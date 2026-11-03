import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Service } from '@deepseek-ai/cordis'
import { WeComAIBotClient } from './wecom-api.js'
import { FeishuClient } from './feishu-api.js'

let KeyringEntry
try {
  ({ Entry: KeyringEntry } = await import('@napi-rs/keyring'))
} catch {
  // Missing optional native bindings must not disable the rest of Project Hub.
}

function createKeyringEntry(service, account) {
  if (typeof KeyringEntry !== 'function') {
    throw new Error('系统凭证库原生模块不可用；请重新安装插件依赖，或改用 Host 环境变量配置机器人凭证')
  }
  return new KeyringEntry(service, account)
}

const ROUTE = '/api/project-hub'
const ROOT = 'projects' // legacy layout, retained only for safe migration
const PROJECT_FILE = 'project.md'
const TASKS_DIR = 'tasks'
const PROJECT_FILES_DIR = 'files'
const PROJECT_FILE_MAX_BYTES = 50 * 1024 * 1024
const OUTBOUND_FILE_MAX_BYTES = 20 * 1024 * 1024
const PROJECT_ID = /^p-[a-z0-9-]{4,80}$/
const TASK_ID = /^t-[a-z0-9-]{4,80}$/
const STATUS = new Set(['todo', 'doing', 'done', 'blocked'])
const PRIORITY = new Set(['low', 'normal', 'high', 'urgent'])
const TASK_NODE_KINDS = new Set(['completed', 'current', 'blocker'])
const TASK_NODE_LIMIT = 500
const TASK_NODE_TEXT_MAX = 2000
const WECOM_CREDENTIAL_SERVICE = 'DeepSeekHarness.ProjectHub'
const WECOM_CREDENTIAL_ACCOUNT = 'wecom-aibot'
const WECOM_BINDING_ACCOUNT = 'wecom-project-binding'
const WECOM_PAIRING_TTL_MS = 5 * 60 * 1000
const FEISHU_CREDENTIAL_ACCOUNT = 'feishu-app'
const FEISHU_BINDING_ACCOUNT = 'feishu-user-binding'
const FEISHU_PAIRING_TTL_MS = 5 * 60 * 1000
const FEISHU_SEEN_LIMIT = 5000
const FEISHU_PENDING_LIMIT = 100
const INBOUND_FILE_MAX_BYTES = 50 * 1024 * 1024
const INBOUND_FILE_COUNT_LIMIT = 5
const INBOUND_MESSAGE_FILE_MAX_BYTES = 100 * 1024 * 1024
const INBOUND_FILE_CONFIRM_TTL_MS = 5 * 60 * 1000
const PROJECT_FILE_WRITE_SCRIPT = [
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
const PROJECT_FILE_WRITE_PWSH_SCRIPT = [
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

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
}
function fail(message, status = 400) {
  const error = new Error(message)
  error.status = status
  throw error
}
function safeText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label}不能为空且最多 ${max} 个字符`)
  return value.trim()
}
function textBlocksText(content) {
  return Array.isArray(content) ? content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('').trim() : ''
}
function truncateWeComText(value, max) {
  const text = String(value || '').trim()
  if (text.length <= max) return text
  let end = Math.max(0, max - 1)
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--
  return `${text.slice(0, end)}…`
}
function sanitizeInboundFilename(value, fallback = 'attachment.bin') {
  const candidate = typeof value === 'string' ? value.replace(/\\/g, '/').split('/').at(-1) : ''
  let name = String(candidate || '').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 180)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) name = `_${name}`
  return name || fallback
}
function feishuFileResources(message, rawMessage) {
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
function parseScalar(value) {
  try { return JSON.parse(value) } catch { return value }
}
function parseDocument(text) {
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
function serializeDocument(front, body = '') {
  const lines = ['---']
  for (const [key, value] of Object.entries(front)) lines.push(`${key}: ${JSON.stringify(value)}`)
  lines.push('---', '', String(body || '').trimEnd())
  return `${lines.join('\n')}\n`
}
function slug(value) {
  const ascii = value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
  return ascii || 'project'
}
function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function normalizeAssignees(value) {
  if (!Array.isArray(value)) fail('assignees 必须是数组')
  return value.map((person) => {
    if (!person || typeof person !== 'object') fail('负责人格式无效')
    const id = safeText(person.id, '负责人 ID', 80)
    const name = typeof person.name === 'string' && person.name.trim() ? person.name.trim().slice(0, 80) : id
    return person.role === 'owner' ? { id, name, role: 'owner' } : { id, name }
  })
}
function normalizeTaskNodes(value) {
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
function pickPatch(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} patch 格式无效`)
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length) fail(`${label} 不允许修改字段：${unknown.join(', ')}`)
  if (!Object.keys(value).length) fail(`${label} patch 不能为空`)
  return value
}

class ProjectHub extends Service {
  static inject = ['connection', 'fs', 'shell', 'sandboxPolicy', 'tools', 'workspaceRegistry', 'sessions', 'agents']
  ensureProjects = new Map()
  wecomClient = null
  createWeComClient = (options) => new WeComAIBotClient(options)
  wecomStatus = { state: 'not-configured', label: '尚未配置智能机器人长连接' }
  wecomCredentialSource = null
  wecomPairingChallenge = null
  wecomSeenMessages = new Map()
  wecomPendingMessages = new Map()
  wecomOpenTurns = new Map()
  wecomTurnReplies = new Map()
  wecomMirrorTurnReplies = new Map()
  wecomPendingFileOverwrites = new Map()
  feishuClient = null
  createFeishuClient = (options) => new FeishuClient(options)
  feishuStatus = { state: 'not-configured', label: '尚未配置飞书应用' }
  feishuCredentialSource = null
  feishuTenantKey = ''
  feishuPairingChallenges = new Map()
  feishuSeenMessages = new Map()
  feishuPendingMessages = new Map()
  feishuPendingFileOverwrites = new Map()
  feishuOpenTurns = new Map()
  feishuTurnReplies = new Map()
  feishuMirrorTurnReplies = new Map()
  externalMessageOrigins = new Map()
  feishuInboundDiagnostics = { sequence: 0, receivedCount: 0, lastAt: null, lastType: null, lastOutcome: 'none', rejectedCount: 0, lastRejectAt: null, lastRejectReason: null, dispatcherErrorCount: 0, lastDispatcherErrorAt: null, lastDispatcherErrorCode: null }
  feishuReplyDiagnostics = { pendingCount: 0, sentCount: 0, failedCount: 0, lastAt: null, lastOutcome: 'none', lastErrorCode: null }

