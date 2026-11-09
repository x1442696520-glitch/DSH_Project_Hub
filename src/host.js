import * as HOST_SHARED from './host/shared.js'
import { createToolingMethods } from './host/tooling.js'
import { createFilesMethods } from './host/files.js'
import { createProjectStoreMethods } from './host/project-store.js'
import { createBridgeMethods } from './host/bridge.js'
import { createFeishuStateMethods } from './host/feishu-state.js'
import { createWecomStateMethods } from './host/wecom-state.js'
import { createWecomRuntimeMethods } from './host/wecom-runtime.js'
import { createFeishuRepliesMethods } from './host/feishu-replies.js'
import { createFeishuInboundMethods } from './host/feishu-inbound.js'
import { createAgentToolsMethods } from './host/agent-tools.js'
import { createRoutesMethods } from './host/routes.js'

class ProjectHub extends HOST_SHARED.Service {
  static inject = ['connection', 'fs', 'shell', 'sandboxPolicy', 'workspaceRegistry', 'sessions', 'sessionPersistence', 'agents', 'agentPresets']
  ensureProjects = new Map()
  bridgeJournalQueues = new Map()
  bridgeAutoResumeAttempts = new Map()
  bridgeAgentToolDisposers = new Map()
  agentPresetRestoreAttempts = new Map()
  agentPresetRestorationStatus = new Map()
  agentPresetRestoreGeneration = 0
  projectAssistantSessions = new Set()
  bridgeToolScopeActive = false
  bridgeToolScopeReady = undefined
  bridgeJournalDiagnostics = { lastFailure: null }
  feishuDurableOutbox = new Map()
  feishuOutboxRecoveryRunning = false
  wecomClient = null
  createWeComClient = (options) => new HOST_SHARED.WeComAIBotClient(options)
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
  createFeishuClient = (options) => new HOST_SHARED.FeishuClient(options)
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
  activeInboundFileBatches = 0
  externalMessageOrigins = new Map()
  feishuInboundDiagnostics = { sequence: 0, receivedCount: 0, lastAt: null, lastType: null, lastOutcome: 'none', rejectedCount: 0, lastRejectAt: null, lastRejectReason: null, dispatcherErrorCount: 0, lastDispatcherErrorAt: null, lastDispatcherErrorCode: null }
  feishuCardActionDiagnostics = { count: 0, lastAt: null, lastOutcome: 'none', selectedProject: null, activeProject: null, clickedCanonicalCard: null, oldCardRecall: null }
  feishuReplyDiagnostics = { pendingCount: 0, sentCount: 0, failedCount: 0, uncertainCount: 0, lastAt: null, lastOutcome: 'none', lastErrorCode: null }

  constructor(ctx) {
    super(ctx, 'projectHub')
    this.root = ctx.sandboxPolicy.workspaceRoot
    ctx.on('session/event', (session, event) => this.handleSessionEvent(session, event))
    ctx.on('agent/created', ({ agent }) => {
      if (!this.bridgeToolScopeActive) return
      const restoreGeneration = this.agentPresetRestoreGeneration
      return this.attachProjectHubToolIfOwned(agent, { expectedGeneration: restoreGeneration }).catch((error) => this.ctx.logger.warn(`project-hub: could not attach the scoped assistant tool (${HOST_SHARED.bridgeJournalErrorCode(error)})`))
    })
    ctx.effect(() => ctx.connection.fetch.register({
      path: HOST_SHARED.ROUTE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: (request) => this.handleScoped(request)
    }), 'project-hub: api route')
    ctx.effect(() => {
      this.bridgeToolScopeActive = true
      this.agentPresetRestoreGeneration++
      this.bridgeToolScopeReady = this.attachProjectHubToolsToLiveAgents()
      void this.bridgeToolScopeReady.catch((error) => this.ctx.logger.warn(`project-hub: could not restore scoped assistant tools (${HOST_SHARED.bridgeJournalErrorCode(error)})`))
      return () => {
        this.bridgeToolScopeActive = false
        this.agentPresetRestoreGeneration++
        this.bridgeToolScopeReady = undefined
        this.disposeBridgeAgentTools()
        this.projectAssistantSessions.clear()
        this.agentPresetRestorationStatus.clear()
      }
    }, 'project-hub: scoped assistant tools')
    ctx.effect(() => this.startWeComConnection(), 'project-hub: wecom ai bot long connection')
    ctx.effect(() => this.startFeishuConnection(), 'project-hub: feishu official long connection')
  }

}

Object.assign(
  ProjectHub.prototype,
  createToolingMethods(HOST_SHARED),
  createFilesMethods(HOST_SHARED),
  createProjectStoreMethods(HOST_SHARED),
  createBridgeMethods(HOST_SHARED),
  createFeishuStateMethods(HOST_SHARED),
  createWecomStateMethods(HOST_SHARED),
  createWecomRuntimeMethods(HOST_SHARED),
  createFeishuRepliesMethods(HOST_SHARED),
  createFeishuInboundMethods(HOST_SHARED),
  createAgentToolsMethods(HOST_SHARED),
  createRoutesMethods(HOST_SHARED)
)

export default ProjectHub

