export function createFeishuInboundMethods(shared) {
  const { FEISHU_SEEN_LIMIT, FEISHU_PENDING_LIMIT, BRIDGE_EVENT_TTL_MS, INBOUND_FILE_MAX_BYTES, INBOUND_FILE_COUNT_LIMIT, INBOUND_MESSAGE_FILE_MAX_BYTES, INBOUND_FILE_BATCH_CONCURRENCY, sanitizeInboundFilename, feishuFileResources, makeId, bridgeJournalClaimFailureNotice } = shared
  return {
  async handleFeishuCardAction(event) {
    const chatId = typeof event?.chatId === 'string' ? event.chatId.trim() : ''
    const messageId = typeof event?.messageId === 'string' ? event.messageId.trim() : ''
    const openId = typeof event?.operator?.openId === 'string' ? event.operator.openId.trim() : ''
    const action = event?.action
    const value = action?.value
    const previousCount = this.feishuCardActionDiagnostics.count
    const recordCardAction = (patch) => {
      this.feishuCardActionDiagnostics = { ...this.feishuCardActionDiagnostics, count: previousCount + 1, lastAt: new Date().toISOString(), ...patch }
    }
    if (!chatId || !messageId || !openId || action?.tag !== 'button' || !value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'project.select') {
      recordCardAction({ lastOutcome: 'invalid-card-action' })
      return false
    }
    let conversation
    try { conversation = this.readStoredFeishuConversation({ chatId, openId }) } catch {
      recordCardAction({ lastOutcome: 'binding-read-failed' })
      return false
    }
    if (!conversation) {
      recordCardAction({ lastOutcome: 'unauthorized-or-unbound' })
      return false
    }
    const binding = conversation.bindings.find((candidate) => candidate.sessionId === value.sessionId && candidate.projectId === value.projectId)
    if (!binding) {
      await this.refreshFeishuProjectPicker({ ...conversation })
      recordCardAction({ lastOutcome: 'stale-project-button', activeProject: conversation.bindings.find((candidate) => candidate.sessionId === conversation.activeSessionId)?.projectName || null })
      return false
    }
    if (!this.setFeishuActiveProject({ tenantKey: conversation.tenantKey, chatId, openId, sessionId: binding.sessionId })) {
      recordCardAction({ lastOutcome: 'active-selection-failed', selectedProject: binding.projectName })
      return false
    }

    const oldPickerMessageId = conversation.pickerMessageId || ''
    let pickerRefreshed = await this.refreshFeishuProjectPicker({ tenantKey: conversation.tenantKey, chatId, openId, replyToMessageId: messageId, forceNew: true })
    if (!pickerRefreshed) pickerRefreshed = await this.refreshFeishuProjectPicker({ tenantKey: conversation.tenantKey, chatId, openId, replyToMessageId: messageId })

    let currentConversation = null
    try { currentConversation = this.readStoredFeishuConversation({ tenantKey: conversation.tenantKey, chatId, openId }) } catch {}
    const replacementMessageId = currentConversation?.pickerMessageId || ''
    let recalledCount = 0
    let recallFailedCount = 0
    if (pickerRefreshed && replacementMessageId && typeof this.feishuClient?.recallMessage === 'function') {
      for (const oldMessageId of new Set([messageId, oldPickerMessageId])) {
        if (!oldMessageId || oldMessageId === replacementMessageId) continue
        try {
          await this.feishuClient.recallMessage({ messageId: oldMessageId })
          recalledCount++
        } catch { recallFailedCount++ }
      }
    }
    recordCardAction({
      lastOutcome: pickerRefreshed ? 'switched-card-replaced' : 'switched-card-refresh-failed',
      selectedProject: binding.projectName,
      activeProject: currentConversation?.bindings.find((candidate) => candidate.sessionId === currentConversation.activeSessionId)?.projectName || null,
      clickedCanonicalCard: oldPickerMessageId === messageId,
      oldCardRecall: `${recalledCount}/${recallFailedCount}`
    })
    return true
  },

  async handleFeishuMessage(message, diagnosticSequence = 0) {
    const messageId = typeof message?.messageId === 'string' ? message.messageId.trim() : ''
    const chatId = typeof message?.chatId === 'string' ? message.chatId.trim() : ''
    if (!messageId || !chatId) {
      this.setFeishuInboundOutcome(diagnosticSequence, 'missing-message-fields')
      return
    }
    const raw = message?.raw && typeof message.raw === 'object' ? message.raw : {}
    const event = raw.event && typeof raw.event === 'object' ? raw.event : raw
    const sender = event.sender && typeof event.sender === 'object' ? event.sender : {}
    const rawMessage = event.message && typeof event.message === 'object' ? event.message : {}
    const senderType = typeof sender.sender_type === 'string' ? sender.sender_type.toLowerCase() : ''
    const senderOpenId = typeof sender.sender_id?.open_id === 'string' ? sender.sender_id.open_id.trim() : ''
    const tenantKey = typeof sender.tenant_key === 'string' ? sender.tenant_key.trim() : ''
    if (!tenantKey || !senderOpenId || (senderType && senderType !== 'user')) {
      this.setFeishuInboundOutcome(diagnosticSequence, 'missing-sender-metadata')
      return
    }
    if (this.feishuClient?.botIdentity?.openId && senderOpenId === this.feishuClient.botIdentity.openId) {
      this.setFeishuInboundOutcome(diagnosticSequence, 'ignored-bot-self-message')
      return
    }
    if (this.feishuTenantKey && tenantKey !== this.feishuTenantKey) {
      this.setFeishuInboundOutcome(diagnosticSequence, 'tenant-key-mismatch')
      return
    }
    if (message.chatType !== 'p2p' || rawMessage.chat_type && rawMessage.chat_type !== 'p2p') {
      this.setFeishuInboundOutcome(diagnosticSequence, 'not-private-chat')
      return
    }

    const eventId = [raw.header?.event_id, event.header?.event_id].find((value) => typeof value === 'string' && value.trim())
    const eventKey = `${tenantKey}:${eventId || messageId}`
    const now = Date.now()
    if (this.feishuSeenMessages.has(eventKey)) {
      this.setFeishuInboundOutcome(diagnosticSequence, 'duplicate-event')
      return
    }

    const text = typeof message.content === 'string' ? message.content.trim() : ''
    const isText = message.rawContentType === 'text' && (!rawMessage.message_type || rawMessage.message_type === 'text')
    const isFile = message.rawContentType === 'file' && (!rawMessage.message_type || rawMessage.message_type === 'file')
    const fileResources = isFile ? feishuFileResources(message, rawMessage) : []
    for (const [code, challenge] of this.feishuPairingChallenges) if (challenge.expiresAt <= now) this.feishuPairingChallenges.delete(code)
    const activeChallenge = isText ? this.feishuPairingChallenges.get(text.toUpperCase()) : null
    if (activeChallenge) {
      this.feishuPairingChallenges.delete(activeChallenge.code)
      try {
        const { workspace, project } = await this.projectForSession(activeChallenge.sessionId)
        if (workspace.id !== activeChallenge.workspaceId || project.id !== activeChallenge.projectId || project.assistantSessionId !== activeChallenge.sessionId) throw new Error('飞书配对目标已变化')
        this.saveFeishuBinding({
          openId: senderOpenId,
          tenantKey,
          chatId,
          sessionId: activeChallenge.sessionId,
          projectId: activeChallenge.projectId,
          projectName: workspace.title || project.name,
          workspaceId: activeChallenge.workspaceId
        })
        const replied = await this.sendFeishuNotice(chatId, `已将「${workspace.title || project.name}」绑定到此飞书私聊。需要切换助手时，请发送 /切换会话 或 /项目列表 主动显示选择卡片。`, messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'paired-replied' : 'pair-reply-failed')
      } catch {
        const replied = await this.sendFeishuNotice(chatId, '飞书配对未能完成；请确认 DSH 项目和助手会话仍有效，然后重新生成配对码。', messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'pairing-error-replied' : 'pairing-error-reply-failed')
      }
      return
    }

    let conversation
    let storedConversations
    try {
      storedConversations = this.readStoredFeishuConversations()
      conversation = storedConversations.find((candidate) => candidate.tenantKey === tenantKey && candidate.chatId === chatId) || null
    } catch {
      const replied = await this.sendFeishuNotice(chatId, 'Project Hub 当前无法读取系统凭证库中的飞书绑定，消息未转入助手。', messageId)
      this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'binding-store-error-replied' : 'binding-store-error-reply-failed')
      return
    }
    if (storedConversations.some((candidate) => candidate.tenantKey !== tenantKey)) {
      this.setFeishuInboundOutcome(diagnosticSequence, 'bound-tenant-mismatch')
      return
    }
    if (!conversation || conversation.openId !== senderOpenId) {
      const replied = await this.sendFeishuNotice(chatId, '此飞书单聊尚未获准绑定到 Project Hub。请在目标 DSH 项目页面生成一次性配对码后，在此私聊中发送该码。', messageId)
      this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'unpaired-notice-sent' : 'unpaired-notice-failed')
      return
    }
    let binding = conversation.bindings.find((candidate) => candidate.sessionId === conversation.activeSessionId) || conversation.bindings[0]
    if (!binding) {
      this.setFeishuInboundOutcome(diagnosticSequence, 'no-active-project')
      return
    }
    let duplicateEvent = false
    try { duplicateEvent = await this.claimBridgeEvent(binding.sessionId, 'feishu', eventKey) }
    catch (error) {
      this.recordBridgeJournalFailure('feishu', error)
      await this.sendFeishuNotice(chatId, bridgeJournalClaimFailureNotice(error), messageId)
      this.setFeishuInboundOutcome(diagnosticSequence, error?.code === 'SESSION_NOT_ACTIVE' ? 'bound-session-inactive' : error?.code === 'SESSION_AUTO_RESUME_FAILED' ? 'bound-session-auto-resume-failed' : typeof error?.code === 'string' && error.code.startsWith('SESSION_') ? 'bound-session-validation-failed' : 'journal-write-failed')
      return
    }
    if (duplicateEvent) {
      this.setFeishuInboundOutcome(diagnosticSequence, 'duplicate-event')
      return
    }
    this.feishuSeenMessages.set(eventKey, now)
    const cutoff = now - BRIDGE_EVENT_TTL_MS
    for (const [key, timestamp] of this.feishuSeenMessages) {
      if (timestamp >= cutoff && this.feishuSeenMessages.size <= FEISHU_SEEN_LIMIT) break
      this.feishuSeenMessages.delete(key)
    }
    const overwriteKey = `feishu:${tenantKey}:${senderOpenId}:${chatId}:${binding.sessionId}`
    if (isText && text) {
      const handled = await this.handlePendingFileOverwriteReply({
        map: this.feishuPendingFileOverwrites,
        key: overwriteKey,
        text,
        sessionId: binding.sessionId,
        reply: (content) => this.sendFeishuNotice(chatId, content, messageId)
      })
      if (handled) return
    }
    if (isText && text) {
      const normalizedCommand = text.trim()
      if (/^\/?(?:帮助|help)$/i.test(normalizedCommand)) {
        const replied = await this.sendFeishuNotice(chatId, '需要切换助手时，发送 /切换会话 或 /项目列表 主动显示项目选择卡片；也可发送 /切换 <序号> 直接切换。普通文本和文件会送入当前项目助手。', messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'project-help-sent' : 'project-help-failed')
        return
      }
      if (/^\/?(?:项目列表|projects|切换会话|switch(?:\s+sessions?)?)$/i.test(normalizedCommand)) {
        const refreshed = await this.refreshFeishuProjectPicker({ tenantKey, chatId, openId: senderOpenId, replyToMessageId: messageId, forceNew: true })
        if (!refreshed) {
          const projectChoices = conversation.bindings.map((candidate, index) => `${index + 1}. ${candidate.projectName}`).join('\n')
          const noticeSent = await this.sendFeishuNotice(chatId, `项目选择卡片暂时无法显示。你仍可发送「切换 <序号>」直接切换已绑定项目：\n${projectChoices}`, messageId)
          this.setFeishuInboundOutcome(diagnosticSequence, noticeSent ? 'project-picker-failed-with-help' : 'project-picker-send-failed')
        } else {
          this.setFeishuInboundOutcome(diagnosticSequence, 'project-picker-refreshed')
        }
        return
      }
      if (/^\/?(?:当前项目|current)$/i.test(normalizedCommand)) {
        const replied = await this.sendFeishuNotice(chatId, `当前项目：${binding.projectName}\n需要切换时，发送 /切换会话 或 /项目列表。`, messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'current-project-sent' : 'current-project-failed')
        return
      }
      const switchMatch = normalizedCommand.match(/^\/?(?:切换|switch)\s+(\d{1,3})$/i)
      if (switchMatch) {
        const requested = Number(switchMatch[1])
        const selected = conversation.bindings[requested - 1]
        if (!selected) {
          const replied = await this.sendFeishuNotice(chatId, '项目序号无效。发送 /切换会话 查看可选项目，或使用 /项目列表。', messageId)
          this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'project-switch-invalid' : 'project-switch-failed')
          return
        }
        if (!this.setFeishuActiveProject({ tenantKey, chatId, openId: senderOpenId, sessionId: selected.sessionId })) {
          const replied = await this.sendFeishuNotice(chatId, '项目切换未完成；请刷新 Project Hub 绑定状态后重试。', messageId)
          this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'project-switch-failed' : 'project-switch-failed')
          return
        }
        binding = selected
        const pickerUpdated = await this.refreshFeishuProjectPicker({ tenantKey, chatId, openId: senderOpenId, replyToMessageId: messageId })
        const notice = pickerUpdated
          ? `当前项目已切换为「${selected.projectName}」，项目选择卡片已刷新。`
          : `当前项目已切换为「${selected.projectName}」，但项目卡片未能更新；请稍后发送「切换会话」重新打开选择卡片。`
        const replied = await this.sendFeishuNotice(chatId, notice, messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, replied ? pickerUpdated ? 'project-switched' : 'project-switched-picker-refresh-failed' : 'project-switch-reply-failed')
        return
      }
    }
    if (isFile) {
      const pending = this.feishuPendingFileOverwrites.get(overwriteKey)
      if (pending && pending.expiresAt <= Date.now()) this.clearPendingFileOverwrite(this.feishuPendingFileOverwrites, overwriteKey)
      else if (pending) {
        await this.sendFeishuNotice(chatId, '上一个同名文件正在等待替换确认；请先回复「替换」或「取消」。本次新附件未处理，请稍后重发。', messageId)
        return
      }
    }
    if (!isText && !isFile) {
      await this.sendFeishuNotice(chatId, '目前仅支持单聊文本和文件消息；图片、卡片及其他类型不会送入助手。', messageId)
      return
    }
    if (isText && !text) {
      await this.sendFeishuNotice(chatId, '目前仅支持非空文本消息。', messageId)
      return
    }
    if (isFile && !fileResources.length) {
      await this.sendFeishuNotice(chatId, '飞书文件消息缺少有效附件信息，文件未送入助手。', messageId)
      return
    }
    if (isFile && fileResources.length > INBOUND_FILE_COUNT_LIMIT) {
      await this.sendFeishuNotice(chatId, `单条飞书消息最多接收 ${INBOUND_FILE_COUNT_LIMIT} 个文件。`, messageId)
      return
    }
    if (!isFile && this.feishuPendingMessages.size >= FEISHU_PENDING_LIMIT) {
      await this.sendFeishuNotice(chatId, '当前飞书消息队列繁忙，请稍后重试。', messageId)
      return
    }
    if (!this.feishuClient || this.feishuStatus.state !== 'connected') {
      await this.sendFeishuNotice(chatId, '飞书长连接当前不可用，消息未能处理。', messageId)
      return
    }

    let fileBatchSlotHeld = false
    if (isFile) {
      if (this.activeInboundFileBatches >= INBOUND_FILE_BATCH_CONCURRENCY) {
        await this.sendFeishuNotice(chatId, '当前附件处理正忙，请稍后重新发送文件。', messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, 'file-queue-busy')
        return
      }
      this.activeInboundFileBatches += 1
      fileBatchSlotHeld = true
    }

    let failureStage = 'project-binding'
    try {
      const { workspace, project, session } = await this.projectForSession(binding.sessionId)
      if (workspace.id !== binding.workspaceId || project.id !== binding.projectId || project.assistantSessionId !== binding.sessionId) throw new Error('Project/session binding mismatch')
      if (isFile) {
        let totalBytes = 0
        const filesToSave = []
        try {
          for (const resource of fileResources) {
            const remainingBytes = INBOUND_MESSAGE_FILE_MAX_BYTES - totalBytes
            if (remainingBytes <= 0) throw Object.assign(new Error('Feishu message attachments exceed the aggregate byte limit'), { code: 'MESSAGE_FILES_TOO_LARGE' })
            failureStage = 'file-download'
            let downloaded
            try {
              downloaded = await this.feishuClient.downloadFile(resource.fileKey, messageId, { maxBytes: Math.min(INBOUND_FILE_MAX_BYTES, remainingBytes) })
            } catch (error) {
              if (['FILE_TOO_LARGE', 'MESSAGE_FILES_TOO_LARGE'].includes(error?.code)) failureStage = 'file-validation'
              throw error
            }
            const bytes = downloaded?.buffer
            failureStage = 'file-validation'
            if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('Empty or invalid Feishu attachment')
            if (bytes.byteLength > INBOUND_FILE_MAX_BYTES) throw Object.assign(new Error('Feishu attachment exceeds the per-file limit'), { code: 'FILE_TOO_LARGE' })
            totalBytes += bytes.byteLength
            if (totalBytes > INBOUND_MESSAGE_FILE_MAX_BYTES) throw Object.assign(new Error('Feishu message attachments exceed the aggregate byte limit'), { code: 'MESSAGE_FILES_TOO_LARGE' })
            filesToSave.push({ filename: sanitizeInboundFilename(resource.fileName, 'feishu-attachment.bin'), bytes })
          }
          failureStage = 'file-save'
          const result = await this.saveInboundFileBatch({
            map: this.feishuPendingFileOverwrites,
            key: overwriteKey,
            files: filesToSave,
            workspace,
            project,
            session,
            sessionId: binding.sessionId,
            reply: (content) => this.sendFeishuNotice(chatId, content, messageId)
          })
          if (!result.pending) await this.sendFeishuNotice(chatId, `文件已保存到项目目录：${result.saved.join('、')}。未读取文件内容，也未将其发送给助手。`, messageId)
          return
        } catch (error) {
          for (const file of filesToSave) {
            try { file.bytes?.fill?.(0) } catch {}
            file.bytes = undefined
          }
          throw error
        }
      }

      const agent = this.ctx.agents?.get(binding.sessionId)
      if (!agent || typeof agent.followup !== 'function') {
        await this.sendFeishuNotice(chatId, '项目助手 Agent 当前未运行，消息未送入 DSH。', messageId)
        return
      }
      const dshMessageId = makeId('feishu')
      const record = { dshMessageId, eventKey, sessionId: binding.sessionId, chatId, openId: senderOpenId, replyToMessageId: messageId, output: '', status: 'pending', createdAt: new Date().toISOString() }
      this.feishuPendingMessages.set(dshMessageId, record)
      this.trackExternalMessageOrigin(dshMessageId, { platform: 'feishu', sessionId: binding.sessionId, prompt: text })
      try { await this.writeFeishuPending(binding.sessionId, record) }
      catch (error) {
        this.feishuPendingMessages.delete(dshMessageId)
        this.externalMessageOrigins.delete(dshMessageId)
        this.feishuSeenMessages.delete(eventKey)
        await this.releaseBridgeEvent(binding.sessionId, 'feishu', eventKey).catch(() => {})
        await this.sendFeishuNotice(chatId, '无法安全持久化本轮回复关联，消息未送入 DSH；请稍后重发。', messageId)
        this.recordFeishuReplyOutcome('pending-persist-failed', error)
        return
      }
      this.recordFeishuReplyOutcome('awaiting-session-events')
      failureStage = 'agent-followup'
      let accepted
      try {
        accepted = agent.followup({
          id: dshMessageId,
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'user' }
        })
      } catch (error) {
        this.feishuPendingMessages.delete(dshMessageId)
        this.externalMessageOrigins.delete(dshMessageId)
        await this.writeFeishuPending(binding.sessionId, record, { remove: true }).catch(() => {})
        this.feishuSeenMessages.delete(eventKey)
        await this.releaseBridgeEvent(binding.sessionId, 'feishu', eventKey).catch(() => {})
        throw error
      }
      if (accepted && typeof accepted.then === 'function') accepted.catch(() => {
        this.feishuPendingMessages.delete(dshMessageId)
        this.externalMessageOrigins.delete(dshMessageId)
        void this.writeFeishuPending(binding.sessionId, record, { remove: true }).catch(() => {})
        this.feishuSeenMessages.delete(eventKey)
        void this.releaseBridgeEvent(binding.sessionId, 'feishu', eventKey).catch(() => {})
        this.recordFeishuReplyOutcome('agent-followup-failed')
        void this.sendFeishuNotice(chatId, '消息未能送入 DSH 项目助手；请检查项目绑定和 Agent 状态。', messageId)
      })
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 48) || 'ERROR' : error?.name === 'Error' ? 'ERROR' : 'UNKNOWN'
      this.ctx.logger.warn(`project-hub: Feishu inbound ${isFile ? 'file' : 'text'} failed at ${failureStage} (${code})`)
      const notice = failureStage === 'file-download'
        ? '飞书文件下载失败，请稍后重试并检查应用文件权限。'
        : failureStage === 'file-validation'
          ? '飞书附件无效或超出大小限制（单文件 50 MiB、单条消息累计 100 MiB）。'
          : failureStage === 'file-save'
            ? `文件未能保存到项目 files/ 目录（诊断码 ${code}）。请把此诊断码发给管理员以定位写入失败原因。`
            : '消息未能送入 DSH 项目助手；请检查项目绑定和 Agent 状态。'
      await this.sendFeishuNotice(chatId, notice, messageId)
    } finally {
      if (fileBatchSlotHeld) this.activeInboundFileBatches -= 1
    }
  },
  }
}

