export function createBridgeMethods(shared) {
  const { FEISHU_SEEN_LIMIT, FEISHU_PENDING_LIMIT, BRIDGE_JOURNAL_FILE, BRIDGE_JOURNAL_MAX_BYTES, BRIDGE_EVENT_TTL_MS, FEISHU_OUTBOX_LIMIT, fail, textBlocksText, truncateWeComText, emptyBridgeJournal, parseBridgeJournal, bridgeJournalStageError, bridgeJournalErrorCode } = shared
  return {
  async withBridgeJournal(sessionId, updater) {
    let stage = 'workspace-session-lookup'
    let workspace
    try {
      const binding = await this.workspaceForSession(sessionId)
      workspace = binding.workspace
      const { session } = binding
      if (!session) {
        stage = 'active-session-check'
        fail('桥接状态只允许写入活动 DSH 工作区', 403)
      }
      const previous = this.bridgeJournalQueues.get(workspace.id) || Promise.resolve()
      const operation = previous.catch(() => {}).then(async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          stage = 'journal-path-check'
          await this.assertProjectPath(BRIDGE_JOURNAL_FILE, workspace.path)
          stage = 'journal-target-resolution'
          const target = await this.target(BRIDGE_JOURNAL_FILE, workspace.path)
          stage = 'journal-stat'
          const observed = await this.ctx.fs.stat(target)
          let journal
          if (observed) {
            stage = 'journal-read'
            const encoded = await this.ctx.fs.readText(target)
            stage = 'journal-parse'
            journal = parseBridgeJournal(encoded)
          } else {
            journal = emptyBridgeJournal()
          }
          stage = 'journal-update'
          const response = updater(journal)
          if (response?.write === false) return response.value === undefined ? journal : response.value
          journal.updatedAt = new Date().toISOString()
          stage = 'journal-serialize'
          const encoded = JSON.stringify(journal)
          if (Buffer.byteLength(encoded, 'utf8') > BRIDGE_JOURNAL_MAX_BYTES) fail('桥接状态超出持久化大小限制', 507)
          stage = 'sandbox-policy'
          const policy = this.ctx.sandboxPolicy.resolve({ session })
          try {
            stage = 'journal-write'
            await this.ctx.fs.writeText(target, encoded, observed ? { kind: 'replaceIfVersion', version: observed.version } : { kind: 'createIfAbsent' }, undefined, policy)
            return response?.value === undefined ? journal : response.value
          } catch (error) {
            if (attempt < 2 && ['FS_STALE_VERSION', 'FS_NOT_OBSERVED', 'FS_EXISTS'].includes(error?.code)) continue
            throw error
          }
        }
        stage = 'retry-exhausted'
        fail('桥接状态并发更新冲突，请重试', 409)
      })
      this.bridgeJournalQueues.set(workspace.id, operation)
      try { return await operation } finally { if (this.bridgeJournalQueues.get(workspace.id) === operation) this.bridgeJournalQueues.delete(workspace.id) }
    } catch (error) {
      throw bridgeJournalStageError(error, stage)
    }
  },

  recordBridgeJournalFailure(platform, error) {
    const stage = typeof error?.bridgeJournalStage === 'string' ? error.bridgeJournalStage : 'unknown'
    const errorCode = bridgeJournalErrorCode(error)
    this.bridgeJournalDiagnostics = { lastFailure: { at: new Date().toISOString(), platform, stage, errorCode } }
    this.ctx.logger.warn(`project-hub: ${platform} bridge journal failed at ${stage} (${errorCode})`)
  },

  async readBridgeJournal(sessionId) {
    return this.withBridgeJournal(sessionId, (journal) => ({ write: false, value: journal }))
  },

  bridgeAutoResumeFailure(message, cause) {
    const error = new Error(message)
    error.status = 503
    error.code = 'SESSION_AUTO_RESUME_FAILED'
    error.bridgeJournalStage = 'session-auto-resume'
    if (cause instanceof Error) error.cause = cause
    return error
  },

  async resumeBridgeSession(sessionId, platform, binding, expectedGeneration = this.agentPresetRestoreGeneration) {
    try { this.assertAgentPresetRestoreGeneration(expectedGeneration) }
    catch (cause) { throw this.bridgeAutoResumeFailure('Project Hub 会话集成已卸载或重新初始化；消息未送入 DSH。', cause) }
    const existingSession = this.ctx.sessions.get(sessionId)
    const existingAgent = this.ctx.agents?.get(sessionId)
    if (Boolean(existingSession) !== Boolean(existingAgent)) throw this.bridgeAutoResumeFailure('绑定会话的运行状态不一致；请在 DSH 打开对应助手会话后重试。')
    const shouldResume = !existingSession && !existingAgent

    let workspace
    let project
    try {
      ({ workspace } = await this.workspaceForSession(sessionId, { requireActive: false }))
      const projects = await this.listProjects(undefined, workspace.path)
      if (projects.length !== 1) throw new Error('workspace must resolve to exactly one project')
      project = await this.readProject(projects[0].id, undefined, workspace.path)
      if (project.workspaceId !== workspace.id || project.assistantSessionId !== sessionId || project.path !== '.') throw new Error('bound assistant identity does not match a migrated, root-bound workspace project')
      if (platform === 'feishu' && (binding.projectId !== project.id || binding.workspaceId !== workspace.id)) throw new Error('Feishu binding does not match the resolved workspace project')
    } catch (cause) {
      throw this.bridgeAutoResumeFailure('无法安全验证绑定的 DSH 工作区和项目；消息未送入 DSH。', cause)
    }
    try { this.assertAgentPresetRestoreGeneration(expectedGeneration) }
    catch (cause) { throw this.bridgeAutoResumeFailure('Project Hub 会话集成已卸载或重新初始化；消息未送入 DSH。', cause) }

    if (!shouldResume) {
      await this.requireProjectHubAgentPreset(existingAgent, expectedGeneration)
      this.ensureProjectHubAgentTools(existingAgent)
      return
    }
    const resumeRegistry = this.ctx.root?.agents || this.ctx.agents
    if (typeof resumeRegistry?.resume !== 'function' || !this.ctx.sessionPersistence) throw this.bridgeAutoResumeFailure('当前 DSH Host 未提供会话自动恢复能力；请在 DSH 打开对应助手会话后重试。')

    let handle
    let resumedAgent
    try {
      handle = await resumeRegistry.resume({
        resumeSessionId: sessionId,
        setup: async (agentCtx, agent) => {
          resumedAgent = agent
          this.assertAgentPresetRestoreGeneration(expectedGeneration)
          const cwd = agent?.session?.header?.cwd
          if (agent?.session?.id !== sessionId || typeof cwd !== 'string' || !cwd) throw new Error('resumed agent identity or cwd is invalid')
          const resolved = await this.ctx.workspaceRegistry.resolveByPath(cwd)
          this.assertAgentPresetRestoreGeneration(expectedGeneration)
          if (!resolved || resolved.id !== workspace.id || resolved.path !== workspace.path) throw new Error('resumed agent cwd does not match the bound workspace')
          if (typeof agentCtx?.tools?.register !== 'function') throw new Error('resumed agent tool scope is unavailable')
          await this.requireProjectHubAgentPreset(agent, expectedGeneration, { mountContext: agentCtx })
          const activatedAgent = this.ctx.agents?.get(sessionId)
          if (this.ctx.sessions.get(sessionId) && activatedAgent && activatedAgent !== agent) throw new Error('a UI-activated Agent replaced the partial resume before tool attachment')
          this.ensureProjectHubAgentTools(agent, agentCtx.tools, { validatePreviousTools: true })
        }
      })
      this.assertAgentPresetRestoreGeneration(expectedGeneration)
    } catch (cause) {
      const currentAgent = this.ctx.agents?.get(sessionId)
      if (this.isAgentPresetRestoreGenerationCurrent(expectedGeneration) && resumedAgent && currentAgent !== resumedAgent) {
        this.detachBridgeAgentTool(sessionId, resumedAgent)
      }
      // A UI activation may win the race. Reuse it only after both live registries agree.
      const activatedAgent = this.ctx.agents?.get(sessionId)
      if (this.ctx.sessions.get(sessionId) && activatedAgent?.followup) {
        try {
          await this.requireProjectHubAgentPreset(activatedAgent, expectedGeneration)
          this.ensureProjectHubAgentTools(activatedAgent)
          return
        } catch (activationCause) {
          if (this.isAgentPresetRestoreGenerationCurrent(expectedGeneration) && this.ctx.sessions.get(sessionId) && this.ctx.agents?.get(sessionId) === activatedAgent) {
            try { this.ensureProjectHubAgentTools(activatedAgent) }
            catch (attachError) { this.ctx.logger.warn(`project-hub: could not preserve scoped tools on the UI-activated Agent (${bridgeJournalErrorCode(attachError)})`) }
          }
          throw this.bridgeAutoResumeFailure('DSH 未能恢复已激活的绑定助手会话；消息未送入 DSH。', activationCause)
        }
      }
      throw this.bridgeAutoResumeFailure('DSH 未能自动恢复绑定助手会话；消息未送入 DSH，请打开对应助手会话后重发。', cause)
    }

    const liveSession = this.ctx.sessions.get(sessionId)
    const liveAgent = this.ctx.agents?.get(sessionId)
    if (!handle || !liveSession || !liveAgent || typeof liveAgent.followup !== 'function') {
      throw this.bridgeAutoResumeFailure('DSH 自动恢复后未能确认会话和 Agent 均已活动；消息未送入 DSH。')
    }
    try {
      const { workspace: liveWorkspace, project: liveProject } = await this.projectForSession(sessionId)
      this.assertAgentPresetRestoreGeneration(expectedGeneration)
      if (liveWorkspace.id !== workspace.id || liveWorkspace.path !== workspace.path || liveProject.id !== project.id || liveProject.workspaceId !== workspace.id || liveProject.assistantSessionId !== sessionId) throw new Error('resumed session no longer matches its bound project')
    } catch (cause) {
      throw this.bridgeAutoResumeFailure('恢复后的会话工作目录或项目绑定不匹配；消息未送入 DSH。', cause)
    }
  },

  async awaitBridgeAutoResumeAttempt(sessionId, platform, expectedGeneration, attempt) {
    const generation = Number.isInteger(attempt?.generation) ? attempt.generation : -1
    const promise = attempt?.promise || attempt
    if (generation === expectedGeneration) return promise
    try { await promise } catch {}
    try { this.assertAgentPresetRestoreGeneration(expectedGeneration) }
    catch (cause) { throw this.bridgeAutoResumeFailure('Project Hub 会话集成已卸载或重新初始化；消息未送入 DSH。', cause) }
    if (this.bridgeAutoResumeAttempts.get(sessionId) === attempt) this.bridgeAutoResumeAttempts.delete(sessionId)
    return this.ensureBridgeSessionForInbound(sessionId, platform)
  },

  async ensureBridgeSessionForInbound(sessionId, platform) {
    const restoreGeneration = this.agentPresetRestoreGeneration
    try { this.assertAgentPresetRestoreGeneration(restoreGeneration) }
    catch (cause) { throw this.bridgeAutoResumeFailure('Project Hub 会话集成已卸载或重新初始化；消息未送入 DSH。', cause) }
    const inFlight = this.bridgeAutoResumeAttempts.get(sessionId)
    if (inFlight) return this.awaitBridgeAutoResumeAttempt(sessionId, platform, restoreGeneration, inFlight)
    const liveSession = this.ctx.sessions.get(sessionId)
    if (liveSession) {
      const liveAgent = this.ctx.agents?.get(sessionId)
      if (liveAgent && typeof liveAgent.followup === 'function') {
        try {
          if (this.bridgeToolScopeReady) await this.bridgeToolScopeReady
          this.assertAgentPresetRestoreGeneration(restoreGeneration)
          const attached = await this.attachProjectHubToolIfOwned(liveAgent, { strictPresetRestore: true, expectedGeneration: restoreGeneration })
          if (!attached) throw new Error('bound Project Hub tools could not be confirmed for the live Agent')
        } catch (cause) {
          throw this.bridgeAutoResumeFailure('无法确认绑定助手的标准工具和 Project Hub 工具；消息未送入 DSH。', cause)
        }
        return
      }
      const error = new Error('DSH 会话仍在运行，但对应 Agent 当前不可用；请打开该助手会话后重发。')
      error.status = 503
      error.code = 'SESSION_AGENT_NOT_ACTIVE'
      error.bridgeJournalStage = 'agent-session-lookup'
      throw error
    }
    let binding
    try {
      if (platform === 'wecom') {
        binding = this.readStoredWeComBinding()
        if (binding && binding.sessionId === sessionId) {
          // A stored pairing is sufficient authorization for this exact assistant session.
        } else {
          const env = globalThis.process?.env || {}
          const configuredSessionId = typeof env.WECOM_DSH_SESSION_ID === 'string' ? env.WECOM_DSH_SESSION_ID.trim() : ''
          const allowedUsers = String(env.WECOM_ALLOWED_USER_IDS || '').split(',').map((value) => value.trim()).filter(Boolean)
          if (configuredSessionId !== sessionId || !allowedUsers.length) return
          binding = { sessionId }
        }
      } else if (platform === 'feishu') {
        binding = this.readStoredFeishuBinding({ sessionId })
        if (!binding) return
      } else return
    } catch (cause) {
      throw this.bridgeAutoResumeFailure('无法核验绑定的自动恢复设置；消息未送入 DSH。', cause)
    }
    try { this.assertAgentPresetRestoreGeneration(restoreGeneration) }
    catch (cause) { throw this.bridgeAutoResumeFailure('Project Hub 会话集成已卸载或重新初始化；消息未送入 DSH。', cause) }
    const pending = this.bridgeAutoResumeAttempts.get(sessionId)
    if (pending) return this.awaitBridgeAutoResumeAttempt(sessionId, platform, restoreGeneration, pending)
    const attempt = { generation: restoreGeneration, promise: this.resumeBridgeSession(sessionId, platform, binding, restoreGeneration) }
    this.bridgeAutoResumeAttempts.set(sessionId, attempt)
    try { await attempt.promise } finally { if (this.bridgeAutoResumeAttempts.get(sessionId) === attempt) this.bridgeAutoResumeAttempts.delete(sessionId) }
  },

  async restoreBoundBridgeSessions() {
    const sessions = new Map()
    try {
      const binding = this.readStoredWeComBinding()
      if (binding) sessions.set(binding.sessionId, { platform: 'wecom', binding })
      else {
        const env = globalThis.process?.env || {}
        const sessionId = typeof env.WECOM_DSH_SESSION_ID === 'string' ? env.WECOM_DSH_SESSION_ID.trim() : ''
        const users = String(env.WECOM_ALLOWED_USER_IDS || '').split(',').map((value) => value.trim()).filter(Boolean)
        if (sessionId && users.length) sessions.set(sessionId, { platform: 'wecom', binding: { sessionId } })
      }
    } catch (error) {
      this.ctx.logger.warn(`project-hub: could not read WeCom binding for session restore (${bridgeJournalErrorCode(error)})`)
    }
    try {
      for (const conversation of this.readStoredFeishuConversations()) {
        for (const binding of conversation.bindings) sessions.set(binding.sessionId, { platform: 'feishu', binding })
      }
    } catch (error) {
      this.ctx.logger.warn(`project-hub: could not read Feishu bindings for session restore (${bridgeJournalErrorCode(error)})`)
    }
    await Promise.allSettled([...sessions].map(async ([sessionId, target]) => {
      try { await this.ensureBridgeSessionForInbound(sessionId, target.platform) }
      catch (error) { this.ctx.logger.warn(`project-hub: bound session restore failed (${bridgeJournalErrorCode(error)})`) }
    }))
  },

  async claimBridgeEvent(sessionId, platform, key) {
    if (!['wecom', 'feishu'].includes(platform) || typeof key !== 'string' || !key || key.length > 512) throw new Error('Invalid bridge event key')
    await this.ensureBridgeSessionForInbound(sessionId, platform)
    const now = Date.now()
    let duplicate = false
    await this.withBridgeJournal(sessionId, (journal) => {
      const events = journal.seen[platform].filter((entry) => now - entry.at <= BRIDGE_EVENT_TTL_MS).slice(-FEISHU_SEEN_LIMIT)
      duplicate = events.some((entry) => entry.key === key)
      if (!duplicate) events.push({ key, at: now })
      journal.seen[platform] = events.slice(-FEISHU_SEEN_LIMIT)
      return { write: !duplicate, value: duplicate }
    })
    return duplicate
  },

  async releaseBridgeEvent(sessionId, platform, key) {
    if (!['wecom', 'feishu'].includes(platform)) return
    await this.withBridgeJournal(sessionId, (journal) => {
      journal.seen[platform] = journal.seen[platform].filter((entry) => entry.key !== key)
      return { write: true }
    })
  },

  async writeFeishuOutbox(sessionId, record, { remove = false } = {}) {
    const id = record.outboxId || `${sessionId}:${record.replyToMessageId}`
    await this.withBridgeJournal(sessionId, (journal) => {
      const index = journal.feishuOutbox.findIndex((entry) => entry.id === id)
      if (remove) {
        if (index >= 0) journal.feishuOutbox.splice(index, 1)
      } else {
        const safeRecord = {
          id,
          sessionId,
          ...(typeof record.dshMessageId === 'string' ? { dshMessageId: record.dshMessageId.slice(0, 256) } : {}),
          chatId: String(record.chatId || '').slice(0, 256),
          openId: String(record.openId || '').slice(0, 256),
          replyToMessageId: String(record.replyToMessageId || '').slice(0, 256),
          output: String(record.output || '').slice(0, 19000),
          status: record.status === 'sending' || record.status === 'uncertain' ? record.status : 'queued',
          attempts: Number.isSafeInteger(record.attempts) && record.attempts >= 0 ? record.attempts : 0,
          createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
          lastErrorCode: typeof record.lastErrorCode === 'string' ? record.lastErrorCode.slice(0, 48) : ''
        }
        if (!safeRecord.chatId || !safeRecord.openId || !safeRecord.replyToMessageId) throw new Error('Feishu outbox record is missing its bound delivery target')
        if (index >= 0) journal.feishuOutbox[index] = safeRecord
        else {
          if (journal.feishuOutbox.length >= FEISHU_OUTBOX_LIMIT) fail('飞书待发送回复队列已满', 429)
          journal.feishuOutbox.push(safeRecord)
        }
      }
      return { write: true, value: id }
    })
    return id
  },

  async writeFeishuPending(sessionId, record, { remove = false } = {}) {
    const id = record.dshMessageId || record.id
    if (typeof id !== 'string' || !id || id.length > 256) throw new Error('Invalid persisted Feishu message ID')
    await this.withBridgeJournal(sessionId, (journal) => {
      const index = journal.feishuPending.findIndex((entry) => entry.id === id)
      if (remove) {
        if (index >= 0) journal.feishuPending.splice(index, 1)
      } else {
        const safeRecord = {
          id,
          sessionId,
          eventKey: String(record.eventKey || '').slice(0, 512),
          chatId: String(record.chatId || '').slice(0, 256),
          openId: String(record.openId || '').slice(0, 256),
          replyToMessageId: String(record.replyToMessageId || '').slice(0, 256),
          output: String(record.output || '').slice(0, 19000),
          status: ['pending', 'running', 'completed', 'sent'].includes(record.status) ? record.status : 'pending',
          ...(Number.isSafeInteger(record.turn) ? { turn: record.turn } : {}),
          createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
        }
        if (!safeRecord.eventKey || !safeRecord.chatId || !safeRecord.openId || !safeRecord.replyToMessageId) throw new Error('Feishu pending record is missing its bound target')
        if (index >= 0) journal.feishuPending[index] = safeRecord
        else {
          if (journal.feishuPending.length >= FEISHU_PENDING_LIMIT) fail('飞书进行中回复映射队列已满', 429)
          journal.feishuPending.push(safeRecord)
        }
      }
      return { write: true, value: id }
    })
    return id
  },

  trackExternalMessageOrigin(messageId, origin) {
    if (typeof messageId !== 'string' || !messageId) return
    this.externalMessageOrigins.set(messageId, origin)
    while (this.externalMessageOrigins.size > 500) this.externalMessageOrigins.delete(this.externalMessageOrigins.keys().next().value)
  },

  captureMirrorTurn(map, key, sessionId, sourceLabel, userMessage, promptOverride = '') {
    let record = map.get(key)
    if (!record) {
      record = { sessionId, sourceLabel, prompt: '', output: '', userMessageIds: new Set(), hasNonTextInput: false }
      map.set(key, record)
    }
    const messageId = typeof userMessage?.id === 'string' ? userMessage.id : ''
    if (messageId && record.userMessageIds.has(messageId)) return
    if (messageId) record.userMessageIds.add(messageId)
    const promptText = typeof promptOverride === 'string' && promptOverride ? promptOverride : textBlocksText(userMessage?.content)
    if (promptText) record.prompt = `${record.prompt ? `${record.prompt}\n\n` : ''}${promptText}`
    else if (Array.isArray(userMessage?.content) && userMessage.content.length) record.hasNonTextInput = true
    return record
  },

  appendMirrorAnswer(map, key, answer) {
    const record = map.get(key)
    if (record && answer) record.output = `${record.output ? `${record.output}\n\n` : ''}${answer}`
  },

  handleSessionEvent(session, event) {
    const sessionId = session?.id
    if (event?.type === 'user/message' && typeof sessionId === 'string') {
      const messageId = event.data?.id
      const origin = this.externalMessageOrigins.get(messageId)
      const turn = this.wecomOpenTurns.get(sessionId) ?? this.feishuOpenTurns.get(sessionId)
      if (origin?.sessionId === sessionId && Number.isSafeInteger(turn)) origin.turn = turn
    }
    this.handleWeComSessionEvent(session, event)
    this.handleFeishuSessionEvent(session, event)
    if (event?.type === 'turn/end' && typeof sessionId === 'string') {
      for (const [messageId, origin] of this.externalMessageOrigins) {
        if (origin.sessionId === sessionId && (origin.turn === undefined || origin.turn === event.data?.turn)) this.externalMessageOrigins.delete(messageId)
      }
    }
  },

  async finishFeishuReply(record, { existing = false } = {}) {
    const outboxId = record.outboxId || `${record.sessionId}:${record.replyToMessageId}`
    if (!existing && record.dshMessageId) {
      record.status = 'completed'
      await this.writeFeishuPending(record.sessionId, record).catch(() => this.ctx.logger.warn('project-hub: failed to persist completed Feishu turn state'))
    }
    const outboxRecord = { ...record, outboxId, output: String(record.output || '项目助手本轮未返回可展示的文本内容。').trim(), status: 'queued' }
    try {
      if (!existing) await this.writeFeishuOutbox(record.sessionId, outboxRecord)
      this.feishuDurableOutbox.set(outboxId, outboxRecord)
    } catch (error) {
      this.recordFeishuReplyOutcome('outbox-persist-failed', error)
      this.ctx.logger.warn('project-hub: failed to persist completed Feishu reply')
      return
    }
    let pendingRemoved = true
    if (record.dshMessageId) {
      try { await this.writeFeishuPending(record.sessionId, record, { remove: true }) }
      catch { pendingRemoved = false }
    }
    if (!this.feishuClient || this.feishuStatus.state !== 'connected') return
    let binding
    try { binding = this.readStoredFeishuBinding({ sessionId: record.sessionId, chatId: record.chatId, openId: record.openId }) } catch {
      this.recordFeishuReplyOutcome('binding-read-failed')
      return
    }
    if (!binding) {
      await this.writeFeishuOutbox(record.sessionId, outboxRecord, { remove: true }).catch(() => {})
      this.feishuDurableOutbox.delete(outboxId)
      this.recordFeishuReplyOutcome('binding-mismatch')
      return
    }
    outboxRecord.status = 'sending'
    try { await this.writeFeishuOutbox(record.sessionId, outboxRecord) }
    catch (error) {
      this.recordFeishuReplyOutcome('outbox-persist-failed', error)
      return
    }
    const answer = outboxRecord.output
    const capped = answer.length > 19000 ? `${answer.slice(0, 18980)}\n\n（内容过长，已截断）` : answer
    try {
      await this.feishuClient.sendText({ chatId: record.chatId, content: capped, replyToMessageId: record.replyToMessageId })
    } catch (error) {
      outboxRecord.status = 'queued'
      outboxRecord.attempts += 1
      outboxRecord.lastErrorCode = typeof error?.code === 'string' ? error.code.slice(0, 48) : 'other'
      await this.writeFeishuOutbox(record.sessionId, outboxRecord).catch(() => {})
      this.feishuDurableOutbox.set(outboxId, outboxRecord)
      this.recordFeishuReplyOutcome('send-failed', error)
      this.ctx.logger.warn('project-hub: failed to send Feishu assistant reply; the DSH turn will not be rerun')
      return
    }
    if (!pendingRemoved && record.dshMessageId) {
      try { await this.writeFeishuPending(record.sessionId, { ...record, status: 'sent' }) }
      catch {
        outboxRecord.status = 'uncertain'
        this.feishuDurableOutbox.set(outboxId, outboxRecord)
        this.feishuReplyDiagnostics.uncertainCount += 1
        this.recordFeishuReplyOutcome('sent-with-pending-journal-error')
        return
      }
    }
    try {
      await this.writeFeishuOutbox(record.sessionId, outboxRecord, { remove: true })
      this.feishuDurableOutbox.delete(outboxId)
    } catch {
      outboxRecord.status = 'uncertain'
      this.feishuDurableOutbox.set(outboxId, outboxRecord)
      this.feishuReplyDiagnostics.uncertainCount += 1
    }
    this.recordFeishuReplyOutcome('sent')
  },

  async finishWeComReply(record) {
    if (!this.wecomClient || this.wecomStatus.state !== 'connected') return
    const answer = String(record.output || '项目助手本轮未返回可展示的文本内容。').trim()
    const text = answer.length > 1900 ? `${answer.slice(0, 1900)}\n\n（内容过长，已截断）` : answer
    try { await this.wecomClient.replyStream(record.frame, record.streamId, text, true) } catch {}
  },

  async finishWeComMirrorReply(record) {
    if (!this.wecomClient || this.wecomStatus.state !== 'connected') return
    let binding
    try { binding = this.readStoredWeComBinding() } catch { return }
    if (binding?.sessionId !== record.sessionId || !binding.syncMessages) return
    const prompt = truncateWeComText(record.prompt || (record.hasNonTextInput ? '（消息含非文本内容；附件未转发）' : '（未提取到文本内容）'), 700)
    const answer = truncateWeComText(record.output || '项目助手本轮未返回可展示的文本内容。', 1050)
    const content = `${record.sourceLabel}:\n${prompt}\n\n项目助手回复:\n${answer}`
    try { await this.wecomClient.sendText({ recipient: binding.userId, content: truncateWeComText(content, 1900) }) } catch {}
  },

  async finishFeishuMirrorReply(record) {
    if (!this.feishuClient || this.feishuStatus.state !== 'connected') {
      this.recordFeishuReplyOutcome('skipped-not-connected')
      return
    }
    let binding
    try { binding = this.readStoredFeishuBinding({ sessionId: record.sessionId, chatId: record.destinationChatId, openId: record.destinationOpenId }) } catch {
      this.recordFeishuReplyOutcome('binding-read-failed')
      return
    }
    if (!binding?.syncMessages) return
    const prompt = truncateWeComText(record.prompt || (record.hasNonTextInput ? '（消息含非文本内容；附件未转发）' : '（未提取到文本内容）'), 4000)
    const answer = truncateWeComText(record.output || '项目助手本轮未返回可展示的文本内容。', 14000)
    const content = `【${binding.projectName}】\n${record.sourceLabel}:\n${prompt}\n\n项目助手回复:\n${answer}`
    try {
      await this.feishuClient.sendText({ chatId: binding.chatId, content: content.length > 19000 ? `${content.slice(0, 18980)}\n\n（内容过长，已截断）` : content })
      this.recordFeishuReplyOutcome('sent')
    } catch (error) {
      this.recordFeishuReplyOutcome('send-failed', error)
      this.ctx.logger.warn('project-hub: failed to send synchronized Feishu message; the DSH turn will not be rerun')
    }
  },

  async handlePendingFileOverwriteReply({ map, key, text, sessionId, reply }) {
    const pending = map.get(key)
    if (!pending) return false
    if (pending.expiresAt <= Date.now()) {
      this.clearPendingFileOverwrite(map, key)
      await reply('文件替换确认已超时；原文件没有变化，请重新发送该文件。')
      return true
    }
    const first = pending.files?.[0]
    if (!first) {
      this.clearPendingFileOverwrite(map, key)
      await reply('待确认文件已失效，请重新发送附件。')
      return true
    }
    const command = text.trim().toLocaleLowerCase()
    if (['取消', '否', 'no', 'cancel'].includes(command)) {
      this.clearPendingFileOverwrite(map, key)
      const savedNote = pending.savedBefore?.length ? `此前已保存：${pending.savedBefore.join('、')}；` : ''
      await reply(`已取消替换；${savedNote}原文件保持不变，待确认附件未保存。`)
      return true
    }
    if (!['替换', '确认替换', '是', 'yes', 'replace'].includes(command)) {
      await reply(`项目 files/${first.filename} 已存在。请回复「替换」覆盖，或回复「取消」保留原文件；确认有效期 5 分钟。`)
      return true
    }
    if (pending.busy) {
      await reply('该文件正在保存，请稍候。')
      return true
    }
    pending.busy = true
    try {
      const { workspace, project, session } = await this.projectForSession(sessionId)
      if (pending.sessionId !== sessionId || pending.workspaceId !== workspace.id || pending.projectId !== project.id || project.assistantSessionId !== sessionId) {
        this.clearPendingFileOverwrite(map, key)
        await reply('项目绑定已变化，未替换任何文件；请重新发送附件。')
        return true
      }
      const result = await this.writeInboundProjectFile({ workspace, session, filename: first.filename, bytes: first.bytes, overwrite: true })
      const savedBefore = [...(pending.savedBefore || []), `files/${result.filename}`]
      const remaining = pending.files.slice(1)
      this.clearPendingFileOverwrite(map, key, { preserveBytes: true })
      try { first.bytes?.fill?.(0) } catch {}
      first.bytes = undefined
      const continued = remaining.length ? await this.saveInboundFileBatch({ map, key, files: remaining, workspace, project, session, sessionId, reply, savedBefore }) : { pending: false, saved: savedBefore }
      if (!remaining.length) pending.files = []
      if (continued.pending) return true
      await reply(`已保存文件：${continued.saved.join('、')}。文件仅保存在项目目录中，未送入助手读取。`)
    } catch {
      pending.busy = false
      await reply('替换失败，原文件应保持不变。请稍后回复「替换」重试，或回复「取消」。')
    }
    return true
  },
  }
}

