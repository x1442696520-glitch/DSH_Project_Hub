export function createWecomRuntimeMethods(shared) {
  const { INBOUND_FILE_MAX_BYTES, INBOUND_FILE_BATCH_CONCURRENCY, sanitizeInboundFilename, makeId, bridgeJournalClaimFailureNotice } = shared
  return {
  handleWeComSessionEvent(session, event) {
    const sessionId = session?.id
    if (typeof sessionId !== 'string' || !event?.type) return
    const currentTurn = this.wecomOpenTurns.get(sessionId)
    if (event.type === 'turn/start') {
      this.wecomOpenTurns.set(sessionId, event.data.turn)
      return
    }
    if (event.type === 'user/message') {
      if (!Number.isSafeInteger(currentTurn)) return
      const key = `${sessionId}:${currentTurn}`
      const userMessage = event.data || {}
      const record = this.wecomPendingMessages.get(userMessage.id)
      if (record?.sessionId === sessionId) {
        this.wecomPendingMessages.delete(userMessage.id)
        const replies = this.wecomTurnReplies.get(key) || []
        replies.push(record)
        this.wecomTurnReplies.set(key, replies)
      } else if (!this.wecomTurnReplies.has(key) && userMessage.source?.kind === 'user') {
        const origin = this.externalMessageOrigins.get(userMessage.id)
        const sourcePlatform = origin?.sessionId === sessionId ? origin.platform : 'dsh'
        if (sourcePlatform !== 'wecom') {
          try {
            const binding = this.readStoredWeComBinding()
            if (binding?.sessionId === sessionId && binding.syncMessages) {
              const sourceLabel = sourcePlatform === 'feishu' ? '飞书消息' : 'DSH消息'
              this.captureMirrorTurn(this.wecomMirrorTurnReplies, key, sessionId, sourceLabel, userMessage, origin?.prompt)
            }
          } catch {}
        }
      }
      return
    }
    if (event.type === 'assistant/message') {
      const key = `${sessionId}:${event.data?.turn}`
      const answer = Array.isArray(event.data?.message?.content)
        ? event.data.message.content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('')
        : ''
      this.appendMirrorAnswer(this.wecomMirrorTurnReplies, key, answer)
      const replies = this.wecomTurnReplies.get(key)
      if (replies?.length && answer) for (const record of replies) record.output = `${record.output ? `${record.output}\n\n` : ''}${answer}`
      return
    }
    if (event.type === 'turn/end') {
      const key = `${sessionId}:${event.data?.turn}`
      const replies = this.wecomTurnReplies.get(key) || []
      this.wecomTurnReplies.delete(key)
      const mirrorReply = this.wecomMirrorTurnReplies.get(key)
      this.wecomMirrorTurnReplies.delete(key)
      if (this.wecomOpenTurns.get(sessionId) === event.data?.turn) this.wecomOpenTurns.delete(sessionId)
      for (const record of replies) void this.finishWeComReply(record)
      if (mirrorReply && event.data?.reason?.kind === 'completed') void this.finishWeComMirrorReply(mirrorReply)
    }
  },

  async handleWeComText(frame) {
    return this.handleWeComInbound(frame, 'text')
  },

  async handleWeComFile(frame) {
    return this.handleWeComInbound(frame, 'file')
  },

  async handleWeComInbound(frame, eventType) {
    const body = frame?.body || {}
    const msgid = typeof body.msgid === 'string' ? body.msgid : ''
    const reply = async (text) => {
      try { await this.wecomClient?.replyText(frame, text) } catch {}
    }
    if (!msgid || this.wecomSeenMessages.has(msgid)) return

    if (body.chattype !== 'single') {
      await reply('Project Hub 目前仅启用单聊；群聊需显式绑定项目与会话后再接入。')
      return
    }
    const userId = body.from?.userid
    const isText = eventType === 'text' && (!body.msgtype || body.msgtype === 'text')
    const isFile = eventType === 'file' && body.msgtype === 'file'
    const text = isText && typeof body.text?.content === 'string' ? body.text.content.trim() : ''
    const challenge = this.wecomPairingChallenge
    if (challenge && challenge.expiresAt <= Date.now()) this.wecomPairingChallenge = null
    const activeChallenge = this.wecomPairingChallenge
    if (isText && activeChallenge && userId && text.toUpperCase() === activeChallenge.code) {
      try { this.saveWeComBinding(userId, activeChallenge.sessionId) }
      catch { await reply('企业微信账号绑定未能保存到系统凭证库，请回到 Project Hub 重新发起配对。'); return }
      this.wecomPairingChallenge = null
      await reply('企业微信账号已绑定到此 Project Hub 项目助手。现在可以发送下一条消息。')
      return
    }

    const env = globalThis.process?.env || {}
    const environmentUsers = new Set(String(env.WECOM_ALLOWED_USER_IDS || '').split(',').map((value) => value.trim()).filter(Boolean))
    let storedBinding = null
    let bindingReadFailed = false
    try { storedBinding = this.readStoredWeComBinding() } catch { bindingReadFailed = true }
    const isPairedUser = Boolean(userId && storedBinding?.userId === userId)
    if (!userId || (!environmentUsers.has(userId) && !isPairedUser)) {
      const hint = bindingReadFailed
        ? '系统凭证库不可用，无法核验绑定。'
        : '请在 Project Hub 的企业微信模块发起一次性账号配对。'
      await reply(`此企业微信 UserID 尚未获准绑定到 Project Hub 项目助手。${hint}`)
      return
    }
    const configuredSessionId = typeof env.WECOM_DSH_SESSION_ID === 'string' ? env.WECOM_DSH_SESSION_ID.trim() : ''
    const bindingSessionId = isPairedUser ? storedBinding.sessionId : configuredSessionId
    if (!bindingSessionId) {
      await reply('管理员尚未配置 WECOM_DSH_SESSION_ID，消息未转入 DSH。')
      return
    }
    if (!isText && !isFile) {
      await reply('目前仅支持非空文本消息和文件附件。')
      return
    }
    if (isText && !text) {
      await reply('目前仅支持非空文本消息。')
      return
    }
    const fileDescriptor = isFile ? body.file : null
    if (isFile && (typeof fileDescriptor?.url !== 'string' || !fileDescriptor.url || typeof fileDescriptor.aeskey !== 'string' || !fileDescriptor.aeskey)) {
      await reply('企业微信文件消息缺少有效的下载地址或解密密钥，附件未保存。')
      return
    }
    if (!isFile && this.wecomPendingMessages.size >= 100) {
      await reply('当前企业微信消息队列繁忙，请稍后重试。')
      return
    }
    if (!this.wecomClient || this.wecomStatus.state !== 'connected') {
      await reply('企业微信长连接当前不可用，消息未送入 DSH。')
      return
    }
    let duplicateEvent = false
    try { duplicateEvent = await this.claimBridgeEvent(bindingSessionId, 'wecom', msgid) }
    catch (error) {
      this.recordBridgeJournalFailure('wecom', error)
      await reply(bridgeJournalClaimFailureNotice(error))
      return
    }
    if (duplicateEvent) return
    this.wecomSeenMessages.set(msgid, Date.now())
    while (this.wecomSeenMessages.size > 5000) this.wecomSeenMessages.delete(this.wecomSeenMessages.keys().next().value)
    const overwriteKey = `wecom:${bindingSessionId}:${userId}`
    if (isText) {
      const handled = await this.handlePendingFileOverwriteReply({
        map: this.wecomPendingFileOverwrites,
        key: overwriteKey,
        text,
        sessionId: bindingSessionId,
        reply
      })
      if (handled) return
    }
    if (isFile) {
      const pending = this.wecomPendingFileOverwrites.get(overwriteKey)
      if (pending && pending.expiresAt <= Date.now()) this.clearPendingFileOverwrite(this.wecomPendingFileOverwrites, overwriteKey)
      else if (pending) {
        await reply('上一个同名文件正在等待替换确认；请先回复「替换」或「取消」。本次新附件未处理，请稍后重发。')
        return
      }
    }

    if (isFile && this.activeInboundFileBatches >= INBOUND_FILE_BATCH_CONCURRENCY) {
      await reply('当前附件处理正忙，请稍后重新发送文件。')
      return
    }
    const streamId = this.wecomClient.createStreamId()
    if (isFile) this.activeInboundFileBatches += 1

    try { await this.wecomClient.replyStream(frame, streamId, isFile ? '收到文件，正在保存到项目 files/ 目录；不会读取内容…' : '收到，正在调用 DSH 项目助手…', false) } catch {}
    let failureStage = 'project-binding'
    try {
      const { workspace, project, session } = await this.projectForSession(bindingSessionId)
      if (isFile) {
        if (project.assistantSessionId !== bindingSessionId) throw new Error('项目助手会话绑定不匹配')
        failureStage = 'file-download'
        const downloaded = await this.wecomClient.downloadFile(fileDescriptor.url, fileDescriptor.aeskey)
        const bytes = downloaded?.buffer
        failureStage = 'file-validation'
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('Empty or invalid WeCom attachment')
        if (bytes.byteLength > INBOUND_FILE_MAX_BYTES) {
          failureStage = 'file-size-limit'
          throw Object.assign(new Error('WeCom attachment exceeds the 50 MiB per-file limit'), { code: 'FILE_TOO_LARGE' })
        }
        const filename = sanitizeInboundFilename(downloaded.filename || fileDescriptor.filename || fileDescriptor.name, 'wecom-attachment.bin')
        failureStage = 'file-save'
        const completed = (message) => this.wecomClient.replyStream(frame, streamId, message, true)
        const result = await this.saveInboundFileBatch({
          map: this.wecomPendingFileOverwrites,
          key: overwriteKey,
          files: [{ filename, bytes }],
          workspace,
          project,
          session,
          sessionId: bindingSessionId,
          reply: completed
        })
        if (!result.pending) await completed(`文件已保存到项目目录：${result.saved.join('、')}。未读取文件内容，也未将其发送给助手。`)
        return
      }

      const assistantSessionId = project.assistantSessionId
      if (!assistantSessionId) throw new Error('项目尚未绑定助手会话')
      const agent = this.ctx.agents?.get(assistantSessionId)
      if (!agent || typeof agent.followup !== 'function') throw new Error('项目助手 Agent 当前未运行')
      const messageId = makeId('wecom')
      const record = { sessionId: assistantSessionId, frame, streamId, output: '' }
      this.wecomPendingMessages.set(messageId, record)
      this.trackExternalMessageOrigin(messageId, { platform: 'wecom', sessionId: assistantSessionId, prompt: text })
      failureStage = 'agent-followup'
      try {
        const accepted = agent.followup({ id: messageId, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
        if (accepted && typeof accepted.then === 'function') {
          void Promise.resolve(accepted).catch((error) => {
            if (this.wecomPendingMessages.get(messageId) !== record) return
            this.wecomPendingMessages.delete(messageId)
            this.externalMessageOrigins.delete(messageId)
            this.wecomSeenMessages.delete(msgid)
            void this.releaseBridgeEvent(bindingSessionId, 'wecom', msgid).catch(() => {})
            const code = typeof error?.code === 'string' ? error.code.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 48) || 'ERROR' : error?.name === 'Error' ? 'ERROR' : 'UNKNOWN'
            this.ctx.logger.warn(`project-hub: WeCom inbound ${eventType} failed at agent-followup (${code})`)
            try { void this.wecomClient?.replyStream(frame, streamId, '消息未能送入 DSH 项目助手。请检查项目绑定和助手 Agent 状态。', true)?.catch?.(() => {}) } catch {}
          })
        }
      } catch (error) {
        this.wecomPendingMessages.delete(messageId)
        this.externalMessageOrigins.delete(messageId)
        this.wecomSeenMessages.delete(msgid)
        await this.releaseBridgeEvent(bindingSessionId, 'wecom', msgid).catch(() => {})
        throw error
      }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 48) || 'ERROR' : error?.name === 'Error' ? 'ERROR' : 'UNKNOWN'
      this.ctx.logger.warn(`project-hub: WeCom inbound ${eventType} failed at ${failureStage} (${code})`)
      const userMessage = failureStage === 'file-size-limit'
        ? '企微文件超过单文件 50 MiB 上限，请压缩或拆分后重发。'
        : failureStage === 'file-download'
          ? '企微文件下载或解密失败，请重新发送文件并确认机器人仍有读取权限。'
          : failureStage === 'file-validation'
            ? '企微返回的附件为空或格式无效，请重新发送文件。'
            : failureStage === 'file-save'
              ? `文件未能保存到项目 files/ 目录（诊断码 ${code}）。请把此诊断码发给管理员以定位写入失败原因。`
              : '消息未能送入 DSH 项目助手。请检查项目绑定和助手 Agent 状态。'
      try { await this.wecomClient?.replyStream(frame, streamId, userMessage, true) } catch {}
    } finally {
      if (isFile) this.activeInboundFileBatches -= 1
    }
  },
  }
}

