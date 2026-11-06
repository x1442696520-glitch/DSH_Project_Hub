window.__ModuleLoader__.load({
  id: 'dsh-project-hub/client',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const PANEL_ID = 'project-hub'
    const API = '/api/project-hub'
    const STYLE_ID = 'dsh-project-hub-css'
    const statusNames = { todo: '待办', doing: '进行中', blocked: '有阻塞', done: '完成' }
    const statusClasses = { todo: 'todo', doing: 'doing', blocked: 'blocked', done: 'done' }
    const statusColors = { todo: 'var(--ph-text-tertiary)', doing: 'var(--ph-accent)', blocked: 'var(--ph-danger)', done: 'var(--ph-success)' }
    const taskNodeNames = { completed: '完成事项', current: '当前事项', blocker: '阻塞卡点' }
    const priorityNames = { low: '低', normal: '普通', high: '高', urgent: '紧急' }
    const officePlatforms = [
      { id: 'wecom', name: '企业微信', desc: '智能机器人 API 模式：Host 通过官方 WebSocket 长连接收发消息，无需公网回调。', priority: true, status: '长连接状态待检查' },
      { id: 'feishu', name: '飞书', desc: '官方 SDK 长连接：授权私聊文本投递到助手；项目文件可按要求发送到绑定私聊。', priority: true, status: '长连接状态待检查' },
      { id: 'wechat', name: '微信', desc: '后续评估个人微信可用的合规接入方式。' }
    ]

    const css = `
      .ph-root{--ph-bg:var(--dsw-alias-bg-base,#fff);--ph-surface:var(--dsw-alias-bg-layer-1,var(--ph-bg));--ph-surface-alt:var(--dsw-alias-bg-layer-2,var(--ph-bg));--ph-text-primary:var(--dsw-alias-label-primary,#182230);--ph-text-secondary:var(--dsw-alias-label-secondary,#596579);--ph-text-tertiary:var(--dsw-alias-label-tertiary,#778496);--ph-text-caption:var(--dsw-alias-label-caption,#919aa8);--ph-border:var(--dsw-alias-border-l2,#dfe5ee);--ph-border-strong:var(--dsw-alias-border-l3,var(--ph-border));--ph-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#2563eb));--ph-accent-soft:var(--dsw-alias-state-business-tertiary,var(--dsw-alias-bg-layer-2,#eef3ff));--ph-hover:var(--dsw-alias-interactive-bg-hover,var(--ph-surface-alt));--ph-danger:var(--dsw-alias-state-error-primary,#ac3028);--ph-danger-soft:var(--dsw-alias-state-error-tertiary,var(--ph-surface-alt));--ph-warn:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary,#815000));--ph-warn-soft:var(--dsw-alias-state-warn-tertiary,var(--ph-surface-alt));--ph-success:var(--dsw-alias-state-success-primary,#18713d);--ph-success-soft:var(--dsw-alias-state-success-tertiary,var(--ph-surface-alt));height:100%;min-height:0;background:var(--ph-bg);color:var(--ph-text-primary);font-family:var(--dsw-font-family,system-ui,sans-serif);font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));display:flex;overflow:hidden}
      .ph-root button,.ph-root input,.ph-root select,.ph-root textarea{font-family:inherit}.ph-root input[type=checkbox],.ph-root input[type=range]{accent-color:var(--ph-accent)}.ph-root input::placeholder,.ph-root textarea::placeholder{color:var(--ph-text-tertiary);opacity:1}.ph-root :focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--ph-accent));outline-offset:2px}
      .ph-projects{width:250px;min-width:220px;border-right:.5px solid var(--ph-border);display:flex;flex-direction:column;background:var(--dsw-specific-sidebar-fill,var(--ph-surface-alt));color:var(--ph-text-primary)}
      .ph-project-head{padding:20px 16px 12px;display:flex;align-items:center;justify-content:space-between;font-size:20px;font-weight:700;color:var(--ph-text-primary)}
      .ph-project-list{overflow:auto;padding:4px 10px;flex:1}.ph-project{width:100%;text-align:left;padding:12px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--ph-text-primary);cursor:pointer;margin-bottom:7px}.ph-project:hover{background:var(--ph-hover);border-color:var(--ph-border)}.ph-project.active{background:var(--ph-accent-soft);border-color:var(--ph-accent)}.ph-project small{display:block;color:var(--ph-text-tertiary);margin-top:4px}.ph-progress{height:5px;border-radius:8px;background:var(--ph-hover);margin-top:9px;overflow:hidden}.ph-progress i{display:block;height:100%;background:var(--ph-accent)}
      .ph-main{min-width:0;flex:1;display:flex;flex-direction:column;background:var(--ph-bg);color:var(--ph-text-primary)}.ph-top{padding:22px 26px 0;border-bottom:.5px solid var(--ph-border)}.ph-title-row{display:flex;align-items:center;gap:14px}.ph-title{font-size:22px;font-weight:700;margin:0;color:var(--ph-text-primary)}.ph-path{color:var(--ph-text-tertiary);font-size:12px;margin-top:4px}.ph-tabs{display:flex;gap:24px;margin-top:22px}.ph-tab{border:0;background:none;padding:0 0 12px;color:var(--ph-text-tertiary);cursor:pointer;font:inherit;font-size:13px}.ph-tab.active{color:var(--ph-accent);border-bottom:2px solid var(--ph-accent);font-weight:700}.ph-toolbar{padding:14px 26px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ph-spacer{flex:1}.ph-btn{border:1px solid var(--ph-border);background:var(--ph-surface);color:var(--ph-text-primary);border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit}.ph-btn:hover{background:var(--ph-hover)}.ph-btn.primary{background:var(--ph-accent-soft);color:var(--ph-accent);border-color:var(--ph-accent)}.ph-btn.small{padding:5px 9px;font-size:12px}.ph-select-status{max-width:125px;padding:4px 6px;border:.5px solid var(--ph-border);border-radius:6px;color:var(--ph-text-primary);background:var(--ph-surface);font:inherit}.ph-content{padding:0 26px 24px;overflow:auto;min-height:0;flex:1;color:var(--ph-text-primary)}.ph-error{padding:12px;border-radius:8px;background:var(--ph-danger-soft);color:var(--ph-danger);margin:12px 26px}.ph-muted{color:var(--ph-text-secondary)}.ph-board{display:grid;grid-template-columns:repeat(4,minmax(190px,1fr));gap:14px;min-width:820px}.ph-column{background:var(--ph-surface-alt);border:.5px solid var(--ph-border);border-radius:12px;padding:10px;min-height:280px;color:var(--ph-text-primary)}.ph-column h3{font-size:13px;margin:4px 4px 12px;display:flex;justify-content:space-between;color:var(--ph-text-primary)}.ph-task-card{background:var(--ph-surface);color:var(--ph-text-primary);border:.5px solid var(--ph-border);border-radius:9px;padding:11px;margin:8px 0;cursor:pointer;box-shadow:var(--dsw-elevation-soft,none)}.ph-task-card:hover{border-color:var(--ph-accent)}.ph-task-id{font-size:10px;color:var(--ph-text-caption)}.ph-task-title{font-size:13px;font-weight:600;margin:4px 0 7px;color:var(--ph-text-primary)}.ph-meta{font-size:11px;color:var(--ph-text-secondary);display:flex;gap:8px;flex-wrap:wrap}.ph-badge{display:inline-flex;align-items:center;border-radius:20px;background:var(--ph-hover);padding:2px 7px;font-size:10px;color:var(--ph-text-secondary)}.ph-toolbar-label{font-size:12px;color:var(--ph-text-tertiary);margin-left:4px}
      .ph-gantt-wrap{border:.5px solid var(--ph-border);border-radius:10px;overflow:auto;position:relative;background:var(--ph-surface)}.ph-gantt{display:block;width:100%;min-width:940px;user-select:none;touch-action:pan-x pan-y}.ph-row-name{font-size:12px;fill:var(--ph-text-primary)}.ph-row-id{font-size:9px;fill:var(--ph-text-caption)}.ph-axis{font-size:10px;fill:var(--ph-text-tertiary)}.ph-gantt-status{font-size:10px;fill:var(--ph-text-secondary);font-weight:600}.ph-bar{cursor:grab}.ph-bar:active{cursor:grabbing}.ph-bar-handle{cursor:ew-resize;fill:transparent}.ph-today{stroke:var(--ph-danger);stroke-width:1.4}.ph-popover{position:absolute;z-index:5;right:18px;top:52px;width:280px;border:.5px solid var(--ph-border);border-radius:12px;background:var(--dsw-specific-menu,var(--ph-surface));color:var(--ph-text-primary);box-shadow:var(--dsw-elevation-prominent,none);padding:14px}.ph-pop-title{font-weight:700;margin:3px 0 7px}.ph-pop-actions{display:flex;gap:7px;margin-top:14px}.ph-pop-actions .ph-btn{font-size:12px}
      .ph-overlay{position:fixed;inset:0;background:rgba(0,0,0,.38);z-index:1000;display:flex;justify-content:flex-end}.ph-drawer{height:100%;width:min(480px,95vw);background:var(--dsw-specific-menu,var(--ph-surface));color:var(--ph-text-primary);box-shadow:var(--dsw-elevation-prominent,none);display:flex;flex-direction:column}.ph-drawer-head{display:flex;align-items:center;justify-content:space-between;padding:20px;border-bottom:.5px solid var(--ph-border)}.ph-drawer-body{padding:20px;overflow:auto;flex:1}.ph-field{display:flex;flex-direction:column;gap:5px;margin-bottom:15px}.ph-field label{font-size:12px;color:var(--ph-text-secondary)}.ph-field input,.ph-field select,.ph-field textarea{box-sizing:border-box;width:100%;border:.5px solid var(--ph-border);border-radius:7px;padding:9px;font:inherit;color:var(--ph-text-primary);background:var(--ph-surface)}.ph-field textarea{min-height:72px}.ph-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ph-assignee{display:flex;align-items:center;gap:9px;border:.5px solid var(--ph-border);padding:8px;border-radius:8px;margin-bottom:7px;background:var(--ph-surface)}.ph-assignee-name{flex:1;font-size:13px;color:var(--ph-text-primary)}.ph-assignee select{border:.5px solid var(--ph-border);border-radius:6px;padding:4px 6px;color:var(--ph-text-primary);background:var(--ph-surface);font:inherit}.ph-drawer-foot{padding:14px 20px;border-top:.5px solid var(--ph-border);display:flex;justify-content:flex-end;gap:8px}.ph-empty{padding:40px;text-align:center;color:var(--ph-text-tertiary)}.ph-add-row{padding:12px 2px}
      .ph-project-create{padding:0 12px 10px}.ph-project-create input,.ph-search,.ph-task-create input{box-sizing:border-box;border:.5px solid var(--ph-border);border-radius:8px;background:var(--ph-surface);color:var(--ph-text-primary);font:inherit;padding:8px 10px}.ph-project-create input,.ph-search{width:100%}.ph-search-wrap{padding:0 12px 8px}.ph-task-create{display:flex;gap:8px;margin:4px 0 14px}.ph-task-create input{flex:1;min-width:0;padding:9px}
      @media(max-width:800px){.ph-projects{width:190px;min-width:170px}.ph-top{padding-left:16px;padding-right:16px}.ph-toolbar,.ph-content{padding-left:16px;padding-right:16px}.ph-board{grid-template-columns:repeat(4,210px)}}
      .ph-integration-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;max-width:1000px}.ph-integration-card.active{border-color:var(--ph-accent)}.ph-integration-panel{max-width:960px;border:.5px solid var(--ph-border);border-radius:12px;padding:16px;margin:16px 0;background:var(--ph-surface)}.ph-integration-panel h3{margin:0 0 12px;color:var(--ph-text-primary)}.ph-integration-card{border:.5px solid var(--ph-border);border-radius:12px;background:var(--ph-surface);color:var(--ph-text-primary);padding:18px;box-shadow:var(--dsw-elevation-soft,none)}.ph-integration-card h3{margin:0 0 7px;color:var(--ph-text-primary)}.ph-integration-card p{color:var(--ph-text-secondary);margin:6px 0 14px;font-size:13px}.ph-integration-status{display:inline-flex;border-radius:20px;padding:4px 9px;background:var(--ph-warn-soft);color:var(--ph-warn);font-size:11px;font-weight:600}.ph-notice{border:.5px solid var(--ph-warn);background:var(--ph-warn-soft);color:var(--ph-text-primary);border-radius:10px;padding:14px;margin:4px 0 18px;max-width:960px}.ph-add-assignee{display:flex;gap:8px}.ph-add-assignee input{flex:1;min-width:0}.ph-status-edit{margin-left:auto}
      .ph-overview{max-width:1180px;margin:0 auto;padding-bottom:18px;color:var(--ph-text-primary)}.ph-overview-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:18px 20px;border:.5px solid var(--ph-border);border-radius:14px;background:linear-gradient(135deg,var(--ph-surface-alt),var(--ph-surface));margin-bottom:16px}.ph-overview-hero h2{font-size:20px;margin:0 0 6px;color:var(--ph-text-primary)}.ph-overview-description{font-size:13px;color:var(--ph-text-secondary);white-space:pre-wrap;max-width:760px}.ph-updated{font-size:11px;color:var(--ph-text-tertiary);margin-top:8px}.ph-overview-stats{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:10px;margin:12px 0 18px}.ph-stat{background:var(--ph-surface);color:var(--ph-text-primary);border:.5px solid var(--ph-border);border-radius:11px;padding:12px 14px;min-height:72px}.ph-stat-label{font-size:11px;color:var(--ph-text-tertiary)}.ph-stat-value{font-size:20px;font-weight:700;color:var(--ph-text-primary);margin-top:4px}.ph-stat-note{font-size:10px;color:var(--ph-text-secondary)}
      .ph-overview-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:14px}.ph-overview-card{background:var(--ph-surface);color:var(--ph-text-primary);border:.5px solid var(--ph-border);border-radius:12px;padding:16px;margin-bottom:14px}.ph-overview-card h3{font-size:14px;color:var(--ph-text-primary);margin:0 0 12px}.ph-overview-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.ph-overview-card-head h3{margin:0}.ph-action-link{border:0;background:transparent;color:var(--ph-accent);cursor:pointer;font:inherit;font-size:12px;padding:2px 0}.ph-action-link:hover{text-decoration:underline}.ph-overview-line .ph-action-link:first-child{margin-right:auto;text-align:left}.ph-overview-line button.ph-chip{border:0;cursor:pointer}.ph-critical-picker{display:flex;flex-direction:column;gap:5px;max-height:160px;overflow:auto;margin:6px 0 10px;padding:8px;border-radius:8px;background:var(--ph-surface-alt)}
      .ph-overview-line{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:.5px solid var(--ph-border);font-size:12px}.ph-overview-line:last-child{border-bottom:0}.ph-chip{display:inline-flex;padding:3px 8px;border-radius:16px;background:var(--ph-hover);color:var(--ph-text-secondary);font-size:10px}.ph-chip.warn{background:var(--ph-warn-soft);color:var(--ph-warn)}.ph-chip.danger{background:var(--ph-danger-soft);color:var(--ph-danger)}.ph-chip.good{background:var(--ph-success-soft);color:var(--ph-success)}.ph-timeline{display:flex;align-items:center;gap:10px;margin:8px 0}.ph-timeline-track{height:8px;background:var(--ph-hover);border-radius:8px;flex:1;overflow:hidden}.ph-timeline-track i{display:block;height:100%;background:var(--ph-accent);border-radius:8px}.ph-empty-note{font-size:12px;color:var(--ph-text-secondary);padding:8px 0}
      .ph-inline-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ph-inline-form .ph-field{margin-bottom:8px}.ph-inline-form .wide{grid-column:1/-1}.ph-critical-label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ph-text-secondary)}.ph-files-view{display:flex;flex-direction:column;gap:10px;min-height:420px}.ph-file-path-row{display:flex;gap:8px;align-items:center}.ph-file-path-input{box-sizing:border-box;flex:1;min-width:0;border:.5px solid var(--ph-border);border-radius:8px;background:var(--ph-surface);color:var(--ph-text-primary);font:inherit;padding:9px 10px}.ph-files-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ph-file-filter{box-sizing:border-box;width:min(260px,36vw);border:.5px solid var(--ph-border);border-radius:8px;background:var(--ph-surface);color:var(--ph-text-primary);font:inherit;padding:7px 10px}.ph-file-list{overflow:auto;max-height:calc(100vh - 360px);border:.5px solid var(--ph-border);border-radius:10px;background:var(--ph-surface)}.ph-file-row{min-height:42px;display:flex;align-items:center;gap:12px;padding:6px 12px;border-bottom:.5px solid var(--ph-border)}.ph-file-row:last-child{border-bottom:0}.ph-file-select{flex:1;min-width:0;display:flex;align-items:center;gap:9px;cursor:pointer}.ph-file-name{flex:1;text-align:left;border:0;background:transparent;color:var(--ph-accent);font:inherit;cursor:pointer}.ph-file-meta{font-size:11px;color:var(--ph-text-tertiary);white-space:nowrap}.ph-workspace-view{height:100%;min-height:560px;width:100%;overflow:hidden;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,inherit);font-family:var(--dsw-font-family,system-ui,sans-serif)}
      .ph-gantt-legend{display:flex;gap:16px;align-items:center;padding:10px 14px;border-bottom:.5px solid var(--ph-border);font-size:12px;color:var(--ph-text-secondary);position:sticky;left:0;width:max-content;min-width:100%;box-sizing:border-box}.ph-gantt-legend-item{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.ph-status-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex:none}.status-todo{background:var(--ph-text-tertiary)}.status-doing{background:var(--ph-accent)}.status-blocked{background:var(--ph-danger)}.status-done{background:var(--ph-success)}.ph-status-summary-row{display:flex;align-items:center;gap:9px;padding:8px 2px;border-bottom:.5px solid var(--ph-border);font-size:13px}.ph-status-summary-row strong{margin-left:auto}.ph-active-task{display:flex;align-items:flex-start;gap:9px;width:100%;text-align:left;padding:10px 2px;border:0;border-bottom:.5px solid var(--ph-border);background:transparent;color:var(--ph-text-primary);cursor:pointer;font:inherit}.ph-active-task strong{min-width:110px}.ph-active-task>span:last-child{color:var(--ph-text-secondary);overflow:hidden;text-overflow:ellipsis}.ph-active-task:hover{background:var(--ph-hover)}.ph-task-node-preview{font-size:11px;padding:6px 8px;border-radius:6px;margin:6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ph-task-node-preview.current,.ph-node-callout.current{background:var(--ph-accent-soft);color:var(--ph-accent)}.ph-task-node-preview.blocker,.ph-node-callout.blocker{background:var(--ph-danger-soft);color:var(--ph-danger)}.ph-task-nodes{border:.5px solid var(--ph-border);border-radius:10px;padding:12px;margin:16px 0;background:var(--ph-surface-alt)}.ph-task-nodes h3{margin:0 0 10px;font-size:14px}.ph-node-callout{display:flex;flex-direction:column;gap:4px;padding:9px 10px;border-radius:7px;margin:8px 0;font-size:12px;white-space:pre-wrap}.ph-node-form{display:grid;grid-template-columns:minmax(120px,.35fr) 1fr auto;gap:8px;align-items:start;margin:10px 0}.ph-node-form select,.ph-node-form textarea{box-sizing:border-box;border:.5px solid var(--ph-border);border-radius:7px;padding:8px;font:inherit;color:var(--ph-text-primary);background:var(--ph-surface)}.ph-node-form textarea{min-height:58px;resize:vertical}.ph-node-list{max-height:300px;overflow:auto}.ph-node{padding:9px 2px;border-top:.5px solid var(--ph-border)}.ph-node-head{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--ph-text-secondary)}.ph-node-text{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:5px;color:var(--ph-text-primary)}.ph-node-resolved{font-size:10px;color:var(--ph-text-tertiary);margin-top:4px}
      @media(max-width:850px){.ph-overview-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.ph-overview-grid{grid-template-columns:1fr}.ph-overview-hero{display:block}.ph-inline-form{grid-template-columns:1fr}.ph-node-form{grid-template-columns:1fr}.ph-active-task{flex-wrap:wrap}}
    `
    if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = css
      document.head.appendChild(tag)
    }

    async function request(url = API, options = {}) {
      const response = await fetch(url, { cache: 'no-store', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
      const value = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(value.error || `请求失败 (${response.status})`)
        error.status = response.status
        throw error
      }
      return value
    }
    const dateObj = (date) => {
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
      const d = new Date(`${date}T00:00:00Z`)
      return Number.isFinite(d.getTime()) ? d : null
    }
    const isoDay = (date) => date.toISOString().slice(0, 10)
    const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const defaultTaskDates = () => {
      const today = new Date()
      return { start: localDay(today), due: localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)) }
    }
    const dayNumber = (date) => Math.floor(date.getTime() / 86400000)
    const fromDayNumber = (day) => new Date(day * 86400000)
    const shiftDate = (value, days) => {
      const d = dateObj(value)
      return d ? isoDay(fromDayNumber(dayNumber(d) + days)) : value
    }
    const labelDate = (value) => value ? value.slice(5).replace('-', '/') : '未排期'

    function csvCell(value) {
      let text = value == null ? '' : String(value)
      if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`
      return `"${text.replace(/"/g, '""').replace(/\r\n|\r|\n/g, '\r\n')}"`
    }

    function buildProjectCsv(project) {
      const headers = ['项目名称', '项目简介', '项目开始日期', '项目截止日期', '任务 ID', '任务名称', '状态', '优先级', '关键任务', '进度（%）', '任务开始日期', '任务截止日期', '负责人', '当前事项', '阻塞卡点', '任务节点记录', '任务说明']
      const tasks = Array.isArray(project.tasks) ? project.tasks : []
      const rows = (tasks.length ? tasks : [null]).map((task) => [
        project.name, project.description, project.startDate, project.dueDate,
        task?.id, task?.title, statusNames[task?.status] || task?.status,
        priorityNames[task?.priority] || task?.priority, task?.critical ? '是' : '否', task?.progress, task?.start, task?.due,
        (task?.assignees || []).map((person) => person.name || person.id).join('；'), task?.currentWork, task?.blocker,
        (task?.nodes || []).map((node) => `${new Date(node.at).toLocaleString()} ${taskNodeNames[node.kind] || node.kind}：${node.text}`).join('；'), task?.body
      ])
      return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
    }

    function downloadProjectCsv(project) {
      const safeName = String(project.name || 'project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'project'
      const blob = new Blob([buildProjectCsv(project)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${safeName}-项目任务.csv`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    }

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
      const [saving, setSaving] = useState(false)
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
        h('div', { className: 'ph-overview-card' }, h('div', { className: 'ph-overview-card-head' }, h('h3', null, '整体进度与日期范围'), h('button', { className: 'ph-btn small', onClick: () => setEditing(true) }, '编辑日期')),
          h('div', { className: 'ph-timeline' }, h('span', { className: 'ph-toolbar-label' }, startDate ? labelDate(startDate) : '开始未定'), h('div', { className: 'ph-timeline-track' }, h('i', { style: { width: `${project.progress}%` } })), h('span', { className: 'ph-toolbar-label' }, dueDate ? labelDate(dueDate) : '截止未定')),
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

    function ProjectManagementView({ sessionId, onOpenSession, workspacePath, workspaceTitle, onSendFiles, onEnsureFiles, onNormalizeWorkspace }) {
      return h('div', { className: 'ph-workspace-view' }, h(Panel, { key: sessionId, sessionId, onOpenSession, workspacePath, workspaceTitle, onSendFiles, onEnsureFiles, onNormalizeWorkspace }))
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

    function Panel({ sessionId, onOpenSession, workspaceId, workspacePath, workspaceTitle, onSendFiles, onEnsureFiles, onNormalizeWorkspace, onInitializeWorkspace }) {
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
      const wecomSendDisabledReason = project?.wecomConnection?.state !== 'connected'
        ? `发送测试消息需要 Host 长连接已认证（当前：${project?.wecomConnection?.label || '状态未知'}）`
        : !wecomDraft.recipient.trim() || !wecomDraft.text.trim()
          ? '请填写企业微信 UserID 和消息内容后再发送。'
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
      const grouped = useMemo(() => ({
        todo: boardTasks.filter((task) => task.status === 'todo'),
        doing: boardTasks.filter((task) => task.status === 'doing'),
        blocked: boardTasks.filter((task) => task.status === 'blocked'),
        done: boardTasks.filter((task) => task.status === 'done')
      }), [project])
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
      const needsWorkspaceNormalization = Boolean(workspaceTitle && workspaceDirectoryName !== workspaceTitle)
      const normalizeCurrentWorkspace = async () => {
        if (!needsWorkspaceNormalization || normalizing || !onNormalizeWorkspace) return
        if (!globalThis.confirm?.(`将把「${workspaceTitle}」项目资料与任务迁移到同名目录，并创建新的 DSH Workspace 和项目助手 Session。迁移成功后，旧 Workspace 会保留为「旧」备份（其中的其他文件和 files/ 附件不会自动复制或合并），旧会话历史仍保留但不再绑定；项目 ID、Workspace ID 和助手 Session ID 会变化。是否继续？`)) return
        setNormalizing(true); setError('')
        try { await onNormalizeWorkspace(sessionId, project, workspacePath, workspaceTitle) }
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
          h('div', { className: 'ph-toolbar' }, tab === 'tasks' && h('button', { className: 'ph-btn primary', onClick: () => setShowTaskInput((v) => !v) }, '+ 新建任务'), tab === 'gantt' && h('span', { className: 'ph-toolbar-label' }, '自动适配项目周期 · 可拖动任务条改日期 · 允许并行交叉'), tab === 'files' && h('span', { className: 'ph-toolbar-label' }, '选择项目文件后可作为附件发送给项目助手'), h('span', { className: 'ph-spacer' }), tab !== 'files' && h('span', { className: 'ph-toolbar-label' }, `${tab === 'tasks' ? boardTasks.length : project.tasks.length} 个任务`)), 
          h('section', { className: 'ph-content' },
            tab === 'overview' ? h(ProjectOverview, { project, onUpdate: updateProject, onError: setError, onPatchTask: updateOverviewTask, onEditTask: openEditor }) : null,
            tab === 'integrations' ? renderIntegrations() : null,
            tab === 'files' ? h(ProjectFilesView, { sessionId, project, workspacePath, scopedRequest, onSendFiles, onEnsureFiles, onError: setError }) : null,
             tab === 'tasks' ? h(React.Fragment, null,
              showTaskInput && h('form', { className: 'ph-task-create', onSubmit: createTask }, h('input', { autoFocus: true, placeholder: '输入任务名称', value: taskName, onChange: (e) => setTaskName(e.target.value) }), h('button', { className: 'ph-btn primary' }, '创建'), h('button', { type: 'button', className: 'ph-btn', onClick: () => setShowTaskInput(false) }, '取消')),
              h('div', { className: 'ph-board' }, columns.map((status) => h('section', { key: status, className: 'ph-column', onDragOver: (e) => e.preventDefault(), onDrop: async (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/task'); if (id) { const task = project.tasks.find((row) => row.id === id); if (task && task.status !== status) try { await patchTask(id, { status, ...(status === 'done' ? { progress: 100 } : {}) }) } catch (err) { setError(err.message) } } } }, h('h3', null, h('span', null, statusNames[status]), h('span', { className: 'ph-badge' }, grouped[status].length)), grouped[status].map((task) => h('article', { key: task.id, className: 'ph-task-card', draggable: true, onDragStart: (e) => e.dataTransfer.setData('text/task', task.id), onClick: () => openEditor(task) }, h('div', { className: 'ph-task-id' }, task.id), h('div', { className: 'ph-task-title' }, task.title), h('div', { className: 'ph-meta' }, h('span', null, task.assignees.length ? `${task.assignees.length} 位负责人` : '未指派'), task.due && h('span', null, `截止 ${labelDate(task.due)}`)), task.status === 'blocked' && h('div', { className: 'ph-task-node-preview blocker' }, task.blocker || '尚未记录阻塞卡点'), task.status === 'doing' && task.currentWork && h('div', { className: 'ph-task-node-preview current' }, task.currentWork), h('div', { className: 'ph-progress' }, h('i', { style: { width: `${task.progress}%` } })), h('div', { className: 'ph-meta', style: { justifyContent: 'space-between', marginTop: 5 } }, h('span', null, `${task.progress}%`), h('select', { className: 'ph-select-status ph-status-edit', value: task.status, 'aria-label': `更改任务状态：${task.title}`, onClick: (e) => e.stopPropagation(), onChange: (e) => { e.stopPropagation(); changeTaskStatus(task, e.target.value) } }, Object.entries(statusNames).map(([key, label]) => h('option', { key, value: key }, label))))))))))
              : null,
            tab === 'gantt' ? h(Gantt, { project, onEdit: openEditor, onPatch: patchTask, onError: setError }) : null),
          editing && h(TaskEditor, { task: editing, onClose: () => setEditing(null), onSave: saveEditor, onAddNode: addTaskNode, onError: setError }))
          : h('div', { className: 'ph-empty', style: { margin: 'auto' } }, loading ? '正在读取项目…' : h(React.Fragment, null, h('h2', null, '当前工作区尚未初始化为项目'), h('p', null, '只有点击下方按钮后，Project Hub 才会在当前 Workspace 创建项目资料；不会自动创建 DSH 会话。'), h('button', { type: 'button', className: 'ph-btn primary', disabled: initializing || !workspaceId, onClick: initializeCurrentWorkspace }, initializing ? '初始化中…' : '初始化当前 Workspace 项目')))))
    }

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
        const conflictingDirectory = siblingListing.entries.find((entry) => entry.name.toLocaleLowerCase() === title.toLocaleLowerCase())
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
            for (const key of ['status', 'priority', 'start', 'due', 'progress', 'critical', 'assignees', 'relatedTo', 'checklist', 'nodes', 'body']) {
              if (oldTask[key] === undefined) continue
              patch[key] = key === 'relatedTo' && Array.isArray(oldTask[key]) ? oldTask[key].map((id) => taskIdMap.get(id) || id) : oldTask[key]
            }
            if (Object.keys(patch).length) {
              const updatedTask = await request(API, { method: 'POST', body: JSON.stringify({ action: 'task.update', sessionId: newSessionId, projectId: newProject.id, taskId: newTask.id, patch }) })
              newProject = updatedTask.project
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
