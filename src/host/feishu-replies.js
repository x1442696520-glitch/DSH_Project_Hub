export function createFeishuRepliesMethods(shared) {
  const {  } = shared
  return {
  handleFeishuSessionEvent(session, event) {
    const sessionId = session?.id
    if (typeof sessionId !== 'string' || !event?.type) return
    if (event.type === 'turn/start') {
      this.feishuOpenTurns.set(sessionId, event.data?.turn)
      if ([...this.feishuPendingMessages.values()].some((record) => record.sessionId === sessionId)) this.recordFeishuReplyOutcome('turn-started')
      return
    }
    if (event.type === 'user/message') {
      const turn = this.feishuOpenTurns.get(sessionId)
      const userMessage = event.data || {}
      const record = this.feishuPendingMessages.get(userMessage.id)
      if (!Number.isSafeInteger(turn)) {
        if (record?.sessionId === sessionId) this.recordFeishuReplyOutcome('missing-turn-start')
        return
      }
      const key = `${sessionId}:${turn}`
      if (record?.sessionId === sessionId) {
        this.feishuPendingMessages.delete(userMessage.id)
        record.dshMessageId = userMessage.id
        record.turn = turn
        record.status = 'running'
        const replies = this.feishuTurnReplies.get(key) || []
        if (!replies.some((reply) => reply.dshMessageId === userMessage.id)) replies.push(record)
        this.feishuTurnReplies.set(key, replies)
        void this.writeFeishuPending(sessionId, record).catch(() => this.ctx.logger.warn('project-hub: failed to persist Feishu turn mapping'))
        this.recordFeishuReplyOutcome('user-event-matched')
      } else if (userMessage.source?.kind === 'user') {
        const origin = this.externalMessageOrigins.get(userMessage.id)
        const sourcePlatform = origin?.sessionId === sessionId ? origin.platform : 'dsh'
        if (sourcePlatform !== 'feishu') {
          try {
            const binding = this.readStoredFeishuBinding({ sessionId })
            if (binding?.syncMessages) {
              const sourceLabel = sourcePlatform === 'wecom' ? '企微消息' : 'DSH消息'
              const mirrorRecord = this.captureMirrorTurn(this.feishuMirrorTurnReplies, key, sessionId, sourceLabel, userMessage, origin?.prompt)
              mirrorRecord.destinationChatId = binding.chatId
              mirrorRecord.destinationOpenId = binding.openId
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
      this.appendMirrorAnswer(this.feishuMirrorTurnReplies, key, answer)
      const replies = this.feishuTurnReplies.get(key)
      if (replies?.length && answer) {
        for (const record of replies) {
          record.output = `${record.output ? `${record.output}\n\n` : ''}${answer}`
          record.status = 'running'
          void this.writeFeishuPending(sessionId, record).catch(() => this.ctx.logger.warn('project-hub: failed to persist Feishu assistant output'))
        }
        this.recordFeishuReplyOutcome('assistant-text-captured')
      }
      return
    }
    if (event.type === 'turn/end') {
      const key = `${sessionId}:${event.data?.turn}`
      const replies = this.feishuTurnReplies.get(key) || []
      this.feishuTurnReplies.delete(key)
      const mirrorReply = this.feishuMirrorTurnReplies.get(key)
      this.feishuMirrorTurnReplies.delete(key)
      if (mirrorReply && event.data?.reason?.kind === 'completed') void this.finishFeishuMirrorReply(mirrorReply)
      if (this.feishuOpenTurns.get(sessionId) === event.data?.turn) this.feishuOpenTurns.delete(sessionId)
      if (replies.length) {
        if (event.data?.reason?.kind === 'completed') {
          this.recordFeishuReplyOutcome('turn-completed')
          for (const record of replies) void this.finishFeishuReply(record)
        } else {
          for (const record of replies) void this.writeFeishuPending(record.sessionId, record, { remove: true }).catch(() => {})
          this.recordFeishuReplyOutcome('turn-not-completed')
        }
      } else if ([...this.feishuPendingMessages.values()].some((record) => record.sessionId === sessionId)) this.recordFeishuReplyOutcome('no-mapped-user-event')
    }
  },

  async sendFeishuNotice(chatId, content, replyToMessageId) {
    if (!this.feishuClient || this.feishuStatus.state !== 'connected') return false
    try {
      await this.feishuClient.sendText({ chatId, content, replyToMessageId })
      return true
    } catch {
      this.ctx.logger.warn('project-hub: failed to send Feishu notice')
      return false
    }
  },

  buildFeishuProjectPickerCard(conversation) {
    const active = conversation.bindings.find((binding) => binding.sessionId === conversation.activeSessionId) || conversation.bindings[0]
    const elements = [
      { tag: 'markdown', content: `**当前项目：${active?.projectName || '未选择'}**` },
      { tag: 'markdown', content: '点击下方项目按钮，即可切换到对应的 DSH 助手会话。各项目的对话上下文彼此独立。' },
      ...conversation.bindings.map((binding) => ({
        tag: 'button',
        type: binding.sessionId === conversation.activeSessionId ? 'primary_filled' : 'default',
        width: 'fill',
        text: { tag: 'plain_text', content: `${binding.sessionId === conversation.activeSessionId ? '✓ ' : ''}${binding.projectName}`.slice(0, 80) },
        behaviors: [{ type: 'callback', value: { kind: 'project.select', sessionId: binding.sessionId, projectId: binding.projectId } }]
      }))
    ]
    return {
      schema: '2.0',
      config: { update_multi: true },
      header: { title: { tag: 'plain_text', content: '选择项目助手' }, template: 'blue' },
      body: { elements }
    }
  },

  async restoreFeishuStateOnStartup() {
    await this.restoreBoundBridgeSessions()
    await this.recoverFeishuOutbox()
  },

  async recoverFeishuOutbox(conversations) {
    if (this.feishuOutboxRecoveryRunning || !this.feishuClient || this.feishuStatus.state !== 'connected') return
    this.feishuOutboxRecoveryRunning = true
    try {
      const stored = conversations || this.readStoredFeishuConversations()
      const sessionIds = [...new Set(stored.flatMap((conversation) => conversation.bindings.map((binding) => binding.sessionId)))]
      for (const sessionId of sessionIds) {
        let journal
        try { journal = await this.readBridgeJournal(sessionId) } catch { continue }
        for (const entry of journal.feishuOutbox) {
          const record = { ...entry, outboxId: entry.id }
          this.feishuDurableOutbox.set(entry.id, record)
          if (entry.status === 'sending') {
            record.status = 'uncertain'
            await this.writeFeishuOutbox(sessionId, record)
            this.feishuReplyDiagnostics.uncertainCount += 1
            this.recordFeishuReplyOutcome('delivery-uncertain-after-restart')
          } else if (entry.status === 'queued') {
            await this.finishFeishuReply(record, { existing: true })
          }
        }
        const outboxMessageIds = new Set(journal.feishuOutbox.map((entry) => entry.dshMessageId).filter(Boolean))
        for (const entry of journal.feishuPending) {
          if (entry.status === 'sent' || outboxMessageIds.has(entry.id)) continue
          const record = { ...entry, dshMessageId: entry.id }
          if (entry.status === 'completed') {
            await this.finishFeishuReply(record)
            continue
          }
          if (!Number.isSafeInteger(entry.turn)) this.feishuPendingMessages.set(entry.id, record)
          this.externalMessageOrigins.set(entry.id, { platform: 'feishu', sessionId })
          if (Number.isSafeInteger(entry.turn)) {
            const turnKey = `${sessionId}:${entry.turn}`
            const replies = this.feishuTurnReplies.get(turnKey) || []
            if (!replies.some((reply) => reply.dshMessageId === entry.id)) replies.push(record)
            this.feishuTurnReplies.set(turnKey, replies)
            this.feishuOpenTurns.set(sessionId, entry.turn)
          }
        }
      }
    } catch {
      this.ctx.logger.warn('project-hub: failed to recover persisted Feishu replies')
    } finally { this.feishuOutboxRecoveryRunning = false }
  },

  async refreshFeishuProjectPicker({ tenantKey, chatId, openId, replyToMessageId, createIfMissing = true, forceNew = false } = {}) {
    if (!this.feishuClient || this.feishuStatus.state !== 'connected') return false
    let conversation
    try { conversation = this.readStoredFeishuConversation({ tenantKey, chatId, openId }) } catch { return false }
    if (!conversation) return false
    const card = this.buildFeishuProjectPickerCard(conversation)
    if (!forceNew && conversation.pickerMessageId && typeof this.feishuClient.updateCard === 'function') {
      try {
        await this.feishuClient.updateCard({ messageId: conversation.pickerMessageId, card })
        return true
      } catch {
        this.ctx.logger.warn('project-hub: failed to update Feishu project picker')
      }
    }
    if (!createIfMissing) return false
    try {
      const result = await this.feishuClient.sendCard({ chatId, card, replyToMessageId })
      if (!result?.messageId) return false
      const conversations = this.readStoredFeishuConversations()
      const target = conversations.find((candidate) => candidate.tenantKey === tenantKey && candidate.chatId === chatId && candidate.openId === openId)
      if (!target) return false
      target.pickerMessageId = result.messageId
      this.saveStoredFeishuConversations(conversations)
      return true
    } catch {
      this.ctx.logger.warn('project-hub: failed to send Feishu project picker')
      return false
    }
  },
  }
}