  constructor(ctx) {
    super(ctx, 'projectHub')
    this.root = ctx.sandboxPolicy.workspaceRoot
    ctx.on('session/event', (session, event) => this.handleSessionEvent(session, event))
    ctx.effect(() => ctx.connection.fetch.register({
      path: ROUTE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: (request) => this.handleScoped(request)
    }), 'project-hub: api route')
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'project_hub_manage',
      description: '只能访问调用此工具的 DSH 会话所属工作区对应的唯一 Project Hub 项目。任务只使用待办、进行中、有阻塞、完成四种状态；阶段和里程碑不再使用。用户明确要求时才创建/修改任务、记录任务节点或发送文件。add_task_node 用于追加完成事项、当前事项或阻塞卡点，完成时间由 Host 记录。企业微信使用智能机器人 API 长连接；飞书使用官方长连接并仅接受已绑定的单聊。send_file 只发送当前项目 Workspace 下 files/ 目录内的文件到本项目已绑定的平台私聊；不接受任何目标 ID，不可用于群发。禁止删除和猜测日期。',
      parameters: {
        action: { type: 'string', required: true, enum: ['list_projects', 'get_project', 'update_project', 'create_task', 'update_task', 'add_task_node', 'wecom_send_text', 'wecom_status', 'feishu_status', 'feishu_send_test', 'send_file'], description: '操作类型。add_task_node 只追加任务节点；send_file 仅在用户明确要求发送时调用。' },
        taskId: { type: 'string', description: 'get_project 返回的当前工作区任务 ID。' },
        title: { type: 'string', description: 'create_task 新任务的标题。' },
        kind: { type: 'string', enum: ['completed', 'current', 'blocker'], description: '仅 add_task_node 使用：completed=记录已完成事项和时间，current=更新当前事项，blocker=记录阻塞卡点并将任务设为有阻塞。' },
        path: { type: 'string', description: '仅 send_file 使用：当前项目文件路径，如 files/reports/status.pptx（也可写成 reports/status.pptx）；必须位于 files/ 下，不得使用绝对路径或 ..。' },
        nodeText: { type: 'string', description: '仅 add_task_node 使用：节点说明，最多 2000 字符。' },
        platform: { type: 'string', enum: ['feishu', 'wecom'], description: 'send_file 可选。用户明确指定飞书或企微时填写；从某平台私聊发起且用户说“发给我/发到这里”时省略，由 Host 按本轮入站平台确定。' },
        recipient: { type: 'string', description: '仅 wecom_send_text 使用：单聊 UserID 或已授权群聊 chatid；不接受 @all。send_file 不接受 recipient。' },
        text: { type: 'string', description: '仅 wecom_send_text 使用：要发送的 Markdown 文本，最多 2048 字符。' },
        patch: { type: 'json', description: '要更新的字段。项目支持 name、description、startDate、dueDate；任务支持 title、status、priority、start、due、progress、critical、assignees、relatedTo、checklist、body。阶段和里程碑已停用；节点请使用 add_task_node。' }
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: (args, exec) => this.executeAgentTool(args, exec.signal, exec.agent),
      presentCall: (args) => ({ card: 'generic', title: 'Project Hub', kind: ['list_projects', 'get_project', 'wecom_status', 'feishu_status'].includes(args.action) ? 'read' : 'other', rawInput: args })
    })), 'project-hub: assistant tool')
    ctx.effect(() => this.startWeComConnection(), 'project-hub: wecom ai bot long connection')
    ctx.effect(() => this.startFeishuConnection(), 'project-hub: feishu official long connection')
  }

  async target(relativePath, workspaceRoot = this.root) {
    const root = await this.ctx.fs.resolve(workspaceRoot)
    const target = await this.ctx.fs.resolve(relativePath, { cwd: workspaceRoot })
    if (!this.ctx.fs.contains(root, target)) fail('文件目标超出所属 DSH 工作区，拒绝访问', 403)
    return target
  }

  async assertEntryType(relativePath, expectedType, workspaceRoot, { optional = false, signal } = {}) {
    const entry = await this.ctx.fs.lstat(relativePath, { cwd: workspaceRoot }, signal)
    if (!entry && optional) return undefined
    if (!entry || entry.type !== expectedType) fail(`项目路径类型无效或包含符号链接：${relativePath}`, 403)
    return entry
  }

  async assertProjectPath(relativePath, workspaceRoot, signal) {
    if (relativePath === PROJECT_FILE) {
      await this.assertEntryType(PROJECT_FILE, 'file', workspaceRoot, { optional: true, signal })
      return
    }
    const taskMatch = new RegExp(`^${TASKS_DIR}/(t-[a-z0-9-]{4,80}\\.md)$`).exec(relativePath)
    if (relativePath === TASKS_DIR || taskMatch) {
      await this.assertEntryType(TASKS_DIR, 'directory', workspaceRoot, { optional: true, signal })
      if (taskMatch) await this.assertEntryType(relativePath, 'file', workspaceRoot, { optional: true, signal })
      return
    }
    const legacy = new RegExp(`^${ROOT}/(p-[a-z0-9-]{4,80})(?:/(tasks)(?:/t-[a-z0-9-]{4,80}\\.md)?|/PROJECT\\.md)?$`).exec(relativePath)
    if (!legacy) fail('项目路径不在允许的 Workspace 根目录结构中', 403)
    await this.assertEntryType(ROOT, 'directory', workspaceRoot, { optional: true, signal })
    await this.assertEntryType(`${ROOT}/${legacy[1]}`, 'directory', workspaceRoot, { optional: true, signal })
    if (legacy[2]) await this.assertEntryType(`${ROOT}/${legacy[1]}/tasks`, 'directory', workspaceRoot, { optional: true, signal })
    if (relativePath.endsWith('.md')) await this.assertEntryType(relativePath, 'file', workspaceRoot, { optional: true, signal })
  }

  projectFilesPath(projectId, path = '') {
    if (!PROJECT_ID.test(projectId)) fail('项目 ID 无效')
    if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path)) fail('项目文件路径必须是 Workspace 根目录 files 内的相对路径', 403)
    const segments = path === '' ? [] : path.split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\u0000-\u001f]/.test(segment))) fail('项目文件路径包含无效目录名', 403)
    return segments.length ? `${PROJECT_FILES_DIR}/${segments.join('/')}` : PROJECT_FILES_DIR
  }

  async assertProjectFilesPath(projectId, path, workspaceRoot, expectedType, signal) {
    const relativePath = this.projectFilesPath(projectId, path)
    await this.assertEntryType(PROJECT_FILES_DIR, 'directory', workspaceRoot, { signal })
    let current = PROJECT_FILES_DIR
    const segments = path === '' ? [] : path.split('/')
    for (let index = 0; index < segments.length; index += 1) {
      current += `/${segments[index]}`
      const type = index < segments.length - 1 ? 'directory' : expectedType
      await this.assertEntryType(current, type, workspaceRoot, { signal })
    }
    return relativePath
  }

  async readFile(relativePath, signal, workspaceRoot = this.root) {
    await this.assertProjectPath(relativePath, workspaceRoot, signal)
    const target = await this.target(relativePath, workspaceRoot)
    return this.ctx.fs.readText(target, signal)
  }

  async writeFile(relativePath, content, signal, workspaceRoot = this.root, sandboxPolicy) {
    await this.assertProjectPath(relativePath, workspaceRoot, signal)
    const target = await this.target(relativePath, workspaceRoot)
    const current = await this.ctx.fs.stat(target, signal)
    if (current) {
      return this.ctx.fs.writeText(target, content, { kind: 'replaceIfVersion', version: current.version }, signal, sandboxPolicy)
    }
    return this.ctx.fs.writeText(target, content, { kind: 'createIfAbsent' }, signal, sandboxPolicy)
  }

  async findProjectFileCollision(workspaceRoot, filename) {
    const directory = await this.ctx.fs.lstat(PROJECT_FILES_DIR, { cwd: workspaceRoot })
    if (!directory) return null
    if (directory.type !== 'directory') fail('项目 files 路径不是安全目录，拒绝写入', 403)
    const directoryTarget = await this.target(PROJECT_FILES_DIR, workspaceRoot)
    let entries = []
    try { entries = await this.ctx.fs.listDir(directoryTarget) }
    catch (error) { if (error?.code !== 'FS_NOT_FOUND' && error?.code !== 'ENOENT') throw error }
    const match = entries.find((entry) => entry.name.toLocaleLowerCase() === filename.toLocaleLowerCase())
    if (!match) return null
    const relativePath = `${PROJECT_FILES_DIR}/${match.name}`
    const info = await this.ctx.fs.lstat(relativePath, { cwd: workspaceRoot })
    if (!info || info.type === 'symlink') fail('同名项目路径不是普通文件，拒绝覆盖', 403)
    if (info.type !== 'file') fail('files 目录中存在同名目录，无法保存该文件', 409)
    return { filename: match.name, relativePath, info }
  }

  async writeInboundProjectFile({ workspace, session, filename, bytes, overwrite = false }) {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) fail('收到的文件为空或格式无效')
    const safeName = sanitizeInboundFilename(filename)
    let collision = await this.findProjectFileCollision(workspace.path, safeName)
    if (collision && !overwrite) return { conflict: true, filename: collision.filename }
    const finalName = collision?.filename || safeName
    const relativePath = `${PROJECT_FILES_DIR}/${finalName}`
    const target = await this.target(relativePath, workspace.path)
    const targetPath = this.ctx.fs.processPath(target)
    const workspaceTarget = await this.ctx.fs.resolve(workspace.path)
    const workdir = this.ctx.fs.processPath(workspaceTarget)
    const sandboxPolicy = this.ctx.sandboxPolicy.resolve({ session })
    if (sandboxPolicy.mode === 'read-only') {
      const error = new Error('项目助手会话处于只读沙箱，不能保存入站文件')
      error.code = 'SANDBOX_READ_ONLY'
      throw error
    }
    if (sandboxPolicy.mode === 'workspace-write') {
      let policyRoot
      try { policyRoot = await this.ctx.fs.resolve(sandboxPolicy.workspaceRoot) }
      catch {
        const error = new Error('无法解析项目助手会话的沙箱工作区根目录')
        error.code = 'SANDBOX_ROOT_UNRESOLVED'
        throw error
      }
      if (!this.ctx.fs.contains(policyRoot, target)) {
        const error = new Error('目标文件不在项目助手会话允许写入的沙箱根目录中')
        error.code = 'SANDBOX_ROOT_MISMATCH'
        throw error
      }
    }
    if (!this.ctx.shell || typeof this.ctx.shell.resolve !== 'function' || typeof this.ctx.shell.execute !== 'function') fail('DSH 安全 Shell 写入服务不可用', 503)
    const isWindows = globalThis.process?.platform === 'win32'
    const command = isWindows ? PROJECT_FILE_WRITE_PWSH_SCRIPT : `"$PROJECT_HUB_NODE" -e '${PROJECT_FILE_WRITE_SCRIPT}'`
    const spec = this.ctx.shell.resolve({
      command,
      workdir,
      timeoutMs: 60_000,
      stdoutMaxBytes: 1024,
      stdin: Buffer.from(bytes).toString('base64'),
      env: {
        ...(!isWindows ? { PROJECT_HUB_NODE: String(globalThis.process?.execPath || 'node').replace(/\\/g, '/') } : {}),
        PROJECT_HUB_FILE_TARGET: targetPath,
        PROJECT_HUB_FILE_MODE: overwrite ? 'replace' : 'create'
      },
      sandboxPolicy
    })
    const execution = await this.ctx.shell.execute(spec)
    const result = await execution.result()
    const errorCode = String(result?.stderr?.text || '').trim().split(/\s+/)[0]
    if (result?.exitCode !== 0 || result?.timedOut || result?.aborted || result?.sandbox?.denied) {
      if (!overwrite && errorCode === 'EEXIST') {
        collision = await this.findProjectFileCollision(workspace.path, safeName)
        if (collision) return { conflict: true, filename: collision.filename }
      }
      const error = new Error('项目文件安全写入失败')
      error.code = errorCode || (result?.sandbox?.denied ? 'SANDBOX_DENIED' : 'FILE_WRITE_FAILED')
      throw error
    }
    const writtenEntry = await this.ctx.fs.lstat(relativePath, { cwd: workspace.path })
    const writtenInfo = await this.ctx.fs.stat(target)
    if (!writtenEntry || writtenEntry.type !== 'file' || !writtenInfo || writtenInfo.type !== 'file') {
      const error = new Error('项目文件写入后未能在目标目录中验证到文件')
      error.code = 'WRITE_VERIFY_MISSING'
      throw error
    }
    if (Number.isFinite(writtenInfo.size) && writtenInfo.size !== bytes.byteLength) {
      const error = new Error('项目文件写入后大小与接收字节数不一致')
      error.code = 'WRITE_VERIFY_SIZE_MISMATCH'
      throw error
    }
    return { conflict: false, filename: finalName, path: relativePath, size: bytes.byteLength }
  }

  rememberPendingFileOverwrite(map, key, pending) {
    this.clearPendingFileOverwrite(map, key)
    const entry = { ...pending, expiresAt: Date.now() + INBOUND_FILE_CONFIRM_TTL_MS, busy: false, timer: undefined }
    entry.timer = setTimeout(() => {
      if (map.get(key) === entry) map.delete(key)
      for (const file of entry.files || []) file.bytes = undefined
      entry.files = []
    }, INBOUND_FILE_CONFIRM_TTL_MS)
    entry.timer.unref?.()
    map.set(key, entry)
    return entry
  }

  clearPendingFileOverwrite(map, key) {
    const entry = map.get(key)
    if (!entry) return undefined
    clearTimeout(entry.timer)
    map.delete(key)
    return entry
  }

  async saveInboundFileBatch({ map, key, files, workspace, project, session, sessionId, reply, savedBefore = [] }) {
    const saved = [...savedBefore]
    for (let index = 0; index < files.length; index++) {
      const item = files[index]
      const result = await this.writeInboundProjectFile({ workspace, session, filename: item.filename, bytes: item.bytes })
      if (result.conflict) {
        const pendingFiles = [{ filename: result.filename, bytes: item.bytes }, ...files.slice(index + 1)]
        this.rememberPendingFileOverwrite(map, key, {
          sessionId,
          workspaceId: workspace.id,
          projectId: project.id,
          files: pendingFiles,
          savedBefore: saved
        })
        await reply(`项目 files/${result.filename} 已存在。本次该文件尚未保存${pendingFiles.length > 1 ? `，另有 ${pendingFiles.length - 1} 个附件待处理` : ''}。请回复「替换」覆盖，或回复「取消」保留原文件；确认有效期 5 分钟。`)
        return { pending: true, saved }
      }
      saved.push(`files/${result.filename}`)
    }
    return { pending: false, saved }
  }

  projectPath(id, suffix = '') {
    if (!PROJECT_ID.test(id)) fail('项目 ID 无效')
    return `${ROOT}/${id}${suffix ? `/${suffix}` : ''}`
  }

  async migrateLegacyProject(id, signal, workspaceRoot, sandboxPolicy) {
    const legacyDir = this.projectPath(id)
    const rootEntry = await this.ctx.fs.lstat(PROJECT_FILE, { cwd: workspaceRoot }, signal)
    if (rootEntry) {
      const rootDoc = parseDocument(await this.readFile(PROJECT_FILE, signal, workspaceRoot))
      if (rootDoc.front.id !== id) fail('Workspace 根目录已存在另一个 project.md，拒绝覆盖', 409)
      return
    }
    const legacyProjectFile = `${legacyDir}/PROJECT.md`
    const projectDoc = parseDocument(await this.readFile(legacyProjectFile, signal, workspaceRoot))
    if (projectDoc.front.id !== id) fail('旧项目文件 ID 与目录不一致，拒绝迁移', 403)
    const legacyFilesDir = `${legacyDir}/${PROJECT_FILES_DIR}`
    await this.assertEntryType(legacyDir, 'directory', workspaceRoot, { signal })
    await this.assertEntryType(legacyFilesDir, 'directory', workspaceRoot, { optional: true, signal })
    let legacyFiles = []
    try { legacyFiles = await this.ctx.fs.listDir(await this.target(legacyFilesDir, workspaceRoot), signal) }
    catch (error) { if (error?.code !== 'FS_NOT_FOUND' && error?.code !== 'ENOENT') throw error }
    if (legacyFiles.length) fail('旧项目 files 目录含有附件；为避免丢失，已停止自动迁移，请先备份或移出这些文件', 409)
    const legacyTasksDir = `${legacyDir}/${TASKS_DIR}`
    await this.assertEntryType(legacyTasksDir, 'directory', workspaceRoot, { optional: true, signal })
    let taskEntries = []
    try { taskEntries = await this.ctx.fs.listDir(await this.target(legacyTasksDir, workspaceRoot), signal) }
    catch (error) { if (error?.code !== 'FS_NOT_FOUND' && error?.code !== 'ENOENT') throw error }
    for (const entry of taskEntries) {
      if (entry.type !== 'file' || !/^t-[a-z0-9-]{4,80}\.md$/.test(entry.name)) fail(`旧任务目录包含不支持的条目「${entry.name}」，已停止迁移`, 409)
      const sourcePath = `${legacyTasksDir}/${entry.name}`
      await this.assertEntryType(sourcePath, 'file', workspaceRoot, { signal })
      const sourceText = await this.readFile(sourcePath, signal, workspaceRoot)
      const destinationPath = `${TASKS_DIR}/${entry.name}`
      const existing = await this.ctx.fs.stat(await this.target(destinationPath, workspaceRoot), signal)
      if (existing) {
        if (await this.readFile(destinationPath, signal, workspaceRoot) !== sourceText) fail(`Workspace 根目录已有不同内容的任务「${entry.name}」，拒绝覆盖`, 409)
      } else await this.writeFile(destinationPath, sourceText, signal, workspaceRoot, sandboxPolicy)
    }
    await this.writeFile(PROJECT_FILE, serializeDocument(projectDoc.front, projectDoc.body), signal, workspaceRoot, sandboxPolicy)
  }

  async readProject(id, signal, workspaceRoot = this.root) {
    if (!PROJECT_ID.test(id)) fail('项目 ID 无效')
    const rootEntry = await this.ctx.fs.lstat(PROJECT_FILE, { cwd: workspaceRoot }, signal)
    const legacy = !rootEntry
    const dir = legacy ? this.projectPath(id) : ''
    const projectFile = legacy ? `${dir}/PROJECT.md` : PROJECT_FILE
    let projectDoc
    try { projectDoc = parseDocument(await this.readFile(projectFile, signal, workspaceRoot)) }
    catch (error) {
      if (error?.code === 'FS_NOT_FOUND' || error?.code === 'ENOENT') fail('项目不存在', 404)
      throw error
    }
    if (projectDoc.front.id && projectDoc.front.id !== id) fail('项目文件 ID 与项目资料不一致，拒绝访问', 403)
    const taskDir = legacy ? `${dir}/${TASKS_DIR}` : TASKS_DIR
    let entries = []
    try { entries = await this.ctx.fs.listDir(await this.target(taskDir, workspaceRoot), signal) }
    catch (error) { if (error?.code !== 'FS_NOT_FOUND' && error?.code !== 'ENOENT') throw error }
    const taskEntries = entries.filter((entry) => entry.type === 'file' && /^t-[a-z0-9-]{4,80}\.md$/.test(entry.name))
    const tasks = []
    for (let index = 0; index < taskEntries.length; index += 8) {
      const batch = await Promise.all(taskEntries.slice(index, index + 8).map(async (entry) => {
        try {
          const taskPath = `${taskDir}/${entry.name}`
          const doc = parseDocument(await this.readFile(taskPath, signal, workspaceRoot))
          const task = doc.front
          if (!TASK_ID.test(String(task.id || ''))) return null
          const nodes = normalizeTaskNodes(task.nodes)
          return {
            id: task.id,
            title: String(task.title || '未命名任务'),
            status: STATUS.has(task.status) ? task.status : 'todo',
            priority: PRIORITY.has(task.priority) ? task.priority : 'normal',
            assignees: normalizeAssignees(Array.isArray(task.assignees) ? task.assignees : []),
            start: typeof task.start === 'string' ? task.start : '',
            due: typeof task.due === 'string' ? task.due : '',
            progress: Number.isFinite(task.progress) ? Math.max(0, Math.min(100, task.progress)) : task.status === 'done' ? 100 : 0,
            estimate: Number.isFinite(task.estimate) ? task.estimate : null,
            critical: task.critical === true,
            relatedTo: Array.isArray(task.relatedTo) ? task.relatedTo : [],
            checklist: Array.isArray(task.checklist) ? task.checklist : [],
            nodes,
            currentWork: [...nodes].reverse().find((node) => node.kind === 'current' && node.active)?.text || '',
            blocker: task.status === 'blocked' ? [...nodes].reverse().find((node) => node.kind === 'blocker' && node.active)?.text || '' : '',
            body: doc.body,
            file: taskPath
          }
        } catch (error) {
          this.ctx.logger.warn(`project-hub: skipped ${entry.name}: ${String(error)}`)
          return null
        }
      }))
      tasks.push(...batch.filter(Boolean))
    }
    tasks.sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.title.localeCompare(b.title))
    return {
      id: projectDoc.front.id || id,
      workspaceId: typeof projectDoc.front.workspaceId === 'string' ? projectDoc.front.workspaceId : '',
      assistantSessionId: typeof projectDoc.front.assistantSessionId === 'string' ? projectDoc.front.assistantSessionId : '',
      name: projectDoc.front.name || id,
      status: projectDoc.front.status || 'active',
      createdAt: projectDoc.front.createdAt || projectDoc.front.created || null,
      updatedAt: projectDoc.front.updatedAt || projectDoc.front.createdAt || projectDoc.front.created || null,
      startDate: typeof projectDoc.front.startDate === 'string' ? projectDoc.front.startDate : '',
      dueDate: typeof projectDoc.front.dueDate === 'string' ? projectDoc.front.dueDate : '',
      path: legacy ? dir : '.',
      description: typeof projectDoc.front.description === 'string' ? projectDoc.front.description : projectDoc.body,
      tasks,
      progress: tasks.length ? Math.round(tasks.filter((task) => task.status === 'done').length * 100 / tasks.length) : 0
    }
  }

  async touchProject(id, signal, workspaceRoot = this.root, sandboxPolicy) {
    const relativePath = PROJECT_FILE
    await this.assertProjectPath(relativePath, workspaceRoot, signal)
    const target = await this.target(relativePath, workspaceRoot)
    const observed = await this.ctx.fs.stat(target, signal)
    if (!observed) fail('项目不存在', 404)
    const doc = parseDocument(await this.ctx.fs.readText(target, signal))
    if (doc.front.id !== id) fail('Workspace 根目录项目 ID 不匹配', 403)
    doc.front.updatedAt = new Date().toISOString()
    await this.ctx.fs.writeText(target, serializeDocument(doc.front, doc.body), { kind: 'replaceIfVersion', version: observed.version }, signal, sandboxPolicy)
  }

  projectSummary(project) {
    return { id: project.id, name: project.name, status: project.status, path: project.path, updatedAt: project.updatedAt, progress: project.progress, taskCount: project.tasks.length, doneCount: project.tasks.filter((task) => task.status === 'done').length }
  }

  async listProjects(signal, workspaceRoot = this.root) {
    const rootProject = await this.ctx.fs.lstat(PROJECT_FILE, { cwd: workspaceRoot }, signal)
    if (rootProject) {
      await this.assertEntryType(PROJECT_FILE, 'file', workspaceRoot, { signal })
      const doc = parseDocument(await this.readFile(PROJECT_FILE, signal, workspaceRoot))
      const id = String(doc.front.id || '')
      if (!PROJECT_ID.test(id)) fail('Workspace 根目录 project.md 缺少有效项目 ID', 403)
      return [this.projectSummary(await this.readProject(id, signal, workspaceRoot))]
    }
    await this.assertEntryType(ROOT, 'directory', workspaceRoot, { optional: true, signal })
    const projectsTarget = await this.target(ROOT, workspaceRoot)
    let entries = []
    try { entries = await this.ctx.fs.listDir(projectsTarget, signal) }
    catch (error) { if (error?.code !== 'FS_NOT_FOUND' && error?.code !== 'ENOENT') throw error }
    const projects = []
    for (const entry of entries) {
      if (entry.type !== 'directory' || !PROJECT_ID.test(entry.name)) continue
      try { projects.push(this.projectSummary(await this.readProject(entry.name, signal, workspaceRoot))) }
      catch (error) { this.ctx.logger.warn(`project-hub: skipped legacy project ${entry.name}: ${String(error)}`) }
    }
    projects.sort((a, b) => a.name.localeCompare(b.name))
    return projects
  }

  async workspaceForSession(sessionId, { requireActive = true } = {}) {
    const session = this.ctx.sessions.get(sessionId)
    if (!session && requireActive) fail('DSH 会话尚未激活，暂时不能访问项目', 403)
    if (session && (typeof session.header?.cwd !== 'string' || !session.header.cwd)) fail('会话没有有效工作目录，拒绝访问项目', 403)
    const matches = this.ctx.workspaceRegistry.list().filter((workspace) => workspace.sessionIds.includes(sessionId))
    if (matches.length !== 1) fail(matches.length ? '会话同时属于多个 DSH 工作区，拒绝访问' : '当前 DSH 会话不属于已登记工作区', 403)
    if (session) {
      let byPath
      try { byPath = await this.ctx.workspaceRegistry.resolveByPath(session.header.cwd) }
      catch { fail('无法验证会话工作目录，拒绝访问项目', 403) }
      if (!byPath || byPath.id !== matches[0].id || byPath.path !== matches[0].path) fail('会话工作目录与 DSH 工作区不匹配，拒绝访问', 403)
    }
    return { workspace: matches[0], session }
  }

  async ensureWorkspaceProject(workspaceId, options = {}, signal) {
    const pending = this.ensureProjects.get(workspaceId)
    if (pending) return pending
    const promise = this.ensureWorkspaceProjectUnlocked(workspaceId, options, signal)
    this.ensureProjects.set(workspaceId, promise)
    try { return await promise }
    finally { if (this.ensureProjects.get(workspaceId) === promise) this.ensureProjects.delete(workspaceId) }
  }

  async ensureWorkspaceProjectUnlocked(workspaceId, { name, sessionId } = {}, signal) {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (!workspace) fail('DSH 工作区不存在', 404)
    const binding = await this.workspaceForSession(sessionId)
    if (binding.workspace.id !== workspace.id) fail('只能在会话所属工作区初始化项目', 403)
    const sandboxPolicy = this.ctx.sandboxPolicy.resolve({ session: binding.session })
    const existing = await this.listProjects(signal, workspace.path)
    if (existing.length > 1) fail(`工作区 ${workspace.title} 中存在多个旧项目，需先迁移为一项目一工作区`, 409)
    let projectId = existing[0]?.id
    if (!existing.length) {
      const projectName = safeText(workspace.title || name || workspace.id, '项目名称')
      const directoryName = String(workspace.path).replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)
      if (projectName !== String(directoryName)) fail(`工作区标题「${projectName}」必须与目录名「${directoryName}」完全一致，未创建项目`, 409)
      const duplicate = this.ctx.workspaceRegistry.list().find((candidate) => candidate.id !== workspace.id && String(candidate.title || '').trim().toLocaleLowerCase() === projectName.toLocaleLowerCase())
      if (duplicate) fail(`已有同名项目/工作区「${projectName}」，拒绝重复创建`, 409)
      projectId = `p-${slug(projectName)}-${randomUUID().slice(0, 8)}`
      const now = new Date().toISOString()
      const project = { id: projectId, workspaceId: workspace.id, name: projectName, status: 'active', created: now.slice(0, 10), createdAt: now, updatedAt: now, startDate: '', dueDate: '', members: [], assistantSessionId: binding.session.id }
      await this.writeFile(PROJECT_FILE, serializeDocument(project, `# ${projectName}\n\n项目目标与范围可在这里补充。`), signal, workspace.path, sandboxPolicy)
    }
    if (existing.length && existing[0].path !== '.') await this.migrateLegacyProject(projectId, signal, workspace.path, sandboxPolicy)
    if (!projectId) fail('项目初始化失败', 500)
    const projectFile = PROJECT_FILE
    await this.assertProjectPath(projectFile, workspace.path, signal)
    const target = await this.target(projectFile, workspace.path)
    const observed = await this.ctx.fs.stat(target, signal)
    if (!observed) fail('项目文件不存在', 404)
    const doc = parseDocument(await this.ctx.fs.readText(target, signal))
    let changed = false
    if (doc.front.workspaceId && doc.front.workspaceId !== workspace.id) fail('项目与 DSH 工作区绑定不一致，拒绝访问', 403)
    if (doc.front.assistantSessionId && !workspace.sessionIds.includes(doc.front.assistantSessionId)) {
      const foreignOwner = this.ctx.workspaceRegistry.list().some((candidate) => candidate.id !== workspace.id && candidate.sessionIds.includes(doc.front.assistantSessionId))
      if (foreignOwner) fail('项目助手会话属于其他 DSH 工作区，拒绝访问', 403)
      doc.front.assistantSessionId = binding.session.id
      changed = true
    }
    if (doc.front.workspaceId !== workspace.id) { doc.front.workspaceId = workspace.id; changed = true }
    if (!doc.front.assistantSessionId) { doc.front.assistantSessionId = binding.session.id; changed = true }
    if (name && !doc.front.name) { doc.front.name = safeText(name, '项目名称'); changed = true }
    if (changed) {
      doc.front.updatedAt = new Date().toISOString()
      await this.ctx.fs.writeText(target, serializeDocument(doc.front, doc.body), { kind: 'replaceIfVersion', version: observed.version }, signal, sandboxPolicy)
    }
    return this.readProject(projectId, signal, workspace.path)
  }

  async projectForSession(sessionId, signal) {
    const { workspace, session } = await this.workspaceForSession(sessionId)
    const projects = await this.listProjects(signal, workspace.path)
    if (!projects.length) return { workspace, session, project: await this.ensureWorkspaceProject(workspace.id, { name: workspace.title, sessionId }, signal) }
    if (projects.length > 1) fail(`工作区 ${workspace.title} 中存在多个旧项目，需先迁移为一项目一工作区`, 409)
    const project = await this.readProject(projects[0].id, signal, workspace.path)
    if (project.workspaceId && project.workspaceId !== workspace.id) fail('项目与 DSH 工作区绑定不一致，拒绝访问', 403)
    const assistantBound = Boolean(project.assistantSessionId && workspace.sessionIds.includes(project.assistantSessionId))
    if (project.assistantSessionId && !assistantBound) {
      const foreignOwner = this.ctx.workspaceRegistry.list().some((candidate) => candidate.id !== workspace.id && candidate.sessionIds.includes(project.assistantSessionId))
      if (foreignOwner) fail('项目助手会话属于其他 DSH 工作区，拒绝访问', 403)
    }
    if (!project.workspaceId || !assistantBound || project.path !== '.') return { workspace, session, project: await this.ensureWorkspaceProject(workspace.id, { name: project.name, sessionId }, signal) }
    return { workspace, session, project }
  }

  async agentApi(method, sessionId, { body, signal } = {}) {
    const query = method === 'GET' ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
    const request = new Request(`http://project-hub.local${ROUTE}${query}`, {
      method,
      signal,
      ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, sessionId }) } : {})
    })
    const response = await this.handleScoped(request)
    const value = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(value.error || `Project Hub request failed (${response.status})`)
    return value
  }

  createWeComCredentialEntry() {
    return createKeyringEntry(WECOM_CREDENTIAL_SERVICE, WECOM_CREDENTIAL_ACCOUNT)
  }

  readStoredWeComCredentials() {
    const encoded = this.createWeComCredentialEntry().getPassword()
    if (!encoded) return null
    let credentials
    try { credentials = JSON.parse(encoded) } catch { throw new Error('系统凭证库中的企业微信凭证格式无效') }
    if (typeof credentials?.botId !== 'string' || typeof credentials?.secret !== 'string' || !credentials.botId.trim() || !credentials.secret.trim()) {
      throw new Error('系统凭证库中的企业微信凭证格式无效')
    }
    return { botId: credentials.botId.trim(), secret: credentials.secret.trim() }
  }

  getWeComStatus() {
    return { ...this.wecomStatus, credentialSource: this.wecomCredentialSource }
  }

  createFeishuCredentialEntry() {
    return createKeyringEntry(WECOM_CREDENTIAL_SERVICE, FEISHU_CREDENTIAL_ACCOUNT)
  }

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
  }

  getFeishuStatus() {
    const { sequence: _sequence, ...inboundDiagnostics } = this.feishuInboundDiagnostics
    return { ...this.feishuStatus, credentialSource: this.feishuCredentialSource, inboundDiagnostics, replyDiagnostics: { ...this.feishuReplyDiagnostics } }
  }

  recordFeishuReplyOutcome(outcome, error) {
    const allowedCodes = new Set(['format_error', 'target_revoked', 'permission_denied', 'rate_limited', 'send_timeout', 'not_connected', 'unknown'])
    const code = typeof error?.code === 'string' && allowedCodes.has(error.code) ? error.code : error ? 'other' : null
    const pendingTurnReplies = [...this.feishuTurnReplies.values()].reduce((total, replies) => total + replies.length, 0)
    this.feishuReplyDiagnostics = {
      pendingCount: this.feishuPendingMessages.size + pendingTurnReplies,
      sentCount: this.feishuReplyDiagnostics.sentCount + (outcome === 'sent' ? 1 : 0),
      failedCount: this.feishuReplyDiagnostics.failedCount + (outcome === 'send-failed' || outcome === 'agent-followup-failed' ? 1 : 0),
      lastAt: new Date().toISOString(),
      lastOutcome: outcome,
      lastErrorCode: code
    }
  }

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
  }

  setFeishuInboundOutcome(sequence, outcome) {
    if (!Number.isSafeInteger(sequence) || sequence <= 0 || this.feishuInboundDiagnostics.sequence !== sequence) return
    this.feishuInboundDiagnostics = { ...this.feishuInboundDiagnostics, lastOutcome: outcome }
  }

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
  }

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
  }

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
        if (this.feishuClient === client) this.feishuStatus = { state: 'connected', label: '飞书长连接已连接' }
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
          void this.sendFeishuProjectPickersOnStartup()
        }
      }).catch(() => {
        if (this.feishuClient === client) this.feishuStatus = { state: 'error', label: '飞书长连接失败（检查 App 凭证、机器人权限和网络）' }
      })
    } catch {
      this.feishuClient = null
      this.feishuStatus = { state: 'error', label: '飞书官方 SDK 长连接初始化失败' }
    }
    return () => this.stopFeishuConnection()
  }

  stopFeishuConnection() {
    const client = this.feishuClient
    this.feishuClient = null
    try { void client?.disconnect()?.catch?.(() => {}) } catch {}
    this.feishuPendingMessages.clear()
    this.feishuOpenTurns.clear()
    this.feishuTurnReplies.clear()
    this.feishuMirrorTurnReplies.clear()
    this.externalMessageOrigins.clear()
    this.feishuCredentialSource = null
    this.feishuTenantKey = ''
    this.feishuPairingChallenges.clear()
    this.feishuStatus = { state: 'stopped', label: '飞书长连接已停止' }
  }

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
  }

  clearStoredFeishuCredentials() {
    try { this.createFeishuCredentialEntry().deletePassword() }
    catch { fail('无法删除系统凭证库中的飞书应用凭证', 503) }
    this.stopFeishuConnection()
    this.startFeishuConnection()
    return this.getFeishuStatus()
  }

  createFeishuBindingEntry() {
    return createKeyringEntry(WECOM_CREDENTIAL_SERVICE, FEISHU_BINDING_ACCOUNT)
  }

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
  }

  saveStoredFeishuConversations(conversations) {
    try {
      if (conversations.length) this.createFeishuBindingEntry().setPassword(JSON.stringify({ version: 2, conversations }))
      else this.createFeishuBindingEntry().deletePassword()
    } catch { fail('无法将飞书绑定写入系统凭证库', 503) }
  }

  readStoredFeishuConversation({ tenantKey, chatId, openId } = {}) {
    return this.readStoredFeishuConversations().find((conversation) =>
      (!tenantKey || conversation.tenantKey === tenantKey) && (!chatId || conversation.chatId === chatId) && (!openId || conversation.openId === openId)
    ) || null
  }

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
  }

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
  }

  setFeishuActiveProject({ tenantKey, chatId, openId, sessionId }) {
    const conversations = this.readStoredFeishuConversations()
    const conversation = conversations.find((candidate) => candidate.tenantKey === tenantKey && candidate.chatId === chatId && candidate.openId === openId)
    if (!conversation || !conversation.bindings.some((binding) => binding.sessionId === sessionId)) return false
    conversation.activeSessionId = sessionId
    this.saveStoredFeishuConversations(conversations)
    return true
  }

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
  }

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
  }

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
  }

  setFeishuMessageSync(sessionId, enabled) {
    if (typeof enabled !== 'boolean') fail('同步开关必须为 true 或 false')
    let binding
    try { binding = this.readStoredFeishuBinding({ sessionId }) }
    catch { fail('无法访问系统凭证库中的飞书绑定信息', 503) }
    if (!binding) fail('请先在当前 DSH 会话完成飞书配对', 409)
    return this.saveFeishuBinding({ ...binding, syncMessages: enabled })
  }

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
      client.on('authenticated', () => { if (this.wecomClient === client) this.wecomStatus = { state: 'connected', label: '长连接已认证' } })
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
  }

  stopWeComConnection() {
    const client = this.wecomClient
    this.wecomClient = null
    try { client?.disconnect() } catch {}
    this.wecomPendingMessages.clear()
    this.wecomOpenTurns.clear()
    this.wecomTurnReplies.clear()
    this.wecomMirrorTurnReplies.clear()
    this.externalMessageOrigins.clear()
    this.wecomCredentialSource = null
    this.wecomPairingChallenge = null
    this.wecomStatus = { state: 'stopped', label: '长连接已停止' }
  }

  saveWeComCredentials(botIdValue, secretValue) {
    const botId = safeText(botIdValue, 'Bot ID', 128)
    const secret = safeText(secretValue, 'Bot Secret', 1024)
    if (/[\u0000-\u001f\u007f]/.test(botId) || /[\u0000-\u001f\u007f]/.test(secret)) fail('Bot ID / Secret 格式无效')
    try { this.createWeComCredentialEntry().setPassword(JSON.stringify({ botId, secret })) }
    catch { fail('无法写入系统凭证库；请检查 Windows 凭证管理器权限或使用 Host 环境变量', 503) }
    this.stopWeComConnection()
    this.startWeComConnection()
    return this.getWeComStatus()
  }

  clearStoredWeComCredentials() {
    try { this.createWeComCredentialEntry().deletePassword() }
    catch { fail('无法删除系统凭证库中的企业微信凭证', 503) }
    this.stopWeComConnection()
    this.startWeComConnection()
    return this.getWeComStatus()
  }

  createWeComBindingEntry() {
    return createKeyringEntry(WECOM_CREDENTIAL_SERVICE, WECOM_BINDING_ACCOUNT)
  }

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
  }

  saveWeComBinding(userIdValue, sessionIdValue, syncMessages = false) {
    const userId = safeText(userIdValue, '企业微信 UserID', 128)
    const sessionId = safeText(sessionIdValue, 'DSH Session ID', 100)
    if (/[\u0000-\u001f\u007f]/.test(userId)) fail('企业微信 UserID 格式无效')
    try { this.createWeComBindingEntry().setPassword(JSON.stringify({ userId, sessionId, syncMessages: Boolean(syncMessages) })) }
    catch { fail('无法将企业微信绑定写入系统凭证库', 503) }
    return { state: 'bound', userId, syncMessages: Boolean(syncMessages) }
  }

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
  }

  startWeComPairing(sessionId, project) {
    if (!this.wecomClient || this.wecomStatus.state !== 'connected') fail('企业微信长连接尚未认证', 503)
    if (!project.assistantSessionId) fail('项目尚未绑定助手会话', 409)
    const agent = this.ctx.agents?.get(project.assistantSessionId)
    if (!agent || typeof agent.followup !== 'function') fail('项目助手 Agent 当前未运行', 409)
    const challenge = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
    this.wecomPairingChallenge = { code: challenge, sessionId, expiresAt: Date.now() + WECOM_PAIRING_TTL_MS }
    return this.getWeComPairingStatus(sessionId)
  }

  clearWeComPairing(sessionId) {
    let binding
    try { binding = this.readStoredWeComBinding() }
    catch { fail('无法访问系统凭证库中的绑定信息', 503) }
    if (binding && binding.sessionId !== sessionId) fail('只能解除当前 DSH 会话创建的企业微信绑定', 403)
    try { this.createWeComBindingEntry().deletePassword() }
    catch { fail('无法解除系统凭证库中的企业微信绑定', 503) }
    if (this.wecomPairingChallenge?.sessionId === sessionId) this.wecomPairingChallenge = null
    return { state: 'unbound' }
  }

  setWeComReplySync(sessionId, enabled) {
    if (typeof enabled !== 'boolean') fail('同步开关必须为 true 或 false')
    let binding
    try { binding = this.readStoredWeComBinding() }
    catch { fail('无法访问系统凭证库中的绑定信息', 503) }
    if (!binding || binding.sessionId !== sessionId) fail('请先在当前 DSH 会话完成企业微信配对', 409)
    return this.saveWeComBinding(binding.userId, binding.sessionId, enabled)
  }

  trackExternalMessageOrigin(messageId, origin) {
    if (typeof messageId !== 'string' || !messageId) return
    this.externalMessageOrigins.set(messageId, origin)
    while (this.externalMessageOrigins.size > 500) this.externalMessageOrigins.delete(this.externalMessageOrigins.keys().next().value)
  }

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
  }

  appendMirrorAnswer(map, key, answer) {
    const record = map.get(key)
    if (record && answer) record.output = `${record.output ? `${record.output}\n\n` : ''}${answer}`
  }

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
  }

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
  }

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
        const replies = this.feishuTurnReplies.get(key) || []
        replies.push(record)
        this.feishuTurnReplies.set(key, replies)
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
        for (const record of replies) record.output = `${record.output ? `${record.output}\n\n` : ''}${answer}`
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
        } else this.recordFeishuReplyOutcome('turn-not-completed')
      } else if ([...this.feishuPendingMessages.values()].some((record) => record.sessionId === sessionId)) this.recordFeishuReplyOutcome('no-mapped-user-event')
    }
  }

  async finishFeishuReply(record) {
    if (!this.feishuClient || this.feishuStatus.state !== 'connected') {
      this.recordFeishuReplyOutcome('skipped-not-connected')
      return
    }
    let binding
    try { binding = this.readStoredFeishuBinding({ sessionId: record.sessionId, chatId: record.chatId, openId: record.openId }) } catch {
      this.recordFeishuReplyOutcome('binding-read-failed')
      return
    }
    if (!binding) {
      this.recordFeishuReplyOutcome('binding-mismatch')
      return
    }
    const answer = String(record.output || '项目助手本轮未返回可展示的文本内容。').trim()
    const capped = answer.length > 19000 ? `${answer.slice(0, 18980)}\n\n（内容过长，已截断）` : answer
    try {
      await this.feishuClient.sendText({ chatId: record.chatId, content: capped, replyToMessageId: record.replyToMessageId })
      this.recordFeishuReplyOutcome('sent')
    } catch (error) {
      this.recordFeishuReplyOutcome('send-failed', error)
      this.ctx.logger.warn('project-hub: failed to send Feishu assistant reply; the DSH turn will not be rerun')
    }
  }

  async finishWeComReply(record) {
    if (!this.wecomClient || this.wecomStatus.state !== 'connected') return
    const answer = String(record.output || '项目助手本轮未返回可展示的文本内容。').trim()
    const text = answer.length > 1900 ? `${answer.slice(0, 1900)}\n\n（内容过长，已截断）` : answer
    try { await this.wecomClient.replyStream(record.frame, record.streamId, text, true) } catch {}
  }

  async finishWeComMirrorReply(record) {
    if (!this.wecomClient || this.wecomStatus.state !== 'connected') return
    let binding
    try { binding = this.readStoredWeComBinding() } catch { return }
    if (binding?.sessionId !== record.sessionId || !binding.syncMessages) return
    const prompt = truncateWeComText(record.prompt || (record.hasNonTextInput ? '（消息含非文本内容；附件未转发）' : '（未提取到文本内容）'), 700)
    const answer = truncateWeComText(record.output || '项目助手本轮未返回可展示的文本内容。', 1050)
    const content = `${record.sourceLabel}:\n${prompt}\n\n项目助手回复:\n${answer}`
    try { await this.wecomClient.sendText({ recipient: binding.userId, content: truncateWeComText(content, 1900) }) } catch {}
  }

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
  }

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
      this.clearPendingFileOverwrite(map, key)
      const continued = remaining.length ? await this.saveInboundFileBatch({ map, key, files: remaining, workspace, project, session, sessionId, reply, savedBefore }) : { pending: false, saved: savedBefore }
      if (continued.pending) return true
      await reply(`已保存文件：${continued.saved.join('、')}。文件仅保存在项目目录中，未送入助手读取。`)
    } catch {
      pending.busy = false
      await reply('替换失败，原文件应保持不变。请稍后回复「替换」重试，或回复「取消」。')
    }
    return true
  }

  async handleWeComText(frame) {
    return this.handleWeComInbound(frame, 'text')
  }

  async handleWeComFile(frame) {
    return this.handleWeComInbound(frame, 'file')
  }

  async handleWeComInbound(frame, eventType) {
    const body = frame?.body || {}
    const msgid = typeof body.msgid === 'string' ? body.msgid : ''
    const reply = async (text) => {
      try { await this.wecomClient?.replyText(frame, text) } catch {}
    }
    if (!msgid || this.wecomSeenMessages.has(msgid)) return
    this.wecomSeenMessages.set(msgid, Date.now())
    while (this.wecomSeenMessages.size > 5000) this.wecomSeenMessages.delete(this.wecomSeenMessages.keys().next().value)

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
    const streamId = this.wecomClient.createStreamId()
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
            const code = typeof error?.code === 'string' ? error.code.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 48) || 'ERROR' : error?.name === 'Error' ? 'ERROR' : 'UNKNOWN'
            this.ctx.logger.warn(`project-hub: WeCom inbound ${eventType} failed at agent-followup (${code})`)
            try { void this.wecomClient?.replyStream(frame, streamId, '消息未能送入 DSH 项目助手。请检查项目绑定和助手 Agent 状态。', true)?.catch?.(() => {}) } catch {}
          })
        }
      } catch (error) {
        this.wecomPendingMessages.delete(messageId)
        this.externalMessageOrigins.delete(messageId)
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
    }
  }

  async sendFeishuNotice(chatId, content, replyToMessageId) {
    if (!this.feishuClient || this.feishuStatus.state !== 'connected') return false
    try {
      await this.feishuClient.sendText({ chatId, content, replyToMessageId })
      return true
    } catch {
      this.ctx.logger.warn('project-hub: failed to send Feishu notice')
      return false
    }
  }

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
  }

  async sendFeishuProjectPickersOnStartup() {
    let conversations
    try { conversations = this.readStoredFeishuConversations() } catch { return }
    for (const conversation of conversations) {
      await this.refreshFeishuProjectPicker({ ...conversation, forceNew: true })
    }
  }

  async refreshFeishuProjectPicker({ tenantKey, chatId, openId, replyToMessageId, forceNew = false } = {}) {
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
        this.ctx.logger.warn('project-hub: failed to update Feishu project picker; sending a replacement card')
      }
    }
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
  }

  async handleFeishuCardAction(event) {
    const chatId = typeof event?.chatId === 'string' ? event.chatId.trim() : ''
    const messageId = typeof event?.messageId === 'string' ? event.messageId.trim() : ''
    const openId = typeof event?.operator?.openId === 'string' ? event.operator.openId.trim() : ''
    const action = event?.action
    const value = action?.value
    if (!chatId || !messageId || !openId || action?.tag !== 'button' || !value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'project.select') return false
    let conversation
    try { conversation = this.readStoredFeishuConversation({ chatId, openId }) } catch { return false }
    if (!conversation) return false
    const binding = conversation.bindings.find((candidate) => candidate.sessionId === value.sessionId && candidate.projectId === value.projectId)
    if (!binding) {
      await this.refreshFeishuProjectPicker({ ...conversation, forceNew: true })
      return false
    }
    if (!this.setFeishuActiveProject({ tenantKey: conversation.tenantKey, chatId, openId, sessionId: binding.sessionId })) return false
    await this.refreshFeishuProjectPicker({ tenantKey: conversation.tenantKey, chatId, openId })
    try {
      const updatedConversation = this.readStoredFeishuConversation({ tenantKey: conversation.tenantKey, chatId, openId })
      if (updatedConversation?.pickerMessageId && updatedConversation.pickerMessageId !== messageId) {
        await this.feishuClient.updateCard({ messageId, card: this.buildFeishuProjectPickerCard(updatedConversation) })
      }
    } catch {}
    return true
  }

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
    this.feishuSeenMessages.set(eventKey, now)
    const cutoff = now - 24 * 60 * 60 * 1000
    for (const [key, timestamp] of this.feishuSeenMessages) {
      if (timestamp >= cutoff && this.feishuSeenMessages.size <= FEISHU_SEEN_LIMIT) break
      this.feishuSeenMessages.delete(key)
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
        const replied = await this.sendFeishuNotice(chatId, `已将「${workspace.title || project.name}」绑定到此飞书私聊。请直接点击“选择项目助手”卡片中的项目按钮切换。`, messageId)
        const pickerUpdated = await this.refreshFeishuProjectPicker({ tenantKey, chatId, openId: senderOpenId, replyToMessageId: messageId, forceNew: true })
        if (!pickerUpdated) await this.sendFeishuNotice(chatId, '项目绑定已完成，但选择卡片未能显示；请检查飞书卡片按钮回调设置，并在 Project Hub 点击“在飞书显示项目选择卡片”重试。', messageId)
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
    if (!conversation.pickerMessageId) {
      await this.refreshFeishuProjectPicker({ tenantKey, chatId, openId: senderOpenId, replyToMessageId: messageId })
      try { conversation = this.readStoredFeishuConversation({ tenantKey, chatId, openId: senderOpenId }) || conversation } catch {}
    }
    let binding = conversation.bindings.find((candidate) => candidate.sessionId === conversation.activeSessionId) || conversation.bindings[0]
    if (!binding) {
      this.setFeishuInboundOutcome(diagnosticSequence, 'no-active-project')
      return
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
        const replied = await this.sendFeishuNotice(chatId, '请直接点击“选择项目助手”卡片中的项目按钮切换；发送 /项目列表 可重新显示选择卡片。普通文本和文件会送入当前项目助手。', messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'project-help-sent' : 'project-help-failed')
        return
      }
      if (/^\/?(?:项目列表|projects)$/i.test(normalizedCommand)) {
        const refreshed = await this.refreshFeishuProjectPicker({ tenantKey, chatId, openId: senderOpenId, replyToMessageId: messageId, forceNew: true })
        if (!refreshed) await this.sendFeishuNotice(chatId, '项目选择卡片暂时无法显示，请稍后重试或检查飞书卡片按钮回调设置。', messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, refreshed ? 'project-picker-refreshed' : 'project-picker-failed')
        return
      }
      if (/^\/?(?:当前项目|current)$/i.test(normalizedCommand)) {
        const replied = await this.sendFeishuNotice(chatId, `当前项目：${binding.projectName}\n使用 /项目列表 查看其他已授权项目。`, messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'current-project-sent' : 'current-project-failed')
        return
      }
      const switchMatch = normalizedCommand.match(/^\/?(?:切换|switch)\s+(\d{1,3})$/i)
      if (switchMatch) {
        const requested = Number(switchMatch[1])
        const selected = conversation.bindings[requested - 1]
        if (!selected) {
          const replied = await this.sendFeishuNotice(chatId, '项目序号无效。请先发送 /项目列表 查看可选项目。', messageId)
          this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'project-switch-invalid' : 'project-switch-failed')
          return
        }
        if (!this.setFeishuActiveProject({ tenantKey, chatId, openId: senderOpenId, sessionId: selected.sessionId })) {
          const replied = await this.sendFeishuNotice(chatId, '项目切换未完成；请刷新 Project Hub 绑定状态后重试。', messageId)
          this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'project-switch-failed' : 'project-switch-failed')
          return
        }
        binding = selected
        await this.refreshFeishuProjectPicker({ tenantKey, chatId, openId: senderOpenId })
        const replied = await this.sendFeishuNotice(chatId, `当前项目已切换为「${selected.projectName}」。`, messageId)
        this.setFeishuInboundOutcome(diagnosticSequence, replied ? 'project-switched' : 'project-switch-reply-failed')
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

    let failureStage = 'project-binding'
    try {
      const { workspace, project, session } = await this.projectForSession(binding.sessionId)
      if (workspace.id !== binding.workspaceId || project.id !== binding.projectId || project.assistantSessionId !== binding.sessionId) throw new Error('Project/session binding mismatch')
      if (isFile) {
        let totalBytes = 0
        const filesToSave = []
        for (const resource of fileResources) {
          failureStage = 'file-download'
          const downloaded = await this.feishuClient.downloadFile(resource.fileKey)
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
      }

      const agent = this.ctx.agents?.get(binding.sessionId)
      if (!agent || typeof agent.followup !== 'function') {
        await this.sendFeishuNotice(chatId, '项目助手 Agent 当前未运行，消息未送入 DSH。', messageId)
        return
      }
      const dshMessageId = makeId('feishu')
      const record = { sessionId: binding.sessionId, chatId, openId: senderOpenId, replyToMessageId: messageId, output: '' }
      this.feishuPendingMessages.set(dshMessageId, record)
      this.trackExternalMessageOrigin(dshMessageId, { platform: 'feishu', sessionId: binding.sessionId, prompt: text })
      this.recordFeishuReplyOutcome('awaiting-session-events')
      failureStage = 'agent-followup'
      const accepted = agent.followup({
        id: dshMessageId,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' }
      })
      if (accepted && typeof accepted.then === 'function') accepted.catch(() => {
        this.feishuPendingMessages.delete(dshMessageId)
        this.externalMessageOrigins.delete(dshMessageId)
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
    }
  }

  currentExternalMessagePlatform(sessionId) {
    const activeTurns = new Set([this.wecomOpenTurns.get(sessionId), this.feishuOpenTurns.get(sessionId)].filter(Number.isSafeInteger))
    const origin = [...this.externalMessageOrigins.values()].filter((candidate) => candidate.sessionId === sessionId && activeTurns.has(candidate.turn) && ['wecom', 'feishu'].includes(candidate.platform)).at(-1)
    return origin?.platform || null
  }

  async sendProjectFile({ sessionId, path, platform, signal }) {
    const { workspace, project } = await this.projectForSession(sessionId, signal)
    if (project.assistantSessionId !== sessionId) fail('只有项目所有者助手会话可以发送项目文件', 403)
    const filePath = path.startsWith(`${PROJECT_FILES_DIR}/`) ? path.slice(PROJECT_FILES_DIR.length + 1) : path
    if (!filePath || filePath === PROJECT_FILES_DIR) fail('项目文件路径必须指向 files/ 中的具体文件', 400)
    const relativePath = await this.assertProjectFilesPath(project.id, filePath, workspace.path, 'file', signal)
    const target = await this.target(relativePath, workspace.path)
    let bytes
    try { bytes = await this.ctx.fs.readBytes(target, signal, OUTBOUND_FILE_MAX_BYTES) }
    catch (error) {
      if (error?.code === 'FS_TOO_LARGE') fail('项目文件超过 20 MiB 的单文件发送上限', 413)
      throw error
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) fail('项目文件为空或无法读取', 400)
    if (bytes.byteLength > OUTBOUND_FILE_MAX_BYTES) fail('项目文件超过 20 MiB 的单文件发送上限', 413)
    const filename = sanitizeInboundFilename(path.split('/').at(-1), 'project-file.bin')

    if (platform === 'feishu') {
      const binding = this.readStoredFeishuBinding({ sessionId })
      if (!binding || binding.projectId !== project.id || binding.workspaceId !== workspace.id) fail('当前项目助手尚未绑定飞书私聊', 409)
      if (!this.feishuClient || this.feishuStatus.state !== 'connected') fail('飞书长连接未连接', 503)
      await this.feishuClient.sendFile({ chatId: binding.chatId, filename, buffer: bytes })
      return { sent: true, platform, filename, sizeBytes: bytes.byteLength }
    }
    if (platform === 'wecom') {
      const binding = this.readStoredWeComBinding()
      if (!binding || binding.sessionId !== sessionId) fail('当前项目助手尚未绑定企业微信单聊', 409)
      if (!this.wecomClient || this.wecomStatus.state !== 'connected') fail('企业微信智能机器人长连接未认证', 503)
      await this.wecomClient.sendFile({ recipient: binding.userId, filename, buffer: bytes })
      return { sent: true, platform, filename, sizeBytes: bytes.byteLength }
    }
    fail('文件发送平台无效', 400)
  }

  async executeAgentTool(args, signal, agent) {
    signal?.throwIfAborted()
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string' || !sessionId) fail('Project Hub 工具必须由 DSH 会话调用', 403)
    if (args.action === 'send_file') {
      const path = safeText(args.path, '项目文件相对路径', 512)
      const platform = args.platform === undefined ? this.currentExternalMessagePlatform(sessionId) : safeText(args.platform, '文件发送平台', 16)
      if (!platform) fail('无法从当前对话确定目标平台；请明确指定 feishu 或 wecom', 409)
      if (!['feishu', 'wecom'].includes(platform)) fail('文件发送平台必须是 feishu 或 wecom', 400)
      return JSON.stringify(await this.sendProjectFile({ sessionId, path, platform, signal }))
    }
    if (args.action === 'wecom_status') {
      await this.agentApi('GET', sessionId, { signal })
      return JSON.stringify(this.getWeComStatus())
    }
    if (args.action === 'feishu_status') {
      const result = await this.agentApi('GET', sessionId, { signal })
      return JSON.stringify({ connection: result.project.feishuConnection, pairing: result.project.feishuPairing })
    }
    if (args.action === 'feishu_send_test') {
      const result = await this.agentApi('GET', sessionId, { signal })
      const binding = this.readStoredFeishuBinding({ sessionId: result.project.assistantSessionId })
      if (!binding || binding.projectId !== result.project.id) fail('请先在当前项目助手会话完成飞书配对', 409)
      if (!this.feishuClient || this.feishuStatus.state !== 'connected') fail('飞书官方长连接尚未连接', 503)
      await this.feishuClient.sendText({ chatId: binding.chatId, content: 'Project Hub 飞书长连接测试消息。' })
      return JSON.stringify({ sent: true })
    }
    if (args.action === 'wecom_send_text') {
      const recipient = safeText(args.recipient, '企业微信接收目标', 128)
      const text = safeText(args.text, '企业微信消息', 2048)
      if (recipient.toLowerCase() === '@all') fail('企业微信工具禁止群发到 @all', 403)
      await this.agentApi('GET', sessionId, { signal })
      if (!this.wecomClient || this.wecomStatus.state !== 'connected') fail('企业微信智能机器人长连接未认证；请先配置 Bot ID/Secret 并确认连接状态', 503)
      await this.wecomClient.sendText({ recipient, content: text })
      return JSON.stringify({ sent: true, recipient })
    }
    if (args.action === 'list_projects' || args.action === 'get_project') return JSON.stringify(await this.agentApi('GET', sessionId, { signal }))
    const projectFields = ['name', 'description', 'startDate', 'dueDate']
    const taskFields = ['title', 'status', 'priority', 'start', 'due', 'progress', 'critical', 'assignees', 'relatedTo', 'checklist', 'body']
    if (args.action === 'add_task_node') {
      const taskId = safeText(args.taskId, 'taskId', 100)
      const kind = safeText(args.kind, '任务节点类型', 16)
      if (!TASK_NODE_KINDS.has(kind)) fail('任务节点类型必须是 completed、current 或 blocker')
      const nodeText = safeText(args.nodeText, '节点内容', TASK_NODE_TEXT_MAX)
      return JSON.stringify(await this.agentApi('POST', sessionId, { signal, body: { action: 'task.node.add', taskId, kind, nodeText } }))
    }
    if (args.action === 'update_project') {
      const patch = pickPatch(args.patch, projectFields, '项目')
      return JSON.stringify(await this.agentApi('POST', sessionId, { signal, body: { action: 'project.update', patch } }))
    }
    if (args.action === 'create_task') {
      const title = safeText(args.title, '任务标题')
      const initialPatch = args.patch === undefined ? null : pickPatch(args.patch, taskFields.filter((field) => field !== 'title'), '任务')
      let result = await this.agentApi('POST', sessionId, { signal, body: { action: 'task.create', title } })
      if (initialPatch) {
        const taskId = result.createdTaskId
        if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) throw new Error('任务已创建，但 Host 未返回新任务 ID，无法应用初始字段')
        result = await this.agentApi('POST', sessionId, { signal, body: { action: 'task.update', taskId, patch: initialPatch } })
      }
      return JSON.stringify(result)
    }
    if (args.action === 'update_task') {
      const taskId = safeText(args.taskId, 'taskId', 100)
      const patch = pickPatch(args.patch, taskFields, '任务')
      return JSON.stringify(await this.agentApi('POST', sessionId, { signal, body: { action: 'task.update', taskId, patch } }))
    }
    fail('不支持的 Project Hub 对话操作')
  }

  async handleScoped(request) {
    try {
      if (request.method === 'GET') {
        const sessionId = safeText(new URL(request.url).searchParams.get('sessionId'), 'sessionId', 100)
        const { workspace, project } = await this.projectForSession(sessionId, request.signal)
        const ownerFeishuPairing = this.getFeishuPairingStatus(project.assistantSessionId || sessionId, workspace.sessionIds)
        const feishuPairing = sessionId === project.assistantSessionId
          ? ownerFeishuPairing
          : ['bound', 'waiting'].includes(ownerFeishuPairing.state)
            ? { state: 'bound-elsewhere', ownerSessionId: project.assistantSessionId }
            : ownerFeishuPairing
        const visibleProject = {
          ...project,
          wecomConnection: this.getWeComStatus(),
          wecomPairing: this.getWeComPairingStatus(sessionId, workspace.sessionIds),
          feishuConnection: this.getFeishuStatus(),
          feishuPairing
        }
        return json({ project: visibleProject, projects: [{ id: project.id, name: project.name, status: project.status, path: project.path, updatedAt: project.updatedAt, progress: project.progress, taskCount: project.tasks.length, doneCount: project.tasks.filter((task) => task.status === 'done').length }] })
      }
      if (request.method !== 'POST') fail('只支持 GET 和 POST', 405)
      const body = await request.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('请求格式无效')
      const sessionId = safeText(body.sessionId, 'sessionId', 100)
      if (body.action === 'project.binding') {
        const { workspace, session } = await this.workspaceForSession(sessionId, { requireActive: false })
        const projects = await this.listProjects(request.signal, workspace.path)
        if (projects.length > 1) fail(`工作区 ${workspace.title} 中存在多个旧项目，需先迁移为一项目一工作区`, 409)
        if (!projects.length) return json({ project: null, sessionActive: Boolean(session) })
        const project = await this.readProject(projects[0].id, request.signal, workspace.path)
        if (project.workspaceId && project.workspaceId !== workspace.id) fail('项目与 DSH 工作区绑定不一致，拒绝访问', 403)
        let assistantSessionId = project.assistantSessionId
        if (assistantSessionId && !workspace.sessionIds.includes(assistantSessionId)) {
          const foreignOwner = this.ctx.workspaceRegistry.list().some((candidate) => candidate.id !== workspace.id && candidate.sessionIds.includes(assistantSessionId))
          if (foreignOwner) fail('项目助手会话属于其他 DSH 工作区，拒绝访问', 403)
          assistantSessionId = null
        }
        return json({ project: { id: project.id, workspaceId: project.workspaceId, assistantSessionId }, sessionActive: Boolean(session) })
      }
      if (body.action === 'project.ensure') {
        const workspaceId = safeText(body.workspaceId, 'workspaceId', 100)
        const project = await this.ensureWorkspaceProject(workspaceId, { name: body.name, sessionId }, request.signal)
        return json({ project }, 201)
      }
      const { workspace, session, project } = await this.projectForSession(sessionId, request.signal)
      if (body.projectId && body.projectId !== project.id) fail('禁止从此工作区会话访问其他项目', 403)
      if (body.action === 'wecom.configure') {
        const wecomConnection = this.saveWeComCredentials(body.botId, body.secret)
        return json({ configured: true, wecomConnection })
      }
      if (body.action === 'wecom.clear_credentials') {
        const wecomConnection = this.clearStoredWeComCredentials()
        return json({ configured: false, wecomConnection })
      }
      if (body.action === 'wecom.pair.start') {
        const pairing = this.startWeComPairing(sessionId, project)
        return json({ pairing })
      }
      if (body.action === 'wecom.pair.clear') {
        const pairing = this.clearWeComPairing(sessionId)
        return json({ pairing })
      }
      if (body.action === 'wecom.pair.sync') {
        const pairing = this.setWeComReplySync(sessionId, body.enabled)
        return json({ pairing })
      }
      if (body.action === 'wecom.send_text') {
        const recipient = safeText(body.recipient, '企业微信接收目标', 128)
        const text = safeText(body.text, '企业微信消息', 2048)
        if (recipient.toLowerCase() === '@all') fail('企业微信禁止群发到 @all', 403)
        if (!this.wecomClient || this.wecomStatus.state !== 'connected') fail('企业微信智能机器人长连接未认证；请配置 Bot ID/Secret 并刷新状态', 503)
        await this.wecomClient.sendText({ recipient, content: text })
        return json({ sent: true, recipient, projectId: project.id })
      }
      if (body.action === 'feishu.configure') {
        const feishuConnection = this.saveFeishuCredentials(body.appId, body.appSecret, body.tenantKey)
        return json({ configured: true, feishuConnection })
      }
      if (body.action === 'feishu.clear_credentials') {
        const feishuConnection = this.clearStoredFeishuCredentials()
        return json({ configured: false, feishuConnection })
      }
      if (body.action === 'feishu.pair.start') {
        if (sessionId !== project.assistantSessionId) fail('只有当前项目助手会话可以管理飞书绑定', 403)
        const pairing = this.startFeishuPairing(sessionId, workspace, project)
        return json({ pairing })
      }
      if (body.action === 'feishu.pair.clear') {
        if (sessionId !== project.assistantSessionId) fail('只有当前项目助手会话可以管理飞书绑定', 403)
        const pairing = this.clearFeishuPairing(project.assistantSessionId)
        return json({ pairing })
      }
      if (body.action === 'feishu.pair.sync') {
        if (sessionId !== project.assistantSessionId) fail('只有当前项目助手会话可以管理飞书绑定', 403)
        const pairing = this.setFeishuMessageSync(project.assistantSessionId, body.enabled)
        return json({ pairing })
      }
      if (body.action === 'feishu.picker.refresh') {
        if (sessionId !== project.assistantSessionId) fail('只有当前项目助手会话可以管理飞书绑定', 403)
        let binding
        try { binding = this.readStoredFeishuBinding({ sessionId: project.assistantSessionId }) } catch { fail('无法访问系统凭证库中的飞书绑定', 503) }
        if (!binding || binding.projectId !== project.id || binding.workspaceId !== workspace.id) fail('请先在当前项目助手会话完成飞书配对', 409)
        const pickerUpdated = await this.refreshFeishuProjectPicker({ tenantKey: binding.tenantKey, chatId: binding.chatId, openId: binding.openId, forceNew: true })
        if (!pickerUpdated) fail('飞书项目选择卡片未能发送或更新', 503)
        return json({ pickerUpdated: true })
      }
      if (body.action === 'feishu.pair.activate') {
        if (sessionId !== project.assistantSessionId) fail('只有当前项目助手会话可以管理飞书绑定', 403)
        let binding
        try { binding = this.readStoredFeishuBinding({ sessionId: project.assistantSessionId }) } catch { fail('无法访问系统凭证库中的飞书绑定', 503) }
        if (!binding || binding.projectId !== project.id || binding.workspaceId !== workspace.id) fail('请先在当前项目助手会话完成飞书配对', 409)
        if (!this.setFeishuActiveProject({ tenantKey: binding.tenantKey, chatId: binding.chatId, openId: binding.openId, sessionId: binding.sessionId })) fail('飞书当前项目切换未完成', 409)
        const pickerUpdated = await this.refreshFeishuProjectPicker({ tenantKey: binding.tenantKey, chatId: binding.chatId, openId: binding.openId })
        return json({ pairing: this.getFeishuPairingStatus(project.assistantSessionId, workspace.sessionIds), pickerUpdated })
      }
      if (body.action === 'feishu.send_test') {
        if (sessionId !== project.assistantSessionId) fail('只有当前项目助手会话可以管理飞书绑定', 403)
        let binding
        try { binding = this.readStoredFeishuBinding({ sessionId: project.assistantSessionId }) } catch { fail('无法访问系统凭证库中的飞书绑定', 503) }
        if (!binding || binding.projectId !== project.id || binding.workspaceId !== workspace.id) fail('请先在当前项目助手会话完成飞书配对', 409)
        if (!this.feishuClient || this.feishuStatus.state !== 'connected') fail('飞书官方长连接尚未连接', 503)
        await this.feishuClient.sendText({ chatId: binding.chatId, content: 'Project Hub 飞书长连接测试消息。' })
        return json({ sent: true })
      }
      const workspaceRoot = workspace.path
      const projectId = project.id
      const sandboxPolicy = this.ctx.sandboxPolicy.resolve({ session })
      if (body.action === 'project.files.list') {
        const relativePath = this.projectFilesPath(projectId, body.path ?? '')
        await this.assertProjectFilesPath(projectId, body.path ?? '', workspaceRoot, 'directory', request.signal)
        const directoryTarget = await this.target(relativePath, workspaceRoot)
        const entries = await this.ctx.fs.listDir(directoryTarget, request.signal)
        const safeEntries = entries.filter((entry) => entry.name && entry.name !== '.' && entry.name !== '..' && !entry.name.includes('/') && !entry.name.includes('\\'))
        const files = []
        for (let index = 0; index < safeEntries.length; index += 16) {
          const batch = await Promise.all(safeEntries.slice(index, index + 16).map(async (entry) => {
            const childPath = `${relativePath}/${entry.name}`
            const child = await this.ctx.fs.lstat(childPath, { cwd: workspaceRoot }, request.signal)
            if (!child || child.type === 'symlink' || !['file', 'directory'].includes(child.type)) return null
            return { name: entry.name, type: child.type, ...(child.type === 'file' && Number.isFinite(entry.size) ? { size: entry.size } : {}), path: body.path ? `${body.path}/${entry.name}` : entry.name }
          }))
          files.push(...batch.filter(Boolean))
        }
        return json({ path: body.path ?? '', absolutePath: directoryTarget.displayPath, entries: files })
      }
      if (body.action === 'project.files.read') {
        if (typeof body.path !== 'string' || !body.path) fail('请选择一个项目文件')
        const relativePath = await this.assertProjectFilesPath(projectId, body.path, workspaceRoot, 'file', request.signal)
        const target = await this.target(relativePath, workspaceRoot)
        const bytes = await this.ctx.fs.readBytes(target, request.signal, PROJECT_FILE_MAX_BYTES)
        const filename = body.path.split('/').at(-1)
        return new Response(bytes, { headers: { 'cache-control': 'no-store', 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` } })
      }
      if (body.action === 'project.update') {
        const patch = body.patch
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('项目更新内容无效')
        const projectFile = PROJECT_FILE
        await this.assertProjectPath(projectFile, workspaceRoot, request.signal)
        const projectTarget = await this.target(projectFile, workspaceRoot)
        const observed = await this.ctx.fs.stat(projectTarget, request.signal)
        if (!observed) fail('项目不存在', 404)
        const doc = parseDocument(await this.ctx.fs.readText(projectTarget, request.signal))
        if (Object.hasOwn(patch, 'name')) doc.front.name = safeText(patch.name, '项目名称')
        if (Object.hasOwn(patch, 'description')) {
          if (typeof patch.description !== 'string' || patch.description.length > 100000) fail('项目简介最多 100000 个字符')
          doc.body = patch.description
        }
        for (const key of ['startDate', 'dueDate']) {
          if (Object.hasOwn(patch, key) && patch[key] !== '' && !validDate(patch[key])) fail(`${key} 必须是有效日期 YYYY-MM-DD`)
          if (Object.hasOwn(patch, key)) doc.front[key] = patch[key]
        }
        if (doc.front.startDate && doc.front.dueDate && doc.front.dueDate < doc.front.startDate) fail('项目截止日期不能早于开始日期')
        doc.front.updatedAt = new Date().toISOString()
        await this.ctx.fs.writeText(projectTarget, serializeDocument(doc.front, doc.body), { kind: 'replaceIfVersion', version: observed.version }, request.signal, sandboxPolicy)
        return json({ project: await this.readProject(projectId, request.signal, workspaceRoot) })
      }
      if (body.action === 'task.create') {
        const title = safeText(body.title, '任务标题')
        const id = makeId('t')
        const file = `${TASKS_DIR}/${id}.md`
        const task = { id, title, status: 'todo', priority: 'normal', assignees: [], start: '', due: '', progress: 0, estimate: null, critical: false, relatedTo: [], checklist: [], nodes: [] }
        await this.writeFile(file, serializeDocument(task, '## 任务说明\n\n补充任务描述与验收条件。'), request.signal, workspaceRoot, sandboxPolicy)
        await this.touchProject(projectId, request.signal, workspaceRoot, sandboxPolicy)
        return json({ project: await this.readProject(projectId, request.signal, workspaceRoot), createdTaskId: id }, 201)
      }
      if (body.action === 'task.node.add') {
        const taskId = safeText(body.taskId, 'taskId', 100)
        if (!TASK_ID.test(taskId)) fail('任务 ID 无效')
        if (!TASK_NODE_KINDS.has(body.kind)) fail('任务节点类型无效')
        const text = safeText(body.nodeText, '节点内容', TASK_NODE_TEXT_MAX)
        const relativePath = `${TASKS_DIR}/${taskId}.md`
        await this.assertProjectPath(relativePath, workspaceRoot, request.signal)
        const taskTarget = await this.target(relativePath, workspaceRoot)
        const observed = await this.ctx.fs.stat(taskTarget, request.signal)
        if (!observed) fail('任务不存在', 404)
        const doc = parseDocument(await this.ctx.fs.readText(taskTarget, request.signal))
        const nodes = normalizeTaskNodes(doc.front.nodes)
        if (nodes.length >= TASK_NODE_LIMIT) fail(`每个任务最多记录 ${TASK_NODE_LIMIT} 个节点`, 409)
        const now = new Date().toISOString()
        if (body.kind !== 'completed') {
          doc.front.nodes = nodes.map((node) => node.kind === body.kind && node.active ? { ...node, active: false, resolvedAt: now } : node)
        } else {
          doc.front.nodes = nodes
        }
        doc.front.nodes.push({ id: makeId('n'), kind: body.kind, text, at: now, active: body.kind !== 'completed' })
        if (body.kind === 'blocker') doc.front.status = 'blocked'
        else if (body.kind === 'current' && doc.front.status === 'done') doc.front.status = 'doing'
        doc.front.updatedAt = now
        await this.ctx.fs.writeText(taskTarget, serializeDocument(doc.front, doc.body), { kind: 'replaceIfVersion', version: observed.version }, request.signal, sandboxPolicy)
        await this.touchProject(projectId, request.signal, workspaceRoot, sandboxPolicy)
        return json({ project: await this.readProject(projectId, request.signal, workspaceRoot) }, 201)
      }
      if (body.action === 'task.update') {
        const taskId = safeText(body.taskId, 'taskId', 100)
        if (!TASK_ID.test(taskId)) fail('任务 ID 无效')
        const patch = body.patch
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('任务更新内容无效')
        const relativePath = `${TASKS_DIR}/${taskId}.md`
        await this.assertProjectPath(relativePath, workspaceRoot, request.signal)
        const taskTarget = await this.target(relativePath, workspaceRoot)
        const observed = await this.ctx.fs.stat(taskTarget, request.signal)
        if (!observed) fail('任务不存在', 404)
        const doc = parseDocument(await this.ctx.fs.readText(taskTarget, request.signal))
        const previousStatus = doc.front.status
        const editable = ['title', 'status', 'priority', 'start', 'due', 'progress', 'estimate', 'critical', 'assignees', 'relatedTo', 'checklist']
        const allowed = new Set([...editable, 'body'])
        for (const key of Object.keys(patch)) if (!allowed.has(key)) fail(`不支持的任务字段：${key}`)
        for (const key of editable) if (Object.hasOwn(patch, key)) doc.front[key] = patch[key]
        if (Object.hasOwn(patch, 'body')) {
          if (typeof patch.body !== 'string' || patch.body.length > 100000) fail('任务描述最多 100000 个字符')
          doc.body = patch.body
        }
        if (Object.hasOwn(patch, 'title')) doc.front.title = safeText(patch.title, '任务标题')
        if (Object.hasOwn(patch, 'status') && !STATUS.has(patch.status)) fail('任务状态无效')
        if (Object.hasOwn(patch, 'priority') && !PRIORITY.has(patch.priority)) fail('优先级无效')
        if (Object.hasOwn(patch, 'critical') && typeof patch.critical !== 'boolean') fail('关键路径标记必须是布尔值')
        if (Object.hasOwn(patch, 'status')) {
          const now = new Date().toISOString()
          const nodes = normalizeTaskNodes(doc.front.nodes)
          doc.front.nodes = nodes.map((node) => {
            const resolvingBlocker = previousStatus === 'blocked' && patch.status !== 'blocked' && node.kind === 'blocker' && node.active
            const completingCurrent = patch.status === 'done' && node.kind === 'current' && node.active
            return resolvingBlocker || completingCurrent ? { ...node, active: false, resolvedAt: now } : node
          })
        }
        if (Object.hasOwn(patch, 'estimate') && patch.estimate !== null && (!Number.isFinite(patch.estimate) || patch.estimate < 0 || patch.estimate > 1000000)) fail('工时估算必须为 0 到 1000000 之间的数字')
        if (Object.hasOwn(patch, 'assignees')) doc.front.assignees = normalizeAssignees(patch.assignees)
        for (const key of ['start', 'due']) if (Object.hasOwn(patch, key) && patch[key] !== '' && !validDate(patch[key])) fail(`${key} 必须是有效日期 YYYY-MM-DD`)
        const nextStart = Object.hasOwn(patch, 'start') ? patch.start : doc.front.start
        const nextDue = Object.hasOwn(patch, 'due') ? patch.due : doc.front.due
        if (nextStart && nextDue && nextDue < nextStart) fail('截止日期不能早于开始日期')
        if (Object.hasOwn(patch, 'progress')) {
          if (!Number.isFinite(patch.progress) || patch.progress < 0 || patch.progress > 100) fail('进度必须是 0 到 100')
          doc.front.progress = Math.round(patch.progress)
        }
        if (Object.hasOwn(patch, 'relatedTo') && (!Array.isArray(patch.relatedTo) || patch.relatedTo.some((value) => typeof value !== 'string'))) fail('参考关联格式无效')
        await this.ctx.fs.writeText(taskTarget, serializeDocument(doc.front, doc.body), { kind: 'replaceIfVersion', version: observed.version }, request.signal, sandboxPolicy)
        await this.touchProject(projectId, request.signal, workspaceRoot, sandboxPolicy)
        return json({ project: await this.readProject(projectId, request.signal, workspaceRoot) })
      }
      fail('不支持的操作')
    } catch (error) {
      if (error?.code === 'FS_STALE_VERSION') return json({ error: '项目文件刚被其他操作修改，请刷新后重试' }, 409)
      const status = Number.isInteger(error?.status) ? error.status : 500
      this.ctx.logger.warn(`project-hub: ${String(error)}`)
      return json({ error: error?.message || '项目面板请求失败' }, status)
    }
  }

  async handle(request) {
    return this.handleScoped(request)
  }
}

export default ProjectHub
