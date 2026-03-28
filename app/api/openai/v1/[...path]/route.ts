import { NextRequest, NextResponse } from 'next/server'
import { decr, getJson, getNumber, incr, keys, KEYS, pushJsonList, setJson } from '@/lib/minimemory'
import { AgentProfile, DispatchConfig, LlamaService, RunEventType, RunRecord, SessionRecord, TaskPriority } from '@/types'
import { listAgents } from '@/lib/agents'
import { getDispatchConfig } from '@/lib/orchestrator'
import { addTaskChild, appendTaskEvent, createTask, releaseTaskLease, setTaskResult, updateTask, upsertTaskLease } from '@/lib/tasks'
import { generateId } from '@/lib/utils'

function stableHash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return h >>> 0
}

function requiresModel(upstreamPath: string): boolean {
  return upstreamPath === '/v1/chat/completions' || upstreamPath === '/v1/embeddings' || upstreamPath === '/v1/completions'
}

type StickyRoute = {
  serviceId: string
  host: string
  port: number
  model?: string
  updatedAt: number
}

const RUN_TTL_MS = 24 * 60 * 60 * 1000
const RUN_EVENTS_LIMIT = 200
const RUN_LIST_LIMIT = 200

function getSessionKey(request: NextRequest, parsedJson: any): string | null {
  const sessionId = parsedJson?.session_id
  if (typeof sessionId === 'string' && sessionId.trim()) return sessionId.trim()

  const headerKeys = ['x-session-id', 'x-agent-id', 'x-client-id']
  for (const headerKey of headerKeys) {
    const headerValue = request.headers.get(headerKey)
    if (headerValue && headerValue.trim()) return headerValue.trim()
  }

  return null
}

