import { AgentProfile, AgentRuntimeStats, LlamaService, RunRecord } from '@/types'
import {
  deleteKey,
  getJson,
  getJsonList,
  getNumber,
  graphAddEdge,
  graphDelEdge,
  KEYS,
  keys,
  metaset,
  setJson,
} from '@/lib/minimemory'
import { generateId } from '@/lib/utils'

export async function listServices(): Promise<LlamaService[]> {
  const serviceKeys = await keys('llama:service:*')
  const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))
  const services = await Promise.all(
    serviceIds.map(id => getJson<LlamaService>(KEYS.SERVICE(id)))
  )

  return services
    .filter((service): service is LlamaService => Boolean(service))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function listAgents(): Promise<AgentProfile[]> {
  const agentKeys = await keys('agent:profile:*')
  const agentIds = agentKeys.map(key => key.slice('agent:profile:'.length))
  const agents = await Promise.all(
    agentIds.map(id => getJson<AgentProfile>(KEYS.AGENT(id)))
  )

  return agents
    .filter((agent): agent is AgentProfile => Boolean(agent))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getAgentProfile(id: string): Promise<AgentProfile | null> {
  return await getJson<AgentProfile>(KEYS.AGENT(id))
}

export async function getAgentRuntimeStats(
  agents: AgentProfile[],
  options: { activeRunStaleMs?: number; runSampleSize?: number } = {}
): Promise<Record<string, AgentRuntimeStats>> {
  const activeRunStaleMs = options.activeRunStaleMs ?? 5 * 60 * 1000
  const runSampleSize = options.runSampleSize ?? 20
  const activeRunStatuses = new Set<RunRecord['status']>(['received', 'routed', 'running'])
  const now = Date.now()

  const entries = await Promise.all(
    agents.map(async (agent) => {
      const [activeRunsRaw, totalRuns, failedRuns, agentRunIds] = await Promise.all([
        getNumber(KEYS.AGENT_ACTIVE(agent.id)),
        getNumber(KEYS.AGENT_TOTAL(agent.id)),
        getNumber(KEYS.AGENT_ERROR(agent.id)),
        getJsonList<string>(KEYS.RUNS_BY_AGENT(agent.id), 0, Math.max(0, runSampleSize - 1)),
      ])

      const recentRunsRaw = await Promise.all(
        agentRunIds.map((runId) => getJson<RunRecord>(KEYS.RUN(runId)))
      )
      const recentRuns = recentRunsRaw.filter((run): run is RunRecord => Boolean(run))
      const activeRuns = recentRuns.reduce((count, run) => {
        if (!activeRunStatuses.has(run.status)) return count
        return now - run.startedAt <= activeRunStaleMs ? count + 1 : count
      }, 0)
      const lastRun = recentRuns[0]
      const lastFailedRun = recentRuns.find((run) => run.status === 'failed')
      const successRate =
        totalRuns > 0
          ? Number((((totalRuns - failedRuns) / totalRuns) * 100).toFixed(1))
          : 0

      const stats: AgentRuntimeStats = {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        activeRuns: activeRuns || (activeRunsRaw > 0 ? 0 : activeRunsRaw),
        totalRuns,
        failedRuns,
        successRate,
        lastRunAt: lastRun?.startedAt,
        lastErrorAt: lastFailedRun?.completedAt || lastFailedRun?.startedAt,
      }

      return [agent.id, stats] as const
    })
  )

  return Object.fromEntries(entries)
}

export async function createAgentProfile(input: unknown): Promise<AgentProfile> {
  const services = await listServices()
  const now = Date.now()
  const normalized = normalizeAgentInput(input)
  const serviceIds = normalized.serviceIds || []
  const capabilities = normalized.capabilities || []
  const tools = normalized.tools || []
  validateServiceIds(serviceIds, services)
  validatePreferredServiceId(normalized.preferredServiceId, serviceIds, services)

  const agent: AgentProfile = {
    id: generateId(),
    name: normalized.name || `agent-${now}`,
    description: normalized.description,
    role: normalized.role,
    systemPrompt: normalized.systemPrompt,
    defaultModel: normalized.defaultModel,
    preferredServiceId: normalized.preferredServiceId,
    enabled: normalized.enabled ?? true,
    serviceIds,
    capabilities,
    tools,
    createdAt: now,
    updatedAt: now,
    metadata: normalized.metadata,
  }

  await setJson(KEYS.AGENT(agent.id), agent)
  await syncAgentGraph(null, agent)

  return agent
}

export async function updateAgentProfile(id: string, input: unknown): Promise<AgentProfile | null> {
  const existing = await getAgentProfile(id)
  if (!existing) return null

  const services = await listServices()
  const normalized = normalizeAgentInput(input)

  const next: AgentProfile = {
    ...existing,
    name: normalized.name ?? existing.name,
    description: normalized.description ?? existing.description,
    role: normalized.role ?? existing.role,
    systemPrompt: normalized.systemPrompt ?? existing.systemPrompt,
    defaultModel: normalized.defaultModel ?? existing.defaultModel,
    preferredServiceId: normalized.preferredServiceId ?? existing.preferredServiceId,
    enabled: normalized.enabled ?? existing.enabled,
    serviceIds: normalized.serviceIds ?? existing.serviceIds,
    capabilities: normalized.capabilities ?? existing.capabilities,
    tools: normalized.tools ?? existing.tools,
    metadata: normalized.metadata ?? existing.metadata,
    updatedAt: Date.now(),
  }

  validateServiceIds(next.serviceIds, services)
  validatePreferredServiceId(next.preferredServiceId, next.serviceIds, services)

  await setJson(KEYS.AGENT(id), next)
  await syncAgentGraph(existing, next)

  return next
}

export async function deleteAgentProfile(id: string): Promise<AgentProfile | null> {
  const existing = await getAgentProfile(id)
  if (!existing) return null

  await syncAgentGraph(existing, null)
  await deleteKey(KEYS.AGENT(id))

  return existing
}

function normalizeAgentInput(input: unknown): Partial<AgentProfile> {
  const body = isRecord(input) ? input : {}

  return {
    name: normalizeOptionalString(body.name),
    description: normalizeOptionalString(body.description),
    role: normalizeOptionalString(body.role),
    systemPrompt: normalizeOptionalString(body.systemPrompt),
    defaultModel: normalizeOptionalString(body.defaultModel),
    preferredServiceId: normalizeOptionalString(body.preferredServiceId),
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    serviceIds: Array.isArray(body.serviceIds) ? normalizeStringArray(body.serviceIds) : undefined,
    capabilities: Array.isArray(body.capabilities) ? normalizeStringArray(body.capabilities) : undefined,
    tools: Array.isArray(body.tools) ? normalizeStringArray(body.tools) : undefined,
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function normalizeStringArray(values: unknown[]): string[] {
  return Array.from(new Set(
    values
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
  ))
}

function validateServiceIds(serviceIds: string[], services: LlamaService[]) {
  const serviceIdSet = new Set(services.map(service => service.id))
  const unknown = serviceIds.filter(id => !serviceIdSet.has(id))
  if (unknown.length > 0) {
    throw new Error(`Unknown service ids: ${unknown.join(', ')}`)
  }
}

function validatePreferredServiceId(
  preferredServiceId: string | undefined,
  serviceIds: string[],
  services: LlamaService[]
) {
  if (!preferredServiceId) return

  const serviceIdSet = new Set(services.map(service => service.id))
  if (!serviceIdSet.has(preferredServiceId)) {
    throw new Error(`Unknown preferred service id: ${preferredServiceId}`)
  }
  if (serviceIds.length > 0 && !serviceIds.includes(preferredServiceId)) {
    throw new Error(`Preferred service must be included in serviceIds: ${preferredServiceId}`)
  }
}

async function syncAgentGraph(previous: AgentProfile | null, next: AgentProfile | null) {
  const current = next || previous
  if (!current) return

  if (next) {
    await setJson(KEYS.AGENT_GRAPH(current.id), {
      agentId: current.id,
      services: next.serviceIds,
      capabilities: next.capabilities,
      tools: next.tools,
      updatedAt: next.updatedAt,
    })
  } else {
    await deleteKey(KEYS.AGENT_GRAPH(current.id))
  }

  const agentNode = toGraphNode('agent', current.id)

  try {
    if (next) {
      await Promise.all([
        metaset(agentNode, 'type', 'agent'),
        metaset(agentNode, 'name', next.name),
        metaset(agentNode, 'enabled', String(next.enabled)),
        metaset(agentNode, 'role', next.role || 'general'),
      ])
    }

    await syncGraphEdgeSet(
      agentNode,
      'USES_SERVICE',
      previous?.serviceIds || [],
      next?.serviceIds || [],
      'service'
    )
    await syncGraphEdgeSet(
      agentNode,
      'HAS_CAPABILITY',
      previous?.capabilities || [],
      next?.capabilities || [],
      'capability'
    )
    await syncGraphEdgeSet(
      agentNode,
      'USES_TOOL',
      previous?.tools || [],
      next?.tools || [],
      'tool'
    )
  } catch (error) {
    if (!isUnsupportedGraphCommandError(error)) {
      throw error
    }
  }
}

async function syncGraphEdgeSet(
  fromNode: string,
  relation: string,
  previousItems: string[],
  nextItems: string[],
  targetType: 'service' | 'capability' | 'tool'
) {
  const previousSet = new Set(previousItems)
  const nextSet = new Set(nextItems)

  for (const item of previousSet) {
    if (nextSet.has(item)) continue
    await graphDelEdge(fromNode, relation, toGraphNode(targetType, item)).catch(() => undefined)
  }

  for (const item of nextSet) {
    const targetNode = toGraphNode(targetType, item)
    await metaset(targetNode, 'type', targetType)
    await metaset(targetNode, 'name', item)
    if (previousSet.has(item)) continue
    await graphAddEdge(fromNode, relation, targetNode)
  }
}

function toGraphNode(prefix: string, value: string): string {
  return `${prefix}:${encodeURIComponent(value)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isUnsupportedGraphCommandError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof error.message === 'string'
    && error.message.includes('ERR Unknown command')
}
