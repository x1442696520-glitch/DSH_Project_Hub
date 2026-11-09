export function createFeishuStateMethods(shared) {
  const { randomUUID, createKeyringEntry, WECOM_CREDENTIAL_SERVICE, FEISHU_CREDENTIAL_ACCOUNT, FEISHU_BINDING_ACCOUNT, FEISHU_PAIRING_TTL_MS, fail, safeText } = shared
  return {
  createFeishuCredentialEntry() {
    return createKeyringEntry(WECOM_CREDENTIAL_SERVICE, FEISHU_CREDENTIAL_ACCOUNT)
  },

  readStoredFeishuCredentials() {
    const encoded = this.createFeishuCredentialEntry().getPassword()
    if (!encoded) return null
    let credentials
    try { credentials = JSON.parse(encoded) } catch { throw new Error('系统凭证库中的飞书应用凭证格式无效') }
    if (typeof credentials?.appId !== 'string' || typeof credentials?.appSecret !== 'string' || !credentials.appId.trim() || !credentials.appSecret.trim()) {
      throw new Error('系统凭证库中的飞书应用凭证格式无效')
    }
    return {
      appId: credentials.appId.trim(),
      appSecret: credentials.appSecret.trim(),
      tenantKey: typeof credentials.tenantKey === 'string' ? credentials.tenantKey.trim() : ''
    }
  },

  getFeishuStatus() {
    const { sequence: _sequence, ...inboundDiagnostics } = this.feishuInboundDiagnostics
    return { ...this.feishuStatus, credentialSource: this.feishuCredentialSource, inboundDiagnostics, cardActionDiagnostics: { ...this.feishuCardActionDiagnostics }, replyDiagnostics: { ...this.feishuReplyDiagnostics }, bridgeJournalDiagnostics: { ...this.bridgeJournalDiagnostics } }
  },

  recordFeishuReplyOutcome(outcome, error) {
    const allowedCodes = new Set(['format_error', 'target_revoked', 'permission_denied', 'rate_limited', 'send_timeout', 'not_connected', 'unknown'])
    const code = typeof error?.code === 'string' && allowedCodes.has(error.code) ? error.code : error ? 'other' : null
    const pendingTurnReplies = [...this.feishuTurnReplies.values()].reduce((total, replies) => total + replies.length, 0)
    this.feishuReplyDiagnostics = {
      pendingCount: this.feishuPendingMessages.size + pendingTurnReplies + this.feishuDurableOutbox.size,
      sentCount: this.feishuReplyDiagnostics.sentCount + (outcome === 'sent' ? 1 : 0),
      failedCount: this.feishuReplyDiagnostics.failedCount + (outcome === 'send-failed' || outcome === 'agent-followup-failed' || outcome === 'outbox-persist-failed' ? 1 : 0),
      uncertainCount: this.feishuReplyDiagnostics.uncertainCount,
      lastAt: new Date().toISOString(),
      lastOutcome: outcome,
      lastErrorCode: code
    }
  },

  beginFeishuInboundDiagnostic(message) {
    const sequence = this.feishuInboundDiagnostics.sequence + 1
    const rawType = typeof message?.rawContentType === 'string' ? message.rawContentType : ''
    const lastType = rawType === 'text' || rawType === 'file' ? rawType : 'other'
    this.feishuInboundDiagnostics = {
      ...this.feishuInboundDiagnostics,
      sequence,
      receivedCount: this.feishuInboundDiagnostics.receivedCount + 1,
      lastAt: new Date().toISOString(),
      lastType,
      lastOutcome: 'processing'
    }
    return sequence
  },

  setFeishuInboundOutcome(sequence, outcome) {
    if (!Number.isSafeInteger(sequence) || sequence <= 0 || this.feishuInboundDiagnostics.sequence !== sequence) return
    this.feishuInboundDiagnostics = { ...this.feishuInboundDiagnostics, lastOutcome: outcome }
  },

  recordFeishuReject(event) {
    const allowedReasons = new Set(['group_not_allowed', 'sender_not_allowed', 'no_mention', 'dm_disabled', 'mention_all_blocked', 'bot_loop'])
    const reason = typeof event?.reason === 'string' && allowedReasons.has(event.reason) ? event.reason : 'other'
    this.feishuInboundDiagnostics = {
      ...this.feishuInboundDiagnostics,
      rejectedCount: this.feishuInboundDiagnostics.rejectedCount + 1,
      lastRejectAt: new Date().toISOString(),
      lastRejectReason: reason,
      lastOutcome: `sdk-reject:${reason}`
    }
  },

  recordFeishuDispatcherError(error) {
    const allowedCodes = new Set(['format_error', 'target_revoked', 'permission_denied', 'rate_limited', 'send_timeout', 'upload_failed', 'ssrf_blocked', 'not_connected', 'unknown', 'not_supported'])
    const code = typeof error?.code === 'string' && allowedCodes.has(error.code) ? error.code : 'other'
    this.feishuInboundDiagnostics = {
      ...this.feishuInboundDiagnostics,
      dispatcherErrorCount: this.feishuInboundDiagnostics.dispatcherErrorCount + 1,
      lastDispatcherErrorAt: new Date().toISOString(),
      lastDispatcherErrorCode: code,
      lastOutcome: `dispatcher-error:${code}`
    }
  },

  startFeishuConnection() {
    let credentials
    let keyringError = null
    try { credentials = this.readStoredFeishuCredentials() }
    catch (error) { keyringError = error }
    let source = 'system-credential-store'
    if (!credentials) {
      const env = globalThis.process?.env || {}
      const appId = typeof env.FEISHU_APP_ID === 'string' ? env.FEISHU_APP_ID.trim() : ''
      const appSecret = typeof env.FEISHU_APP_SECRET === 'string' ? env.FEISHU_APP_SECRET.trim() : ''
      const tenantKey = typeof env.FEISHU_TENANT_KEY === 'string' ? env.FEISHU_TENANT_KEY.trim() : ''
      if (appId && appSecret) { credentials = { appId, appSecret, tenantKey }; source = 'environment' }
    }
    if (!credentials) {
      this.feishuCredentialSource = null
      this.feishuClient = null
      this.feishuStatus = keyringError
        ? { state: 'error', label: '无法访问系统凭证库；可改用 Host 环境变量' }
        : { state: 'not-configured', label: '未配置飞书 App ID / App Secret' }
      return () => this.stopFeishuConnection()
    }

    this.feishuCredentialSource = source
    this.feishuTenantKey = credentials.tenantKey || ''
    try {
      const client = this.createFeishuClient(credentials)
      this.feishuClient = client
      this.feishuStatus = { state: 'connecting', label: '飞书官方长连接连接中' }
      client.on('message', (message) => {
        if (this.feishuClient !== client) return
        const diagnosticSequence = this.beginFeishuInboundDiagnostic(message)
        return Promise.resolve(this.handleFeishuMessage(message, diagnosticSequence)).then(() => {
          if (this.feishuInboundDiagnostics.sequence === diagnosticSequence && this.feishuInboundDiagnostics.lastOutcome === 'processing') this.setFeishuInboundOutcome(diagnosticSequence, 'processed')
        }).catch(() => {
          this.setFeishuInboundOutcome(diagnosticSequence, 'handler-error')
          this.ctx.logger.warn('project-hub: Feishu inbound message handler failed')
        })
      })
      client.on('cardAction', (event) => {
        if (this.feishuClient !== client) return
        return Promise.resolve(this.handleFeishuCardAction(event)).catch(() => {
          this.ctx.logger.warn('project-hub: Feishu project picker action failed')
        })
      })
      client.on('reconnecting', () => {
        if (this.feishuClient === client) this.feishuStatus = { state: 'reconnecting', label: '飞书长连接重连中' }
      })
      client.on('reconnected', () => {
        if (this.feishuClient === client) {
          this.feishuStatus = { state: 'connected', label: '飞书长连接已连接' }
          void this.recoverFeishuOutbox()
        }
      })
      client.on('reject', (event) => {
        if (this.feishuClient === client) this.recordFeishuReject(event)
      })
      client.on('error', (error) => {
        if (this.feishuClient !== client) return
        this.recordFeishuDispatcherError(error)
        this.ctx.logger.warn('project-hub: feishu channel dispatcher error')
      })
      Promise.resolve(client.connect()).then(() => {
        if (this.feishuClient === client) {
          this.feishuStatus = { state: 'connected', label: '飞书长连接已连接' }
          void this.restoreFeishuStateOnStartup()
        }
      }).catch(() => {
        if (this.feishuClient === client) this.feishuStatus = { state: 'error', label: '飞书长连接失败（检查 App 凭证、机器人权限和网络）' }
      })
    } catch {
      this.feishuClient = null
      this.feishuStatus = { state: 'error', label: '飞书官方 SDK 长连接初始化失败' }
    }
    return () => this.stopFeishuConnection()
  },

  stopFeishuConnection() {
    const client = this.feishuClient
    this.feishuClient = null
    try { void client?.disconnect()?.catch?.(() => {}) } catch {}
    this.feishuPendingMessages.clear()
    this.clearAllPendingFileOverwrites(this.feishuPendingFileOverwrites)
    this.feishuOpenTurns.clear()
    this.feishuTurnReplies.clear()
    this.feishuMirrorTurnReplies.clear()
    this.externalMessageOrigins.clear()
    this.feishuCredentialSource = null
    this.feishuTenantKey = ''
    this.feishuPairingChallenges.clear()
    this.feishuStatus = { state: 'stopped', label: '飞书长连接已停止' }
  },

  saveFeishuCredentials(appIdValue, appSecretValue, tenantKeyValue = '') {
    const appId = safeText(appIdValue, '飞书 App ID', 128)
    const appSecret = safeText(appSecretValue, '飞书 App Secret', 1024)
    const tenantKey = typeof tenantKeyValue === 'string' && tenantKeyValue.trim() ? safeText(tenantKeyValue, '飞书 Tenant Key', 128) : ''
    if (/[^\x21-\x7e]/.test(appId) || /[\u0000-\u001f\u007f]/.test(appSecret) || /[\u0000-\u001f\u007f]/.test(tenantKey)) fail('飞书凭证格式无效')
    try { this.createFeishuCredentialEntry().setPassword(JSON.stringify({ appId, appSecret, tenantKey })) }
    catch { fail('无法写入系统凭证库；请检查操作系统凭证管理器权限或使用 Host 环境变量', 503) }
    this.stopFeishuConnection()
    this.startFeishuConnection()
    return this.getFeishuStatus()
  },

  clearStoredFeishuCredentials() {
    try { this.createFeishuCredentialEntry().deletePassword() }
    catch { fail('无法删除系统凭证库中的飞书应用凭证', 503) }
    this.stopFeishuConnection()
    this.startFeishuConnection()
    return this.getFeishuStatus()
  },

  createFeishuBindingEntry() {
    return createKeyringEntry(WECOM_CREDENTIAL_SERVICE, FEISHU_BINDING_ACCOUNT)
  },

  readStoredFeishuConversations() {
    const encoded = this.createFeishuBindingEntry().getPassword()
    if (!encoded) return []
    let stored
    try { stored = JSON.parse(encoded) } catch { throw new Error('系统凭证库中的飞书绑定格式无效') }
    const legacyKeys = ['openId', 'tenantKey', 'chatId', 'sessionId', 'projectId', 'workspaceId']
    const source = Array.isArray(stored?.conversations)
      ? stored.conversations
      : legacyKeys.every((key) => typeof stored?.[key] === 'string')
        ? [{ openId: stored.openId, tenantKey: stored.tenantKey, chatId: stored.chatId, activeSessionId: stored.sessionId, bindings: [{ sessionId: stored.sessionId, projectId: stored.projectId, workspaceId: stored.workspaceId, projectName: stored.projectName, syncMessages: stored.syncMessages === true }] }]
        : null
    if (!source) throw new Error('系统凭证库中的飞书绑定格式无效')
    return source.map((conversation) => {
      for (const key of ['openId', 'tenantKey', 'chatId']) {
        if (typeof conversation?.[key] !== 'string' || !conversation[key].trim()) throw new Error('系统凭证库中的飞书绑定格式无效')
      }
      if (!Array.isArray(conversation.bindings) || !conversation.bindings.length) throw new Error('系统凭证库中的飞书绑定格式无效')
      const bindings = conversation.bindings.map((binding) => {
        for (const key of ['sessionId', 'projectId', 'workspaceId']) {
          if (typeof binding?.[key] !== 'string' || !binding[key].trim()) throw new Error('系统凭证库中的飞书绑定格式无效')
        }
        const workspaceId = binding.workspaceId.trim()
        let workspaceTitle = ''
        try {
          const workspace = this.ctx.workspaceRegistry.get(workspaceId)
          if (typeof workspace?.title === 'string' && workspace.title.trim()) workspaceTitle = workspace.title
        } catch {}
        const storedName = typeof binding.projectName === 'string' && binding.projectName.trim() ? binding.projectName : binding.projectId
        return {
          sessionId: binding.sessionId.trim(),
          projectId: binding.projectId.trim(),
          workspaceId,
          projectName: safeText(workspaceTitle || storedName, '飞书项目名', 200),
          syncMessages: binding.syncMessages === true
        }
      })
      const requestedActive = typeof conversation.activeSessionId === 'string' ? conversation.activeSessionId.trim() : ''
      const activeSessionId = bindings.some((binding) => binding.sessionId === requestedActive) ? requestedActive : bindings[0].sessionId
      return {
        openId: conversation.openId.trim(), tenantKey: conversation.tenantKey.trim(), chatId: conversation.chatId.trim(), activeSessionId, bindings,
        ...(typeof conversation.pickerMessageId === 'string' && conversation.pickerMessageId.trim() ? { pickerMessageId: safeText(conversation.pickerMessageId, '飞书选择卡片 message_id', 256) } : {})
      }
    })
  },

  saveStoredFeishuConversations(conversations) {
    try {
      if (conversations.length) this.createFeishuBindingEntry().setPassword(JSON.stringify({ version: 2, conversations }))
      else this.createFeishuBindingEntry().deletePassword()
    } catch { fail('无法将飞书绑定写入系统凭证库', 503) }
  },

  readStoredFeishuConversation({ tenantKey, chatId, openId } = {}) {
    return this.readStoredFeishuConversations().find((conversation) =>
      (!tenantKey || conversation.tenantKey === tenantKey) && (!chatId || conversation.chatId === chatId) && (!openId || conversation.openId === openId)
    ) || null
  },

  readStoredFeishuBinding({ sessionId, tenantKey, chatId, openId, activeOnly = false } = {}) {
    for (const conversation of this.readStoredFeishuConversations()) {
      if (tenantKey && conversation.tenantKey !== tenantKey || chatId && conversation.chatId !== chatId || openId && conversation.openId !== openId) continue
      const binding = sessionId
        ? conversation.bindings.find((candidate) => candidate.sessionId === sessionId)
        : activeOnly
          ? conversation.bindings.find((candidate) => candidate.sessionId === conversation.activeSessionId)
          : conversation.bindings[0]
      if (binding) return { ...binding, openId: conversation.openId, tenantKey: conversation.tenantKey, chatId: conversation.chatId, activeSessionId: conversation.activeSessionId, active: binding.sessionId === conversation.activeSessionId }
    }
    return null
  },

  saveFeishuBinding(binding) {
    const value = {}
    for (const key of ['openId', 'tenantKey', 'chatId', 'sessionId', 'projectId', 'workspaceId']) value[key] = safeText(binding?.[key], `飞书 ${key}`, 256)
    const conversations = this.readStoredFeishuConversations()
    if (conversations.some((conversation) => conversation.tenantKey !== value.tenantKey)) fail('当前 Host 已有飞书绑定到另一个租户，拒绝跨租户绑定', 409)
    const existingTarget = conversations.find((conversation) => conversation.tenantKey === value.tenantKey && conversation.chatId === value.chatId)
    if (existingTarget && existingTarget.openId !== value.openId) fail('飞书私聊 ID 与授权用户不匹配', 403)
    const matchesBinding = (candidate) => candidate.sessionId === value.sessionId || candidate.projectId === value.projectId && candidate.workspaceId === value.workspaceId
    const previousConversation = conversations.find((conversation) => conversation.bindings.some(matchesBinding))
    const previousIndex = previousConversation?.bindings.findIndex(matchesBinding) ?? -1
    const previous = previousIndex >= 0 ? previousConversation.bindings[previousIndex] : undefined
    const syncMessages = typeof binding?.syncMessages === 'boolean' ? binding.syncMessages : previous?.syncMessages === true
    const projectName = safeText(typeof binding?.projectName === 'string' && binding.projectName.trim() ? binding.projectName : previous?.projectName || value.projectId, '飞书项目名', 200)
    const shouldActivate = typeof binding?.activate === 'boolean' ? binding.activate : binding?.active !== false
    for (const conversation of conversations) conversation.bindings = conversation.bindings.filter((candidate) => !matchesBinding(candidate))
    const remaining = conversations.filter((conversation) => conversation.bindings.length || conversation === previousConversation && conversation.tenantKey === value.tenantKey && conversation.chatId === value.chatId && conversation.openId === value.openId)
    let target = remaining.find((conversation) => conversation.tenantKey === value.tenantKey && conversation.chatId === value.chatId)
    if (target && target.openId !== value.openId) fail('飞书私聊 ID 与授权用户不匹配', 403)
    if (!target) {
      target = { openId: value.openId, tenantKey: value.tenantKey, chatId: value.chatId, activeSessionId: value.sessionId, bindings: [] }
      remaining.push(target)
    }
    const nextBinding = { sessionId: value.sessionId, projectId: value.projectId, workspaceId: value.workspaceId, projectName, syncMessages }
    if (target === previousConversation && previousIndex >= 0) target.bindings.splice(Math.min(previousIndex, target.bindings.length), 0, nextBinding)
    else target.bindings.push(nextBinding)
    const currentSelectionExists = target.bindings.some((candidate) => candidate.sessionId === target.activeSessionId)
    if (shouldActivate || !currentSelectionExists) target.activeSessionId = value.sessionId
    this.saveStoredFeishuConversations(remaining)
    return { state: 'bound', syncMessages, active: target.activeSessionId === value.sessionId, projectName }
  },

  setFeishuActiveProject({ tenantKey, chatId, openId, sessionId }) {
    const conversations = this.readStoredFeishuConversations()
    const conversation = conversations.find((candidate) => candidate.tenantKey === tenantKey && candidate.chatId === chatId && candidate.openId === openId)
    if (!conversation || !conversation.bindings.some((binding) => binding.sessionId === sessionId)) return false
    conversation.activeSessionId = sessionId
    this.saveStoredFeishuConversations(conversations)
    return true
  },

  getFeishuPairingStatus(sessionId, workspaceSessionIds = []) {
    for (const [code, challenge] of this.feishuPairingChallenges) {
      if (challenge.expiresAt <= Date.now()) this.feishuPairingChallenges.delete(code)
      else if (challenge.initiatorSessionId === sessionId || challenge.sessionId === sessionId) return { state: 'waiting', code, expiresAt: challenge.expiresAt }
    }
    try {
      const binding = this.readStoredFeishuBinding({ sessionId })
      if (binding) return { state: 'bound', syncMessages: binding.syncMessages, active: binding.active, projectName: binding.projectName }
      return { state: 'unbound' }
    } catch {
      return { state: 'error', label: '无法访问系统凭证库中的飞书绑定信息' }
    }
  },

  startFeishuPairing(sessionId, workspace, project) {
    if (!this.feishuClient || this.feishuStatus.state !== 'connected') fail('飞书长连接尚未连接', 503)
    const assistantSessionId = project.assistantSessionId
    if (!assistantSessionId || !workspace.sessionIds.includes(assistantSessionId)) fail('项目尚未绑定此工作区内的助手会话', 409)
    try { this.readStoredFeishuConversations() } catch { fail('无法访问系统凭证库中的飞书绑定信息', 503) }
    const agent = this.ctx.agents?.get(assistantSessionId)
    if (!agent || typeof agent.followup !== 'function') fail('项目助手 Agent 当前未运行', 409)
    for (const [pendingCode, challenge] of this.feishuPairingChallenges) if (challenge.initiatorSessionId === sessionId || challenge.sessionId === assistantSessionId) this.feishuPairingChallenges.delete(pendingCode)
    const code = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
    this.feishuPairingChallenges.set(code, {
      code,
      initiatorSessionId: sessionId,
      sessionId: assistantSessionId,
      projectId: project.id,
      projectName: workspace.title || project.name,
      workspaceId: workspace.id,
      expiresAt: Date.now() + FEISHU_PAIRING_TTL_MS
    })
    return this.getFeishuPairingStatus(sessionId, workspace.sessionIds)
  },

  clearFeishuPairing(sessionId) {
    let conversations
    try { conversations = this.readStoredFeishuConversations() }
    catch { fail('无法访问系统凭证库中的飞书绑定信息', 503) }
    let removed = false
    for (const conversation of conversations) {
      const before = conversation.bindings.length
      conversation.bindings = conversation.bindings.filter((binding) => binding.sessionId !== sessionId)
      if (conversation.bindings.length !== before) removed = true
      if (!conversation.bindings.some((binding) => binding.sessionId === conversation.activeSessionId)) conversation.activeSessionId = conversation.bindings[0]?.sessionId || ''
    }
    const remaining = conversations.filter((conversation) => conversation.bindings.length)
    if (removed) this.saveStoredFeishuConversations(remaining)
    for (const [code, challenge] of this.feishuPairingChallenges) if (challenge.initiatorSessionId === sessionId || challenge.sessionId === sessionId) this.feishuPairingChallenges.delete(code)
    return { state: 'unbound' }
  },

  setFeishuMessageSync(sessionId, enabled) {
    if (typeof enabled !== 'boolean') fail('同步开关必须为 true 或 false')
    let binding
    try { binding = this.readStoredFeishuBinding({ sessionId }) }
    catch { fail('无法访问系统凭证库中的飞书绑定信息', 503) }
    if (!binding) fail('请先在当前 DSH 会话完成飞书配对', 409)
    return this.saveFeishuBinding({ ...binding, syncMessages: enabled })
  },
  }
}

