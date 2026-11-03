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

export class FeishuClient {
  #channel

  constructor({ appId, appSecret, sdk } = {}) {
    const id = safeText(appId, '飞书 App ID', 128)
    const secret = safeText(appSecret, '飞书 App Secret', 1024)
    const officialSdk = sdk || loadOfficialSdk()
    if (typeof officialSdk?.createLarkChannel !== 'function') throw new Error('飞书官方 Node.js SDK 不可用')
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

  async downloadFile(fileKey) {
    const key = safeText(fileKey, '飞书 file_key', 512)
    if (typeof this.#channel.downloadResource !== 'function') throw new Error('飞书官方 SDK 不支持文件资源下载')
    const buffer = await this.#channel.downloadResource(key, 'file')
    if (!(buffer instanceof Uint8Array)) throw new Error('飞书 SDK 返回的文件数据无效')
    return { buffer }
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
    const result = await this.#channel.send(target, { file: { source: Buffer.from(buffer), fileName: name } }, options)
    return { sent: true, messageId: result?.messageId || '' }
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
}
