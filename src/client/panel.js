window.__ModuleLoader__.load({
  id: 'dsh-project-hub/client/panel',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const shared = require('dsh-project-hub/client/shared')
    const { API, PANEL_ID, STYLE_ID, statusNames, statusClasses, statusColors, taskNodeNames, priorityNames, officePlatforms, css, ensureStyles, request, dateObj, isoDay, localDay, defaultTaskDates, dayNumber, fromDayNumber, shiftDate, labelDate, csvCell, buildProjectCsv, parseProjectCsv, downloadProjectCsv } = shared
    const { Icon, TaskEditor, ProjectOverview, Gantt, ProjectFilesView } = require('dsh-project-hub/client/components')

    function ProjectManagementView({ sessionId, onOpenSession, workspacePath, workspaceTitle, onSendFiles, onEnsureFiles, onPreviewNormalizeWorkspace, onNormalizeWorkspace }) {
      return h('div', { className: 'ph-workspace-view' }, h(Panel, { key: sessionId, sessionId, onOpenSession, workspacePath, workspaceTitle, onSendFiles, onEnsureFiles, onPreviewNormalizeWorkspace, onNormalizeWorkspace }))
    }

    function Panel({ sessionId, onOpenSession, workspaceId, workspacePath, workspaceTitle, onSendFiles, onEnsureFiles, onPreviewNormalizeWorkspace, onNormalizeWorkspace, onInitializeWorkspace }) {
      const [project, setProject] = useState(null)
      const activeId = project?.id || ''
      const [tab, setTab] = useState('overview')
      const [loading, setLoading] = useState(true)
      const [initializing, setInitializing] = useState(false)
      const [normalizing, setNormalizing] = useState(false)
      const [error, setError] = useState('')
      const [editing, setEditing] = useState(null)
      const [taskName, setTaskName] = useState('')
      const [showTaskInput, setShowTaskInput] = useState(false)
      const [wecomDraft, setWecomDraft] = useState({ recipient: '', text: '' })
      const [wecomSending, setWecomSending] = useState(false)
      const [wecomNotice, setWecomNotice] = useState('')
      const [activeIntegration, setActiveIntegration] = useState(null)
      const [wecomCredentialsDraft, setWecomCredentialsDraft] = useState({ botId: '', secret: '' })
      const [wecomCredentialsSaving, setWecomCredentialsSaving] = useState(false)
      const [wecomCredentialsNotice, setWecomCredentialsNotice] = useState('')
      const [wecomPairingBusy, setWecomPairingBusy] = useState(false)
      const [feishuCredentialsDraft, setFeishuCredentialsDraft] = useState({ appId: '', appSecret: '', tenantKey: '' })
      const [feishuCredentialsSaving, setFeishuCredentialsSaving] = useState(false)
      const [feishuCredentialsNotice, setFeishuCredentialsNotice] = useState('')
      const [feishuPairingBusy, setFeishuPairingBusy] = useState(false)
      const [feishuNotice, setFeishuNotice] = useState('')
      const [taskSearch, setTaskSearch] = useState('')
      const [dueFilter, setDueFilter] = useState('all')
      const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set())
      const [bulkTargetStatus, setBulkTargetStatus] = useState('doing')
      const [bulkUpdating, setBulkUpdating] = useState(false)
      const [csvImportPreview, setCsvImportPreview] = useState(null)
      const [csvImporting, setCsvImporting] = useState(false)
      const [taskNotice, setTaskNotice] = useState('')
      const wecomSendDisabledReason = project?.wecomConnection?.state !== 'connected'
        ? `发送测试消息需要 Host 长连接已认证（当前：${project?.wecomConnection?.label || '状态未知'}）`
        : !wecomDraft.recipient.trim() || !wecomDraft.text.trim()
          ? '请填写企业微信 UserID 和消息内容后再发送。'
          : wecomDraft.recipient.trim().toLocaleLowerCase() === '@all'
            ? '此入口只支持单聊 UserID，不支持 @all 或群聊目标。'
          : ''
      const scopedRequest = useCallback((url = API, options = {}) => {
        if (options.method === 'POST') {
          const body = JSON.parse(options.body || '{}')
          return request(url, { ...options, body: JSON.stringify({ ...body, sessionId }) })
        }
        const separator = url.includes('?') ? '&' : '?'
        return request(`${url}${separator}sessionId=${encodeURIComponent(sessionId || '')}`, options)
      }, [sessionId])

      useEffect(() => {
        let alive = true
        setLoading(true)
        if (!sessionId) { setError('无法确定当前 DSH 会话'); setLoading(false); return () => { alive = false } }
        scopedRequest().then((result) => {
          if (!alive) return
          setProject(result.project || null)
          setLoading(false)
        }).catch((e) => { if (alive) { setError(e.message); setLoading(false) } })
        return () => { alive = false }
      }, [sessionId])
      const initializeCurrentWorkspace = async () => {
        if (!workspaceId || !sessionId || initializing || !onInitializeWorkspace) return
        setInitializing(true); setError('')
        try {
          const created = await onInitializeWorkspace({ sessionId, workspaceId, workspacePath, workspaceTitle })
          setProject(created)
        } catch (failure) { setError(failure.message || String(failure)) }
        finally { setInitializing(false) }
      }
      const applyProject = async (next) => { setProject(next) }
      const patchTask = async (taskId, patch) => {
        setError('')
        const result = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'task.update', projectId: activeId, taskId, patch }) })
        await applyProject(result.project)
        return result.project
      }
      const updateProject = async (patch) => {
        setError('')
        const result = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'project.update', projectId: activeId, patch }) })
        await applyProject(result.project)
      }
      const sendWeComMessage = async (event) => {
        event.preventDefault()
        if (!wecomDraft.recipient.trim() || !wecomDraft.text.trim() || wecomSending) return
        setWecomSending(true); setWecomNotice('')
        try {
          const result = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'wecom.send_text', projectId: activeId, recipient: wecomDraft.recipient.trim(), text: wecomDraft.text.trim() }) })
          setWecomNotice(`已通过企业微信长连接发送给 ${result.recipient}`)
          setWecomDraft((current) => ({ ...current, text: '' }))
        } catch (e) { setError(e.message) }
        finally { setWecomSending(false) }
      }
      const checkRuntimeEnvironment = async () => {
        setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'plugin.diagnostics', projectId: activeId }) })
          setProject((current) => current ? { ...current, runtimeDiagnostics: result.diagnostics || [] } : current)
        } catch (failure) { setError(failure.message || String(failure)) }
      }
      const wecomCredentialErrorMessage = (error) => {
        const message = String(error?.message || error)
        return message.includes('不支持的操作')
          ? '当前 DSH Host 尚未加载凭证配置接口。请完全退出并重启 DSH Host，再刷新页面重试；仅刷新网页不会更新 Host。'
          : message
      }
      const saveWeComCredentials = async (event) => {
        event.preventDefault()
        const botId = wecomCredentialsDraft.botId.trim()
        const secret = wecomCredentialsDraft.secret.trim()
        if (!botId || !secret || wecomCredentialsSaving) return
        setWecomCredentialsSaving(true); setWecomCredentialsNotice(''); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'wecom.configure', projectId: activeId, botId, secret }) })
          setProject((current) => current ? { ...current, wecomConnection: result.wecomConnection } : current)
          setWecomCredentialsDraft({ botId: '', secret: '' })
          setWecomCredentialsNotice('凭证已保存到系统凭证库并启动连接；Secret 已从表单清除。')
        } catch (e) { setWecomCredentialsDraft((current) => ({ ...current, secret: '' })); setError(wecomCredentialErrorMessage(e)) }
        finally { setWecomCredentialsSaving(false) }
      }
      const clearWeComCredentials = async () => {
        if (wecomCredentialsSaving || !globalThis.confirm?.('删除本机系统凭证库中保存的企业微信 Bot ID/Secret？此操作不会删除 Host 环境变量。')) return
        setWecomCredentialsSaving(true); setWecomCredentialsNotice(''); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'wecom.clear_credentials', projectId: activeId }) })
          setProject((current) => current ? { ...current, wecomConnection: result.wecomConnection } : current)
          setWecomCredentialsDraft({ botId: '', secret: '' })
          setWecomCredentialsNotice(result.wecomConnection?.credentialSource === 'environment' ? '已删除系统凭证；当前将回退使用 Host 环境变量。' : '已删除系统凭证。')
        } catch (e) { setWecomCredentialsDraft((current) => ({ ...current, secret: '' })); setError(wecomCredentialErrorMessage(e)) }
        finally { setWecomCredentialsSaving(false) }
      }
      const refreshWeComStatus = async () => {
        try {
          const refreshed = await scopedRequest()
          setProject(refreshed.project)
          if (refreshed.project?.wecomPairing?.state === 'bound') setWecomDraft((current) => ({ ...current, recipient: refreshed.project.wecomPairing.userId }))
        } catch (refreshError) { setError(refreshError.message) }
      }
      const startWeComPairing = async () => {
        if (wecomPairingBusy) return
        setWecomPairingBusy(true); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'wecom.pair.start', projectId: activeId }) })
          setProject((current) => current ? { ...current, wecomPairing: result.pairing } : current)
        } catch (e) { setError(e.message) }
        finally { setWecomPairingBusy(false) }
      }
      const clearWeComPairing = async () => {
        if (wecomPairingBusy || !globalThis.confirm?.('解除当前 Project Hub 会话与企业微信 UserID 的绑定？')) return
        setWecomPairingBusy(true); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'wecom.pair.clear', projectId: activeId }) })
          setProject((current) => current ? { ...current, wecomPairing: result.pairing } : current)
          setWecomDraft((current) => ({ ...current, recipient: '' }))
        } catch (e) { setError(e.message) }
        finally { setWecomPairingBusy(false) }
      }
      const feishuCredentialErrorMessage = (error) => {
        const message = String(error?.message || error)
        return message.includes('不支持的操作')
          ? '当前 DSH Host 尚未加载飞书配置接口。请完全退出并重启 DSH Host，再刷新页面重试；仅刷新网页不会更新 Host。'
          : message
      }
      const saveFeishuCredentials = async (event) => {
        event.preventDefault()
        const appId = feishuCredentialsDraft.appId.trim()
        const appSecret = feishuCredentialsDraft.appSecret.trim()
        const tenantKey = feishuCredentialsDraft.tenantKey.trim()
        if (!appId || !appSecret || feishuCredentialsSaving) return
        setFeishuCredentialsSaving(true); setFeishuCredentialsNotice(''); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'feishu.configure', projectId: activeId, appId, appSecret, tenantKey }) })
          setProject((current) => current ? { ...current, feishuConnection: result.feishuConnection } : current)
          setFeishuCredentialsDraft({ appId: '', appSecret: '', tenantKey: '' })
          setFeishuCredentialsNotice('应用凭证已保存到系统凭证库并启动连接；Secret 已从表单清除。')
        } catch (e) { setFeishuCredentialsDraft((current) => ({ ...current, appSecret: '' })); setError(feishuCredentialErrorMessage(e)) }
        finally { setFeishuCredentialsSaving(false) }
      }
      const clearFeishuCredentials = async () => {
        if (feishuCredentialsSaving || !globalThis.confirm?.('删除本机系统凭证库中保存的飞书 App ID/App Secret？此操作不会删除 Host 环境变量。')) return
        setFeishuCredentialsSaving(true); setFeishuCredentialsNotice(''); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'feishu.clear_credentials', projectId: activeId }) })
          setProject((current) => current ? { ...current, feishuConnection: result.feishuConnection } : current)
          setFeishuCredentialsDraft({ appId: '', appSecret: '', tenantKey: '' })
          setFeishuCredentialsNotice(result.feishuConnection?.credentialSource === 'environment' ? '已删除系统凭证；当前将回退使用 Host 环境变量。' : '已删除系统凭证。')
        } catch (e) { setFeishuCredentialsDraft((current) => ({ ...current, appSecret: '' })); setError(feishuCredentialErrorMessage(e)) }
        finally { setFeishuCredentialsSaving(false) }
      }
      const refreshFeishuStatus = async () => {
        try { const refreshed = await scopedRequest(); setProject(refreshed.project) }
        catch (refreshError) { setError(refreshError.message) }
      }
      const startFeishuPairing = async () => {
        if (feishuPairingBusy) return
        setFeishuPairingBusy(true); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'feishu.pair.start', projectId: activeId }) })
          setProject((current) => current ? { ...current, feishuPairing: result.pairing } : current)
        } catch (e) { setError(e.message) }
        finally { setFeishuPairingBusy(false) }
      }
      const clearFeishuPairing = async () => {
        if (feishuPairingBusy || !globalThis.confirm?.('解除当前 Project Hub 项目助手与已绑定飞书单聊的关联？')) return
        setFeishuPairingBusy(true); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'feishu.pair.clear', projectId: activeId }) })
          setProject((current) => current ? { ...current, feishuPairing: result.pairing } : current)
          setFeishuNotice('已解除飞书账号绑定。')
        } catch (e) { setError(e.message) }
        finally { setFeishuPairingBusy(false) }
      }
      const sendFeishuTestMessage = async () => {
        if (feishuPairingBusy) return
        setFeishuPairingBusy(true); setFeishuNotice(''); setError('')
        try {
          await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'feishu.send_test', projectId: activeId }) })
          setFeishuNotice('已向绑定的飞书单聊发送测试消息。')
        } catch (e) { setError(e.message) }
        finally { setFeishuPairingBusy(false) }
      }
      const activateFeishuProject = async () => {
        if (feishuPairingBusy) return
        setFeishuPairingBusy(true); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'feishu.pair.activate', projectId: activeId }) })
          setProject((current) => current ? { ...current, feishuPairing: result.pairing } : current)
          setFeishuNotice(result.pickerUpdated === false ? '已切换当前项目，但飞书选择卡片未能更新；可重新显示卡片重试。' : '已将此项目设为飞书私聊的当前助手。')
        } catch (e) { setError(e.message) }
        finally { setFeishuPairingBusy(false) }
      }
      const refreshFeishuPicker = async () => {
        if (feishuPairingBusy) return
        setFeishuPairingBusy(true); setError('')
        try {
          await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'feishu.picker.refresh', projectId: activeId }) })
          setFeishuNotice('已在飞书私聊发送或更新项目选择卡片；可直接点击项目切换。')
        } catch (e) { setError(e.message) }
        finally { setFeishuPairingBusy(false) }
      }
      const setWeComReplySync = async (event) => {
        const enabled = Boolean(event.target.checked)
        if (wecomPairingBusy) return
        setWecomPairingBusy(true); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'wecom.pair.sync', projectId: activeId, enabled }) })
          setProject((current) => current ? { ...current, wecomPairing: result.pairing } : current)
        } catch (e) { setError(e.message) }
        finally { setWecomPairingBusy(false) }
      }
      const setFeishuMessageSync = async (event) => {
        const enabled = Boolean(event.target.checked)
        if (feishuPairingBusy) return
        setFeishuPairingBusy(true); setError('')
        try {
          const result = await scopedRequest(API, { method: 'POST', cache: 'no-store', body: JSON.stringify({ action: 'feishu.pair.sync', projectId: activeId, enabled }) })
          setProject((current) => current ? { ...current, feishuPairing: result.pairing } : current)
        } catch (e) { setError(e.message) }
        finally { setFeishuPairingBusy(false) }
      }
      const createTask = async (event) => {
        event.preventDefault()
        if (!taskName.trim() || !activeId) return
        try {
          const result = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'task.create', projectId: activeId, title: taskName, ...defaultTaskDates() }) })
          setTaskName(''); setShowTaskInput(false); await applyProject(result.project)
        } catch (e) { setError(e.message) }
      }
      const boardTasks = project?.tasks || []
      const readTaskCsv = async (event) => {
        const input = event.target
        const file = input.files?.[0]
        if (!file) return
        setTaskNotice('')
        setError('')
        try {
          if (file.size > 5 * 1024 * 1024) throw new Error('CSV 文件超过 5 MiB 限制')
          const parsed = parseProjectCsv(await file.text(), new Set(boardTasks.map((task) => task.id)))
          setCsvImportPreview({ fileName: file.name, ...parsed, completedCount: 0 })
        } catch (failure) {
          setCsvImportPreview(null)
          setError(failure.message || String(failure))
        } finally { input.value = '' }
      }
      const importTaskCsv = async () => {
        if (!csvImportPreview?.tasks?.length || csvImporting) return
        if (!globalThis.confirm?.(`将从 ${csvImportPreview.fileName} 新增 ${csvImportPreview.tasks.length} 项任务；已有任务 ID 会跳过。不会修改现有任务。继续导入？`)) return
        setCsvImporting(true); setTaskNotice(''); setError('')
        let latestProject = project
        let completedCount = 0
        let currentTaskTitle = ''
        try {
          for (const task of csvImportPreview.tasks) {
            currentTaskTitle = task.title
            const created = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'task.create', projectId: activeId, title: task.title, start: task.start, due: task.due }) })
            latestProject = created.project
            if (!created.createdTaskId) throw new Error(`创建任务「${task.title}」后未返回任务 ID`)
            const updated = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'task.update', projectId: activeId, taskId: created.createdTaskId, patch: { priority: task.priority, critical: task.critical, progress: task.progress, assignees: task.assignees, body: task.body } }) })
            latestProject = updated.project
            if (task.currentWork) {
              const current = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'task.node.add', projectId: activeId, taskId: created.createdTaskId, kind: 'current', nodeText: task.currentWork }) })
              latestProject = current.project
            }
            if (task.blocker) {
              const blocked = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'task.node.add', projectId: activeId, taskId: created.createdTaskId, kind: 'blocker', nodeText: task.blocker }) })
              latestProject = blocked.project
            }
            const statusResult = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'task.update', projectId: activeId, taskId: created.createdTaskId, patch: { status: task.status } }) })
            latestProject = statusResult.project
            completedCount++
            setCsvImportPreview((current) => current ? { ...current, completedCount } : current)
          }
          setProject(latestProject)
          setCsvImportPreview(null)
          setSelectedTaskIds(new Set())
          setTaskNotice(`已从 CSV 新增 ${completedCount} 项任务`)
        } catch (failure) {
          setProject(latestProject)
          setCsvImportPreview((current) => current ? { ...current, failed: true, completedCount } : current)
          setError(`已完成 ${completedCount} 项；${currentTaskTitle ? `任务「${currentTaskTitle}」可能已部分写入。` : ''}${failure.message || String(failure)} 请刷新核对并处理已创建项，不要直接重试同一文件。`)
        } finally { setCsvImporting(false) }
      }
      const applyBulkStatus = async () => {
        const selectedTasks = boardTasks.filter((task) => selectedTaskIds.has(task.id))
        if (!selectedTasks.length || bulkUpdating) return
        if (!globalThis.confirm?.(`将把选中的 ${selectedTasks.length} 项任务设为「${statusNames[bulkTargetStatus]}」。继续？`)) return
        setBulkUpdating(true); setTaskNotice(''); setError('')
        let latestProject = project
        let completedCount = 0
        try {
          for (const task of selectedTasks) {
            const result = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'task.update', projectId: activeId, taskId: task.id, patch: { status: bulkTargetStatus, ...(bulkTargetStatus === 'done' ? { progress: 100 } : {}) } }) })
            latestProject = result.project
            completedCount++
          }
          setProject(latestProject)
          setSelectedTaskIds(new Set())
          setTaskNotice(`已更新 ${completedCount} 项任务`)
        } catch (failure) {
          setProject(latestProject)
          setError(`已更新 ${completedCount} 项任务，后续更新失败：${failure.message || String(failure)}`)
        } finally { setBulkUpdating(false) }
      }
      const toggleTaskSelection = (taskId) => setSelectedTaskIds((current) => {
        const next = new Set(current)
        if (next.has(taskId)) next.delete(taskId); else next.add(taskId)
        return next
      })
      const filteredTasks = useMemo(() => {
        const query = taskSearch.trim().toLocaleLowerCase()
        const today = localDay(new Date())
        return boardTasks.filter((task) => {
          const searchable = [task.title, task.id, task.currentWork, task.blocker, ...(task.assignees || []).flatMap((person) => [person.name, person.id])].filter(Boolean).join(' ').toLocaleLowerCase()
          if (query && !searchable.includes(query)) return false
          if (dueFilter === 'overdue' && (!task.due || task.due >= today || task.status === 'done')) return false
          if (dueFilter === 'unscheduled' && task.due) return false
          return true
        })
      }, [project, taskSearch, dueFilter])
      const selectedTaskRows = boardTasks.filter((task) => selectedTaskIds.has(task.id))
      const selectFilteredTasks = () => setSelectedTaskIds((current) => new Set([...current, ...filteredTasks.map((task) => task.id)]))
      const grouped = useMemo(() => ({
        todo: filteredTasks.filter((task) => task.status === 'todo'),
        doing: filteredTasks.filter((task) => task.status === 'doing'),
        blocked: filteredTasks.filter((task) => task.status === 'blocked'),
        done: filteredTasks.filter((task) => task.status === 'done')
      }), [filteredTasks])
      const openEditor = (task) => setEditing(task)
      const updateOverviewTask = async (taskId, patch) => {
        try { return await patchTask(taskId, patch) }
        catch (e) { setError(e.message); return null }
      }
      const addTaskNode = async (taskId, kind, nodeText) => {
        const result = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'task.node.add', projectId: activeId, taskId, kind, nodeText }) })
        await applyProject(result.project)
        const updatedTask = result.project.tasks.find((task) => task.id === taskId)
        if (updatedTask) setEditing(updatedTask)
        return updatedTask
      }
      const saveEditor = (patch) => patchTask(editing.id, patch)
      const changeTaskStatus = async (task, status) => {
        if (status === task.status) return
        try { await patchTask(task.id, { status, ...(status === 'done' ? { progress: 100 } : {}) }) }
        catch (e) { setError(e.message) }
      }
      const columns = ['todo', 'doing', 'blocked', 'done']
      const workspaceDirectoryName = String(workspacePath || '').replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || ''
      const isWindowsWorkspacePath = /^[a-z]:[\\/]/i.test(String(workspacePath || '')) || String(workspacePath || '').startsWith('\\\\')
      const isCaseOnlyWorkspaceNameDifference = isWindowsWorkspacePath && workspaceDirectoryName.toLocaleLowerCase() === String(workspaceTitle || '').toLocaleLowerCase()
      const needsWorkspaceNormalization = Boolean(workspaceTitle && workspaceDirectoryName !== workspaceTitle && !isCaseOnlyWorkspaceNameDifference)
      const normalizeCurrentWorkspace = async () => {
        if (!needsWorkspaceNormalization || normalizing || !onPreviewNormalizeWorkspace || !onNormalizeWorkspace) return
        setNormalizing(true); setError('')
        try {
          const preview = await onPreviewNormalizeWorkspace(sessionId, project, workspacePath, workspaceTitle)
          if (preview?.alreadyNormalized) return
          const message = [
            '目录迁移预览',
            `项目：${preview.projectName}`,
            `来源目录：${preview.sourcePath}`,
            `目标目录：${preview.targetPath}`,
            `将迁移 ${preview.taskCount} 项任务和 ${preview.taskNodeCount} 条任务记录，并创建新的 DSH Workspace 和项目助手 Session。`,
            '旧 Workspace 会保留为备份，旧会话历史仍可用但不再绑定。项目 ID、Workspace ID 和助手 Session ID 会变化。',
            '旧目录中的其他文件和 files/ 附件不会自动复制或合并。',
            '是否继续？'
          ].join('\n')
          if (!globalThis.confirm?.(message)) return
          await onNormalizeWorkspace(sessionId, project, workspacePath, workspaceTitle)
        }
        catch (failure) { setError(failure.message || String(failure)) }
        finally { setNormalizing(false) }
      }

      const openAssistantSession = async () => {
        const assistantSessionId = project?.assistantSessionId
        if (!assistantSessionId || !onOpenSession) return
        setError('')
        try { await onOpenSession(assistantSessionId) }
        catch (failure) { setError(`打开项目助手会话失败：${failure?.message || String(failure)}`) }
      }
      const wecomPairing = project?.wecomPairing || { state: 'unbound' }
      const feishuPairing = project?.feishuPairing || { state: 'unbound' }
      const renderIntegrations = () => h('div', { className: 'ph-integrations' },
        h('h2', null, '办公软件集成'),
        h('p', { className: 'ph-muted' }, '点击对应平台卡片展开该平台的连接信息和功能。'),
        h('button', { type: 'button', className: 'ph-btn primary', onClick: () => downloadProjectCsv(project) }, '导出项目表格 CSV（Excel / 飞书表格）'),
        h('button', { type: 'button', className: 'ph-btn', style: { marginLeft: 8 }, onClick: checkRuntimeEnvironment }, '检查运行环境'),
        Array.isArray(project.runtimeDiagnostics) && project.runtimeDiagnostics.length > 0 && h('div', { className: 'ph-notice', role: 'status', style: { marginTop: 8 } }, project.runtimeDiagnostics.map((check) => h('div', { key: check.id, style: { marginTop: 4 } }, `${check.status === 'ok' ? '正常' : check.status === 'optional' ? '未配置（可选）' : '需要处理'} · ${check.label}：${check.detail}`))),
        h('div', { className: 'ph-integration-grid' }, officePlatforms.map((platform) => {
          const selected = activeIntegration === platform.id
          const status = platform.id === 'wecom' ? (project.wecomConnection?.label || platform.status) : platform.id === 'feishu' ? (project.feishuConnection?.label || platform.status) : (platform.status || '尚未接入')
          return h('article', { key: platform.id, className: `ph-integration-card ${selected ? 'active' : ''}` },
            h('h3', null, platform.name),
            h('span', { className: 'ph-integration-status' }, status),
            h('p', null, platform.desc),
            h('span', { className: 'ph-integration-status', title: platform.id === 'wecom' ? '智能机器人 API 模式' : platform.id === 'feishu' ? '飞书官方 Node.js SDK WebSocket 长连接' : '当前尚未接入' }, platform.id === 'wecom' ? 'API 模式长连接' : platform.id === 'feishu' ? '官方 SDK 长连接' : '待接入'),
            h('button', { type: 'button', className: 'ph-btn primary', 'aria-expanded': selected, 'aria-controls': `ph-integration-panel-${platform.id}`, onClick: () => { if (activeIntegration === 'wecom') setWecomCredentialsDraft((current) => ({ ...current, secret: '' })); if (activeIntegration === 'feishu') setFeishuCredentialsDraft((current) => ({ ...current, appSecret: '' })); setActiveIntegration((current) => current === platform.id ? null : platform.id) } }, `${selected ? '收起' : '展开'}${platform.name}连接设置`)
          )
        })),
        activeIntegration === 'wecom' ? h('section', { id: 'ph-integration-panel-wecom', className: 'ph-integration-panel' },
          h('h3', null, '企业微信智能机器人连接'),
          h('form', { className: 'ph-task-create ph-wecom-credentials', onSubmit: saveWeComCredentials },
            h('input', { type: 'text', autoComplete: 'off', required: true, maxLength: 128, value: wecomCredentialsDraft.botId, placeholder: '企业微信 Bot ID', 'aria-label': '企业微信 Bot ID', onChange: (event) => setWecomCredentialsDraft((current) => ({ ...current, botId: event.target.value })) }),
            h('input', { type: 'password', autoComplete: 'new-password', required: true, maxLength: 1024, value: wecomCredentialsDraft.secret, placeholder: '企业微信 Bot Secret', 'aria-label': '企业微信 Bot Secret', onChange: (event) => setWecomCredentialsDraft((current) => ({ ...current, secret: event.target.value })) }),
            h('button', { type: 'submit', className: 'ph-btn primary', disabled: wecomCredentialsSaving || !wecomCredentialsDraft.botId.trim() || !wecomCredentialsDraft.secret.trim() }, wecomCredentialsSaving ? '保存中…' : '保存并连接'),
            project.wecomConnection?.credentialSource === 'system-credential-store' && h('button', { type: 'button', className: 'ph-btn small', disabled: wecomCredentialsSaving, onClick: clearWeComCredentials }, '清除已保存凭证'),
            wecomCredentialsNotice && h('span', { className: 'ph-toolbar-label', role: 'status' }, wecomCredentialsNotice)
          ),
          h('p', { className: 'ph-muted' }, '凭证保存在当前操作系统的系统凭证库中，不写入项目文件、浏览器存储或 API 响应；保存成功后 Secret 输入框会清空。'),
          h('div', { className: 'ph-notice' },
            h('strong', null, `企业微信长连接：${project.wecomConnection?.label || '状态未知'}`),
            h('div', { style: { marginTop: 5 } }, 'API 模式无需公网域名/IP或公网回调。此处保存的凭证写入当前操作系统的系统凭证库，并优先于环境变量；Secret 不会返回页面。也可通过 Host 启动环境设置 WECOM_AIBOT_ID 和 WECOM_AIBOT_SECRET，环境变量变更需重启 Host。不要把 Secret 发到聊天。'),
            h('button', { type: 'button', className: 'ph-btn small', style: { marginTop: 8 }, onClick: refreshWeComStatus }, '刷新连接状态')
          ),
          h('div', { className: 'ph-notice' },
            h('strong', null, `项目助手会话：${project.assistantSessionId || '尚未绑定'}`),
            h('div', { style: { marginTop: 5 } }, '无需手工查找 UserID：点击生成一次性配对码，在企业微信中向机器人发送该码。仅精确匹配的配对码会被处理，不会送入助手；成功后当前 UserID 与项目会话保存在系统凭证库。后续文本单聊会送入助手，收到的文件保存到项目 files/ 目录；在用户明确要求时，助手也可将 files/ 内生成的文件发送到已绑定的企微单聊（单个不超过 20 MiB）。配对码 5 分钟内有效，请勿转发给他人。'),
            wecomPairing.state === 'waiting' && h('p', { role: 'status' }, `请在机器人单聊中发送配对码：${wecomPairing.code}`),
            wecomPairing.state === 'bound' && h('p', { role: 'status' }, `已绑定 UserID：${wecomPairing.userId}。刷新状态后会自动填入单聊测试目标。`),
            wecomPairing.state === 'bound-elsewhere' && h('p', { role: 'status' }, '此工作区已配对企业微信账号，但绑定属于另一个 DSH 会话。为保护 UserID，此处不显示账号或同步设置；请打开原配对会话管理。'),
            wecomPairing.state === 'bound-elsewhere' && wecomPairing.ownerSessionId && h('button', { type: 'button', className: 'ph-btn small', onClick: () => onOpenSession?.(wecomPairing.ownerSessionId) }, '打开已配对的 DSH 会话'),
            wecomPairing.state === 'bound' && h('label', { className: 'ph-muted', style: { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 } },
              h('input', { type: 'checkbox', 'aria-label': '同步对话到企业微信', checked: wecomPairing.syncMessages === true, disabled: wecomPairingBusy, onChange: setWeComReplySync }),
              '开启后，会把 DSH 或飞书来源的用户消息及助手可见答复镜像到企微并标注来源；企微发起的对话只在原聊天回复。关闭则不镜像；DSH 会话始终不加来源标签，后台上下文和推理内容不会转发。'
            ),
            wecomPairing.state === 'bound' && h('p', { className: 'ph-muted', style: { marginTop: 8 } }, '已配对会话会在 DSH Host 运行时自动恢复；收到企微私聊后无需手动打开 DSH 会话窗口。恢复使用 DSH 当前可用的 Agent 配置，不保证还原原会话专属模型、工具或提示配置。'),
            wecomPairing.state === 'error' && h('p', { role: 'alert' }, wecomPairing.label),
            h('button', { type: 'button', className: 'ph-btn small primary', disabled: !project.assistantSessionId || project.wecomConnection?.state !== 'connected' || wecomPairingBusy, onClick: startWeComPairing }, wecomPairingBusy ? '处理中…' : wecomPairing.state === 'bound' ? '重新配对 UserID' : wecomPairing.state === 'bound-elsewhere' ? '迁移绑定到当前会话' : '生成我的单聊配对码'),
            wecomPairing.state === 'bound' && h('button', { type: 'button', className: 'ph-btn small', disabled: wecomPairingBusy, onClick: clearWeComPairing }, '解除 UserID 绑定'),
            h('button', { type: 'button', className: 'ph-btn small', disabled: !project.assistantSessionId, onClick: openAssistantSession }, '打开项目助手会话')
          ),
          h('p', { className: 'ph-muted' },
            '单聊测试目标是企业通讯录成员的 UserID（不是昵称或手机号）。建议使用上方一次性配对自动识别；如需手工查询，请管理员在企业微信管理后台通讯录成员详情中查找，或查看 ',
            h('a', { href: 'https://developer.work.weixin.qq.com/community/question/detail?content_id=16818873074047176659', target: '_blank', rel: 'noopener noreferrer' }, '企业微信官方人员 ID 说明'),
            ' 或 ',
            h('a', { href: 'https://developer.work.weixin.qq.com/document/path/90196', target: '_blank', rel: 'noopener noreferrer' }, '读取成员 API 文档'),
            '。'
          ),
          h('p', { className: 'ph-muted' }, '仅支持单聊 UserID。收件人必须是当前会话已配对用户，或在 Host 的授权名单中；不支持 @all 和群聊 ID。'),
          h('form', { className: 'ph-task-create', onSubmit: sendWeComMessage },
            h('input', { value: wecomDraft.recipient, maxLength: 128, placeholder: '企业微信 UserID（单聊）', 'aria-label': '企业微信接收目标', onChange: (event) => setWecomDraft((current) => ({ ...current, recipient: event.target.value })) }),
            h('textarea', { value: wecomDraft.text, maxLength: 2048, placeholder: '输入要发送的 Markdown 文本…', 'aria-label': '企业微信消息内容', onChange: (event) => setWecomDraft((current) => ({ ...current, text: event.target.value })) }),
            h('button', { type: 'submit', className: 'ph-btn primary', disabled: Boolean(wecomSendDisabledReason) || wecomSending }, wecomSending ? '正在发送…' : '发送单聊测试消息'),
            !wecomSending && wecomSendDisabledReason && h('span', { className: 'ph-toolbar-label', role: 'status' }, wecomSendDisabledReason),
            wecomNotice && h('span', { className: 'ph-toolbar-label', role: 'status' }, wecomNotice)
          )
        ) : activeIntegration === 'feishu' ? h('section', { id: 'ph-integration-panel-feishu', className: 'ph-integration-panel' },
          h('h3', null, '飞书官方长连接'),
          h('form', { className: 'ph-task-create ph-feishu-credentials', onSubmit: saveFeishuCredentials },
            h('input', { type: 'text', autoComplete: 'off', required: true, maxLength: 128, value: feishuCredentialsDraft.appId, placeholder: '飞书 App ID', 'aria-label': '飞书 App ID', onChange: (event) => setFeishuCredentialsDraft((current) => ({ ...current, appId: event.target.value })) }),
            h('input', { type: 'password', autoComplete: 'new-password', required: true, maxLength: 1024, value: feishuCredentialsDraft.appSecret, placeholder: '飞书 App Secret', 'aria-label': '飞书 App Secret', onChange: (event) => setFeishuCredentialsDraft((current) => ({ ...current, appSecret: event.target.value })) }),
            h('input', { type: 'text', autoComplete: 'off', maxLength: 128, value: feishuCredentialsDraft.tenantKey, placeholder: 'Tenant Key（可选，固定租户）', 'aria-label': '飞书 Tenant Key（可选）', onChange: (event) => setFeishuCredentialsDraft((current) => ({ ...current, tenantKey: event.target.value })) }),
            h('button', { type: 'submit', className: 'ph-btn primary', disabled: feishuCredentialsSaving || !feishuCredentialsDraft.appId.trim() || !feishuCredentialsDraft.appSecret.trim() }, feishuCredentialsSaving ? '保存中…' : '保存并连接'),
            project.feishuConnection?.credentialSource === 'system-credential-store' && h('button', { type: 'button', className: 'ph-btn small', disabled: feishuCredentialsSaving, onClick: clearFeishuCredentials }, '清除已保存凭证'),
            feishuCredentialsNotice && h('span', { className: 'ph-toolbar-label', role: 'status' }, feishuCredentialsNotice)
          ),
          h('p', { className: 'ph-muted' }, 'App Secret 只保存在 Host 当前操作系统的系统凭证库，不写入项目文件、浏览器存储或 API 响应；保存后输入框会清空。Tenant Key 可选；留空时由首次成功配对固定租户。也可通过 Host 环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET 配置。不要把 Secret 发到聊天。'),
          h('div', { className: 'ph-notice' },
            h('strong', null, `飞书长连接：${project.feishuConnection?.label || '状态未知'}`),
            h('div', { style: { marginTop: 5 } }, 'Host 使用飞书官方 Node.js SDK 建立 WebSocket 长连接，无需公网回调。开放平台需启用机器人能力、订阅 im.message.receive_v1 和卡片按钮回调 card.action.trigger、申请并审批 im:message.p2p_msg:readonly（读取单聊消息）及 im:message:send_as_bot（发送文本和文件），并发布应用版本后配置才生效。'),
            h('div', { className: 'ph-muted', role: 'status', style: { marginTop: 5 } }, (() => { const d = project.feishuConnection?.inboundDiagnostics; return d ? `入站诊断（不记录消息内容）：已收 ${d.receivedCount} 条；最近 ${d.lastAt ? new Date(d.lastAt).toLocaleString() : '暂无'}；类型 ${d.lastType || '—'}；结果 ${d.lastOutcome || '—'}；SDK 拒绝 ${d.rejectedCount || 0}（${d.lastRejectReason || '—'}）；分发错误 ${d.dispatcherErrorCount || 0}（${d.lastDispatcherErrorCode || '—'}）` : '入站诊断需更新并重启 Host 后显示' })()),
            h('div', { className: 'ph-muted', role: 'status', style: { marginTop: 5 } }, (() => { const d = project.feishuConnection?.replyDiagnostics; return d ? `助手回传诊断：已发送 ${d.sentCount} 次；失败 ${d.failedCount} 次；待处理 ${d.pendingCount}；待人工核对 ${d.uncertainCount || 0}；最近结果 ${d.lastOutcome || '—'}${d.lastErrorCode ? `（${d.lastErrorCode}）` : ''}` : '助手回传诊断需更新并重启 Host 后显示' })()),
            h('button', { type: 'button', className: 'ph-btn small', style: { marginTop: 8 }, onClick: refreshFeishuStatus }, '刷新连接状态')
          ),
          h('div', { className: 'ph-notice' },
            h('strong', null, `项目助手会话：${project.assistantSessionId || '尚未绑定'}`),
            h('div', { style: { marginTop: 5 } }, '同一个飞书私聊可通过不同项目的一次性配对码授权多个 DSH 项目助手；每条私聊仅限配对用户使用。绑定后不会主动推送项目选择卡片；需要切换时发送 /切换会话 或 /项目列表 主动显示/更新卡片，也可发送 /切换 <序号> 直接切换。卡片会显示当前项目。文本送入当前助手；收到的文件保存到该项目 files/ 目录；用户明确要求时，助手也可将 files/ 内生成的文件发送到已绑定飞书私聊（单个不超过 20 MiB）。群聊、历史消息、文档和表格读取暂不开放；配对码 5 分钟有效，请勿转发。'),
            feishuPairing.state === 'waiting' && h('p', { role: 'status' }, `请在飞书机器人私聊中发送配对码：${feishuPairing.code}`),
            feishuPairing.state === 'bound' && h('p', { role: 'status' }, `已绑定飞书私聊：${feishuPairing.active ? '当前选中此项目' : '当前选中其他项目'}；飞书记录共用一个私聊窗口。`),
            feishuPairing.state === 'bound' && h('label', { className: 'ph-muted', style: { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 } },
              h('input', { type: 'checkbox', 'aria-label': '同步对话到飞书', checked: feishuPairing.syncMessages === true, disabled: feishuPairingBusy, onChange: setFeishuMessageSync }),
              '开启后，会把 DSH 或企微来源的用户消息及助手可见答复镜像到飞书并标注来源；飞书发起的对话只在原聊天回复。关闭则不镜像；DSH 会话始终不加来源标签，后台上下文和推理内容不会转发。'
            ),
            feishuPairing.state === 'bound' && h('p', { className: 'ph-muted', style: { marginTop: 8 } }, '已配对会话会在 DSH Host 运行时自动恢复；收到飞书私聊后无需手动打开 DSH 会话窗口。恢复使用 DSH 当前可用的 Agent 配置，不保证还原原会话专属模型、工具或提示配置。'),
            feishuPairing.state === 'bound-elsewhere' && h('p', { role: 'status' }, '此工作区已绑定飞书单聊，绑定归属于另一个 DSH 会话；账号信息不会在此显示。'),
            feishuPairing.state === 'bound-elsewhere' && feishuPairing.ownerSessionId && h('button', { type: 'button', className: 'ph-btn small', onClick: () => onOpenSession?.(feishuPairing.ownerSessionId) }, '打开已配对的 DSH 会话'),
            feishuPairing.state === 'error' && h('p', { role: 'alert' }, feishuPairing.label),
            h('button', { type: 'button', className: 'ph-btn small primary', disabled: !project.assistantSessionId || sessionId !== project.assistantSessionId || project.feishuConnection?.state !== 'connected' || feishuPairingBusy, onClick: startFeishuPairing }, feishuPairingBusy ? '处理中…' : feishuPairing.state === 'bound' ? '重新配对飞书账号' : feishuPairing.state === 'bound-elsewhere' ? '重新生成配对码' : '生成单聊配对码'),
            feishuPairing.state === 'bound' && !feishuPairing.active && h('button', { type: 'button', className: 'ph-btn small', disabled: feishuPairingBusy, onClick: activateFeishuProject }, '设为飞书当前项目'),
            feishuPairing.state === 'bound' && h('button', { type: 'button', className: 'ph-btn small', disabled: feishuPairingBusy, onClick: refreshFeishuPicker }, '在飞书显示项目选择卡片'),
            feishuPairing.state === 'bound' && h('button', { type: 'button', className: 'ph-btn small', disabled: feishuPairingBusy, onClick: sendFeishuTestMessage }, feishuPairingBusy ? '发送中…' : '发送飞书测试消息'),
            feishuPairing.state === 'bound' && h('button', { type: 'button', className: 'ph-btn small', disabled: feishuPairingBusy, onClick: clearFeishuPairing }, '解除飞书绑定'),
            feishuNotice && h('p', { role: 'status' }, feishuNotice),
            h('button', { type: 'button', className: 'ph-btn small', style: { marginTop: 8 }, disabled: !project.assistantSessionId, onClick: openAssistantSession }, '打开项目助手会话')
          )
        ) : activeIntegration === 'wechat' ? h('section', { id: 'ph-integration-panel-wechat', className: 'ph-integration-panel' },
          h('h3', null, '微信连接'), h('div', { className: 'ph-notice' }, '微信连接能力尚未实现；此模块暂用于后续评估入口。')
        ) : h('div', { className: 'ph-empty-note' }, '选择上方平台模块以查看对应连接信息。')
      )

      return h('div', { className: 'ph-root' },
        h('main', { className: 'ph-main' }, project ? h(React.Fragment, null,
          h('header', { className: 'ph-top' }, h('div', { className: 'ph-title-row' }, h('div', null, h('h1', { className: 'ph-title' }, project.name), h('div', { className: 'ph-path' }, project.path === '.' ? 'Workspace 根目录' : project.path)), h('span', { className: 'ph-badge' }, `${project.tasks.filter((task) => task.status === 'done').length}/${project.tasks.length} 完成`), h('span', { className: 'ph-badge' }, `${project.progress}%`), needsWorkspaceNormalization && h('button', { className: 'ph-btn small', disabled: normalizing, onClick: normalizeCurrentWorkspace }, normalizing ? '迁移中…' : '迁移项目目录')),
            h('nav', { className: 'ph-tabs' }, [['overview', '概览'], ['tasks', '任务'], ['gantt', '甘特'], ['files', '项目文件'], ['integrations', '办公集成']].map(([key, label]) => h('button', { key, type: 'button', 'aria-pressed': tab === key, className: `ph-tab ${tab === key ? 'active' : ''}`, onClick: () => setTab(key) }, label)))),
          error && h('div', { className: 'ph-error', role: 'alert' }, error),
          (project.path !== '.' || !project.workspaceId || !project.assistantSessionId) && h('div', { className: 'ph-warning', role: 'status' }, h('span', null, '该项目尚未完整绑定到当前 Workspace 根目录。打开面板不会自动迁移；确认后可迁移/修复项目资料，旧来源文件将保留。'), h('button', { type: 'button', className: 'ph-btn small primary', disabled: initializing || !workspaceId, onClick: initializeCurrentWorkspace }, initializing ? '处理中…' : '迁移/修复项目资料')),
          h('div', { className: 'ph-toolbar' }, tab === 'tasks' && h('button', { className: 'ph-btn primary', onClick: () => setShowTaskInput((v) => !v) }, '+ 新建任务'), tab === 'tasks' && h('label', { className: 'ph-btn ph-file-picker', title: '从 Project Hub 导出的 CSV 添加任务' }, '导入 CSV', h('input', { className: 'ph-file-input', type: 'file', accept: '.csv,text/csv', 'aria-label': '选择任务 CSV', onChange: readTaskCsv })), tab === 'gantt' && h('span', { className: 'ph-toolbar-label' }, '自动适配项目周期 · 可拖动任务条改日期 · 允许并行交叉'), tab === 'files' && h('span', { className: 'ph-toolbar-label' }, '选择项目文件后可作为附件发送给项目助手'), h('span', { className: 'ph-spacer' }), tab !== 'files' && h('span', { className: 'ph-toolbar-label' }, `${tab === 'tasks' ? boardTasks.length : project.tasks.length} 个任务`)),
          h('section', { className: 'ph-content' },
            tab === 'overview' ? h(ProjectOverview, { project, onUpdate: updateProject, onError: setError, onPatchTask: updateOverviewTask, onEditTask: openEditor }) : null,
            tab === 'integrations' ? renderIntegrations() : null,
            tab === 'files' ? h(ProjectFilesView, { sessionId, project, workspacePath, scopedRequest, onSendFiles, onEnsureFiles, onError: setError }) : null,
             tab === 'tasks' ? h(React.Fragment, null,
              showTaskInput && h('form', { className: 'ph-task-create', onSubmit: createTask }, h('input', { autoFocus: true, placeholder: '输入任务名称', value: taskName, onChange: (e) => setTaskName(e.target.value) }), h('button', { className: 'ph-btn primary' }, '创建'), h('button', { type: 'button', className: 'ph-btn', onClick: () => setShowTaskInput(false) }, '取消')),
              h('div', { className: 'ph-task-tools' },
                h('input', { className: 'ph-task-search', type: 'search', placeholder: '搜索名称、负责人、事项…', 'aria-label': '搜索任务', value: taskSearch, onChange: (event) => setTaskSearch(event.target.value) }),
                h('select', { className: 'ph-select-status', 'aria-label': '按截止日期筛选', value: dueFilter, onChange: (event) => setDueFilter(event.target.value) }, h('option', { value: 'all' }, '所有任务'), h('option', { value: 'overdue' }, '已逾期'), h('option', { value: 'unscheduled' }, '未排期')),
                h('span', { className: 'ph-toolbar-label' }, `${filteredTasks.length} / ${boardTasks.length} 项`),
                h('button', { type: 'button', className: 'ph-btn small', onClick: selectFilteredTasks, disabled: !filteredTasks.length }, '选择筛选结果'),
                h('button', { type: 'button', className: 'ph-btn small', onClick: () => setSelectedTaskIds(new Set()), disabled: !selectedTaskRows.length }, '清除选择'),
                h('span', { className: 'ph-toolbar-label' }, `已选 ${selectedTaskRows.length} 项（当前筛选中 ${filteredTasks.filter((task) => selectedTaskIds.has(task.id)).length} 项）`),
                h('select', { className: 'ph-select-status', 'aria-label': '批量设置任务状态', value: bulkTargetStatus, onChange: (event) => setBulkTargetStatus(event.target.value) }, Object.entries(statusNames).map(([key, label]) => h('option', { key, value: key }, label))),
                h('button', { type: 'button', className: 'ph-btn small primary', onClick: applyBulkStatus, disabled: !selectedTaskRows.length || bulkUpdating }, bulkUpdating ? '正在更新…' : '批量改状态')),
              taskNotice && h('div', { className: 'ph-inline-notice', role: 'status' }, taskNotice),
              csvImportPreview && h('section', { className: 'ph-csv-preview', 'aria-label': 'CSV 导入预览' },
                h('strong', null, `导入预览：${csvImportPreview.fileName}`),
                h('p', { className: 'ph-muted' }, `将新增 ${csvImportPreview.tasks.length} 项；跳过 ${csvImportPreview.skippedExisting} 个已有任务 ID、${csvImportPreview.skippedDuplicateIds} 个重复 ID。${csvImportPreview.historyRows ? `有 ${csvImportPreview.historyRows} 行包含历史节点记录，这些记录不会重建；只会导入当前事项和阻塞卡点。` : ''}`),
                csvImportPreview.tasks.length > 0 && h('ul', null, csvImportPreview.tasks.slice(0, 5).map((task, index) => h('li', { key: `${task.sourceTaskId || task.title}-${index}` }, `${task.title} · ${statusNames[task.status]} · ${priorityNames[task.priority]} · ${labelDate(task.start)} 至 ${labelDate(task.due)}`)), csvImportPreview.tasks.length > 5 && h('li', null, `另有 ${csvImportPreview.tasks.length - 5} 项…`)),
                csvImportPreview.failed && h('p', { role: 'alert' }, '导入遇到错误，部分任务可能已写入。请刷新核对并处理已创建项后再导入同一文件，避免产生重复任务。'),
                h('div', { className: 'ph-task-tools' }, h('button', { type: 'button', className: 'ph-btn primary', onClick: importTaskCsv, disabled: !csvImportPreview.tasks.length || csvImportPreview.failed || csvImporting }, csvImporting ? `正在导入 ${csvImportPreview.completedCount}/${csvImportPreview.tasks.length}…` : `新增 ${csvImportPreview.tasks.length} 项`), !csvImporting && h('button', { type: 'button', className: 'ph-btn', onClick: () => setCsvImportPreview(null) }, '取消'))),
              filteredTasks.length === 0 && h('div', { className: 'ph-empty-note' }, boardTasks.length ? '没有符合条件的任务，试试更改搜索词或筛选条件。' : '还没有任务，点击“新建任务”或导入 CSV。'),
              h('div', { className: 'ph-board' }, columns.map((status) => h('section', { key: status, className: 'ph-column', onDragOver: (e) => e.preventDefault(), onDrop: async (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/task'); if (id) { const task = project.tasks.find((row) => row.id === id); if (task && task.status !== status) try { await patchTask(id, { status, ...(status === 'done' ? { progress: 100 } : {}) }) } catch (err) { setError(err.message) } } } }, h('h3', null, h('span', null, statusNames[status]), h('span', { className: 'ph-badge' }, grouped[status].length)), grouped[status].map((task) => h('article', { key: task.id, className: 'ph-task-card', draggable: true, onDragStart: (e) => e.dataTransfer.setData('text/task', task.id), onClick: () => openEditor(task) }, h('label', { className: 'ph-task-select', onClick: (event) => event.stopPropagation() }, h('input', { type: 'checkbox', checked: selectedTaskIds.has(task.id), 'aria-label': `选择任务：${task.title}`, onChange: () => toggleTaskSelection(task.id) }), '选择'), h('div', { className: 'ph-task-id' }, task.id), h('div', { className: 'ph-task-title' }, task.title), h('div', { className: 'ph-meta' }, h('span', null, task.assignees.length ? `${task.assignees.length} 位负责人` : '未指派'), task.due && h('span', null, `截止 ${labelDate(task.due)}`)), task.status === 'blocked' && h('div', { className: 'ph-task-node-preview blocker' }, task.blocker || '尚未记录阻塞卡点'), task.status === 'doing' && task.currentWork && h('div', { className: 'ph-task-node-preview current' }, task.currentWork), h('div', { className: 'ph-progress' }, h('i', { style: { width: `${task.progress}%` } })), h('div', { className: 'ph-meta', style: { justifyContent: 'space-between', marginTop: 5 } }, h('span', null, `${task.progress}%`), h('select', { className: 'ph-select-status ph-status-edit', value: task.status, 'aria-label': `更改任务状态：${task.title}`, onClick: (e) => e.stopPropagation(), onChange: (e) => { e.stopPropagation(); changeTaskStatus(task, e.target.value) } }, Object.entries(statusNames).map(([key, label]) => h('option', { key, value: key }, label))))))))))
              : null,
            tab === 'gantt' ? h(Gantt, { project, onEdit: openEditor, onPatch: patchTask, onError: setError }) : null),
          editing && h(TaskEditor, { task: editing, onClose: () => setEditing(null), onSave: saveEditor, onAddNode: addTaskNode, onError: setError }))
          : h('div', { className: 'ph-empty', style: { margin: 'auto' } }, loading ? '正在读取项目…' : h(React.Fragment, null, h('h2', null, '当前工作区尚未初始化为项目'), h('p', null, '只有点击下方按钮后，Project Hub 才会在当前 Workspace 创建项目资料；不会自动创建 DSH 会话。'), h('button', { type: 'button', className: 'ph-btn primary', disabled: initializing || !workspaceId, onClick: initializeCurrentWorkspace }, initializing ? '初始化中…' : '初始化当前 Workspace 项目')))))
    }

    return { ProjectManagementView, Panel }
  }
})
