export function createWecomStateMethods(shared) {
  const { randomUUID, createKeyringEntry, WECOM_CREDENTIAL_SERVICE, WECOM_CREDENTIAL_ACCOUNT, WECOM_BINDING_ACCOUNT, WECOM_PAIRING_TTL_MS, fail, safeText } = shared
  return {
  createWeComCredentialEntry() {
    return createKeyringEntry(WECOM_CREDENTIAL_SERVICE, WECOM_CREDENTIAL_ACCOUNT)
  },

  readStoredWeComCredentials() {
    const encoded = this.createWeComCredentialEntry().getPassword()
    if (!encoded) return null
    let credentials
    try { credentials = JSON.parse(encoded) } catch { throw new Error('系统凭证库中的企业微信凭证格式无效') }
    if (typeof credentials?.botId !== 'string' || typeof credentials?.secret !== 'string' || !credentials.botId.trim() || !credentials.secret.trim()) {
      throw new Error('系统凭证库中的企业微信凭证格式无效')
    }
    return { botId: credentials.botId.trim(), secret: credentials.secret.trim() }
  },

  getWeComStatus() {
    return { ...this.wecomStatus, credentialSource: this.wecomCredentialSource, bridgeJournalDiagnostics: { ...this.bridgeJournalDiagnostics } }
  },

  startWeComConnection() {
    let credentials
    let keyringError = null
    try { credentials = this.readStoredWeComCredentials() }
    catch (error) { keyringError = error }
    let source = 'system-credential-store'
    if (!credentials) {
      const env = globalThis.process?.env || {}
      const botId = typeof env.WECOM_AIBOT_ID === 'string' ? env.WECOM_AIBOT_ID.trim() : ''
      const secret = typeof env.WECOM_AIBOT_SECRET === 'string' ? env.WECOM_AIBOT_SECRET.trim() : ''
      if (botId && secret) {
        credentials = { botId, secret }
        source = 'environment'
      }
    }
    if (!credentials) {
      this.wecomCredentialSource = null
      this.wecomClient = null
      this.wecomStatus = keyringError
        ? { state: 'error', label: '无法访问系统凭证库；可改用 Host 环境变量' }
        : { state: 'not-configured', label: '未配置 Bot ID / Secret' }
      return () => this.stopWeComConnection()
    }

    this.wecomCredentialSource = source
    try {
      const client = this.createWeComClient(credentials)
      this.wecomClient = client
      this.wecomStatus = { state: 'connecting', label: '长连接连接中' }
      client.on('connected', () => { if (this.wecomClient === client) this.wecomStatus = { state: 'connecting', label: '已连接，正在认证' } })
      client.on('authenticated', () => {
        if (this.wecomClient !== client) return
        this.wecomStatus = { state: 'connected', label: '长连接已认证' }
        void this.restoreBoundBridgeSessions()
      })
      client.on('reconnecting', () => { if (this.wecomClient === client) this.wecomStatus = { state: 'reconnecting', label: '长连接重连中' } })
      client.on('disconnected', () => { if (this.wecomClient === client) this.wecomStatus = { state: 'disconnected', label: '长连接已断开' } })
      client.on('error', () => { if (this.wecomClient === client) this.wecomStatus = { state: 'error', label: '长连接出错（检查 Bot 凭证和网络）' } })
      client.on('message.text', (frame) => this.wecomClient === client ? this.handleWeComText(frame) : undefined)
      client.on('message.file', (frame) => this.wecomClient === client ? this.handleWeComFile(frame) : undefined)
      client.connect()
    } catch {
      this.wecomClient = null
      this.wecomStatus = { state: 'error', label: '智能机器人长连接初始化失败' }
    }
    return () => this.stopWeComConnection()
  },

  stopWeComConnection() {
    const client = this.wecomClient
    this.wecomClient = null
    try { client?.disconnect() } catch {}
    this.wecomPendingMessages.clear()
    this.clearAllPendingFileOverwrites(this.wecomPendingFileOverwrites)
    this.wecomOpenTurns.clear()
    this.wecomTurnReplies.clear()
    this.wecomMirrorTurnReplies.clear()
    this.externalMessageOrigins.clear()
    this.wecomCredentialSource = null
    this.wecomPairingChallenge = null
    this.wecomStatus = { state: 'stopped', label: '长连接已停止' }
  },

  saveWeComCredentials(botIdValue, secretValue) {
    const botId = safeText(botIdValue, 'Bot ID', 128)
    const secret = safeText(secretValue, 'Bot Secret', 1024)
    if (/[\u0000-\u001f\u007f]/.test(botId) || /[\u0000-\u001f\u007f]/.test(secret)) fail('Bot ID / Secret 格式无效')
    try { this.createWeComCredentialEntry().setPassword(JSON.stringify({ botId, secret })) }
    catch { fail('无法写入系统凭证库；请检查 Windows 凭证管理器权限或使用 Host 环境变量', 503) }
    this.stopWeComConnection()
    this.startWeComConnection()
    return this.getWeComStatus()
  },

  clearStoredWeComCredentials() {
    try { this.createWeComCredentialEntry().deletePassword() }
    catch { fail('无法删除系统凭证库中的企业微信凭证', 503) }
    this.stopWeComConnection()
    this.startWeComConnection()
    return this.getWeComStatus()
  },

  createWeComBindingEntry() {
    return createKeyringEntry(WECOM_CREDENTIAL_SERVICE, WECOM_BINDING_ACCOUNT)
  },

  readStoredWeComBinding() {
    const encoded = this.createWeComBindingEntry().getPassword()
    if (!encoded) return null
    let binding
    try { binding = JSON.parse(encoded) } catch { throw new Error('系统凭证库中的企业微信绑定格式无效') }
    if (typeof binding?.userId !== 'string' || typeof binding?.sessionId !== 'string' || !binding.userId.trim() || !binding.sessionId.trim()) {
      throw new Error('系统凭证库中的企业微信绑定格式无效')
    }
    const syncMessages = typeof binding.syncMessages === 'boolean' ? binding.syncMessages : binding.syncDshReplies === true
    return { userId: binding.userId.trim(), sessionId: binding.sessionId.trim(), syncMessages }
  },

  saveWeComBinding(userIdValue, sessionIdValue, syncMessagesValue) {
    const userId = safeText(userIdValue, '企业微信 UserID', 128)
    const sessionId = safeText(sessionIdValue, 'DSH Session ID', 100)
    if (/[\u0000-\u001f\u007f]/.test(userId)) fail('企业微信 UserID 格式无效')
    let previous
    try { previous = this.readStoredWeComBinding() } catch { fail('无法读取系统凭证库中的企业微信绑定', 503) }
    const sameBinding = previous?.sessionId === sessionId && previous?.userId === userId
    const syncMessages = typeof syncMessagesValue === 'boolean' ? syncMessagesValue : sameBinding && previous.syncMessages
    try { this.createWeComBindingEntry().setPassword(JSON.stringify({ userId, sessionId, syncMessages })) }
    catch { fail('无法将企业微信绑定写入系统凭证库', 503) }
    return { state: 'bound', userId, syncMessages }
  },

  getWeComPairingStatus(sessionId, workspaceSessionIds = []) {
    const challenge = this.wecomPairingChallenge
    if (challenge && challenge.expiresAt <= Date.now()) this.wecomPairingChallenge = null
    const current = this.wecomPairingChallenge
    if (current?.sessionId === sessionId) return { state: 'waiting', code: current.code, expiresAt: current.expiresAt }
    try {
      const binding = this.readStoredWeComBinding()
      if (binding?.sessionId === sessionId) return { state: 'bound', userId: binding.userId, syncMessages: binding.syncMessages }
      if (binding && workspaceSessionIds.includes(binding.sessionId)) return { state: 'bound-elsewhere', ownerSessionId: binding.sessionId }
      return { state: 'unbound' }
    } catch {
      return { state: 'error', label: '无法访问系统凭证库中的绑定信息' }
    }
  },

  startWeComPairing(sessionId, project) {
    if (!this.wecomClient || this.wecomStatus.state !== 'connected') fail('企业微信长连接尚未认证', 503)
    if (!project.assistantSessionId) fail('项目尚未绑定助手会话', 409)
    const agent = this.ctx.agents?.get(project.assistantSessionId)
    if (!agent || typeof agent.followup !== 'function') fail('项目助手 Agent 当前未运行', 409)
    const challenge = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
    this.wecomPairingChallenge = { code: challenge, sessionId, expiresAt: Date.now() + WECOM_PAIRING_TTL_MS }
    return this.getWeComPairingStatus(sessionId)
  },

  clearWeComPairing(sessionId) {
    let binding
    try { binding = this.readStoredWeComBinding() }
    catch { fail('无法访问系统凭证库中的绑定信息', 503) }
    if (binding && binding.sessionId !== sessionId) fail('只能解除当前 DSH 会话创建的企业微信绑定', 403)
    try { this.createWeComBindingEntry().deletePassword() }
    catch { fail('无法解除系统凭证库中的企业微信绑定', 503) }
    if (this.wecomPairingChallenge?.sessionId === sessionId) this.wecomPairingChallenge = null
    return { state: 'unbound' }
  },

  setWeComReplySync(sessionId, enabled) {
    if (typeof enabled !== 'boolean') fail('同步开关必须为 true 或 false')
    let binding
    try { binding = this.readStoredWeComBinding() }
    catch { fail('无法访问系统凭证库中的绑定信息', 503) }
    if (!binding || binding.sessionId !== sessionId) fail('请先在当前 DSH 会话完成企业微信配对', 409)
    return this.saveWeComBinding(binding.userId, binding.sessionId, enabled)
  },
  }
}

