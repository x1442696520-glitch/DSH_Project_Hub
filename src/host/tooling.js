export function createToolingMethods(shared) {
  const { defineTool, STANDARD_DSH_TOOL_NAMES, json, bridgeJournalErrorCode } = shared
  return {
  createIntegrationToolDefinition() {
    return defineTool({
      name: 'project_hub_integrations',
      description: '飞书/企业微信集成工具：查看连接状态、发送企微文本、发送飞书测试消息，以及在明确请求时列出/发送当前项目 files/ 中的文件。项目和任务仍由 Project Hub 面板管理；此工具不修改项目或任务。企微文本仅发给当前会话已配对或由 WECOM_ALLOWED_USER_IDS 授权的 UserID；禁止群聊和群发。',
      parameters: {
        action: { type: 'string', required: true, enum: ['list_project_files', 'wecom_send_text', 'wecom_status', 'feishu_status', 'feishu_send_test', 'send_file'], description: '仅限飞书/企微连接与发送操作；不包含项目或任务管理。' },
        path: { type: 'string', description: 'list_project_files 可选目录（相对于 files/）；send_file 必须是 files/ 下的精确相对文件路径，如 reports/status.pptx。不得使用绝对路径或 ..。' },
        platform: { type: 'string', enum: ['feishu', 'wecom'], description: 'send_file 可选。用户明确指定平台时填写；从平台私聊发起且用户说“发给我/发到这里”时省略，由 Host 按本轮入站平台确定。' },
        recipient: { type: 'string', description: '仅 wecom_send_text 使用：必须是当前会话已配对的 UserID，或 WECOM_ALLOWED_USER_IDS 中授权的 UserID。不接受群聊或 @all。send_file 不接受 recipient。' },
        text: { type: 'string', description: '仅 wecom_send_text 使用：要发送的 Markdown 文本，最多 2048 字符。' }
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: (args, exec) => this.executeAgentTool(args, exec.signal, exec.agent),
      presentCall: (args) => ({ card: 'generic', title: '飞书 / 企业微信', kind: ['list_project_files', 'wecom_status', 'feishu_status'].includes(args.action) ? 'read' : 'other', rawInput: args })
    })
  },

  createProjectManagementToolDefinition() {
    return defineTool({
      name: 'project_hub_manage',
      description: '管理当前 DSH 会话所属 Workspace 的 Project Hub 项目和任务；可诊断当前 Agent 可见的 DSH 工具名，也可在用户要求时通过沙箱内固定的只读 Git 命令查看工作区状态、差异统计与最近提交。可按用户明确要求创建任务、更新任务或记录完成/当前/阻塞节点；阻塞节点自动将任务设为有阻塞。不得访问其他 Workspace、执行任意命令或臆造审查结果。此工具只作补充，不限制 DSH 原有代码、文件、终端工具。',
      parameters: {
        action: { type: 'string', required: true, enum: ['agent_tool_status', 'review_code_changes', 'get_project', 'list_tasks', 'create_task', 'update_task', 'add_task_node'], description: '检查 Agent 当前可见工具，或执行受限的工作区变更/Project Hub 管理操作。' },
        taskId: { type: 'string', description: '当前项目中的任务 ID。' },
        title: { type: 'string', description: 'create_task 使用：新任务标题。' },
        kind: { type: 'string', enum: ['completed', 'current', 'blocker'], description: 'add_task_node 使用：completed=记录已完成事项，current=记录当前进展，blocker=记录阻塞并自动设置 blocked 状态。' },
        nodeText: { type: 'string', description: 'add_task_node 使用：节点内容，最多 2000 字符。' },
        patch: { type: 'json', description: 'update_task 使用。仅允许 title、status、priority、start、due、progress、critical、assignees、relatedTo、checklist、body。' }
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: (args, exec) => this.executeProjectManagementTool(args, exec.signal, exec.agent),
      presentCall: (args) => ({ card: 'generic', title: 'Project Hub', kind: ['agent_tool_status', 'review_code_changes', 'get_project', 'list_tasks'].includes(args.action) ? 'read' : 'other', rawInput: args })
    })
  },

  async attachProjectHubToolIfOwned(agent, { strictPresetRestore = false, expectedGeneration = this.agentPresetRestoreGeneration } = {}) {
    if (!this.isAgentPresetRestoreGenerationCurrent(expectedGeneration)) return false
    const sessionId = agent?.session?.id || agent?.id
    if (typeof sessionId !== 'string' || !sessionId) return false
    const workspaces = this.ctx.workspaceRegistry.list().filter((workspace) => workspace.sessionIds.includes(sessionId))
    if (workspaces.length !== 1) return false
    const workspace = workspaces[0]
    const projects = await this.listProjects(undefined, workspace.path)
    if (!this.isAgentPresetRestoreGenerationCurrent(expectedGeneration) || projects.length !== 1) return false
    const project = await this.readProject(projects[0].id, undefined, workspace.path)
    if (!this.isAgentPresetRestoreGenerationCurrent(expectedGeneration)) return false
    if (project.workspaceId !== workspace.id || project.assistantSessionId !== sessionId || project.path !== '.') return false
    this.projectAssistantSessions.add(sessionId)
    if (strictPresetRestore) await this.requireProjectHubAgentPreset(agent, expectedGeneration)
    else {
      try { await this.restoreProjectHubAgentPreset(agent, expectedGeneration) }
      catch (error) { this.ctx.logger.warn(`project-hub: could not verify an existing assistant Agent preset composition (${bridgeJournalErrorCode(error)})`) }
    }
    if (!this.isAgentPresetRestoreGenerationCurrent(expectedGeneration)) return false
    this.ensureProjectHubAgentTools(agent)
    return true
  },

  isAgentPresetRestoreGenerationCurrent(generation) {
    return this.bridgeToolScopeActive && generation === this.agentPresetRestoreGeneration
  },

  assertAgentPresetRestoreGeneration(generation) {
    if (this.isAgentPresetRestoreGenerationCurrent(generation)) return
    const error = new Error('Project Hub scoped Agent setup was cancelled because its lifecycle changed')
    error.code = 'PROJECT_HUB_SCOPE_CHANGED'
    throw error
  },

  async restoreProjectHubAgentPreset(agent, expectedGeneration = this.agentPresetRestoreGeneration, { mountContext } = {}) {
    this.assertAgentPresetRestoreGeneration(expectedGeneration)
    const sessionId = agent?.session?.id || agent?.id
    if (typeof sessionId !== 'string' || !sessionId) return false
    const generation = expectedGeneration
    const pending = this.agentPresetRestoreAttempts.get(sessionId)
    if (pending) {
      if (pending.agent === agent && pending.generation === generation && pending.mountContext === mountContext) {
        try {
          const result = await pending.promise
          this.assertAgentPresetRestoreGeneration(generation)
          return result
        } catch (error) {
          this.assertAgentPresetRestoreGeneration(generation)
          throw error
        }
      }
      try { await pending.promise } catch {}
      this.assertAgentPresetRestoreGeneration(generation)
      return this.restoreProjectHubAgentPreset(agent, generation, { mountContext })
    }
    const attempt = { agent, generation, mountContext, promise: this.composeOrVerifyProjectHubAgentPreset(agent, sessionId, generation, mountContext) }
    this.agentPresetRestoreAttempts.set(sessionId, attempt)
    try {
      const result = await attempt.promise
      this.assertAgentPresetRestoreGeneration(generation)
      return result
    } catch (error) {
      this.assertAgentPresetRestoreGeneration(generation)
      throw error
    } finally { if (this.agentPresetRestoreAttempts.get(sessionId) === attempt) this.agentPresetRestoreAttempts.delete(sessionId) }
  },

  setAgentPresetRestorationStatus(sessionId, status, generation) {
    if (!this.isAgentPresetRestoreGenerationCurrent(generation)) return false
    this.agentPresetRestorationStatus.set(sessionId, status)
    return true
  },

  async composeOrVerifyProjectHubAgentPreset(agent, sessionId, generation, mountContext) {
    this.assertAgentPresetRestoreGeneration(generation)
    const registry = this.ctx.agentPresets
    const headerPreset = agent?.session?.header?.agentPreset
    let agentPreset = typeof headerPreset === 'string' && headerPreset ? headerPreset : null
    try {
      const projectedPreset = typeof registry?.presetForSession === 'function' ? await registry.presetForSession(agent?.session) : undefined
      if (typeof projectedPreset === 'string' && projectedPreset) agentPreset = projectedPreset
      if (!agentPreset) {
        this.setAgentPresetRestorationStatus(sessionId, { state: 'not-configured' }, generation)
        return false
      }
      if (!registry) {
        const error = new Error('DSH Agent preset registry is unavailable')
        error.code = 'AGENT_PRESET_REGISTRY_UNAVAILABLE'
        throw error
      }
      const agentContext = mountContext || agent?.ctx
      if (mountContext) {
        if (typeof registry.mount !== 'function') {
          const error = new Error('DSH Agent preset mount API is unavailable')
          error.code = 'AGENT_PRESET_MOUNT_UNAVAILABLE'
          throw error
        }
        await registry.mount(mountContext, agentPreset)
        this.assertAgentPresetRestoreGeneration(generation)
      }
      if (typeof registry.composedPreset !== 'function') {
        const error = new Error('DSH Agent preset composition cannot be verified')
        error.code = 'AGENT_PRESET_COMPOSITION_UNAVAILABLE'
        throw error
      }
      const compositionPreset = await registry.composedPreset(agentContext)
      if (compositionPreset !== agentPreset) {
        const error = new Error(mountContext
          ? 'DSH resumed Agent was not composed with its persisted preset'
          : 'the active Agent composition differs from its persisted preset; a started Session cannot be recomposed in place')
        error.code = mountContext
          ? 'AGENT_PRESET_COMPOSITION_MISMATCH'
          : typeof compositionPreset === 'string' ? 'AGENT_PRESET_SCOPE_MISMATCH' : 'AGENT_PRESET_SCOPE_MISSING'
        error.compositionPreset = typeof compositionPreset === 'string' ? compositionPreset : null
        throw error
      }
      let requiredToolNames = []
      if (agentPreset === 'standard') {
        const toolRegistry = agentContext?.tools
        const schemas = typeof toolRegistry?.schemas === 'function' ? toolRegistry.schemas(agent) : []
        const visibleToolNames = Array.isArray(schemas) ? schemas.map((schema) => schema?.name).filter((name) => typeof name === 'string') : []
        const missingTools = STANDARD_DSH_TOOL_NAMES.filter((name) => !visibleToolNames.includes(name))
        if (missingTools.length) {
          const error = new Error(`DSH standard Agent preset is missing ordinary tools: ${missingTools.join(', ')}`)
          error.code = 'AGENT_PRESET_TOOLS_MISSING'
          error.missingTools = missingTools
          error.compositionPreset = compositionPreset
          throw error
        }
        requiredToolNames = STANDARD_DSH_TOOL_NAMES
      }
      this.setAgentPresetRestorationStatus(sessionId, { state: 'verified', agentPreset, compositionPreset, requiredToolNames }, generation)
      return true
    } catch (error) {
      this.setAgentPresetRestorationStatus(sessionId, {
        state: 'failed',
        agentPreset,
        code: bridgeJournalErrorCode(error),
        ...(typeof error?.compositionPreset === 'string' || error?.compositionPreset === null ? { compositionPreset: error.compositionPreset } : {}),
        ...(Array.isArray(error?.missingTools) ? { missingToolNames: error.missingTools } : {})
      }, generation)
      throw error
    }
  },

  async requireProjectHubAgentPreset(agent, expectedGeneration = this.agentPresetRestoreGeneration, { mountContext } = {}) {
    this.assertAgentPresetRestoreGeneration(expectedGeneration)
    const restored = await this.restoreProjectHubAgentPreset(agent, expectedGeneration, { mountContext })
    this.assertAgentPresetRestoreGeneration(expectedGeneration)
    if (restored) return true
    const error = new Error('live Agent has no persisted Agent preset; strict bridge delivery is disabled')
    error.code = 'AGENT_PRESET_NOT_CONFIGURED'
    throw error
  },

  async attachProjectHubToolsToLiveAgents() {
    const restoreGeneration = this.agentPresetRestoreGeneration
    if (!this.isAgentPresetRestoreGenerationCurrent(restoreGeneration)) return
    const agents = this.ctx.agents?.list?.() || []
    const results = await Promise.allSettled(agents.map((agent) => this.attachProjectHubToolIfOwned(agent, { expectedGeneration: restoreGeneration })))
    if (!this.isAgentPresetRestoreGenerationCurrent(restoreGeneration)) return
    for (const result of results) if (result.status === 'rejected') this.ctx.logger.warn(`project-hub: skipped an Agent while restoring scoped tools (${bridgeJournalErrorCode(result.reason)})`)
  },

  attachProjectHubIntegrationToolToAgent(agent) {
    const sessionId = agent?.session?.id || agent?.id
    if (!this.bridgeToolScopeActive) throw new Error('Project Hub tool scope is closing')
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('cannot attach Project Hub tool to an unidentified Agent')
    const registered = this.bridgeAgentToolDisposers.get(sessionId)
    const tools = agent?.ctx?.tools
    if (registered?.agent === agent && (typeof tools?.get !== 'function' || (tools.get('project_hub_integrations', agent) && tools.get('project_hub_manage', agent)))) return
    if (registered) this.detachBridgeAgentTool(sessionId)
    if (typeof tools?.register !== 'function') throw new Error('resumed Agent tool scope is unavailable')
    const disposers = []
    if (typeof tools.get !== 'function' || !tools.get('project_hub_integrations', agent)) disposers.push(tools.register(this.createIntegrationToolDefinition()))
    if (typeof tools.get !== 'function' || !tools.get('project_hub_manage', agent)) disposers.push(tools.register(this.createProjectManagementToolDefinition()))
    if (!disposers.length) return
    const dispose = () => { for (const unregister of disposers.reverse()) unregister() }
    this.bridgeAgentToolDisposers.set(sessionId, { agent, dispose })
  },

  ensureProjectHubAgentTools(agent, tools = agent?.ctx?.tools, { validatePreviousTools = false } = {}) {
    if (typeof tools?.register !== 'function') throw new Error('Project Hub Agent tool scope is unavailable')
    const previousTools = agent?.session?.requestHeader?.()?.tools || []
    if (previousTools.some((tool) => tool.name === 'run_code') && !tools.get('run_code', agent)) {
      if (typeof tools.presentAs !== 'function') throw new Error('resumed agent cannot restore its previous run_code presentation mode')
      try { tools.presentAs('ptc') }
      catch (error) { throw new Error('resumed agent could not restore its previous run_code presentation mode', { cause: error }) }
    }
    this.attachProjectHubIntegrationToolToAgent(agent)
    if (validatePreviousTools) {
      const unavailable = previousTools.map((tool) => tool.name).filter((name) => name && name !== 'project_hub_manage' && !tools.get(name, agent))
      if (unavailable.length) throw new Error(`resumed agent is missing tools from its previous request: ${unavailable.join(', ')}`)
    }
  },

  detachBridgeAgentTool(sessionId, expectedAgent) {
    const registration = this.bridgeAgentToolDisposers.get(sessionId)
    if (!registration || (expectedAgent && registration.agent !== expectedAgent)) return
    try { registration.dispose() } catch (error) { this.ctx.logger.warn(`project-hub: failed to detach an Agent-scoped tool (${bridgeJournalErrorCode(error)})`) }
    if (this.bridgeAgentToolDisposers.get(sessionId) === registration) this.bridgeAgentToolDisposers.delete(sessionId)
  },

  disposeBridgeAgentTools() {
    for (const sessionId of [...this.bridgeAgentToolDisposers.keys()]) this.detachBridgeAgentTool(sessionId)
  },
  }
}

