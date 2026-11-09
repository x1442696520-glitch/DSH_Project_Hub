window.__ModuleLoader__.load({
  id: 'dsh-project-hub/client/components',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const shared = require('dsh-project-hub/client/shared')
    const { PANEL_ID, API, STYLE_ID, statusNames, statusClasses, statusColors, taskNodeNames, priorityNames, officePlatforms, css, ensureStyles, request, dateObj, isoDay, localDay, defaultTaskDates, dayNumber, fromDayNumber, shiftDate, labelDate, csvCell, buildProjectCsv, downloadProjectCsv } = shared

    function Icon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, h('rect', { x: 2, y: 2, width: 5, height: 5, rx: 1, fill: 'currentColor' }), h('rect', { x: 9, y: 2, width: 5, height: 5, rx: 1, fill: 'currentColor' }), h('rect', { x: 2, y: 9, width: 5, height: 5, rx: 1, fill: 'currentColor' }), h('rect', { x: 9, y: 9, width: 5, height: 5, rx: 1, fill: 'currentColor' }))
    }

    function TaskEditor({ task, onClose, onSave, onAddNode, onError }) {
      const [draft, setDraft] = useState(() => ({ ...task, assignees: task.assignees.map((person) => ({ ...person })) }))
      const [saving, setSaving] = useState(false)
      const [assigneeName, setAssigneeName] = useState('')
      const [nodeKind, setNodeKind] = useState('completed')
      const [nodeText, setNodeText] = useState('')
      const [nodeSaving, setNodeSaving] = useState(false)
      useEffect(() => setDraft((current) => ({ ...current, status: task.status, progress: task.progress, nodes: task.nodes, currentWork: task.currentWork, blocker: task.blocker })), [task])
      const mutate = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
      const updateAssignee = (index, changes) => setDraft((current) => ({ ...current, assignees: current.assignees.map((person, i) => i === index ? { ...person, ...changes } : person) }))
      const addAssignee = () => {
        const name = assigneeName.trim().slice(0, 80)
        if (!name) return
        const id = `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
        mutate('assignees', [...draft.assignees, { id, name }])
        setAssigneeName('')
      }
      const save = async () => {
        setSaving(true)
        try {
          await onSave({ title: draft.title, status: draft.status, priority: draft.priority, start: draft.start, due: draft.due, progress: Number(draft.progress), critical: Boolean(draft.critical), assignees: draft.assignees, body: draft.body })
          onClose()
        } catch (error) { onError(error.message) } finally { setSaving(false) }
      }
      const addNode = async (event) => {
        event.preventDefault()
        if (!nodeText.trim() || nodeSaving) return
        setNodeSaving(true)
        try { await onAddNode(task.id, nodeKind, nodeText.trim()); setNodeText('') }
        catch (error) { onError(error.message) }
        finally { setNodeSaving(false) }
      }
      const nodeTime = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString() }
      return h('div', { className: 'ph-overlay', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } }, h('section', { className: 'ph-drawer', role: 'dialog', 'aria-modal': true, 'aria-label': '任务详情' },
        h('header', { className: 'ph-drawer-head' }, h('div', null, h('div', { className: 'ph-task-id' }, task.id), h('strong', null, '任务详情')), h('button', { className: 'ph-btn small', onClick: onClose, 'aria-label': '关闭' }, '×')),
        h('div', { className: 'ph-drawer-body' },
          h('div', { className: 'ph-field' }, h('label', null, '任务名称'), h('input', { value: draft.title, maxLength: 200, onChange: (e) => mutate('title', e.target.value) })),
          h('div', { className: 'ph-grid2' },
            h('div', { className: 'ph-field' }, h('label', null, '状态'), h('select', { value: draft.status, onChange: (e) => mutate('status', e.target.value) }, Object.entries(statusNames).map(([key, label]) => h('option', { key, value: key }, label)))),
            h('div', { className: 'ph-field' }, h('label', null, '优先级'), h('select', { value: draft.priority, onChange: (e) => mutate('priority', e.target.value) }, Object.entries(priorityNames).map(([key, label]) => h('option', { key, value: key }, label))))),
          h('div', { className: 'ph-grid2' },
            h('div', { className: 'ph-field' }, h('label', null, '开始日期'), h('input', { type: 'date', value: draft.start || '', onChange: (e) => mutate('start', e.target.value) })),
            h('div', { className: 'ph-field' }, h('label', null, '截止日期'), h('input', { type: 'date', value: draft.due || '', onChange: (e) => mutate('due', e.target.value) }))),
          h('div', { className: 'ph-field' }, h('label', null, `任务进度：${draft.progress}%`), h('input', { type: 'range', min: 0, max: 100, value: draft.progress, onChange: (e) => mutate('progress', Number(e.target.value)) })),
          h('div', { className: 'ph-field' }, h('label', { className: 'ph-critical-label' }, h('input', { type: 'checkbox', checked: Boolean(draft.critical), onChange: (e) => mutate('critical', e.target.checked) }), '手动标记为关键任务')),
          h('section', { className: 'ph-task-nodes' },
            h('h3', null, '任务节点记录'),
            task.currentWork && h('div', { className: 'ph-node-callout current' }, h('strong', null, '当前事项'), h('span', null, task.currentWork)),
            task.status === 'blocked' && h('div', { className: 'ph-node-callout blocker' }, h('strong', null, '阻塞卡点'), h('span', null, task.blocker || '尚未记录卡点')),
            h('form', { className: 'ph-node-form', onSubmit: addNode },
              h('select', { value: nodeKind, 'aria-label': '节点类型', onChange: (event) => setNodeKind(event.target.value) }, Object.entries(taskNodeNames).map(([key, label]) => h('option', { key, value: key }, label))),
              h('textarea', { value: nodeText, maxLength: 2000, placeholder: nodeKind === 'completed' ? '记录完成了什么（时间由系统自动记录）' : nodeKind === 'current' ? '记录正在处理的具体事项' : '记录阻塞原因或需要谁/什么协助', 'aria-label': '节点内容', onChange: (event) => setNodeText(event.target.value) }),
              h('button', { type: 'submit', className: 'ph-btn small primary', disabled: nodeSaving || !nodeText.trim() }, nodeSaving ? '记录中…' : nodeKind === 'blocker' ? '记录卡点并标记阻塞' : '添加节点')),
            task.nodes?.length ? h('div', { className: 'ph-node-list' }, [...task.nodes].reverse().map((node) => h('article', { className: `ph-node ${node.kind}`, key: node.id }, h('div', { className: 'ph-node-head' }, h('strong', null, `${taskNodeNames[node.kind] || node.kind}${node.kind !== 'completed' && !node.active ? ' · 历史' : ''}`), h('time', { dateTime: node.at }, nodeTime(node.at))), h('div', { className: 'ph-node-text' }, node.text), node.resolvedAt && h('div', { className: 'ph-node-resolved' }, `解除/替换于 ${nodeTime(node.resolvedAt)}`)))) : h('div', { className: 'ph-empty-note' }, '尚无节点记录；可记录已完成事项、当前处理事项或阻塞卡点。')),
          h('div', { className: 'ph-field' }, h('label', null, '负责人（可多人；默认不设主责）'),
            draft.assignees.length ? draft.assignees.map((person, index) => h('div', { className: 'ph-assignee', key: `${person.id}-${index}` },
              h('span', { className: 'ph-assignee-name' }, person.name || person.id),
              h('select', { value: person.role === 'owner' ? 'owner' : '', onChange: (e) => updateAssignee(index, e.target.value === 'owner' ? { role: 'owner' } : { role: undefined }) }, h('option', { value: '' }, '普通负责人'), h('option', { value: 'owner' }, '主责')),
              h('button', { type: 'button', className: 'ph-btn small', onClick: () => mutate('assignees', draft.assignees.filter((_, i) => i !== index)) }, '移除'))) : h('div', { className: 'ph-muted' }, '暂未指定负责人'),
            h('div', { className: 'ph-add-row' }, h('div', { className: 'ph-add-assignee' }, h('input', { value: assigneeName, maxLength: 80, placeholder: '输入姓名或成员名', 'aria-label': '负责人姓名', onChange: (e) => setAssigneeName(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addAssignee() } } }), h('button', { type: 'button', className: 'ph-btn small primary', disabled: !assigneeName.trim(), onClick: addAssignee }, '添加')))),
          h('div', { className: 'ph-field' }, h('label', null, '任务描述 / 验收标准'), h('textarea', { value: draft.body || '', onChange: (e) => mutate('body', e.target.value) }))),
        h('footer', { className: 'ph-drawer-foot' }, h('button', { className: 'ph-btn', onClick: onClose }, '取消'), h('button', { className: 'ph-btn primary', disabled: saving, onClick: save }, saving ? '保存中…' : '保存'))))
    }

    function ProjectOverview({ project, onUpdate, onError, onPatchTask, onEditTask }) {
      const [editing, setEditing] = useState(false)
      const [editingDates, setEditingDates] = useState(false)
      const [saving, setSaving] = useState(false)
      const [dateSaving, setDateSaving] = useState(false)
      const [criticalPicker, setCriticalPicker] = useState(false)
      const [draft, setDraft] = useState(() => ({ name: project.name, description: project.description || '', startDate: project.startDate || '', dueDate: project.dueDate || '' }))
      useEffect(() => setDraft({ name: project.name, description: project.description || '', startDate: project.startDate || '', dueDate: project.dueDate || '' }), [project.id, project.updatedAt])
      const tasks = project.tasks || []
      const descriptionSummary = (project.description || '').replace(/^\s*#\s+.*(?:\r?\n|$)/, '').trim()
      const description = descriptionSummary === '项目目标与范围可在这里补充。' ? '' : descriptionSummary
      const total = tasks.length
      const done = tasks.filter((task) => task.status === 'done').length
      const doing = tasks.filter((task) => task.status === 'doing').length
      const blocked = tasks.filter((task) => task.status === 'blocked')
      const today = localDay(new Date())
      const overdue = tasks.filter((task) => task.status !== 'done' && task.due && task.due < today)
      const risks = [...new Map([...blocked, ...overdue].map((task) => [task.id, task])).values()]
      const statusCounts = Object.fromEntries(Object.keys(statusNames).map((status) => [status, tasks.filter((task) => task.status === status).length]))
      const activeTasks = tasks.filter((task) => task.status === 'doing' || task.status === 'blocked')
      const criticalTasks = tasks.filter((task) => task.critical)
      const allStarts = tasks.map((task) => task.start).filter(Boolean).sort()
      const allDues = tasks.map((task) => task.due).filter(Boolean).sort()
      const startDate = project.startDate || allStarts[0] || ''
      const dueDate = project.dueDate || allDues.at(-1) || ''
      const span = startDate && dueDate ? `${labelDate(startDate)} — ${labelDate(dueDate)}` : '尚未设置项目周期'
      const feasibility = risks.length ? { label: '需要关注', cls: 'danger' } : total ? { label: '当前无阻塞', cls: 'good' } : { label: '待补充计划', cls: 'warn' }
      const change = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
      const save = async () => {
        setSaving(true)
        try {
          await onUpdate({ ...draft })
          setEditing(false)
        } catch (error) { onError?.(error.message) } finally { setSaving(false) }
      }
      const saveDates = async () => {
        if (draft.startDate && draft.dueDate && draft.dueDate < draft.startDate) {
          onError?.('项目截止日期不能早于开始日期')
          return
        }
        setDateSaving(true)
        try {
          await onUpdate({ startDate: draft.startDate, dueDate: draft.dueDate })
          setEditingDates(false)
        } catch (error) { onError?.(error.message) } finally { setDateSaving(false) }
      }
      const toggleDateEditor = () => {
        if (!editingDates) setDraft((current) => ({ ...current, startDate: project.startDate || allStarts[0] || '', dueDate: project.dueDate || allDues.at(-1) || '' }))
        setEditingDates((value) => !value)
      }
      return h('div', { className: 'ph-overview' },
        h('div', { className: 'ph-overview-hero' }, h('div', null,
          h('h2', null, project.name),
          h('div', { className: 'ph-overview-description' }, description || '还没有项目简介。补充目标、范围与交付物，让概览更有上下文。'),
          h('div', { className: 'ph-updated' }, `最近更新：${project.updatedAt ? new Date(project.updatedAt).toLocaleString() : '暂无'}`)),
          h('button', { className: 'ph-btn small', onClick: () => setEditing((value) => !value) }, editing ? '收起编辑' : '编辑项目')),
        editing && h('div', { className: 'ph-overview-card' }, h('h3', null, '项目摘要与计划'),
          h('div', { className: 'ph-inline-form' },
            h('div', { className: 'ph-field' }, h('label', null, '项目名称'), h('input', { value: draft.name, onChange: (e) => change('name', e.target.value) })),
            h('div', { className: 'ph-field' }, h('label', null, '项目开始日期'), h('input', { type: 'date', value: draft.startDate, onChange: (e) => change('startDate', e.target.value) })),
            h('div', { className: 'ph-field' }, h('label', null, '目标截止日期'), h('input', { type: 'date', value: draft.dueDate, onChange: (e) => change('dueDate', e.target.value) })),
            h('div', { className: 'ph-field wide' }, h('label', null, '项目简介 / 目标 / 交付物'), h('textarea', { value: draft.description, onChange: (e) => change('description', e.target.value) }))),
          h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } }, h('button', { className: 'ph-btn', onClick: () => setEditing(false) }, '取消'), h('button', { className: 'ph-btn primary', disabled: saving, onClick: save }, saving ? '保存中…' : '保存项目摘要'))),
        h('div', { className: 'ph-overview-stats' },
          h('div', { className: 'ph-stat' }, h('div', { className: 'ph-stat-label' }, '总体进度'), h('div', { className: 'ph-stat-value' }, `${project.progress}%`), h('div', { className: 'ph-progress' }, h('i', { style: { width: `${project.progress}%` } }))),
          h('div', { className: 'ph-stat' }, h('div', { className: 'ph-stat-label' }, '任务数量'), h('div', { className: 'ph-stat-value' }, total), h('div', { className: 'ph-stat-note' }, `${done} 完成 · ${doing} 进行中`)),
          h('div', { className: 'ph-stat' }, h('div', { className: 'ph-stat-label' }, '项目周期'), h('div', { className: 'ph-stat-value', style: { fontSize: 15 } }, span), h('div', { className: 'ph-stat-note' }, `${tasks.filter((task) => task.start && task.due).length} 个任务已排期`)),
          h('div', { className: 'ph-stat' }, h('div', { className: 'ph-stat-label' }, '计划状态'), h('div', { className: `ph-stat-value ph-chip ${feasibility.cls}`, style: { fontSize: 13 } }, feasibility.label), h('div', { className: 'ph-stat-note' }, '依据阻塞与逾期任务统计')),
          h('div', { className: 'ph-stat' }, h('div', { className: 'ph-stat-label' }, '待处理关注项'), h('div', { className: 'ph-stat-value' }, risks.length), h('div', { className: 'ph-stat-note' }, `${blocked.length} 阻塞 · ${overdue.length} 逾期`))),
        h('div', { className: 'ph-overview-card' }, h('div', { className: 'ph-overview-card-head' }, h('h3', null, '整体进度与日期范围'), h('button', { type: 'button', className: 'ph-btn small', onClick: toggleDateEditor }, editingDates ? '收起日期' : '编辑日期')),
          h('div', { className: 'ph-timeline' }, h('span', { className: 'ph-toolbar-label' }, startDate ? labelDate(startDate) : '开始未定'), h('div', { className: 'ph-timeline-track' }, h('i', { style: { width: `${project.progress}%` } })), h('span', { className: 'ph-toolbar-label' }, dueDate ? labelDate(dueDate) : '截止未定')),
          editingDates && h('div', { className: 'ph-inline-form' },
            h('div', { className: 'ph-field' }, h('label', { htmlFor: 'ph-project-start-date' }, '项目开始日期'), h('input', { id: 'ph-project-start-date', type: 'date', max: draft.dueDate || undefined, value: draft.startDate, onChange: (event) => change('startDate', event.target.value) })),
            h('div', { className: 'ph-field' }, h('label', { htmlFor: 'ph-project-due-date' }, '目标截止日期'), h('input', { id: 'ph-project-due-date', type: 'date', min: draft.startDate || undefined, value: draft.dueDate, onChange: (event) => change('dueDate', event.target.value) })),
            h('div', { className: 'wide', style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } }, h('button', { type: 'button', className: 'ph-btn', disabled: dateSaving, onClick: () => { setDraft((current) => ({ ...current, startDate: project.startDate || allStarts[0] || '', dueDate: project.dueDate || allDues.at(-1) || '' })); setEditingDates(false) } }, '取消'), h('button', { type: 'button', className: 'ph-btn primary', disabled: dateSaving, onClick: saveDates }, dateSaving ? '保存中…' : '保存日期'))),
          h('div', { className: 'ph-meta' }, `关键任务 ${criticalTasks.length} · 有阻塞 ${blocked.length} · 逾期 ${overdue.length}`)),
        h('div', { className: 'ph-overview-grid' },
          h('div', null,
            h('section', { className: 'ph-overview-card' },
              h('h3', null, '任务状态分布'),
              Object.entries(statusNames).map(([status, label]) => h('div', { className: 'ph-status-summary-row', key: status }, h('span', { className: `ph-status-dot status-${statusClasses[status]}` }), h('span', null, label), h('strong', null, statusCounts[status])))),
            h('section', { className: 'ph-overview-card' },
              h('h3', null, '当前事项与阻塞卡点'),
              activeTasks.length ? activeTasks.map((task) => h('button', { className: 'ph-active-task', key: task.id, onClick: () => onEditTask(task) }, h('span', { className: `ph-chip ${task.status === 'blocked' ? 'danger' : ''}` }, statusNames[task.status]), h('strong', null, task.title), h('span', null, task.status === 'blocked' ? task.blocker || '尚未记录阻塞卡点' : task.currentWork || '尚未记录当前事项'))) : h('div', { className: 'ph-empty-note' }, '目前没有进行中或有阻塞的任务。'))),
          h('div', null,
            h('section', { className: 'ph-overview-card' }, h('h3', null, '风险与冲突'), risks.length ? risks.map((task) => h('div', { className: 'ph-overview-line', key: task.id }, h('button', { className: 'ph-action-link', onClick: () => onEditTask(task) }, task.title), h('button', { className: `ph-chip ${task.status === 'blocked' ? 'danger' : 'warn'}`, onClick: () => onEditTask(task) }, task.status === 'blocked' ? '编辑阻塞' : `编辑逾期 ${labelDate(task.due)}`))) : h('div', { className: 'ph-empty-note' }, '目前没有标记阻塞或已逾期的任务。时间交叉允许并行，不会自动视为冲突。')),
            h('section', { className: 'ph-overview-card' },
              h('div', { className: 'ph-overview-card-head' }, h('h3', null, '关键任务'), h('button', { className: 'ph-btn small', disabled: !tasks.some((task) => !task.critical), onClick: () => setCriticalPicker((value) => !value) }, criticalPicker ? '收起' : '选择任务')),
              criticalPicker && h('div', { className: 'ph-critical-picker' }, tasks.filter((task) => !task.critical).map((task) => h('button', { key: task.id, className: 'ph-action-link', onClick: async () => { await onPatchTask(task.id, { critical: true }); setCriticalPicker(false) } }, `+ ${task.title}`))),
              criticalTasks.length ? criticalTasks.map((task) => h('div', { className: 'ph-overview-line', key: task.id }, h('button', { className: 'ph-action-link', onClick: () => onEditTask(task) }, task.title), h('span', { className: 'ph-chip' }, `${statusNames[task.status]} · ${task.progress}%`), h('button', { className: 'ph-action-link', onClick: () => onPatchTask(task.id, { critical: false }) }, '取消标记'))) : h('div', { className: 'ph-empty-note' }, '可从现有任务中选择关键任务；此标记不计算关键路径。')))),
      )
    }

    function Gantt({ project, onEdit, onPatch, onError }) {
      const svgRef = useRef(null)
      const drag = useRef(null)
      const moved = useRef(false)
      const [selected, setSelected] = useState(null)
      const now = new Date()
      const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
      const dated = project.tasks.map((task) => ({ task, start: dateObj(task.start), due: dateObj(task.due) })).filter((row) => row.start && row.due)
      let minDay = dayNumber(today) - 3
      let maxDay = dayNumber(today) + 21
      if (dated.length) {
        minDay = Math.min(dayNumber(today), ...dated.map((row) => dayNumber(row.start))) - 3
        maxDay = Math.max(dayNumber(today), ...dated.map((row) => dayNumber(row.due))) + 4
      }
      if (maxDay - minDay < 14) maxDay = minDay + 14
      const range = maxDay - minDay
      const width = 1230, left = 270, right = 180, timeWidth = width - left - right
      const pxDay = timeWidth / range
      const rowH = 48, top = 56, height = top + Math.max(project.tasks.length, 1) * rowH + 20
      const xDay = (day) => left + (day - minDay) * pxDay
      const ticks = []
      const regularStep = range > 250 ? 30 : range > 85 ? 14 : range > 35 ? 7 : 1
      const step = Math.max(regularStep, Math.ceil(range / 36))
      for (let day = minDay; day <= maxDay; day += step) ticks.push(day)
      const dayToDate = (day) => isoDay(fromDayNumber(day))
      const pointerDown = (event, task, mode) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { task, mode, x: event.clientX }
        moved.current = false
      }
      const pointerUp = async (event) => {
        const current = drag.current
        if (!current) return
        drag.current = null
        const svg = svgRef.current
        if (!svg) return
        const scale = width / svg.getBoundingClientRect().width
        const delta = Math.round((event.clientX - current.x) * scale / pxDay)
        if (delta === 0) return
        moved.current = true
        const { task, mode } = current
        try {
          if (mode === 'move') await onPatch(task.id, { start: shiftDate(task.start, delta), due: shiftDate(task.due, delta) })
          else if (mode === 'start') {
            const next = shiftDate(task.start, delta)
            if (next <= task.due) await onPatch(task.id, { start: next })
          } else {
            const next = shiftDate(task.due, delta)
            if (next >= task.start) await onPatch(task.id, { due: next })
          }
        } catch (error) { onError(error.message) }
      }
      const onClickBar = (task) => { if (!moved.current) setSelected(task) }
      const closePopover = () => setSelected(null)
      return h('div', { className: 'ph-gantt-wrap' },
        h('div', { className: 'ph-gantt-legend', 'aria-label': '任务状态图例' }, Object.entries(statusNames).map(([status, label]) => h('span', { className: 'ph-gantt-legend-item', key: status }, h('i', { className: `ph-status-dot status-${statusClasses[status]}` }), label))),
        h('svg', { ref: svgRef, className: 'ph-gantt', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${project.name} 甘特图` },
          h('rect', { x: 0, y: 0, width, height: top, fill: 'var(--ph-surface-alt)' }),
          h('line', { x1: left, y1: 0, x2: left, y2: height, stroke: 'var(--ph-border)' }),
          h('text', { x: 18, y: 32, className: 'ph-axis' }, '任务'),
          ...ticks.map((day) => h(React.Fragment, { key: `tick-${day}` },
            h('line', { x1: xDay(day), y1: 0, x2: xDay(day), y2: height, stroke: 'var(--ph-border)', strokeDasharray: step === 1 ? '2 3' : undefined }),
            h('text', { x: xDay(day) + 3, y: 32, className: 'ph-axis' }, step >= 365 ? dayToDate(day).slice(0, 4) : step >= 28 ? dayToDate(day).slice(0, 7) : dayToDate(day).slice(5)))),
          ...project.tasks.map((task, index) => {
            const y = top + index * rowH
            const start = dateObj(task.start), due = dateObj(task.due)
            const barX = start ? xDay(dayNumber(start)) : 0
            const barEnd = due ? xDay(dayNumber(due) + 1) : 0
            const barWidth = Math.max(6, barEnd - barX)
            const color = statusColors[task.status] || statusColors.todo
            const statusLabel = `${statusNames[task.status]} · ${task.progress}%`
            return h(React.Fragment, { key: task.id },
              h('rect', { x: 0, y, width, height: rowH, fill: index % 2 ? 'var(--ph-surface-alt)' : 'var(--ph-surface)' }),
              h('line', { x1: 0, y1: y + rowH, x2: width, y2: y + rowH, stroke: 'var(--ph-border)' }),
              h('text', { x: 16, y: y + 17, className: 'ph-row-id' }, task.id),
              h('text', { x: 16, y: y + 34, className: 'ph-row-name' }, task.title.length > 28 ? `${task.title.slice(0, 27)}…` : task.title),
              start && due ? h(React.Fragment, null,
                h('rect', { x: barX, y: y + 13, width: barWidth, height: 22, rx: 5, fill: color, fillOpacity: 0.4, stroke: color, strokeWidth: 2, className: `ph-bar status-${statusClasses[task.status] || 'todo'}`, 'data-task-status': task.status, 'aria-label': `${task.title}：${statusLabel}`, onPointerDown: (event) => pointerDown(event, task, 'move'), onPointerUp: pointerUp, onClick: () => onClickBar(task), onDoubleClick: () => onEdit(task) }),
                h('rect', { x: barX, y: y + 13, width: Math.max(0, barWidth * task.progress / 100), height: 22, rx: 5, fill: color, fillOpacity: 0.92, pointerEvents: 'none' }),
                h('rect', { x: barX - 3, y: y + 11, width: 9, height: 26, className: 'ph-bar-handle', onPointerDown: (event) => pointerDown(event, task, 'start'), onPointerUp: pointerUp, onClick: (event) => event.stopPropagation() }),
                h('rect', { x: barEnd - 6, y: y + 11, width: 9, height: 26, className: 'ph-bar-handle', onPointerDown: (event) => pointerDown(event, task, 'due'), onPointerUp: pointerUp, onClick: (event) => event.stopPropagation() }),
                h('text', { x: barEnd + 9, y: y + 28, className: 'ph-gantt-status' }, statusLabel))
                : h('text', { x: left + 9, y: y + 28, className: 'ph-gantt-status' }, statusLabel))
          }),
          h('line', { x1: xDay(dayNumber(today)), y1: top, x2: xDay(dayNumber(today)), y2: height, className: 'ph-today' }),
          h('rect', { x: xDay(dayNumber(today)) - 18, y: top + 1, width: 36, height: 16, rx: 4, fill: 'var(--ph-danger)' }),
          h('text', { x: xDay(dayNumber(today)), y: top + 12, fill: 'var(--dsw-static-neutral-00,#fff)', textAnchor: 'middle', fontSize: 9 }, '今天')),
        selected && h('div', { className: 'ph-popover', role: 'dialog' },
          h('div', { className: 'ph-task-id' }, selected.id), h('div', { className: 'ph-pop-title' }, selected.title),
          h('div', { className: 'ph-meta' }, h('span', { className: 'ph-badge' }, statusNames[selected.status]), h('span', null, `${labelDate(selected.start)} → ${labelDate(selected.due)}`)),
          h('div', { className: 'ph-meta', style: { marginTop: 9 } }, h('span', null, `进度 ${selected.progress}%`), h('span', null, `负责人 ${selected.assignees.length}`)),
          selected.currentWork && h('div', { className: 'ph-node-callout current', style: { marginTop: 9 } }, h('strong', null, '当前事项'), h('span', null, selected.currentWork)),
          selected.status === 'blocked' && h('div', { className: 'ph-node-callout blocker', style: { marginTop: 9 } }, h('strong', null, '阻塞卡点'), h('span', null, selected.blocker || '尚未记录卡点')),
          h('div', { className: 'ph-pop-actions' }, h('button', { className: 'ph-btn primary', onClick: () => { onEdit(selected); closePopover() } }, '打开详情'), h('button', { className: 'ph-btn', onClick: async () => { try { await onPatch(selected.id, { status: 'done', progress: 100 }); closePopover() } catch (error) { onError(error.message) } } }, '完成'), h('button', { className: 'ph-btn', onClick: closePopover }, '关闭'))))
    }

    function ProjectFilesView({ sessionId, project, workspacePath, scopedRequest, onSendFiles, onEnsureFiles, onError }) {
      const fileSeparator = String(workspacePath || '').includes('\\') ? '\\' : '/'
      const initialFilesPath = `${String(workspacePath || '').replace(/[\\/]+$/, '')}${workspacePath ? fileSeparator : ''}files`
      const [entries, setEntries] = useState([])
      const [directory, setDirectory] = useState('')
      const [absolutePath, setAbsolutePath] = useState('')
      const [pathDraft, setPathDraft] = useState(initialFilesPath)
      const [selection, setSelection] = useState(() => new Set())
      const [filter, setFilter] = useState('')
      const [loading, setLoading] = useState(true)
      const [sending, setSending] = useState(false)
      const [notice, setNotice] = useState('')
      const loadRequest = useRef(0)
      const loadDirectory = useCallback(async (path = '') => {
        const requestId = ++loadRequest.current
        setLoading(true); setNotice('')
        try {
          const result = await scopedRequest(API, { method: 'POST', body: JSON.stringify({ action: 'project.files.list', projectId: project.id, path }) })
          if (requestId !== loadRequest.current) return
          setEntries(result.entries || [])
          setDirectory(result.path || '')
          setAbsolutePath(result.absolutePath || '')
          setPathDraft(result.absolutePath || '')
          setSelection(new Set())
        } catch (error) {
          if (requestId === loadRequest.current) onError(error.message)
        } finally {
          if (requestId === loadRequest.current) setLoading(false)
        }
      }, [project.id, scopedRequest, onError])
      useEffect(() => {
        let alive = true
        const initialize = async () => {
          try {
            await onEnsureFiles?.(workspacePath, project.id)
            if (alive) await loadDirectory('')
          } catch (error) {
            if (alive) { onError(error.message); setLoading(false) }
          }
        }
        void initialize()
        return () => { alive = false; loadRequest.current += 1 }
      }, [loadDirectory, onEnsureFiles, onError, project.id, workspacePath])
      const pathKey = (path) => String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      const projectFilesRoot = `${String(workspacePath || '').replace(/\\/g, '/').replace(/\/+$/, '')}/files`
      const navigateAbsolutePath = () => {
        const root = pathKey(projectFilesRoot)
        const entered = pathKey(pathDraft)
        if (entered === root) { void loadDirectory(''); return }
        if (!entered.startsWith(`${root}/`)) { onError('只能浏览当前项目的 files 目录'); return }
        void loadDirectory(entered.slice(root.length + 1))
      }
      const parent = () => {
        if (!directory) return
        void loadDirectory(directory.split('/').slice(0, -1).join('/'))
      }
      const toggle = (path) => setSelection((previous) => {
        const next = new Set(previous)
        if (next.has(path)) next.delete(path); else next.add(path)
        return next
      })
      const visibleEntries = entries.filter((entry) => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
      const send = async () => {
        if (!selection.size || sending) return
        setSending(true); setNotice('')
        try {
          await onSendFiles(sessionId, project, [...selection])
          setNotice(`已将 ${selection.size} 个文件发送给项目助手`)
          setSelection(new Set())
        } catch (error) { onError(error.message) }
        finally { setSending(false) }
      }
      const sizeLabel = (bytes) => bytes == null ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
      return h('div', { className: 'ph-files-view' },
        h('div', { className: 'ph-file-path-row' }, h('input', { className: 'ph-file-path-input', value: pathDraft, onChange: (event) => setPathDraft(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') navigateAbsolutePath() }, 'aria-label': '项目文件绝对路径', title: absolutePath, spellCheck: false }), h('button', { className: 'ph-btn small', onClick: navigateAbsolutePath }, '跳转')),
        h('div', { className: 'ph-files-toolbar' }, h('button', { className: 'ph-btn small', disabled: !directory || loading, onClick: parent }, '上一级'), h('button', { className: 'ph-btn small', disabled: loading, onClick: () => loadDirectory(directory) }, '刷新'), h('input', { className: 'ph-file-filter', placeholder: '筛选当前目录…', value: filter, onChange: (event) => setFilter(event.target.value) }), h('span', { className: 'ph-spacer' }), h('span', { className: 'ph-toolbar-label' }, `已选 ${selection.size} 个文件`), h('button', { className: 'ph-btn primary', disabled: !selection.size || sending || !project.assistantSessionId, onClick: send }, sending ? '正在发送…' : '发送给项目助手')),
        notice && h('div', { className: 'ph-notice' }, notice),
        h('div', { className: 'ph-file-list' }, loading ? h('div', { className: 'ph-muted' }, '正在读取项目文件…') : visibleEntries.length ? visibleEntries.map((entry) => h('div', { key: entry.path, className: `ph-file-row ${entry.type === 'directory' ? 'is-directory' : ''}` }, entry.type === 'directory' ? h('button', { className: 'ph-file-name', onClick: () => loadDirectory(entry.path) }, '📁 ', entry.name) : h('label', { className: 'ph-file-select' }, h('input', { type: 'checkbox', checked: selection.has(entry.path), onChange: () => toggle(entry.path), disabled: (entry.size || 0) > 50 * 1024 * 1024 }), h('span', null, '📄 ', entry.name)), h('span', { className: 'ph-file-meta' }, entry.type === 'directory' ? '文件夹' : `${sizeLabel(entry.size)}${(entry.size || 0) > 50 * 1024 * 1024 ? ' · 超过 50 MiB 限制' : ''}`))) : h('div', { className: 'ph-empty' }, filter ? '没有匹配文件' : '此目录为空'))
      )
    }

    return { Icon, TaskEditor, ProjectOverview, Gantt, ProjectFilesView }
  }
})
