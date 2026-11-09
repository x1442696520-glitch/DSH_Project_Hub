export function createProjectStoreMethods(shared) {
  const { randomUUID, ROUTE, ROOT, PROJECT_FILE, TASKS_DIR, PROJECT_FILES_DIR, PROJECT_ID, TASK_ID, STATUS, PRIORITY, json, fail, failWithCode, safeText, parseDocument, serializeDocument, slug, normalizeAssignees, normalizeTaskNodes } = shared
  return {
  projectPath(id, suffix = '') {
    if (!PROJECT_ID.test(id)) fail('项目 ID 无效')
    return `${ROOT}/${id}${suffix ? `/${suffix}` : ''}`
  },

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
  },

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
  },

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
  },

  projectSummary(project) {
    return { id: project.id, name: project.name, status: project.status, path: project.path, updatedAt: project.updatedAt, progress: project.progress, taskCount: project.tasks.length, doneCount: project.tasks.filter((task) => task.status === 'done').length }
  },

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
  },

  async workspaceForSession(sessionId, { requireActive = true } = {}) {
    const session = this.ctx.sessions.get(sessionId)
    if (!session && requireActive) failWithCode('DSH 会话尚未激活，暂时不能访问项目', 403, 'SESSION_NOT_ACTIVE')
    if (session && (typeof session.header?.cwd !== 'string' || !session.header.cwd)) failWithCode('会话没有有效工作目录，拒绝访问项目', 403, 'SESSION_CWD_MISSING')
    const matches = this.ctx.workspaceRegistry.list().filter((workspace) => workspace.sessionIds.includes(sessionId))
    if (matches.length !== 1) failWithCode(matches.length ? '会话同时属于多个 DSH 工作区，拒绝访问' : '当前 DSH 会话不属于已登记工作区', 403, matches.length ? 'SESSION_WORKSPACE_AMBIGUOUS' : 'SESSION_WORKSPACE_UNREGISTERED')
    if (session) {
      let byPath
      try { byPath = await this.ctx.workspaceRegistry.resolveByPath(session.header.cwd) }
      catch { failWithCode('无法验证会话工作目录，拒绝访问项目', 403, 'SESSION_WORKSPACE_PATH_UNVERIFIABLE') }
      if (!byPath || byPath.id !== matches[0].id || byPath.path !== matches[0].path) failWithCode('会话工作目录与 DSH 工作区不匹配，拒绝访问项目', 403, 'SESSION_WORKSPACE_PATH_MISMATCH')
    }
    return { workspace: matches[0], session }
  },

  async ensureWorkspaceProject(workspaceId, options = {}, signal) {
    const pending = this.ensureProjects.get(workspaceId)
    if (pending) return pending
    const promise = this.ensureWorkspaceProjectUnlocked(workspaceId, options, signal)
    this.ensureProjects.set(workspaceId, promise)
    try { return await promise }
    finally { if (this.ensureProjects.get(workspaceId) === promise) this.ensureProjects.delete(workspaceId) }
  },

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
  },

  async projectForSession(sessionId, signal) {
    const { workspace, session } = await this.workspaceForSession(sessionId)
    const projects = await this.listProjects(signal, workspace.path)
    if (!projects.length) fail('当前 Workspace 尚未显式初始化 Project Hub 项目', 404)
    if (projects.length > 1) fail(`工作区 ${workspace.title} 中存在多个旧项目，需先迁移为一项目一工作区`, 409)
    const project = await this.readProject(projects[0].id, signal, workspace.path)
    if (project.workspaceId && project.workspaceId !== workspace.id) fail('项目与 DSH 工作区绑定不一致，拒绝访问', 403)
    const assistantBound = Boolean(project.assistantSessionId && workspace.sessionIds.includes(project.assistantSessionId))
    if (project.assistantSessionId && !assistantBound) {
      const foreignOwner = this.ctx.workspaceRegistry.list().some((candidate) => candidate.id !== workspace.id && candidate.sessionIds.includes(project.assistantSessionId))
      if (foreignOwner) fail('项目助手会话属于其他 DSH 工作区，拒绝访问', 403)
    }
    if (!project.workspaceId || !assistantBound || project.path !== '.') fail('项目资料需要在当前 Workspace 的 Project Hub 面板中明确迁移或修复后才能修改', 409)
    return { workspace, session, project }
  },

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
  },
  }
}

