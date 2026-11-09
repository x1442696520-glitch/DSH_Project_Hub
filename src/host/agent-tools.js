export function createAgentToolsMethods(shared) {
  const { INTEGRATION_AGENT_ACTIONS, PROJECT_AGENT_ACTIONS, STANDARD_DSH_TOOL_NAMES, PROJECT_FILES_DIR, OUTBOUND_FILE_MAX_BYTES, TASK_NODE_KINDS, TASK_NODE_TEXT_MAX, fail, safeText, sanitizeInboundFilename, pickPatch, isWeComRecipientAuthorized } = shared
  return {
  currentExternalMessagePlatform(sessionId) {
    const activeTurns = new Set([this.wecomOpenTurns.get(sessionId), this.feishuOpenTurns.get(sessionId)].filter(Number.isSafeInteger))
    const origin = [...this.externalMessageOrigins.values()].filter((candidate) => candidate.sessionId === sessionId && activeTurns.has(candidate.turn) && ['wecom', 'feishu'].includes(candidate.platform)).at(-1)
    return origin?.platform || null
  },

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
  },

  async inspectWorkspaceChanges(workspace, session, signal) {
    if (!this.ctx.shell || typeof this.ctx.shell.resolve !== 'function' || typeof this.ctx.shell.execute !== 'function') fail('DSH 安全 Shell 只读检查服务不可用', 503)
    signal?.throwIfAborted()
    const command = 'git status --short; git diff --stat HEAD; git log -5 --oneline --decorate; git show -1 --no-ext-diff --unified=3 --format=fuller --no-renames HEAD; git diff --no-ext-diff --unified=3 HEAD'
    const sandboxPolicy = this.ctx.sandboxPolicy.resolve({ session })
    const spec = this.ctx.shell.resolve({ command, workdir: workspace.path, timeoutMs: 30_000, stdoutMaxBytes: 512 * 1024, sandboxPolicy })
    const execution = await this.ctx.shell.execute(spec)
    const result = await execution.result()
    if (result?.timedOut || result?.aborted || result?.sandbox?.denied) fail('只读 Git 检查被超时、取消或沙箱策略拒绝', 403)
    return {
      workspacePath: workspace.path,
      exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
      stdout: typeof result?.stdout?.text === 'string' ? result.stdout.text : '',
      stderr: typeof result?.stderr?.text === 'string' ? result.stderr.text : '',
      truncated: Boolean(result?.stdout?.truncated)
    }
  },

  async executeProjectManagementTool(args, signal, agent) {
    signal?.throwIfAborted()
    if (!PROJECT_AGENT_ACTIONS.has(args?.action)) fail('不支持的 Project Hub 项目/任务操作', 403)
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string' || !sessionId) fail('Project Hub 工具必须由 DSH 会话调用', 403)
    if (args.action === 'agent_tool_status') {
      // Re-verify live state on demand so diagnostics can clear stale failures after a safe code update.
      try { await this.restoreProjectHubAgentPreset(agent) } catch {}
      const registry = agent?.ctx?.tools
      if (typeof registry?.schemas !== 'function') fail('当前 Agent 没有公开工具 schema 诊断接口', 503)
      const registeredVisibleToolNames = registry.schemas(agent).map((schema) => schema.name).filter((name) => typeof name === 'string')
      const presetRegistry = this.ctx.agentPresets
      let projectedPreset
      let composedAgentPreset = null
      try { if (typeof presetRegistry?.presetForSession === 'function') projectedPreset = await presetRegistry.presetForSession(agent?.session) } catch {}
      try { if (typeof presetRegistry?.composedPreset === 'function') composedAgentPreset = await presetRegistry.composedPreset(agent?.ctx) || null } catch {}
      const sessionAgentPreset = typeof projectedPreset === 'string' && projectedPreset ? projectedPreset : typeof agent?.session?.header?.agentPreset === 'string' ? agent.session.header.agentPreset : null
      const missingStandardDshToolNames = sessionAgentPreset === 'standard' ? STANDARD_DSH_TOOL_NAMES.filter((name) => !registeredVisibleToolNames.includes(name)) : null
      const projectToolNames = new Set(['project_hub_integrations', 'project_hub_manage'])
      const previousRequestToolNames = (agent?.session?.requestHeader?.()?.tools || []).map((tool) => tool.name).filter((name) => typeof name === 'string')
      return JSON.stringify({
        sessionAgentPreset,
        composedAgentPreset,
        agentPresetRestoration: this.agentPresetRestorationStatus.get(sessionId) || { state: 'not-checked' },
        standardPresetToolsReady: missingStandardDshToolNames === null ? null : missingStandardDshToolNames.length === 0,
        requiredStandardDshToolNames: missingStandardDshToolNames === null ? null : STANDARD_DSH_TOOL_NAMES,
        missingStandardDshToolNames,
        previousRequestToolNames,
        registeredVisibleToolNames,
        inheritedDshToolNames: registeredVisibleToolNames.filter((name) => !projectToolNames.has(name) && name !== 'run_code'),
        runCodeTransportRegistered: registeredVisibleToolNames.includes('run_code')
      })
    }
    if (args.action === 'review_code_changes') {
      const { workspace, session } = await this.projectForSession(sessionId, signal)
      return JSON.stringify(await this.inspectWorkspaceChanges(workspace, session, signal))
    }
    if (args.action === 'get_project') return JSON.stringify(await this.agentApi('GET', sessionId, { signal }))
    if (args.action === 'list_tasks') {
      const result = await this.agentApi('GET', sessionId, { signal })
      const project = result.project
      const tasks = Array.isArray(project?.tasks) ? project.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        due: task.due,
        progress: task.progress,
        currentWork: task.currentWork,
        blocker: task.blocker,
        nodes: task.nodes
      })) : []
      return JSON.stringify({ project: { id: project?.id, name: project?.name, updatedAt: project?.updatedAt }, tasks })
    }
    if (args.action === 'create_task') {
      const title = safeText(args.title, '任务标题')
      return JSON.stringify(await this.agentApi('POST', sessionId, { signal, body: { action: 'task.create', title } }))
    }
    if (args.action === 'add_task_node') {
      const taskId = safeText(args.taskId, 'taskId', 100)
      const kind = safeText(args.kind, '任务节点类型', 16)
      if (!TASK_NODE_KINDS.has(kind)) fail('任务节点类型必须是 completed、current 或 blocker')
      const nodeText = safeText(args.nodeText, '节点内容', TASK_NODE_TEXT_MAX)
      return JSON.stringify(await this.agentApi('POST', sessionId, { signal, body: { action: 'task.node.add', taskId, kind, nodeText } }))
    }
    if (args.action === 'update_task') {
      const taskId = safeText(args.taskId, 'taskId', 100)
      const fields = ['title', 'status', 'priority', 'start', 'due', 'progress', 'critical', 'assignees', 'relatedTo', 'checklist', 'body']
      const patch = pickPatch(args.patch, fields, '任务')
      return JSON.stringify(await this.agentApi('POST', sessionId, { signal, body: { action: 'task.update', taskId, patch } }))
    }
    fail('不支持的 Project Hub 项目/任务操作')
  },

  async executeAgentTool(args, signal, agent) {
    signal?.throwIfAborted()
    if (!INTEGRATION_AGENT_ACTIONS.has(args?.action)) fail('该 Agent 工具仅支持飞书/企微集成操作')
    const sessionId = agent?.session?.id
    if (typeof sessionId !== 'string' || !sessionId) fail('Project Hub 工具必须由 DSH 会话调用', 403)
    if (args.action === 'list_project_files') {
      const path = args.path === undefined ? '' : safeText(args.path, '项目 files 子目录', 512)
      const result = await this.agentApi('POST', sessionId, { signal, body: { action: 'project.files.list', path } })
      const entries = Array.isArray(result.entries) ? result.entries : []
      return JSON.stringify({ path, entries: entries.slice(0, 200), truncated: entries.length > 200 })
    }
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
      const result = await this.agentApi('GET', sessionId, { signal })
      if (result?.project?.assistantSessionId !== sessionId) fail('企微助手工具只能由当前项目助手会话调用', 403)
      let binding = null
      try { binding = this.readStoredWeComBinding() } catch {}
      if (!isWeComRecipientAuthorized(recipient, sessionId, binding)) fail('企微助手只能向当前会话已配对或环境变量授权的 UserID 发送消息', 403)
      if (!this.wecomClient || this.wecomStatus.state !== 'connected') fail('企业微信智能机器人长连接未认证；请先配置 Bot ID/Secret 并确认连接状态', 503)
      await this.wecomClient.sendText({ recipient, content: text })
      return JSON.stringify({ sent: true, recipient })
    }
    fail('不支持的飞书/企微集成操作')
  },
  }
}
