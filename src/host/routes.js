export function createRoutesMethods(shared) {
  const { PROJECT_FILE, TASKS_DIR, PROJECT_FILE_MAX_BYTES, TASK_ID, STATUS, PRIORITY, TASK_NODE_KINDS, TASK_NODE_LIMIT, TASK_NODE_TEXT_MAX, json, fail, safeText, parseDocument, serializeDocument, makeId, validDate, defaultTaskDates, normalizeAssignees, normalizeTaskNodes, bridgeJournalErrorCode, isWeComRecipientAuthorized, isCredentialStoreAvailable } = shared
  return {
  async handleScoped(request) {
    const scopeGeneration = this.agentPresetRestoreGeneration
    try {
      if (request.method === 'GET') {
        const sessionId = safeText(new URL(request.url).searchParams.get('sessionId'), 'sessionId', 100)
        const { workspace } = await this.workspaceForSession(sessionId)
        const projects = await this.listProjects(request.signal, workspace.path)
        if (projects.length > 1) fail(`工作区 ${workspace.title} 中存在多个旧项目，需先迁移为一项目一工作区`, 409)
        if (!projects.length) return json({ project: null, projects: [] })
        const project = await this.readProject(projects[0].id, request.signal, workspace.path)
        if (project.workspaceId && project.workspaceId !== workspace.id) fail('项目与 DSH 工作区绑定不一致，拒绝访问', 403)
        if (project.assistantSessionId && !workspace.sessionIds.includes(project.assistantSessionId)) {
          const foreignOwner = this.ctx.workspaceRegistry.list().some((candidate) => candidate.id !== workspace.id && candidate.sessionIds.includes(project.assistantSessionId))
          if (foreignOwner) fail('项目助手会话属于其他 DSH 工作区，拒绝访问', 403)
          project.assistantSessionId = null
        }
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
        if (this.isAgentPresetRestoreGenerationCurrent(scopeGeneration) && project.workspaceId === workspaceId && project.assistantSessionId === sessionId && project.path === '.') {
          this.projectAssistantSessions.add(sessionId)
          const agent = this.ctx.agents?.get(sessionId)
          if (agent?.ctx?.tools?.register) {
            try { await this.restoreProjectHubAgentPreset(agent, scopeGeneration) }
            catch (error) { this.ctx.logger.warn(`project-hub: could not restore the project assistant Agent preset (${bridgeJournalErrorCode(error)})`) }
            if (this.isAgentPresetRestoreGenerationCurrent(scopeGeneration)) this.ensureProjectHubAgentTools(agent)
          }
        }
        return json({ project }, 201)
      }
      const { workspace, session, project } = await this.projectForSession(sessionId, request.signal)
      if (body.projectId && body.projectId !== project.id) fail('禁止从此工作区会话访问其他项目', 403)
      if (body.action === 'plugin.diagnostics') {
        const nodeVersion = globalThis.process?.versions?.node || '未知'
        const nodeMajor = Number.parseInt(nodeVersion.split('.')[0], 10)
        const connectionCheck = (id, label, connection) => ({
          id,
          label,
          status: connection?.state === 'connected' ? 'ok' : connection?.state === 'not-configured' ? 'optional' : 'attention',
          detail: connection?.label || '连接状态未知'
        })
        return json({ diagnostics: [
          { id: 'plugin', label: 'Project Hub', status: 'ok', detail: '插件已加载并能响应 Host 请求' },
          { id: 'node', label: 'Node.js', status: nodeMajor >= 20 ? 'ok' : 'attention', detail: `当前版本 ${nodeVersion}；要求 20 或更高版本` },
          { id: 'filesystem', label: 'Workspace 文件服务', status: typeof this.ctx.fs?.readText === 'function' && typeof this.ctx.fs?.writeText === 'function' ? 'ok' : 'attention', detail: `当前 Workspace「${workspace.title}」已成功读取项目资料` },
          { id: 'credential-store', label: '系统凭证库', status: isCredentialStoreAvailable() ? 'ok' : 'attention', detail: isCredentialStoreAvailable() ? '原生凭证模块可用' : '原生凭证模块不可用；可改用 Host 环境变量配置机器人凭证' },
          connectionCheck('wecom', '企业微信', this.getWeComStatus()),
          connectionCheck('feishu', '飞书', this.getFeishuStatus())
        ] })
      }
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
        let binding = null
        try { binding = this.readStoredWeComBinding() } catch {}
        if (!isWeComRecipientAuthorized(recipient, sessionId, binding)) fail('企业微信只能向当前会话已配对或环境变量授权的 UserID 发送消息', 403)
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
        const pickerUpdated = await this.refreshFeishuProjectPicker({ tenantKey: binding.tenantKey, chatId: binding.chatId, openId: binding.openId })
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
        const defaults = defaultTaskDates()
        const start = body.start === undefined ? defaults.start : body.start
        const due = body.due === undefined ? defaults.due : body.due
        if (start !== '' && !validDate(start)) fail('start 必须是有效日期 YYYY-MM-DD')
        if (due !== '' && !validDate(due)) fail('due 必须是有效日期 YYYY-MM-DD')
        if (start && due && due < start) fail('截止日期不能早于开始日期')
        const id = makeId('t')
        const file = `${TASKS_DIR}/${id}.md`
        const task = { id, title, status: 'todo', priority: 'normal', assignees: [], start, due, progress: 0, estimate: null, critical: false, relatedTo: [], checklist: [], nodes: [] }
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
      if (body.action === 'task.nodes.replace') {
        const taskId = safeText(body.taskId, 'taskId', 100)
        if (!TASK_ID.test(taskId)) fail('任务 ID 无效')
        if (!Array.isArray(body.nodes) || body.nodes.length > TASK_NODE_LIMIT) fail(`任务记录必须是数组且最多 ${TASK_NODE_LIMIT} 条`)
        const nodes = normalizeTaskNodes(body.nodes)
        if (nodes.length !== body.nodes.length || new Set(nodes.map((node) => node.id)).size !== nodes.length) fail('任务记录格式无效或包含重复 ID')
        const relativePath = `${TASKS_DIR}/${taskId}.md`
        await this.assertProjectPath(relativePath, workspaceRoot, request.signal)
        const taskTarget = await this.target(relativePath, workspaceRoot)
        const observed = await this.ctx.fs.stat(taskTarget, request.signal)
        if (!observed) fail('任务不存在', 404)
        const doc = parseDocument(await this.ctx.fs.readText(taskTarget, request.signal))
        doc.front.nodes = nodes
        doc.front.updatedAt = new Date().toISOString()
        await this.ctx.fs.writeText(taskTarget, serializeDocument(doc.front, doc.body), { kind: 'replaceIfVersion', version: observed.version }, request.signal, sandboxPolicy)
        await this.touchProject(projectId, request.signal, workspaceRoot, sandboxPolicy)
        return json({ project: await this.readProject(projectId, request.signal, workspaceRoot) })
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
  },

  async handle(request) {
    return this.handleScoped(request)
  },
  }
}
