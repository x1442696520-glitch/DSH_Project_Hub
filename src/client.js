window.__ModuleLoader__.load({
  id: 'dsh-project-hub/client',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const shared = require('dsh-project-hub/client/shared')
    const { PANEL_ID, API, STYLE_ID, statusNames, statusClasses, statusColors, taskNodeNames, priorityNames, officePlatforms, css, ensureStyles, request, dateObj, isoDay, localDay, defaultTaskDates, dayNumber, fromDayNumber, shiftDate, labelDate, csvCell, buildProjectCsv, downloadProjectCsv } = shared
    const { ProjectManagementView } = require('dsh-project-hub/client/panel')

    function apply(ctx) {
      const randomSuffix = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`).replace(/-/g, '').slice(0, 8).toLowerCase()
      const safeWorkspaceTitle = (value) => {
        const name = String(value || '').trim()
        if (!name || name.length > 100 || /[<>:\x2f\x5c|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) throw new Error('工作区名称不能为空，且不能包含 Windows 路径非法字符或保留名称')
        return name
      }
      let sessionCatalogRefresh = null
      const refreshSessionCatalog = () => {
        if (sessionCatalogRefresh) return sessionCatalogRefresh
        if (typeof ctx.sessions?.refresh !== 'function') return Promise.reject(new Error('当前 DSH Client 不支持刷新会话列表'))
        const current = Promise.resolve().then(() => ctx.sessions.refresh())
        sessionCatalogRefresh = current
        const cleanup = current.finally(() => { if (sessionCatalogRefresh === current) sessionCatalogRefresh = null })
        cleanup.catch(() => {})
        return current
      }
      const openProjectAssistantSession = async (assistantSessionId) => {
        if (typeof assistantSessionId !== 'string' || !assistantSessionId) throw new Error('项目资料没有绑定助手会话 ID')
        await refreshSessionCatalog()
        const snapshot = ctx.sessions.list?.getSnapshot?.()
        if (!snapshot?.byId?.[assistantSessionId]) throw new Error(`DSH 会话列表刷新后仍未返回助手会话 ${assistantSessionId}；项目资料仍保留此会话绑定。`)
        ctx.uiWorkspace.openSession(assistantSessionId)
      }
      void refreshSessionCatalog().catch((error) => globalThis.console?.warn?.('project-hub: DSH session-list refresh failed', error))
      const ensureProjectFilesDirectory = async (workspacePath) => {
        await ensureDirectory(workspacePath, 'files')
      }
      const unwrapRemote = (result) => {
        if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') return result
        if (!result.ok) throw new Error(result.error?.message || 'DSH 远程操作失败')
        return result.value
      }
      const ensureDirectory = async (parentPath, name) => {
        const findExisting = async () => {
          const listing = unwrapRemote(await ctx.remote.directoryPicker.list(parentPath))
          return listing.entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.path
        }
        const existing = await findExisting()
        if (existing) return existing
        try { return unwrapRemote(await ctx.remote.directoryPicker.createDirectory(parentPath, name)) }
        catch (error) {
          const raced = await findExisting()
          if (raced) return raced
          throw error
        }
      }
      const sendProjectFiles = async (currentSessionId, project, paths) => {
        if (!project?.assistantSessionId) throw new Error('项目尚未绑定项目助手 Session')
        const assistantSessionId = project.assistantSessionId
        ctx.uiWorkspace.openSession(assistantSessionId)
        const receipts = []
        for (const path of paths) {
          const response = await fetch(API, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'project.files.read', sessionId: currentSessionId, projectId: project.id, path }) })
          if (!response.ok) {
            const value = await response.json().catch(() => ({}))
            throw new Error(value.error || `读取项目文件失败 (${response.status})`)
          }
          const blob = await response.blob()
          const uploaded = await ctx.fileUpload.upload(assistantSessionId, blob, path.split('/').at(-1))
          if (!uploaded?.ok) throw new Error(uploaded?.error?.message || `项目文件附件上传失败：${path}`)
          receipts.push({ path, receiptId: uploaded.value.receiptId })
        }
        const lineBreak = String.fromCharCode(10)
        const fileList = receipts.map(({ path }) => `- files/${path}`).join(lineBreak)
        const content = [{ type: 'text', text: `请查看并使用以下项目文件，结合项目资料协助我：${lineBreak}${fileList}` }, ...receipts.map(({ receiptId }) => ({ type: 'file', receiptId }))]
        const result = await ctx.sessions.using(assistantSessionId, { source: 'projectHubFileSelection' }, (reference) => reference.binding.session.prompt(content, 'queue'))
        if (!result?.ok) throw new Error(result?.error?.message || '项目文件未能发送给项目助手')
      }
      const normalizeWorkspaceDirectory = async (currentSessionId, displayedProject, workspacePath, workspaceTitle) => {
        const workspace = ctx.workspaces.list.getSnapshot().items.find((candidate) => candidate.sessionIds?.includes(currentSessionId))
        const workspaceId = workspace?.workspaceId || workspace?.id
        if (!workspaceId || !workspacePath || !workspaceTitle) throw new Error('无法确定当前 Workspace 身份或路径')
        const title = safeWorkspaceTitle(workspaceTitle)
        if (workspacePath.split(/[\\/]/).at(-1) === title) return
        const current = await request(`${API}?sessionId=${encodeURIComponent(currentSessionId)}`)
        const oldProject = current.project || displayedProject
        if (!oldProject?.id) throw new Error('无法读取待迁移的项目资料')
        const normalized = String(workspacePath).replace(/[\\/]+$/, '')
        const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
        let parentPath = separatorIndex < 0 ? '' : normalized.slice(0, separatorIndex)
        if (/^[a-z]:$/i.test(parentPath)) parentPath += normalized.includes('\\') ? '\\' : '/'
        if (!parentPath) throw new Error('无法确定 Workspace 的父目录')
        const siblingListing = unwrapRemote(await ctx.remote.directoryPicker.list(parentPath))
        const normalizePathForComparison = (value) => {
          const normalizedPath = String(value || '').replace(/[\\/]+$/, '').replace(/\\/g, '/')
          return /^[a-z]:\//i.test(normalizedPath) ? normalizedPath.toLocaleLowerCase() : normalizedPath
        }
        const currentWorkspacePath = normalizePathForComparison(workspacePath)
        const conflictingDirectory = siblingListing.entries.find((entry) =>
          entry.name.toLocaleLowerCase() === title.toLocaleLowerCase() && normalizePathForComparison(entry.path) !== currentWorkspacePath
        )
        if (conflictingDirectory) throw new Error(`同名目录「${title}」已存在：${conflictingDirectory.path}`)
        const conflictingWorkspace = ctx.workspaces.list.getSnapshot().items.find((candidate) => (candidate.workspaceId || candidate.id) !== workspaceId && String(candidate.title || '').trim().toLocaleLowerCase() === title.toLocaleLowerCase())
        if (conflictingWorkspace) throw new Error(`已有同名 Workspace「${title}」，无法规范化目录`)
        const temporaryTitle = `${title.slice(0, 70)} (旧-${randomSuffix()})`
        let oldRenamed = false
        let newWorkspaceId = ''
        let newSessionId = ''
        let newPath = ''
        let dataCopied = false
        try {
          unwrapRemote(await ctx.remote.workspace.rename({ workspaceId, title: temporaryTitle }))
          oldRenamed = true
          newPath = unwrapRemote(await ctx.remote.directoryPicker.createDirectory(parentPath, title))
          const created = unwrapRemote(await ctx.remote.workspace.create({ path: newPath }))
          newWorkspaceId = created.workspace?.workspaceId || created.workspace?.id
          if (!newWorkspaceId) throw new Error('DSH 未返回新 Workspace ID')
          unwrapRemote(await ctx.remote.workspace.rename({ workspaceId: newWorkspaceId, title }))
          const sourceAgentPreset = await ctx.sessions.using(currentSessionId, { source: 'projectHubWorkspaceMigration' }, (reference) => reference.binding.session.header?.agentPreset)
          // The Web ISessions.create API accepts agentPreset at the top level and maps it to Session metadata.
          const createSessionOptions = { workspaceId: newWorkspaceId }
          if (typeof sourceAgentPreset === 'string' && sourceAgentPreset) createSessionOptions.agentPreset = sourceAgentPreset
          newSessionId = await ctx.sessions.create(createSessionOptions)
          if (typeof sourceAgentPreset === 'string' && sourceAgentPreset) {
            const createdAgentPreset = await ctx.sessions.using(newSessionId, { source: 'projectHubWorkspaceMigrationVerify' }, (reference) => reference.binding.session.header?.agentPreset)
            if (createdAgentPreset !== sourceAgentPreset) throw new Error('新项目助手 Session 未保留原会话的 Agent preset（工具与提示配置），已中止迁移以避免静默改变会话能力')
          }
          unwrapRemote(await ctx.remote.session.rename({ sessionId: newSessionId, title: `${title} · 项目助手` }))
          const initialized = await request(API, { method: 'POST', body: JSON.stringify({ action: 'project.ensure', workspaceId: newWorkspaceId, sessionId: newSessionId, name: title }) })
          let newProject = initialized.project
          const projectPatch = { name: title, description: oldProject.description || '', startDate: oldProject.startDate || '', dueDate: oldProject.dueDate || '' }
          const updated = await request(API, { method: 'POST', body: JSON.stringify({ action: 'project.update', sessionId: newSessionId, projectId: newProject.id, patch: projectPatch }) })
          newProject = updated.project
          const taskIdMap = new Map()
          const copiedTasks = []
          for (const oldTask of oldProject.tasks || []) {
            const previousIds = new Set(newProject.tasks.map((task) => task.id))
            const createdTask = await request(API, { method: 'POST', body: JSON.stringify({ action: 'task.create', sessionId: newSessionId, projectId: newProject.id, title: oldTask.title, start: oldTask.start || '', due: oldTask.due || '' }) })
            newProject = createdTask.project
            const nextTask = newProject.tasks.find((task) => !previousIds.has(task.id))
            if (!nextTask) throw new Error(`迁移任务失败：${oldTask.title}`)
            taskIdMap.set(oldTask.id, nextTask.id)
            copiedTasks.push({ oldTask, newTask: nextTask })
          }
          for (const { oldTask, newTask } of copiedTasks) {
            const patch = {}
            for (const key of ['status', 'priority', 'start', 'due', 'progress', 'critical', 'assignees', 'relatedTo', 'checklist', 'body']) {
              if (oldTask[key] === undefined) continue
              patch[key] = key === 'relatedTo' && Array.isArray(oldTask[key]) ? oldTask[key].map((id) => taskIdMap.get(id) || id) : oldTask[key]
            }
            if (Object.keys(patch).length) {
              const updatedTask = await request(API, { method: 'POST', body: JSON.stringify({ action: 'task.update', sessionId: newSessionId, projectId: newProject.id, taskId: newTask.id, patch }) })
              newProject = updatedTask.project
            }
            if (Array.isArray(oldTask.nodes) && oldTask.nodes.length) {
              const copiedNodes = await request(API, { method: 'POST', body: JSON.stringify({ action: 'task.nodes.replace', sessionId: newSessionId, projectId: newProject.id, taskId: newTask.id, nodes: oldTask.nodes }) })
              newProject = copiedNodes.project
            }
          }
          await ensureProjectFilesDirectory(newPath, newProject.id)
          dataCopied = true
          ctx.uiWorkspace.openSession(newSessionId)
          return newProject
        } catch (error) {
          if (!dataCopied) {
            if (newWorkspaceId) {
              try { unwrapRemote(await ctx.remote.workspace.delete({ workspaceId: newWorkspaceId })) } catch {}
            }
            if (oldRenamed) {
              try { unwrapRemote(await ctx.remote.workspace.rename({ workspaceId, title })) } catch {}
            }
          }
          throw new Error(`${dataCopied ? '项目内容已复制到新目录，但迁移未完全结束' : '目录规范化未完成，旧项目仍保留'}：${error.message}${newPath ? `（新目录：${newPath}）` : ''}`)
        }
      }

      const initializeWorkspaceProject = async ({ sessionId, workspaceId, workspacePath, workspaceTitle }) => {
        const result = await request(API, { method: 'POST', body: JSON.stringify({ action: 'project.ensure', sessionId, workspaceId, name: workspaceTitle }) })
        if (workspacePath) await ensureProjectFilesDirectory(workspacePath)
        const refreshed = await request(`${API}?sessionId=${encodeURIComponent(sessionId)}`)
        return refreshed.project || result.project
      }
      const View = ({ sessionId }) => {
        const workspace = ctx.workspaces.list.getSnapshot().items.find((candidate) => candidate.sessionIds?.includes(sessionId))
        const workspaceId = workspace?.workspaceId || workspace?.id || ''
        return h(ProjectManagementView, { sessionId, workspaceId, workspacePath: workspace?.path || '', workspaceTitle: workspace?.title || '', onOpenSession: openProjectAssistantSession, onInitializeWorkspace: initializeWorkspaceProject, onSendFiles: (currentSessionId, project, paths) => sendProjectFiles(currentSessionId, project, paths), onEnsureFiles: ensureProjectFilesDirectory, onNormalizeWorkspace: (currentSessionId, project, path, title) => normalizeWorkspaceDirectory(currentSessionId, project, path, title) })
      }
      ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: PANEL_ID, order: 20, label: () => '项目', inject: (sessionId) => ({ sessionId }) }, View))
    }
    return { apply, inject: ['slots', 'remote', 'remote.directoryPicker', 'remote.workspace', 'remote.session', 'fileUpload', 'sessions', 'uiWorkspace', 'workspaces'] }
  }
})