function getRequestedAgentId(request: NextRequest, parsedJson: any): string | null {
  const candidates = [
    parsedJson?.agentId,
    parsedJson?.agent_id,
    parsedJson?.metadata?.agentId,
    parsedJson?.metadata?.agent_id,
    request.headers.get('x-agent-profile'),
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

function getRequestedCapabilities(request: NextRequest, parsedJson: any): string[] {
  const capabilities = new Set<string>()
  const candidateArrays = [
    parsedJson?.requiredCapabilities,
    parsedJson?.required_capabilities,
    parsedJson?.metadata?.requiredCapabilities,
    parsedJson?.metadata?.required_capabilities,
  ]

  for (const candidate of candidateArrays) {
    if (!Array.isArray(candidate)) continue
    for (const item of candidate) {
      if (typeof item === 'string' && item.trim()) {
        capabilities.add(item.trim())
      }
    }
  }

  const headerValue = request.headers.get('x-agent-capabilities')
  if (headerValue) {
    for (const item of headerValue.split(',')) {
      if (item.trim()) capabilities.add(item.trim())
    }
  }

  if (Array.isArray(parsedJson?.tools) && parsedJson.tools.length > 0) {
    capabilities.add('tools')
  }

  return Array.from(capabilities)
}

function toSessionRouteKey(rawSessionKey: string): string {
  return stableHash(rawSessionKey).toString(16)
}

function toModelRouteKey(model: string): string {
  return stableHash(model).toString(16)
}

function normalizeModelText(input: string): string {
  const s = String(input || '').trim().toLowerCase()
  if (!s) return ''

  const noQuery = s.split('?')[0].split('#')[0]
  const lastSlash = Math.max(noQuery.lastIndexOf('/'), noQuery.lastIndexOf('\\'))
  const base = lastSlash >= 0 ? noQuery.slice(lastSlash + 1) : noQuery

  return base
    .replace(/\.gguf$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function serviceMatchesModel(service: LlamaService, model: string): boolean {
  if (service.model === model) return true
  if (service.name === model) return true
  if (service.id === model) return true
  const sepIdx = model.indexOf('::')
  if (sepIdx > 0) {
    const maybeId = model.slice(0, sepIdx)
    if (service.id === maybeId) return true
  }

  const reqNorm = normalizeModelText(model)
  if (!reqNorm) return false

  const serviceModelNorm = normalizeModelText(service.model || '')
  if (serviceModelNorm && serviceModelNorm === reqNorm) return true

  const serviceNameNorm = normalizeModelText(service.name || '')
  if (serviceNameNorm && serviceNameNorm === reqNorm) return true

  const servicePathNorm = normalizeModelText(service.modelPath || '')
  if (servicePathNorm) {
    if (servicePathNorm === reqNorm) return true
    if (servicePathNorm.includes(reqNorm) && reqNorm.length >= 6) return true
    if (reqNorm.includes(servicePathNorm) && servicePathNorm.length >= 6) return true
  }
  return false
}

function extractFieldFromRawText(rawText: string, field: 'model' | 'session_id'): string | null {
  if (!rawText || typeof rawText !== 'string') return null
  const text = rawText.trim()
  if (!text) return null

  if (text.includes('=') && (text.includes('&') || !text.startsWith('{'))) {
    try {
      const params = new URLSearchParams(text)
      const v = params.get(field)
      if (v && v.trim()) return v.trim()
    } catch {
      // ignore
    }
  }

  const jsonDouble = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`)
  const m1 = text.match(jsonDouble)
  if (m1?.[1]) return m1[1].trim()

  const jsonSingle = new RegExp(`'${field}'\\s*:\\s*'([^']+)'`)
  const m2 = text.match(jsonSingle)
  if (m2?.[1]) return m2[1].trim()

  return null
}

function pickWeighted(
  services: LlamaService[],
  affinityKey?: string | null
): LlamaService {
  const weights = services.map(s => Math.max(0, Number(s.weight) || 0))
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (totalWeight <= 0) return services[0]

  let r = Math.random() * totalWeight
  if (affinityKey) {
    const bucket = stableHash(affinityKey) % 1_000_000
    r = (bucket / 1_000_000) * totalWeight
  }

  for (let i = 0; i < services.length; i++) {
    r -= weights[i]
    if (r <= 0) return services[i]
  }
  return services[services.length - 1]
}

async function pickLeastConnections(services: LlamaService[]): Promise<LlamaService> {
  let selected = services[0]
  let minActive = Number.POSITIVE_INFINITY

  for (const service of services) {
    const active = await getNumber(KEYS.SERVICE_ACTIVE(service.id))
    if (active < minActive) {
      minActive = active
      selected = service
    }
  }

  return selected
}

async function pickServiceByModel(
  services: LlamaService[],
  model?: string | null,
  affinityKey?: string | null,
  dispatchConfig?: DispatchConfig | null
): Promise<LlamaService | null> {
  const online = services.filter(s => s.status === 'online' && s.enabled !== false)
  if (!online.length) return null
  const stableOnline = [...online].sort((a, b) => (a.id || '').localeCompare(b.id || ''))
  if (model) {
    const candidates = stableOnline.filter(s => serviceMatchesModel(s, model))
    if (!candidates.length) return null

    if (candidates.length > 1) {
      const stableCandidates = [...candidates].sort((a, b) => {
        const pa = Number(a.port) || 0
        const pb = Number(b.port) || 0
        if (pa !== pb) return pa - pb
        return (a.id || '').localeCompare(b.id || '')
      })

      const primaries = candidates.filter(s => Boolean(s.primaryReplica))
      if (primaries.length === 1) return primaries[0]
      if (primaries.length > 1) return null

      const groups = new Set(candidates.map(s => (s.replicaGroup || '').trim()).filter(Boolean))
      if (groups.size !== 1) return stableCandidates[0]
      const groupName = Array.from(groups)[0]
      const enabledGroup = (dispatchConfig?.replicaGroup || '').trim()
      if (!enabledGroup || enabledGroup !== groupName) return stableCandidates[0]

      const strategy = dispatchConfig?.strategy || 'weighted'
      if (strategy === 'least-connections') {
        return await pickLeastConnections(stableCandidates)
      }

      if (strategy === 'round-robin') {
        const n = await incr(KEYS.REPLICA_RR(groupName))
        const idx = (Math.max(1, n) - 1) % candidates.length
        return stableCandidates[idx] || stableCandidates[0]
      }

      return pickWeighted(stableCandidates, affinityKey)
    }

    return candidates[0]
  }

  if (affinityKey) {
    const idx = stableHash(affinityKey) % stableOnline.length
    return stableOnline[idx] || stableOnline[0]
  }
  return stableOnline[0]
}

function sanitizeBodyForLlamaCpp(upstreamPath: string, body: any, supportsTools: boolean): any {
  if (!body || typeof body !== 'object') return body
  if (upstreamPath !== '/v1/chat/completions') return body
  if (supportsTools) return body

  const cleaned = { ...body }
  delete cleaned.tools
  delete cleaned.tool_choice
  delete cleaned.session_id
  delete cleaned.use_server_history
  delete cleaned.trace
  delete cleaned.max_steps
  delete cleaned.max_tool_calls
  return cleaned
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isBusyBody(text: string): boolean {
  if (!text) return false
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  return normalized.includes('"error":"busy"') || normalized.includes('"error": "busy"') || normalized.includes('busy')
}

async function isRetryableBusyResponse(response: Response): Promise<boolean> {
  if (![429, 502, 503].includes(response.status)) return false
  try {
    const bodyText = await response.clone().text()
    return isBusyBody(bodyText)
  } catch {
    return false
  }
}

async function listServices(): Promise<LlamaService[]> {
  const serviceKeys = await keys('llama:service:*')
  const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))
  const services: LlamaService[] = []
  for (const id of serviceIds) {
    const service = await getJson<LlamaService>(KEYS.SERVICE(id))
    if (service) services.push(service)
  }
  return services
}

function filterServicesForAgent(services: LlamaService[], agent: AgentProfile | null): LlamaService[] {
  const enabled = services.filter(service => service.status === 'online' && service.enabled !== false)
  if (!agent) return enabled
  if (!agent.enabled) return []

  let scoped = enabled
  if (agent.serviceIds.length > 0) {
    const serviceSet = new Set(agent.serviceIds)
    scoped = scoped.filter(service => serviceSet.has(service.id))
  }
  if (agent.capabilities.length > 0) {
    scoped = scoped.filter(service => agent.capabilities.some(capability => service.capabilities.includes(capability)))
  }
  return scoped
}

function scoreAgentForRequest(
  agent: AgentProfile,
  services: LlamaService[],
  model: string | null,
  requiredCapabilities: string[]
): number {
  if (!agent.enabled) return Number.NEGATIVE_INFINITY
  const scopedServices = filterServicesForAgent(services, agent)
  if (scopedServices.length === 0) return Number.NEGATIVE_INFINITY

  if (requiredCapabilities.length > 0) {
    const capabilityScore = requiredCapabilities.filter(capability => agent.capabilities.includes(capability)).length
    if (capabilityScore === 0) {
      const matchedServiceCapabilities = scopedServices.some(service =>
        requiredCapabilities.some(capability => service.capabilities.includes(capability))
      )
      if (!matchedServiceCapabilities) return Number.NEGATIVE_INFINITY
    }
  }

  const matchingServices = model
    ? scopedServices.filter(service => serviceMatchesModel(service, model))
    : scopedServices
  if (matchingServices.length === 0) return Number.NEGATIVE_INFINITY

  let score = 0
  if (model && agent.defaultModel && serviceMatchesModel({ ...matchingServices[0], model: agent.defaultModel } as LlamaService, model)) {
    score += 60
  }
  if (agent.preferredServiceId && matchingServices.some(service => service.id === agent.preferredServiceId)) {
    score += 40
  }
  score += matchingServices.length * 3
  score += requiredCapabilities.filter(capability => agent.capabilities.includes(capability)).length * 20
  if (agent.role && agent.role !== 'general') score += 5
  return score
}

async function selectAgentForRequest(input: {
  requestedAgentId: string | null
  services: LlamaService[]
  model: string | null
  requiredCapabilities: string[]
}): Promise<{ agent: AgentProfile | null; selectionMode: 'requested' | 'auto' | 'none' }> {
  if (input.requestedAgentId) {
    return {
      agent: await getJson<AgentProfile>(KEYS.AGENT(input.requestedAgentId)),
      selectionMode: 'requested',
    }
  }

  const agents = await listAgents()
  const ranked = agents
    .map((agent) => ({
      agent,
      score: scoreAgentForRequest(agent, input.services, input.model, input.requiredCapabilities),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score || b.agent.updatedAt - a.agent.updatedAt)

  return {
    agent: ranked[0]?.agent || null,
    selectionMode: ranked[0] ? 'auto' : 'none',
  }
}

async function handleModels(request: NextRequest) {
  const services = await listServices()
  const requestedAgentId = getRequestedAgentId(request, null)
  const agent = requestedAgentId ? await getJson<AgentProfile>(KEYS.AGENT(requestedAgentId)) : null
  const models = services
    .filter(service => filterServicesForAgent([service], agent).length > 0)
    .map(s => ({
      id: s.model || `${s.host}:${s.port}`,
      object: 'model',
      owned_by: s.name,
      created: Math.floor((s.createdAt || Date.now()) / 1000),
    }))

  const res = NextResponse.json({ object: 'list', data: models })
  res.headers.set('x-orchestrator-gateway', 'llama.cpp_dashboard')
  return res
}

function shouldCountServiceError(status: number): boolean {
  return status === 429 || status >= 500
}

function withRunHeader(response: NextResponse, runId: string, taskId?: string): NextResponse {
  response.headers.set('x-orchestrator-run-id', runId)
  if (taskId) response.headers.set('x-orchestrator-task-id', taskId)
  return response
}

function getRequestedTaskPriority(request: NextRequest, parsedJson: any): TaskPriority {
  const candidates = [
    parsedJson?.taskPriority,
    parsedJson?.task_priority,
    parsedJson?.metadata?.taskPriority,
    parsedJson?.metadata?.task_priority,
    request.headers.get('x-task-priority'),
  ]

  for (const candidate of candidates) {
    if (candidate === 'low' || candidate === 'normal' || candidate === 'high' || candidate === 'urgent') {
      return candidate
    }
  }

  return 'normal'
}

function toOpenAIErrorPayload(input: {
  message: string
  type?:
    | 'api_error'
    | 'invalid_request_error'
    | 'authentication_error'
    | 'permission_error'
    | 'rate_limit_error'
    | 'server_error'
  code?: string | null
  param?: string | null
}) {
  return {
    error: {
      message: input.message,
      type: input.type || 'api_error',
      param: input.param ?? null,
      code: input.code ?? null,
    },
  }
}

function toOpenAIErrorType(status: number) {
  if (status === 400 || status === 404) return 'invalid_request_error' as const
  if (status === 401) return 'authentication_error' as const
  if (status === 403) return 'permission_error' as const
  if (status === 429) return 'rate_limit_error' as const
  if (status >= 500) return 'server_error' as const
  return 'api_error' as const
}

function normalizeUpstreamErrorMessage(
  parsed: unknown,
  fallback: string
): { message: string; code: string | null; param: string | null } {
  if (!parsed) return { message: fallback, code: null, param: null }
  if (typeof parsed === 'string') return { message: parsed || fallback, code: null, param: null }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return { message: fallback, code: null, param: null }

  const record = parsed as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : null
  const detail = typeof record.detail === 'string' ? record.detail : ''

  const errorField = record.error
  if (typeof errorField === 'string') {
    const msg = errorField || fallback
    return { message: detail && detail !== msg ? `${msg}: ${detail}` : msg, code, param: null }
  }
  if (errorField && typeof errorField === 'object' && !Array.isArray(errorField)) {
    const errObj = errorField as Record<string, unknown>
    const message = typeof errObj.message === 'string' ? errObj.message : fallback
    const errType = typeof errObj.type === 'string' ? errObj.type : ''
    const errCode = typeof errObj.code === 'string' ? errObj.code : code
    const normalizedMessage = detail && detail !== message ? `${message}: ${detail}` : message

    if (
      errType === 'exceed_context_size_error' ||
      normalizedMessage.toLowerCase().includes('exceeds the available context size')
    ) {
      return {
        message: normalizedMessage,
        code: 'context_length_exceeded',
        param: 'messages',
      }
    }

    return { message: normalizedMessage, code: errCode ?? null, param: null }
  }

  const message = typeof record.message === 'string' ? record.message : fallback
  return { message: detail && detail !== message ? `${message}: ${detail}` : message, code, param: null }
}

function createStreamingResponse(
  upstreamRes: Response,
  headers: Headers,
  finalize: () => Promise<void>
): NextResponse {
  let finalized = false

  const finalizeOnce = async () => {
    if (finalized) return
    finalized = true
    try {
      await finalize()
    } catch (error) {
      console.error('Failed to finalize run state:', error)
    }
  }

  if (!upstreamRes.body) {
    void finalizeOnce()
    return new NextResponse(null, {
      status: upstreamRes.status,
      headers,
    })
  }

  const reader = upstreamRes.body.getReader()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          await finalizeOnce()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
        await finalizeOnce()
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        await finalizeOnce()
      }
    },
  })

  return new NextResponse(stream, {
    status: upstreamRes.status,
    headers,
  })
}

