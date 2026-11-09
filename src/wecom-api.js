import AiBot, { generateReqId } from '@wecom/aibot-node-sdk'

const SILENT_LOGGER = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
})

function validateText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new Error('企业微信消息不能为空且最多 2048 个字符')
  }
  return value.trim()
}

export class WeComAIBotClient {
  #client
  #makeRequestId

  constructor({ botId, secret, sdk = AiBot, makeRequestId = generateReqId } = {}) {
    if (typeof botId !== 'string' || !botId.trim() || typeof secret !== 'string' || !secret.trim()) {
      throw new Error('企业微信智能机器人长连接需要 Bot ID 和 Secret')
    }
    if (typeof sdk?.WSClient !== 'function') throw new Error('企业微信智能机器人 SDK 不可用')
    this.#client = new sdk.WSClient({
      botId: botId.trim(),
      secret: secret.trim(),
      reconnectInterval: 1000,
      maxReconnectAttempts: -1,
      maxAuthFailureAttempts: 5,
      logger: SILENT_LOGGER
    })
    this.#makeRequestId = makeRequestId
  }

  on(event, listener) {
    this.#client.on(event, listener)
    return this
  }

  connect() {
    this.#client.connect()
    return this
  }

  disconnect() {
    this.#client.disconnect()
  }

  async downloadFile(url, aesKey) {
    if (typeof url !== 'string' || !url.trim() || url.length > 4096) throw new Error('企业微信文件下载地址无效')
    let parsedUrl
    try { parsedUrl = new URL(url) } catch { throw new Error('企业微信文件下载地址无效') }
    if (parsedUrl.protocol !== 'https:') throw new Error('企业微信文件下载必须使用 HTTPS')
    if (typeof aesKey !== 'string' || !aesKey.trim() || aesKey.length > 512) throw new Error('企业微信文件解密密钥无效')
    if (typeof this.#client.downloadFile !== 'function') throw new Error('企业微信 SDK 不支持文件下载')
    const result = await this.#client.downloadFile(url, aesKey)
    if (!(result?.buffer instanceof Uint8Array)) throw new Error('企业微信 SDK 返回的文件数据无效')
    return { buffer: result.buffer, ...(typeof result.filename === 'string' ? { filename: result.filename } : {}) }
  }

  async sendText({ recipient, content } = {}) {
    if (typeof recipient !== 'string' || !recipient.trim() || recipient.length > 128 || /[\u0000-\u001f\u007f]/.test(recipient) || recipient.trim().toLowerCase() === '@all') {
      throw new Error('企业微信接收目标无效；禁止使用 @all 群发')
    }
    const text = validateText(content)
    await this.#client.sendMessage(recipient, {
      msgtype: 'markdown',
      markdown: { content: text }
    })
    return { sent: true }
  }

  async sendFile({ recipient, filename, buffer } = {}) {
    if (typeof recipient !== 'string' || !recipient.trim() || recipient.length > 128 || /[\u0000-\u001f\u007f]/.test(recipient) || recipient.trim().toLowerCase() === '@all') {
      throw new Error('企业微信接收目标无效；禁止使用 @all 群发')
    }
    if (typeof filename !== 'string' || !filename.trim() || filename.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(filename)) throw new Error('企业微信文件名无效')
    if (!(buffer instanceof Uint8Array) || buffer.byteLength === 0 || buffer.byteLength > 20 * 1024 * 1024) throw new Error('企业微信发送文件无效或超过 20 MiB 上限')
    if (typeof this.#client.uploadMedia !== 'function' || typeof this.#client.sendMediaMessage !== 'function') throw new Error('企业微信 SDK 不支持主动文件发送')
    const uploaded = await this.#client.uploadMedia(Buffer.from(buffer), { type: 'file', filename: filename.trim() })
    if (typeof uploaded?.media_id !== 'string' || !uploaded.media_id.trim()) throw new Error('企业微信文件上传未返回 media_id')
    await this.#client.sendMediaMessage(recipient.trim(), 'file', uploaded.media_id)
    return { sent: true }
  }

  createStreamId() {
    return this.#makeRequestId('stream')
  }

  async replyStream(frame, streamId, content, finish = false) {
    if (!frame?.headers?.req_id) throw new Error('企业微信回调帧缺少 req_id')
    if (typeof streamId !== 'string' || !streamId) throw new Error('企业微信流式回复缺少 stream_id')
    const text = validateText(content)
    await this.#client.replyStream(frame, streamId, text, Boolean(finish))
    return { replied: true, finish: Boolean(finish) }
  }

  async replyText(frame, content) {
    return this.replyStream(frame, this.createStreamId(), content, true)
  }
}

