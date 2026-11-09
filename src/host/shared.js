import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Service } from '@deepseek-ai/cordis'
import { WeComAIBotClient } from '../wecom-api.js'
import { FeishuClient } from '../feishu-api.js'
export { randomUUID, defineTool, Service, WeComAIBotClient, FeishuClient }

let KeyringEntry
try {
  ({ Entry: KeyringEntry } = await import('@napi-rs/keyring'))
} catch {
  // Missing optional native bindings must not disable the rest of Project Hub.
}

export function createKeyringEntry(service, account) {
  if (typeof KeyringEntry !== 'function') {
    throw new Error('系统凭证库原生模块不可用；请重新安装插件依赖，或改用 Host 环境变量配置机器人凭证')
  }
  return new KeyringEntry(service, account)
}

export const ROUTE = '/api/project-hub'
export const INTEGRATION_AGENT_ACTIONS = new Set(['list_project_files', 'wecom_send_text', 'wecom_status', 'feishu_status', 'feishu_send_test', 'send_file'])
export const PROJECT_AGENT_ACTIONS = new Set(['agent_tool_status', 'review_code_changes', 'get_project', 'list_tasks', 'create_task', 'update_task', 'add_task_node'])
// DSH mounts exactly one native shell tool per host platform: Bash off Windows, Pwsh on Windows.
export const STANDARD_DSH_TOOL_NAMES = ['read', 'write', process.platform === 'win32' ? 'pwsh' : 'bash']
export const ROOT = 'projects' // legacy layout, retained only for safe migration
export const PROJECT_FILE = 'project.md'
export const TASKS_DIR = 'tasks'
export const PROJECT_FILES_DIR = 'files'
export const PROJECT_FILE_MAX_BYTES = 50 * 1024 * 1024
export const OUTBOUND_FILE_MAX_BYTES = 20 * 1024 * 1024
export const PROJECT_ID = /^p-[a-z0-9-]{4,80}$/
export const TASK_ID = /^t-[a-z0-9-]{4,80}$/
export const STATUS = new Set(['todo', 'doing', 'done', 'blocked'])
export const PRIORITY = new Set(['low', 'normal', 'high', 'urgent'])
export const TASK_NODE_KINDS = new Set(['completed', 'current', 'blocker'])
export const TASK_NODE_LIMIT = 500
export const TASK_NODE_TEXT_MAX = 2000
export const WECOM_CREDENTIAL_SERVICE = 'DeepSeekHarness.ProjectHub'
export const WECOM_CREDENTIAL_ACCOUNT = 'wecom-aibot'
export const WECOM_BINDING_ACCOUNT = 'wecom-project-binding'
export const WECOM_PAIRING_TTL_MS = 5 * 60 * 1000
export const FEISHU_CREDENTIAL_ACCOUNT = 'feishu-app'
export const FEISHU_BINDING_ACCOUNT = 'feishu-user-binding'
export const FEISHU_PAIRING_TTL_MS = 5 * 60 * 1000
export const FEISHU_SEEN_LIMIT = 5000
export const FEISHU_PENDING_LIMIT = 100
export const BRIDGE_JOURNAL_FILE = '.project-hub-bridge-state.json'
export const BRIDGE_JOURNAL_VERSION = 1
export const BRIDGE_JOURNAL_MAX_BYTES = 4 * 1024 * 1024
export const BRIDGE_EVENT_TTL_MS = 24 * 60 * 60 * 1000
export const FEISHU_OUTBOX_LIMIT = 50
export const INBOUND_FILE_MAX_BYTES = 50 * 1024 * 1024
export const INBOUND_FILE_COUNT_LIMIT = 5
export const INBOUND_MESSAGE_FILE_MAX_BYTES = 100 * 1024 * 1024
export const INBOUND_FILE_BATCH_CONCURRENCY = 2
export const INBOUND_FILE_CONFIRM_TTL_MS = 5 * 60 * 1000
export const PROJECT_FILE_WRITE_SCRIPT = [
  'const fs=require("node:fs"),path=require("node:path");',
  'let input="";process.stdin.setEncoding("utf8");',
  'process.stdin.on("data",chunk=>{input+=chunk});',
  'process.stdin.on("end",()=>{',
  'const target=process.env.PROJECT_HUB_FILE_TARGET,mode=process.env.PROJECT_HUB_FILE_MODE;',
  'let temp="",backup="";',
  'try{',
  'if(!target||!(mode==="create"||mode==="replace"))throw new Error("INVALID_WRITE_REQUEST");',
  'const bytes=Buffer.from(input,"base64");',
  'const dir=path.dirname(target);fs.mkdirSync(dir,{recursive:true});',
  'temp=target+".dsh-"+process.pid+"-"+Date.now()+".tmp";',
  'fs.writeFileSync(temp,bytes,{flag:"wx"});',
  'if(mode==="create"){fs.copyFileSync(temp,target,fs.constants.COPYFILE_EXCL);fs.unlinkSync(temp);temp="";}',
  'else{if(fs.existsSync(target)){backup=target+".dsh-"+process.pid+".bak";fs.renameSync(target,backup);}',
  'try{fs.renameSync(temp,target);temp="";}catch(error){if(backup&&fs.existsSync(backup))fs.renameSync(backup,target);backup="";throw error;}',
  'if(backup){try{fs.unlinkSync(backup);}catch{};backup="";}}',
  '}catch(error){if(temp){try{fs.unlinkSync(temp);}catch{}};console.error(error&&typeof error.code==="string"?error.code:"WRITE_FAILED");process.exitCode=1;}',
  '});'
].join('')
export const PROJECT_FILE_WRITE_PWSH_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$target = $env:PROJECT_HUB_FILE_TARGET',
  '$mode = $env:PROJECT_HUB_FILE_MODE',
  '$temp = $null; $backup = $null',
  'try {',
  "  if ([string]::IsNullOrWhiteSpace($target) -or $mode -notin @('create','replace')) { throw 'INVALID_WRITE_REQUEST' }",
  '  $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
  '  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null',
  '  $token = [guid]::NewGuid().ToString("N")',
  '  $temp = "$target.dsh-$token.tmp"',
  '  [System.IO.File]::WriteAllBytes($temp, $bytes)',
  "  if ($mode -eq 'create') {",
  '    try { [System.IO.File]::Move($temp, $target); $temp = $null }',
  "    catch [System.IO.IOException] { if ([System.IO.File]::Exists($target)) { if ($temp -and [System.IO.File]::Exists($temp)) { [System.IO.File]::Delete($temp); $temp = $null }; [Console]::Error.WriteLine('EEXIST'); exit 1 }; throw }",
  '  } else {',
  '    if ([System.IO.File]::Exists($target)) { $backup = "$target.dsh-$token.bak"; [System.IO.File]::Move($target, $backup) }',
  '    try { [System.IO.File]::Move($temp, $target); $temp = $null }',
  '    catch { if ($backup -and [System.IO.File]::Exists($backup)) { [System.IO.File]::Move($backup, $target); $backup = $null }; throw }',
  '    if ($backup) { try { [System.IO.File]::Delete($backup) } catch { }; $backup = $null }',
  '  }',
  "} catch { $exception = $_.Exception; $cause = if ($exception.InnerException) { $exception.InnerException } else { $exception }; $kind = if ($cause -is [System.UnauthorizedAccessException]) { 'ACCESS_DENIED' } elseif ($cause -is [System.IO.IOException]) { 'IO_FAILURE' } else { $cause.GetType().Name }; [Console]::Error.WriteLine(\"WRITE_FAILED:$kind\"); exit 1 }",
  'finally { if ($temp -and [System.IO.File]::Exists($temp)) { try { [System.IO.File]::Delete($temp) } catch { } } }'
].join('\n')