async function createBufferedResponse(
  upstreamRes: Response,
  headers: Headers,
  finalize: () => Promise<void>
): Promise<NextResponse> {
  const body = await upstreamRes.arrayBuffer()
  const status = upstreamRes.status
  const upstreamContentType = upstreamRes.headers.get('content-type') || ''

  if (!upstreamRes.ok) {
    const buf = Buffer.from(body)
    const text = buf.toString('utf8')
    const fallback = `Upstream HTTP ${status}`

    let parsed: unknown = null
    if (upstreamContentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = null
      }
    }

    const { message, code, param } = normalizeUpstreamErrorMessage(parsed, fallback)
    headers.set('content-type', 'application/json; charset=utf-8')
    const response = NextResponse.json(toOpenAIErrorPayload({
      message,
      type: toOpenAIErrorType(status),
      code,
      param,
    }), { status, headers })
    void finalize().catch((error) => {
      console.error('Failed to finalize buffered run state:', error)
    })
    return response
  }

  const response = new NextResponse(body, { status, headers })
  void finalize().catch((error) => {
    console.error('Failed to finalize buffered run state:', error)
  })
  return response
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  if (path.length === 1 && path[0] === 'models') {
    return handleModels(request)
  }
  return NextResponse.json(toOpenAIErrorPayload({
    message: 'Not found',
    type: 'invalid_request_error',
  }), { status: 404 })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const upstreamPath = `/v1/${path.join('/')}`
  const runId = generateId()
  const startedAt = Date.now()

  const contentType = request.headers.get('content-type') || ''
  const raw = await request.arrayBuffer()
  const rawBuf = Buffer.from(raw)
  const rawText = rawBuf.toString('utf8')

  let parsedJson: any = null
  if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
    try {
      parsedJson = rawText ? JSON.parse(rawText) : null
    } catch {
      parsedJson = null
    }
  }

  const hintedModel =
    parsedJson && typeof parsedJson === 'object'
      ? parsedJson?.model
      : extractFieldFromRawText(rawText, 'model')
  const hintedSessionId =
    parsedJson && typeof parsedJson === 'object'
      ? parsedJson?.session_id
      : extractFieldFromRawText(rawText, 'session_id')
  const routingHints =
    parsedJson && typeof parsedJson === 'object'
      ? parsedJson
      : { model: hintedModel, session_id: hintedSessionId }

  const requestedAgentId = getRequestedAgentId(request, routingHints)
  let model = typeof routingHints?.model === 'string' ? routingHints.model : null
  const services = await listServices()
  const requiredCapabilities = getRequestedCapabilities(request, routingHints)
  let { agent: selectedAgent, selectionMode: agentSelectionMode } = await selectAgentForRequest({
    requestedAgentId,
    services,
    model,
    requiredCapabilities,
  })
  if (!model && selectedAgent?.defaultModel) {
    model = selectedAgent.defaultModel
    if (!requestedAgentId) {
      const reselection = await selectAgentForRequest({
        requestedAgentId,
        services,
        model,
        requiredCapabilities,
      })
      selectedAgent = reselection.agent
      agentSelectionMode = reselection.selectionMode
    }
  }
  const rawSessionKey = getSessionKey(request, routingHints)
  const sessionRouteKey = rawSessionKey ? toSessionRouteKey(rawSessionKey) : null
  const modelRouteKey = model ? toModelRouteKey(model) : null

  const runRecord: RunRecord = {
    id: runId,
    status: 'received',
    upstreamPath,
    method: request.method,
    agentId: selectedAgent?.id || requestedAgentId || undefined,
    agentName: selectedAgent?.name,
    model: model || undefined,
    sessionId: rawSessionKey || undefined,
    sessionRouteKey: sessionRouteKey || undefined,
    modelRouteKey: modelRouteKey || undefined,
    schedulingMode: 'direct',
    candidateCount: 0,
    retryCount: 0,
    startedAt,
  }
  const taskPriority = getRequestedTaskPriority(request, routingHints)
  const rootTask = await createTask({
    title: model ? `${upstreamPath} · ${model}` : upstreamPath,
    description: `gateway request ${request.method} ${upstreamPath}`,
    kind: 'gateway_request',
    status: 'pending',
    priority: taskPriority,
    runId,
    sessionId: rawSessionKey || undefined,
    requestedAgentId: requestedAgentId || undefined,
    assignedAgentId: selectedAgent?.id,
    assignedAgentName: selectedAgent?.name,
    payload: {
      upstreamPath,
      method: request.method,
      model: model || null,
      sessionId: rawSessionKey || null,
      requestedAgentId: requestedAgentId || null,
      contentType: contentType || null,
      stream: parsedJson?.stream === true,
    },
  })
  const taskId = rootTask.id

  const writeRun = async (patch: Partial<RunRecord> = {}) => {
    Object.assign(runRecord, patch)
    await setJson(KEYS.RUN(runId), runRecord, RUN_TTL_MS)
  }

  const pushRunEvent = async (
    type: RunEventType,
    patch: Omit<Partial<RunRecord>, 'status' | 'retryCount' | 'candidateCount'> & {
      detail?: string
      metadata?: Record<string, unknown>
    } = {}
  ) => {
    const event = {
      runId,
      type,
      timestamp: Date.now(),
      serviceId: patch.serviceId,
      serviceName: patch.serviceName,
      detail: patch.detail,
      metadata: patch.metadata,
    }
    await pushJsonList(KEYS.RUN_EVENTS(runId), event, {
      maxLength: RUN_EVENTS_LIMIT,
      ttlMs: RUN_TTL_MS,
    })
  }

  const pushRunIndex = async (key: string) => {
    await pushJsonList(key, runId, {
      maxLength: RUN_LIST_LIMIT,
      ttlMs: RUN_TTL_MS,
    })
  }

  const updateSessionRecord = async (patch: Partial<SessionRecord>) => {
    if (!rawSessionKey) return
    const existing = await getJson<SessionRecord>(KEYS.SESSION(rawSessionKey))
    const next: SessionRecord = {
      sessionId: rawSessionKey,
      ...(existing || {}),
      ...patch,
      updatedAt: Date.now(),
    }
    await setJson(KEYS.SESSION(rawSessionKey), next, RUN_TTL_MS)
  }

  const writeTask = async (patch: Parameters<typeof updateTask>[1]) => {
    await updateTask(taskId, patch)
  }

  const pushTaskEvent = async (type: Parameters<typeof appendTaskEvent>[1]['type'], detail: string, metadata?: Record<string, unknown>) => {
    await appendTaskEvent(taskId, {
      type,
      detail,
      metadata,
      actorId: selectedAgent?.id || 'gateway',
      actorType: selectedAgent ? 'agent' : 'system',
    })
  }

  let runFinalized = false
  let agentRuntimeStarted = false
  let agentRuntimeReleased = false
  let taskLeaseReleased = false

  const startAgentRuntime = async () => {
    if (!selectedAgent || agentRuntimeStarted) return
    agentRuntimeStarted = true
    await Promise.all([
      incr(KEYS.AGENT_ACTIVE(selectedAgent.id)),
      incr(KEYS.AGENT_TOTAL(selectedAgent.id)),
      pushRunIndex(KEYS.RUNS_BY_AGENT(selectedAgent.id)),
    ])
  }

  const releaseAgentRuntime = async (failed: boolean) => {
    if (!selectedAgent || !agentRuntimeStarted || agentRuntimeReleased) return
    agentRuntimeReleased = true
    const nextActive = await decr(KEYS.AGENT_ACTIVE(selectedAgent.id))
    if (nextActive < 0) {
      await setJson(KEYS.AGENT_ACTIVE(selectedAgent.id), 0)
    }
    if (failed) {
      await incr(KEYS.AGENT_ERROR(selectedAgent.id))
    }
  }

  const finalizeRun = async (status: 'completed' | 'failed', error?: string) => {
    if (runFinalized) return
    runFinalized = true
    const completedAt = Date.now()
    const failed = status === 'failed'

    await writeRun({
      status,
      completedAt,
      latencyMs: completedAt - startedAt,
      error,
      retryCount: runRecord.retryCount,
      candidateCount: runRecord.candidateCount,
    })

    await pushRunEvent(failed ? 'failed' : 'completed', {
      serviceId: runRecord.serviceId,
      serviceName: runRecord.serviceName,
      detail: error,
      metadata: {
        latencyMs: completedAt - startedAt,
        retryCount: runRecord.retryCount,
        upstreamStatus: failed ? undefined : 'completed',
      },
    })

    await Promise.all([
      releaseAgentRuntime(failed),
      updateSessionRecord({
        currentRunId: undefined,
        lastRunId: runId,
        lastModel: model || undefined,
        boundServiceId: runRecord.serviceId,
      }),
      setTaskResult(taskId, {
        status: failed ? 'error' : 'success',
        summary: error || (failed ? 'gateway request failed' : 'gateway request completed'),
        output: {
          runId,
          upstreamPath,
          model: model || null,
          serviceId: runRecord.serviceId || null,
          serviceName: runRecord.serviceName || null,
          retryCount: runRecord.retryCount,
          candidateCount: runRecord.candidateCount,
          latencyMs: completedAt - startedAt,
        },
        metadata: {
          runId,
          completedAt,
          serviceId: runRecord.serviceId || null,
          serviceName: runRecord.serviceName || null,
          failed,
        },
      }),
      taskLeaseReleased
        ? Promise.resolve()
        : releaseTaskLease(taskId, {
          holderId: selectedAgent?.id || 'gateway',
        }).finally(() => {
          taskLeaseReleased = true
        }),
    ])
  }

  await writeRun()
  await pushRunEvent('received', {
    detail: 'request received',
    metadata: { upstreamPath, method: request.method },
  })
  await pushRunEvent('parsed', {
    detail: 'request parsed',
    metadata: {
      model: model || null,
      sessionId: rawSessionKey || null,
      agentId: requestedAgentId || null,
    },
  })
  await pushTaskEvent('status_changed', 'request parsed into task context', {
    model: model || null,
    sessionId: rawSessionKey || null,
    requestedAgentId: requestedAgentId || null,
    selectedAgentId: selectedAgent?.id || null,
    agentSelectionMode,
    requiredCapabilities,
  })
  if (selectedAgent && agentSelectionMode === 'auto' && !requestedAgentId) {
    await pushRunEvent('parsed', {
      detail: `auto selected agent ${selectedAgent.name}`,
      metadata: {
        selectedAgentId: selectedAgent.id,
        selectedAgentName: selectedAgent.name,
        requiredCapabilities,
      },
    })
  }
  await pushRunIndex(KEYS.RUNS_RECENT)
  if (rawSessionKey) {
    await pushRunIndex(KEYS.RUNS_BY_SESSION(rawSessionKey))
    await updateSessionRecord({
      currentRunId: runId,
      lastRunId: runId,
      lastModel: model || undefined,
    })
  }

  if (requestedAgentId && !selectedAgent) {
    await writeRun({ status: 'failed' })
    await writeTask({ error: `Agent profile not found: ${requestedAgentId}` })
    await finalizeRun('failed', `Agent profile not found: ${requestedAgentId}`)
    return withRunHeader(NextResponse.json(
      toOpenAIErrorPayload({
        message: `Agent profile not found: ${requestedAgentId}`,
        type: 'invalid_request_error',
      }),
      { status: 400 }
    ), runId, taskId)
  }

  if (selectedAgent && !selectedAgent.enabled) {
    await writeRun({ status: 'failed' })
    await writeTask({ error: `Agent profile is disabled: ${selectedAgent.name}` })
    await finalizeRun('failed', `Agent profile is disabled: ${selectedAgent.name}`)
    return withRunHeader(NextResponse.json(
      toOpenAIErrorPayload({
        message: `Agent profile is disabled: ${selectedAgent.name}`,
        type: 'invalid_request_error',
      }),
      { status: 400 }
    ), runId, taskId)
  }

  await upsertTaskLease(taskId, {
    holderId: selectedAgent?.id || 'gateway',
    holderType: selectedAgent ? 'agent' : 'system',
    ttlMs: 10 * 60 * 1000,
    metadata: {
      runId,
      upstreamPath,
      requestedAgentId: requestedAgentId || null,
    },
  })
  await writeTask({
    status: 'queued',
    assignedAgentId: selectedAgent?.id,
    assignedAgentName: selectedAgent?.name,
  })
  await startAgentRuntime()

  const dispatchConfig = await getDispatchConfig()
  const routedServices = filterServicesForAgent(services, selectedAgent)

  let selected: LlamaService | null = null
  let candidateCount = 0
  let schedulingMode: 'direct' | 'enabled' = 'direct'
  let retryCandidates: LlamaService[] = []

  if (model) {
    const candidates = routedServices.filter(s => serviceMatchesModel(s, model))
    candidateCount = candidates.length
    const stableCandidates = [...candidates].sort((a, b) => {
      const pa = Number(a.port) || 0
      const pb = Number(b.port) || 0
      if (pa !== pb) return pa - pb
      return (a.id || '').localeCompare(b.id || '')
    })

    const primaries = candidates.filter(s => Boolean(s.primaryReplica))
    const hasSinglePrimary = primaries.length === 1
    const groups = new Set(candidates.map(s => (s.replicaGroup || '').trim()).filter(Boolean))
    const groupName = groups.size === 1 ? Array.from(groups)[0] : null
    const enabledGroup = (dispatchConfig?.replicaGroup || '').trim()
    const schedulingEnabled = Boolean(!hasSinglePrimary && groupName && enabledGroup && enabledGroup === groupName)
    const baseModelNorm = normalizeModelText(stableCandidates[0]?.model || '')
    const allSameModelNorm = Boolean(
      baseModelNorm &&
        stableCandidates.length > 1 &&
        stableCandidates.every(s => normalizeModelText(s.model || '') === baseModelNorm)
    )
    const allInOneReplicaGroup = groups.size === 1 && Boolean(groupName)
    const canRetryAcrossCandidates = stableCandidates.length > 1 && (allSameModelNorm || allInOneReplicaGroup || schedulingEnabled)
    schedulingMode = schedulingEnabled ? 'enabled' : 'direct'
    retryCandidates = canRetryAcrossCandidates ? stableCandidates : []
    const preferredCandidate = selectedAgent?.preferredServiceId
      ? stableCandidates.find(service => service.id === selectedAgent.preferredServiceId) || null
      : null

    if (!schedulingEnabled) {
      if (preferredCandidate) {
        selected = preferredCandidate
      } else if (!hasSinglePrimary && stableCandidates.length > 1) {
        if (!allSameModelNorm && !allInOneReplicaGroup) {
          selected = null
        } else {
          selected = stableCandidates[0] || null
        }
      } else {
        selected = hasSinglePrimary ? primaries[0] : (stableCandidates[0] || null)
      }
    } else {
      if (preferredCandidate) {
        selected = preferredCandidate
      } else if (sessionRouteKey && modelRouteKey) {
        const stickyRoute = await getJson<StickyRoute>(KEYS.SESSION_ROUTE(sessionRouteKey, modelRouteKey))
        if (stickyRoute) {
          selected =
            routedServices.find(s => s.id === stickyRoute.serviceId) ||
            routedServices.find(s => s.host === stickyRoute.host && s.port === stickyRoute.port) ||
            null
        }
      }
      if (!selected) selected = await pickServiceByModel(routedServices, model, rawSessionKey, dispatchConfig)
    }
  } else {
    if (!selected && requiresModel(upstreamPath)) {
      await writeRun({ status: 'failed' })
      await writeTask({ error: 'model name is missing from the request' })
      await finalizeRun('failed', 'model name is missing from the request')
      return withRunHeader(NextResponse.json(
        toOpenAIErrorPayload({
          message: 'model name is missing from the request',
          type: 'invalid_request_error',
          param: 'model',
        }),
        { status: 400 }
      ), runId, taskId)
    }
  }

  if (!selected) {
    await writeRun({
      candidateCount,
      schedulingMode,
      status: 'failed',
    })
    await writeTask({
      retryCount: 0,
      error: 'No available service for model',
    })
    await finalizeRun('failed', 'No available service for model')
    return withRunHeader(NextResponse.json(
      toOpenAIErrorPayload({
        message: `No available service for model: ${model}. Check /v1/models or enable replicaGroup scheduling in config.`,
        type: 'invalid_request_error',
        param: 'model',
      }),
      { status: 400 }
    ), runId, taskId)
  }

  await writeRun({
    status: 'routed',
    serviceId: selected.id,
    serviceName: selected.name,
    serviceHost: selected.host,
    servicePort: selected.port,
    schedulingMode,
    candidateCount,
  })
  await writeTask({
    status: 'running',
    assignedAgentId: selectedAgent?.id,
    assignedAgentName: selectedAgent?.name,
  })
  await pushRunEvent('routed', {
    serviceId: selected.id,
    serviceName: selected.name,
    detail: `selected ${selected.name}`,
    metadata: {
      candidateCount,
      schedulingMode,
      serviceHost: selected.host,
      servicePort: selected.port,
    },
  })
  await pushTaskEvent('status_changed', `routed to ${selected.name}`, {
    serviceId: selected.id,
    serviceName: selected.name,
    serviceHost: selected.host,
    servicePort: selected.port,
    candidateCount,
    schedulingMode,
  })
  await pushRunIndex(KEYS.RUNS_BY_SERVICE(selected.id))

  if (parsedJson && typeof parsedJson === 'object' && parsedJson.model == null && selected.model) {
    parsedJson = { ...parsedJson, model: selected.model }
  }
  parsedJson = sanitizeBodyForLlamaCpp(upstreamPath, parsedJson, Boolean(selected.supportsTools))

  const headers = new Headers()
  headers.set('Content-Type', contentType || 'application/json')
  headers.set('Accept', request.headers.get('accept') || '*/*')

  if (selected.apiKey) {
    headers.set('Authorization', `Bearer ${selected.apiKey}`)
    headers.set('api-key', selected.apiKey)
  } else {
    const auth = request.headers.get('authorization')
    const apiKey = request.headers.get('api-key')
    if (auth) headers.set('Authorization', auth)
    if (apiKey) headers.set('api-key', apiKey)
  }

  const upstreamBody =
    parsedJson !== null
      ? JSON.stringify(parsedJson)
      : (rawBuf.length ? rawBuf : undefined)

  const finalizeAttemptTask = async (
    attemptTaskId: string,
    service: LlamaService,
    input: {
      taskFailed?: boolean
      detail?: string
      statusCode?: number
    } = {}
  ) => {
    await Promise.all([
      setTaskResult(attemptTaskId, {
        status: input.taskFailed ? 'error' : 'success',
        summary: input.detail || (input.taskFailed ? 'service attempt failed' : 'service attempt completed'),
        output: {
          runId,
          serviceId: service.id,
          serviceName: service.name,
          serviceHost: service.host,
          servicePort: service.port,
          statusCode: input.statusCode || null,
        },
        metadata: {
          runId,
          statusCode: input.statusCode || null,
          taskFailed: Boolean(input.taskFailed),
        },
      }),
      releaseTaskLease(attemptTaskId, { holderId: service.id }),
    ])
  }

  const beginServiceAttempt = async (service: LlamaService, reason: string, attempt: number) => {
    const attemptTask = await addTaskChild(taskId, {
      title: `${service.name} attempt ${attempt}`,
      description: `service attempt ${attempt} for ${upstreamPath}`,
      kind: 'service_attempt',
      status: 'running',
      priority: taskPriority,
      runId,
      sessionId: rawSessionKey || undefined,
      requestedAgentId: requestedAgentId || undefined,
      assignedAgentId: selectedAgent?.id,
      assignedAgentName: selectedAgent?.name,
      payload: {
        serviceId: service.id,
        serviceName: service.name,
        serviceHost: service.host,
        servicePort: service.port,
        model: model || null,
        reason,
        attempt,
      },
    })
    await upsertTaskLease(attemptTask.id, {
      holderId: service.id,
      holderType: 'worker',
      ttlMs: 10 * 60 * 1000,
      metadata: {
        runId,
        reason,
        attempt,
      },
    })

    await Promise.all([
      incr(KEYS.SERVICE_ACTIVE(service.id)),
      incr(KEYS.SERVICE_TOTAL(service.id)),
    ])

    let released = false

    return async (input: {
      countServiceError?: boolean
      taskFailed?: boolean
      detail?: string
      statusCode?: number
    } = {}) => {
      if (released) return
      released = true
      const nextActive = await decr(KEYS.SERVICE_ACTIVE(service.id))
      if (nextActive < 0) {
        await setJson(KEYS.SERVICE_ACTIVE(service.id), 0)
      }
      if (input.countServiceError) {
        await incr(KEYS.SERVICE_ERROR(service.id))
      }
      await finalizeAttemptTask(attemptTask.id, service, input)
    }
  }

  let nextAttempt = 1

  const fetchUpstream = async (service: LlamaService, reason: string) => {
    const release = await beginServiceAttempt(service, reason, nextAttempt)
    nextAttempt += 1
    const serviceUrl = `http://${service.host}:${service.port}${upstreamPath}`
    try {
      const response = await fetch(serviceUrl, {
        method: 'POST',
        headers,
        body: upstreamBody as any,
      })
      return { response, serviceUrl, release }
    } catch (error) {
      await release({
        countServiceError: true,
        taskFailed: true,
        detail: `Upstream fetch failed: ${String(error)}`,
      })
      throw error
    }
  }

  let upstreamRes: Response
  let selectedUrl = ''
  let releaseFinalAttempt: null | ((input?: {
    countServiceError?: boolean
    taskFailed?: boolean
    detail?: string
    statusCode?: number
  }) => Promise<void>) = null
  try {
    const result = await fetchUpstream(selected, 'initial')
    upstreamRes = result.response
    selectedUrl = result.serviceUrl
    releaseFinalAttempt = result.release
  } catch (error) {
    await writeTask({ error: `Upstream fetch failed: ${String(error)}` })
    await finalizeRun('failed', `Upstream fetch failed: ${String(error)}`)
    return withRunHeader(NextResponse.json(
      toOpenAIErrorPayload({
        message: `Upstream fetch failed: ${String(error)}`,
        type: 'server_error',
      }),
      { status: 502 }
    ), runId, taskId)
  }

  let retryCount = 0
  const sameServiceRetryDelays = [150, 350]
  let finalBusy = await isRetryableBusyResponse(upstreamRes)

  if (finalBusy) {
    for (const delayMs of sameServiceRetryDelays) {
      await releaseFinalAttempt?.({
        countServiceError: true,
        taskFailed: true,
        detail: `HTTP ${upstreamRes.status}`,
        statusCode: upstreamRes.status,
      })
      releaseFinalAttempt = null
      retryCount += 1
      await writeRun({ retryCount })
      await writeTask({ retryCount })
      await pushRunEvent('retry', {
        serviceId: selected.id,
        serviceName: selected.name,
        detail: `busy retry on same service after ${delayMs}ms`,
        metadata: { delayMs, attempt: retryCount },
      })
      await pushTaskEvent('updated', `busy retry on ${selected.name}`, {
        serviceId: selected.id,
        serviceName: selected.name,
        delayMs,
        retryCount,
      })
      await sleep(delayMs)
      try {
        const result = await fetchUpstream(selected, 'busy_retry_same_service')
        upstreamRes = result.response
        selectedUrl = result.serviceUrl
        releaseFinalAttempt = result.release
        finalBusy = await isRetryableBusyResponse(upstreamRes)
        if (!finalBusy) break
        await releaseFinalAttempt({
          countServiceError: true,
          taskFailed: true,
          detail: `HTTP ${upstreamRes.status}`,
          statusCode: upstreamRes.status,
        })
        releaseFinalAttempt = null
      } catch {
        releaseFinalAttempt = null
      }
    }
  }

  if (finalBusy && retryCandidates.length > 1) {
    await releaseFinalAttempt?.({
      countServiceError: true,
      taskFailed: true,
      detail: `HTTP ${upstreamRes.status}`,
      statusCode: upstreamRes.status,
    })
    releaseFinalAttempt = null
    for (const candidate of retryCandidates) {
      if (candidate.id === selected.id) continue
      try {
        retryCount += 1
        await writeRun({ retryCount })
        await writeTask({ retryCount })
        await pushRunEvent('retry', {
          serviceId: candidate.id,
          serviceName: candidate.name,
          detail: `switching candidate after busy response`,
          metadata: { attempt: retryCount, fromServiceId: selected.id },
        })
        await pushTaskEvent('updated', `switching candidate to ${candidate.name}`, {
          fromServiceId: selected.id,
          toServiceId: candidate.id,
          retryCount,
        })
        const result = await fetchUpstream(candidate, 'busy_retry_switch_candidate')
        finalBusy = await isRetryableBusyResponse(result.response)
        if (finalBusy) {
          await result.release({
            countServiceError: true,
            taskFailed: true,
            detail: `HTTP ${result.response.status}`,
            statusCode: result.response.status,
          })
          continue
        }
        selected = candidate
        upstreamRes = result.response
        selectedUrl = result.serviceUrl
        releaseFinalAttempt = result.release
        await writeRun({
          serviceId: selected.id,
          serviceName: selected.name,
          serviceHost: selected.host,
          servicePort: selected.port,
          retryCount,
        })
        break
      } catch {
        releaseFinalAttempt = null
      }
    }
  }

  if (model && sessionRouteKey && modelRouteKey && !finalBusy) {
    const route: StickyRoute = {
      serviceId: selected.id,
      host: selected.host,
      port: selected.port,
      model: selected.model,
      updatedAt: Date.now(),
    }
    await Promise.all([
      setJson(KEYS.SESSION_ROUTE(sessionRouteKey, modelRouteKey), route, 2 * 60 * 60 * 1000),
      rawSessionKey
        ? setJson(KEYS.AGENT_SESSION_ROUTE(rawSessionKey, modelRouteKey), route, 2 * 60 * 60 * 1000)
        : Promise.resolve(),
      updateSessionRecord({
        boundServiceId: selected.id,
        lastRunId: runId,
        lastModel: model || undefined,
      }),
    ])
  }

  const resHeaders = new Headers(upstreamRes.headers)
  resHeaders.delete('content-encoding')
  resHeaders.delete('content-length')
  resHeaders.set('x-orchestrator-gateway', 'llama.cpp_dashboard')
  resHeaders.set('x-orchestrator-run-id', runId)
  resHeaders.set('x-orchestrator-task-id', taskId)
  if (selectedAgent) resHeaders.set('x-orchestrator-agent-profile', selectedAgent.id)
  resHeaders.set('x-orchestrator-service-id', selected.id)
  resHeaders.set('x-orchestrator-upstream', `${selected.host}:${selected.port}`)
  if (sessionRouteKey) resHeaders.set('x-orchestrator-session', sessionRouteKey)
  if (modelRouteKey) resHeaders.set('x-orchestrator-model-key', modelRouteKey)
  if (typeof model === 'string') resHeaders.set('x-orchestrator-request-model', model)
  resHeaders.set('x-orchestrator-candidates', String(candidateCount))
  resHeaders.set('x-orchestrator-scheduling', schedulingMode)
  resHeaders.set('x-orchestrator-retries', String(retryCount))
  if (selectedUrl) resHeaders.set('x-orchestrator-final-url', selectedUrl)

  await writeRun({
    status: upstreamRes.ok ? 'running' : 'failed',
    serviceId: selected.id,
    serviceName: selected.name,
    serviceHost: selected.host,
    servicePort: selected.port,
    schedulingMode,
    candidateCount,
    retryCount,
    error: upstreamRes.ok ? undefined : `HTTP ${upstreamRes.status}`,
  })
  await writeTask({
    status: upstreamRes.ok ? 'running' : 'failed',
    retryCount,
    error: upstreamRes.ok ? undefined : `HTTP ${upstreamRes.status}`,
  })

  const upstreamContentType = upstreamRes.headers.get('content-type') || ''
  const expectsStreaming =
    parsedJson?.stream === true ||
    upstreamContentType.includes('text/event-stream') ||
    request.headers.get('accept')?.includes('text/event-stream')

  if (!upstreamRes.ok) {
    return await createBufferedResponse(upstreamRes, resHeaders, async () => {
      await releaseFinalAttempt?.({
        countServiceError: shouldCountServiceError(upstreamRes.status),
        taskFailed: true,
        detail: `HTTP ${upstreamRes.status}`,
        statusCode: upstreamRes.status,
      })
      await finalizeRun('failed', `HTTP ${upstreamRes.status}`)
    })
  }

  if (!expectsStreaming) {
    return await createBufferedResponse(upstreamRes, resHeaders, async () => {
      await releaseFinalAttempt?.({
        countServiceError: shouldCountServiceError(upstreamRes.status),
        taskFailed: !upstreamRes.ok,
        detail: upstreamRes.ok ? 'completed' : `HTTP ${upstreamRes.status}`,
        statusCode: upstreamRes.status,
      })
      await finalizeRun(
        upstreamRes.ok ? 'completed' : 'failed',
        upstreamRes.ok ? undefined : `HTTP ${upstreamRes.status}`
      )
    })
  }

  return createStreamingResponse(upstreamRes, resHeaders, async () => {
    await releaseFinalAttempt?.({
      countServiceError: shouldCountServiceError(upstreamRes.status),
      taskFailed: !upstreamRes.ok,
      detail: upstreamRes.ok ? 'completed' : `HTTP ${upstreamRes.status}`,
      statusCode: upstreamRes.status,
    })
    await finalizeRun(
      upstreamRes.ok ? 'completed' : 'failed',
      upstreamRes.ok ? undefined : `HTTP ${upstreamRes.status}`
    )
  })
}
