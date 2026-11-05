import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function loadOfficialSdk() {
  return require('@larksuiteoapi/node-sdk')
}

function safeText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label}无效`)
  }
  return value.trim()
}

function safeMessageText(value, label, max) {
  if (typeof value !== 'string') throw new Error(`${label}无效`)
  const normalized = value.replace(/\r\n?/g, '\n')
  if (!normalized.trim() || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label}无效`)
  }
  return normalized.trim()
}

function summarizeApiError(error) {
  const cause = error?.cause
  const apiError = cause?.response?.data || cause?.data || cause
  const code = apiError?.code ?? error?.code
  const message = typeof apiError?.msg === 'string' ? apiError.msg : typeof cause?.message === 'string' ? cause.message : error?.message
  const detail = [code != null ? `错误码 ${String(code).slice(0, 64)}` : '', typeof message === 'string' ? message.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').slice(0, 300) : ''].filter(Boolean).join('：')
  return detail
}

export class FeishuClient {
  #channel
  #resourceClient

  constructor({ appId, appSecret, sdk } = {}) {
    const id = safeText(appId, '飞书 App ID', 128)
    const secret = safeText(appSecret, '飞书 App Secret', 1024)
    const officialSdk = sdk || loadOfficialSdk()
    if (typeof officialSdk?.createLarkChannel !== 'function' || typeof officialSdk?.Client !== 'function') throw new Error('飞书官方 Node.js SDK 不可用')
    this.#channel = officialSdk.createLarkChannel({
      appId: id,
      appSecret: secret,
      transport: 'websocket',
      includeRawEvent: true,
      policy: { dmMode: 'open', requireMention: true, groupAllowlist: [] },
      safety: { dedup: { ttl: 5 * 60 * 1000, maxEntries: 5000 }, chatQueue: { enabled: true } },
      outbound: { retry: { maxAttempts: 3, baseDelayMs: 250 } },
      loggerLevel: officialSdk.LoggerLevel?.error
    })
    this.#resourceClient = new officialSdk.Client({ appId: id, appSecret: secret, loggerLevel: officialSdk.LoggerLevel?.error })
  }

  on(event, listener) {
    this.#channel.on(event, listener)
    return this
  }

  connect() {
    return this.#channel.connect()
  }

  disconnect() {
    return this.#channel.disconnect()
  }

  get botIdentity() {
    return this.#channel.botIdentity
  }

  getConnectionStatus() {
    return this.#channel.getConnectionStatus?.()
  }

  async downloadFile(fileKey, messageId) {
    const key = safeText(fileKey, '飞书 file_key', 512)
    const id = safeText(messageId, '飞书 message_id', 256)
    const getResource = this.#resourceClient?.im?.v1?.messageResource?.get
    if (typeof getResource !== 'function') throw new Error('飞书官方 SDK 不支持下载消息中的文件资源')
    const response = await getResource.call(this.#resourceClient.im.v1.messageResource, {
      path: { message_id: id, file_key: key },
      params: { type: 'file' }
    })
    const stream = response?.getReadableStream?.()
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw new Error('飞书 SDK 返回的文件流无效')
    const chunks = []
    let size = 0
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) throw new Error('飞书 SDK 返回了非二进制文件数据')
      const bytes = Buffer.from(chunk)
      size += bytes.byteLength
      if (size > 50 * 1024 * 1024) {
        stream.destroy?.()
        throw new Error('飞书附件超过 50 MiB 的单文件接收上限')
      }
      chunks.push(bytes)
    }
    if (!size) throw new Error('飞书 SDK 返回了空文件')
    return { buffer: Buffer.concat(chunks, size) }
  }

  async sendText({ chatId, content, replyToMessageId } = {}) {
    const target = safeText(chatId, '飞书 chat_id', 256)
    const text = safeMessageText(content, '飞书消息', 20000)
    const options = replyToMessageId ? { replyTo: safeText(replyToMessageId, '飞书 message_id', 256) } : undefined
    const result = await this.#channel.send(target, { markdown: text }, options)
    return { sent: true, messageId: result?.messageId || '' }
  }

  async sendFile({ chatId, filename, buffer, replyToMessageId } = {}) {
    const target = safeText(chatId, '飞书 chat_id', 256)
    const name = safeText(filename, '飞书文件名', 180)
    if (/[\\/]/.test(name)) throw new Error('飞书文件名不能包含路径分隔符')
    if (!(buffer instanceof Uint8Array) || buffer.byteLength === 0 || buffer.byteLength > 20 * 1024 * 1024) throw new Error('飞书发送文件无效或超过 20 MiB 上限')
    const options = replyToMessageId ? { replyTo: safeText(replyToMessageId, '飞书 message_id', 256) } : undefined
    let result
    try {
      result = await this.#channel.send(target, { file: { source: Buffer.from(buffer), fileName: name } }, options)
    } catch (error) {
      const detail = summarizeApiError(error)
      const wrapped = new Error(`飞书文件上传/发送失败${detail ? `：${detail}` : ''}`, { cause: error })
      if (error?.code != null) wrapped.code = error.code
      throw wrapped
    }
    const messageId = typeof result?.messageId === 'string' ? result.messageId.trim() : ''
    if (!messageId) throw new Error('飞书 SDK 未返回文件消息 ID，不能确认文件已送达')
    return { sent: true, messageId }
  }

  async sendCard({ chatId, card, replyToMessageId } = {}) {
    const target = safeText(chatId, '飞书 chat_id', 256)
    if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('飞书卡片无效')
    if (JSON.stringify(card).length > 20000) throw new Error('飞书卡片超过长度限制')
    const options = replyToMessageId ? { replyTo: safeText(replyToMessageId, '飞书 message_id', 256) } : undefined
    const result = await this.#channel.send(target, { card }, options)
    return { sent: true, messageId: result?.messageId || '' }
  }

  async updateCard({ messageId, card } = {}) {
    const id = safeText(messageId, '飞书 message_id', 256)
    if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('飞书卡片无效')
    if (JSON.stringify(card).length > 20000) throw new Error('飞书卡片超过长度限制')
    if (typeof this.#channel.updateCard !== 'function') throw new Error('飞书官方 SDK 不支持更新交互卡片')
    await this.#channel.updateCard(id, card)
    return { updated: true, messageId: id }
  }

  async recallMessage({ messageId } = {}) {
    const id = safeText(messageId, '飞书 message_id', 256)
    if (typeof this.#channel.recallMessage !== 'function') throw new Error('飞书官方 SDK 不支持撤回消息')
    await this.#channel.recallMessage(id)
    return { recalled: true, messageId: id }
  }
}