export function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
}
export function fail(message, status = 400) {
  const error = new Error(message)
  error.status = status
  throw error
}
export function failWithCode(message, status, code) {
  const error = new Error(message)
  error.status = status
  error.code = code
  throw error
}
export function safeText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label}不能为空且最多 ${max} 个字符`)
  return value.trim()
}
export function textBlocksText(content) {
  return Array.isArray(content) ? content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('').trim() : ''
}
export function truncateWeComText(value, max) {
  const text = String(value || '').trim()
  if (text.length <= max) return text
  let end = Math.max(0, max - 1)
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--
  return `${text.slice(0, end)}…`
}
export function sanitizeInboundFilename(value, fallback = 'attachment.bin') {
  const candidate = typeof value === 'string' ? value.replace(/\\/g, '/').split('/').at(-1) : ''
  let name = String(candidate || '').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 180)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) name = `_${name}`
  return name || fallback
}
export function feishuFileResources(message, rawMessage) {
  const normalized = Array.isArray(message?.resources) ? message.resources.filter((resource) => resource?.type === 'file' && typeof resource.fileKey === 'string' && resource.fileKey.trim()) : []
  if (normalized.length) return normalized
  if (typeof rawMessage?.content !== 'string') return []
  try {
    const content = JSON.parse(rawMessage.content)
    const fileKey = typeof content?.file_key === 'string' ? content.file_key : ''
    if (!fileKey) return []
    return [{ type: 'file', fileKey, ...(typeof content.file_name === 'string' ? { fileName: content.file_name } : {}) }]
  } catch { return [] }
}
export function parseScalar(value) {
  try { return JSON.parse(value) } catch { return value }
}
export function parseDocument(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '')
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(normalized)
  if (!match) return { front: {}, body: normalized }
  const front = {}
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index < 1) continue
    front[line.slice(0, index).trim()] = parseScalar(line.slice(index + 1).trim())
  }
  return { front, body: normalized.slice(match[0].length) }
}
export function serializeDocument(front, body = '') {
  const lines = ['---']
  for (const [key, value] of Object.entries(front)) lines.push(`${key}: ${JSON.stringify(value)}`)
  lines.push('---', '', String(body || '').trimEnd())
  return `${lines.join('\n')}\n`
}
export function slug(value) {
  const ascii = value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
  return ascii || 'project'
}
export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function defaultTaskDates(now = new Date()) {
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { start: localDateString(startDate), due: localDateString(dueDate) }
}
export function normalizeAssignees(value) {
  if (!Array.isArray(value)) fail('assignees 必须是数组')
  return value.map((person) => {
    if (!person || typeof person !== 'object') fail('负责人格式无效')
    const id = safeText(person.id, '负责人 ID', 80)
    const name = typeof person.name === 'string' && person.name.trim() ? person.name.trim().slice(0, 80) : id
    return person.role === 'owner' ? { id, name, role: 'owner' } : { id, name }
  })
}
export function normalizeTaskNodes(value) {
  if (!Array.isArray(value)) return []
  return value.slice(-TASK_NODE_LIMIT).flatMap((node) => {
    if (!node || typeof node !== 'object' || !TASK_NODE_KINDS.has(node.kind) || typeof node.text !== 'string' || !node.text.trim() || typeof node.id !== 'string' || !node.id.trim()) return []
    const at = typeof node.at === 'string' && Number.isFinite(Date.parse(node.at)) ? node.at : ''
    if (!at) return []
    const normalized = {
      id: node.id,
      kind: node.kind,
      text: node.text.trim().slice(0, TASK_NODE_TEXT_MAX),
      at,
      active: node.kind !== 'completed' && node.active !== false
    }
    if (typeof node.resolvedAt === 'string' && Number.isFinite(Date.parse(node.resolvedAt))) normalized.resolvedAt = node.resolvedAt
    return [normalized]
  })
}
export function emptyBridgeJournal() {
  return { version: BRIDGE_JOURNAL_VERSION, updatedAt: new Date().toISOString(), seen: { wecom: [], feishu: [] }, feishuPending: [], feishuOutbox: [] }
}
export function parseBridgeJournal(encoded) {
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > BRIDGE_JOURNAL_MAX_BYTES) throw new Error('Project Hub bridge journal exceeds its size limit')
  let value
  try { value = JSON.parse(encoded) } catch { throw new Error('Project Hub bridge journal is corrupt') }
  if (!value || value.version !== BRIDGE_JOURNAL_VERSION || !value.seen || !Array.isArray(value.seen.wecom) || !Array.isArray(value.seen.feishu) || !Array.isArray(value.feishuOutbox)) throw new Error('Project Hub bridge journal schema is unsupported')
  const normalizeSeen = (entries) => entries.filter((entry) => entry && typeof entry.key === 'string' && entry.key.length <= 512 && Number.isFinite(entry.at)).map((entry) => ({ key: entry.key, at: entry.at })).slice(-FEISHU_SEEN_LIMIT)
  const feishuOutbox = value.feishuOutbox.filter((record) => record && typeof record.id === 'string' && record.id.length <= 256 && typeof record.sessionId === 'string' && typeof record.chatId === 'string' && typeof record.openId === 'string' && typeof record.replyToMessageId === 'string' && typeof record.output === 'string' && ['queued', 'sending', 'uncertain'].includes(record.status)).map((record) => ({ id: record.id, sessionId: record.sessionId, ...(typeof record.dshMessageId === 'string' ? { dshMessageId: record.dshMessageId.slice(0, 256) } : {}), chatId: record.chatId, openId: record.openId, replyToMessageId: record.replyToMessageId, output: record.output.slice(0, 19000), status: record.status, attempts: Number.isSafeInteger(record.attempts) && record.attempts >= 0 ? record.attempts : 0, createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(), lastErrorCode: typeof record.lastErrorCode === 'string' ? record.lastErrorCode.slice(0, 48) : '' })).slice(-FEISHU_OUTBOX_LIMIT)
  const pendingSource = Array.isArray(value.feishuPending) ? value.feishuPending : []
  const feishuPending = pendingSource.filter((record) => record && typeof record.id === 'string' && record.id.length <= 256 && typeof record.sessionId === 'string' && typeof record.eventKey === 'string' && typeof record.chatId === 'string' && typeof record.openId === 'string' && typeof record.replyToMessageId === 'string' && typeof record.output === 'string' && ['pending', 'running', 'completed', 'sent'].includes(record.status)).map((record) => ({ id: record.id, sessionId: record.sessionId, eventKey: record.eventKey.slice(0, 512), chatId: record.chatId, openId: record.openId, replyToMessageId: record.replyToMessageId, output: record.output.slice(0, 19000), status: record.status, ...(Number.isSafeInteger(record.turn) ? { turn: record.turn } : {}), createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString() })).slice(-FEISHU_PENDING_LIMIT)
  return { version: BRIDGE_JOURNAL_VERSION, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '', seen: { wecom: normalizeSeen(value.seen.wecom), feishu: normalizeSeen(value.seen.feishu) }, feishuPending, feishuOutbox }
}
export function bridgeJournalStageError(error, stage) {
  const wrapped = new Error(error instanceof Error ? error.message : String(error), { cause: error })
  if (typeof error?.code === 'string') wrapped.code = error.code
  if (Number.isSafeInteger(error?.status)) wrapped.status = error.status
  wrapped.bridgeJournalStage = stage
  return wrapped
}
export function bridgeJournalErrorCode(error) {
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,47}$/.test(error.code)) return error.code
  if (typeof error?.code === 'string' && /^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+){0,2}$/.test(error.code)) return error.code.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 48)
  if (Number.isSafeInteger(error?.status)) return `HOST_${error.status}`
  if (error?.name === 'SyntaxError') return 'SYNTAX_ERROR'
  return typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : 'UNKNOWN'
}
export function bridgeJournalClaimFailureNotice(error) {
  if (error?.code === 'SESSION_AUTO_RESUME_FAILED') return 'DSH 未能自动恢复绑定的项目助手会话，消息未送入 DSH；请在 DSH 打开对应助手会话后重发。'
  if (error?.code === 'SESSION_AGENT_NOT_ACTIVE') return '绑定的 DSH 会话存在，但对应 Agent 当前不可用，消息未送入 DSH；请打开该助手会话后重发。'
  if (error?.code === 'SESSION_NOT_ACTIVE') return '绑定的 DSH 项目助手会话当前未激活，消息未送入 DSH；请在 DSH 打开对应助手会话后重发。'
  if (typeof error?.code === 'string' && error.code.startsWith('SESSION_')) return '绑定的 DSH 会话与工作区信息不匹配，消息未送入 DSH；请在 Project Hub 重新绑定项目助手会话后重试。'
  return '当前无法安全记录消息去重状态，消息未送入 DSH；请稍后重发。'
}
export function pickPatch(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} patch 格式无效`)
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length) fail(`${label} 不允许修改字段：${unknown.join(', ')}`)
  if (!Object.keys(value).length) fail(`${label} patch 不能为空`)
  return value
}

