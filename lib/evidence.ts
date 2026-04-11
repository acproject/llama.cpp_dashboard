import { getMemory, listMemories } from '@/lib/memory'
import { listRagCollections, retrieveRagContext } from '@/lib/rag'
import { getTask, listTaskEvidence, listTasks } from '@/lib/tasks'
import { EvidenceRecord, EvidenceScope, MemoryRecord, RagCollection, RagRetrievalHit, TaskEvidenceRecord, TaskRecord } from '@/types'

type EvidenceSearchInput = {
  query?: string
  topK?: number
  limit?: number
  taskId?: string
  runId?: string
  sessionId?: string
  agentId?: string
  space?: string
  tags?: string[]
  collectionIds?: string[]
  includeTaskEvidence?: boolean
  includeMemory?: boolean
  includeRag?: boolean
}

type EvidenceSearchResult = {
  items: EvidenceRecord[]
  total: number
}

type NormalizedEvidenceSearchInput = {
  query?: string
  topK: number
  limit: number
  taskId?: string
  runId?: string
  sessionId?: string
  agentId?: string
  space?: string
  tags: string[]
  collectionIds: string[]
  includeTaskEvidence: boolean
  includeMemory: boolean
  includeRag: boolean
}

export async function searchEvidence(input: unknown): Promise<EvidenceSearchResult> {
  const normalized = normalizeEvidenceSearchInput(input)
  const aggregated = new Map<string, EvidenceRecord>()

  if (normalized.includeTaskEvidence) {
    const items = await listScopedTaskEvidence(normalized)
    for (const item of items) {
      const record = await taskEvidenceToEvidenceRecord(item.task, item.evidence)
      if (!matchesEvidenceRecord(record, normalized)) continue
      mergeEvidenceRecord(aggregated, record)
    }
  }

  if (normalized.includeMemory) {
    const items = await listMemories({
      space: normalized.space,
      taskId: normalized.taskId,
      runId: normalized.runId,
      sessionId: normalized.sessionId,
      agentId: normalized.agentId,
      tags: normalized.tags,
      limit: Math.max(normalized.limit * 3, 100),
    })

    for (const item of items) {
      const record = memoryToEvidenceRecord(item)
      if (!matchesEvidenceRecord(record, normalized)) continue
      mergeEvidenceRecord(aggregated, record)
    }
  }

  if (normalized.includeRag && normalized.query) {
    const collections = await resolveSearchCollections(normalized.collectionIds)
    const ragResults = await Promise.all(
      collections.map(async (collection) => {
        try {
          const result = await retrieveRagContext({
            collectionId: collection.id,
            query: normalized.query,
            topK: normalized.topK,
            tags: normalized.tags,
          })
          return result
        } catch {
          return null
        }
      })
    )

    for (const result of ragResults) {
      if (!result) continue
      for (const hit of result.hits) {
        const record = ragHitToEvidenceRecord(result.collection, hit)
        if (!matchesEvidenceRecord(record, normalized)) continue
        mergeEvidenceRecord(aggregated, record)
      }
    }
  }

  const items = sortEvidenceRecords(Array.from(aggregated.values())).slice(0, normalized.limit)
  return {
    items,
    total: items.length,
  }
}

export async function listTaskEvidenceWithLinks(taskId: string): Promise<Array<{
  evidence: TaskEvidenceRecord
  memory?: MemoryRecord
  task: TaskRecord
}>> {
  const task = await getTask(taskId)
  if (!task) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const evidences = await listTaskEvidence(taskId)
  const items = await Promise.all(
    evidences.map(async (evidence) => {
      const metadata = evidence.metadata
      const memoryRef = isRecord(metadata) && isRecord(metadata.memory)
        ? normalizeOptionalString(metadata.memory.id)
        : undefined
      const memory = memoryRef ? await getMemory(memoryRef) : null

      return {
        evidence,
        memory: memory || undefined,
        task,
      }
    })
  )

  return items
}

function normalizeEvidenceSearchInput(input: unknown): NormalizedEvidenceSearchInput {
  const body = isRecord(input) ? input : {}
  const query = normalizeOptionalString(body.query)
  const topK = Math.max(1, Math.min(20, Number(body.topK) || 8))
  const limit = Math.max(1, Math.min(100, Number(body.limit) || Math.max(topK * 2, 20)))

  return {
    query,
    topK,
    limit,
    taskId: normalizeOptionalString(body.taskId),
    runId: normalizeOptionalString(body.runId),
    sessionId: normalizeOptionalString(body.sessionId),
    agentId: normalizeOptionalString(body.agentId),
    space: normalizeOptionalString(body.space),
    tags: Array.isArray(body.tags) ? normalizeStringArray(body.tags) : [],
    collectionIds: Array.isArray(body.collectionIds) ? normalizeStringArray(body.collectionIds) : [],
    includeTaskEvidence: typeof body.includeTaskEvidence === 'boolean' ? body.includeTaskEvidence : true,
    includeMemory: typeof body.includeMemory === 'boolean' ? body.includeMemory : true,
    includeRag: typeof body.includeRag === 'boolean' ? body.includeRag : true,
  }
}

async function resolveSearchCollections(collectionIds: string[]): Promise<RagCollection[]> {
  const collections = await listRagCollections()
  const filtered = collectionIds.length > 0
    ? collections.filter((item) => collectionIds.includes(item.id))
    : collections

  return filtered.filter((item) => item.enabled)
}

async function listScopedTaskEvidence(normalized: NormalizedEvidenceSearchInput): Promise<Array<{
  task: TaskRecord
  evidence: TaskEvidenceRecord
}>> {
  const tasks = normalized.taskId
    ? await getSingleTaskAsList(normalized.taskId)
    : await listTasks({
        runId: normalized.runId,
        sessionId: normalized.sessionId,
        limit: 200,
      })

  const scopedTasks = tasks.filter((task) => {
    if (normalized.taskId && task.id !== normalized.taskId) return false
    if (normalized.agentId && task.assignedAgentId !== normalized.agentId && task.requestedAgentId !== normalized.agentId) return false
    return true
  })

  const evidences = await Promise.all(
    scopedTasks.map(async (task) => {
      const items = await listTaskEvidence(task.id)
      return items.map((evidence) => ({ task, evidence }))
    })
  )

  return evidences.flat()
}

async function getSingleTaskAsList(taskId: string): Promise<TaskRecord[]> {
  const task = await getTask(taskId)
  return task ? [task] : []
}

async function taskEvidenceToEvidenceRecord(task: TaskRecord, evidence: TaskEvidenceRecord): Promise<EvidenceRecord> {
  const metadata = evidence.metadata
  const memoryRef = isRecord(metadata) && isRecord(metadata.memory)
    ? normalizeOptionalString(metadata.memory.id)
    : undefined
  const ragRef = isRecord(metadata) && isRecord(metadata.rag)
    ? {
        collectionId: normalizeOptionalString(metadata.rag.collectionId),
        documentId: normalizeOptionalString(metadata.rag.documentId),
      }
    : null

  return {
    id: `task_evidence:${evidence.id}`,
    sourceType: 'task_evidence',
    title: evidence.title || task.title,
    content: evidence.content,
    source: evidence.source,
    uri: evidence.uri,
    tags: [
      'task-evidence',
      `kind:${evidence.kind}`,
      ...(task.kind ? [`task-kind:${task.kind}`] : []),
    ],
    score: null,
    scopes: compactScopes([
      { type: 'task', id: task.id },
      task.runId ? { type: 'run', id: task.runId } : null,
      task.sessionId ? { type: 'session', id: task.sessionId } : null,
      task.assignedAgentId ? { type: 'agent', id: task.assignedAgentId } : task.requestedAgentId ? { type: 'agent', id: task.requestedAgentId } : null,
      memoryRef ? { type: 'memory_space', id: `task:${task.id}` } : null,
    ]),
    collectionId: ragRef?.collectionId || undefined,
    documentId: ragRef?.documentId || undefined,
    memoryId: memoryRef,
    taskEvidenceId: evidence.id,
    taskId: task.id,
    runId: task.runId,
    sessionId: task.sessionId,
    agentId: task.assignedAgentId || task.requestedAgentId,
    kind: evidence.kind,
    createdAt: evidence.createdAt,
    updatedAt: evidence.createdAt,
    metadata: evidence.metadata,
  }
}

function memoryToEvidenceRecord(memory: MemoryRecord): EvidenceRecord {
  const metadata = memory.metadata
  const ragRef = isRecord(metadata) && isRecord(metadata.rag)
    ? {
        collectionId: normalizeOptionalString(metadata.rag.collectionId),
        documentId: normalizeOptionalString(metadata.rag.documentId),
      }
    : null

  return {
    id: `memory:${memory.id}`,
    sourceType: 'memory',
    title: memory.title,
    summary: memory.summary,
    content: memory.content,
    source: memory.source,
    uri: memory.uri,
    tags: ['memory', `kind:${memory.kind}`, ...memory.tags],
    score: null,
    scopes: compactScopes([
      { type: 'memory_space', id: memory.space },
      memory.taskId ? { type: 'task', id: memory.taskId } : null,
      memory.runId ? { type: 'run', id: memory.runId } : null,
      memory.sessionId ? { type: 'session', id: memory.sessionId } : null,
      memory.agentId ? { type: 'agent', id: memory.agentId } : null,
    ]),
    collectionId: ragRef?.collectionId || undefined,
    documentId: ragRef?.documentId || undefined,
    memoryId: memory.id,
    space: memory.space,
    taskId: memory.taskId,
    runId: memory.runId,
    sessionId: memory.sessionId,
    agentId: memory.agentId,
    kind: memory.kind,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    metadata: memory.metadata,
  }
}

function ragHitToEvidenceRecord(collection: RagCollection, hit: RagRetrievalHit): EvidenceRecord {
  const metadata = hit.metadata
  const taskId = isRecord(metadata) ? normalizeOptionalString(metadata.taskId) : undefined
  const runId = isRecord(metadata) ? normalizeOptionalString(metadata.runId) : undefined
  const sessionId = isRecord(metadata) ? normalizeOptionalString(metadata.sessionId) : undefined
  const agentId = isRecord(metadata)
    ? normalizeOptionalString(metadata.agentId) || normalizeOptionalString(metadata.assignedAgentId) || normalizeOptionalString(metadata.requestedAgentId)
    : undefined
  const memoryId = isRecord(metadata) ? normalizeOptionalString(metadata.memoryId) : undefined
  const taskEvidenceId = isRecord(metadata) ? normalizeOptionalString(metadata.taskEvidenceId) || normalizeOptionalString(metadata.evidenceId) : undefined
  const memorySpace = isRecord(metadata) ? normalizeOptionalString(metadata.memorySpace) : undefined

  return {
    id: `rag:${collection.id}:${hit.chunkId}`,
    sourceType: 'rag_hit',
    title: hit.title,
    content: hit.content,
    source: hit.source,
    tags: hit.tags,
    score: hit.score,
    scopes: compactScopes([
      { type: 'collection', id: collection.id },
      memorySpace ? { type: 'memory_space', id: memorySpace } : null,
      taskId ? { type: 'task', id: taskId } : null,
      runId ? { type: 'run', id: runId } : null,
      sessionId ? { type: 'session', id: sessionId } : null,
      agentId ? { type: 'agent', id: agentId } : null,
    ]),
    collectionId: collection.id,
    documentId: hit.documentId,
    chunkId: hit.chunkId,
    memoryId,
    taskEvidenceId,
    space: memorySpace,
    taskId,
    runId,
    sessionId,
    agentId,
    kind: isRecord(metadata) ? normalizeOptionalString(metadata.memoryKind) || normalizeOptionalString(metadata.evidenceKind) : undefined,
    metadata: hit.metadata,
  }
}

function matchesEvidenceRecord(record: EvidenceRecord, normalized: NormalizedEvidenceSearchInput): boolean {
  if (normalized.space && record.space !== normalized.space && !record.scopes.some((scope) => scope.type === 'memory_space' && scope.id === normalized.space)) {
    return false
  }
  if (normalized.taskId && record.taskId !== normalized.taskId && !record.scopes.some((scope) => scope.type === 'task' && scope.id === normalized.taskId)) {
    return false
  }
  if (normalized.runId && record.runId !== normalized.runId && !record.scopes.some((scope) => scope.type === 'run' && scope.id === normalized.runId)) {
    return false
  }
  if (normalized.sessionId && record.sessionId !== normalized.sessionId && !record.scopes.some((scope) => scope.type === 'session' && scope.id === normalized.sessionId)) {
    return false
  }
  if (normalized.agentId && record.agentId !== normalized.agentId && !record.scopes.some((scope) => scope.type === 'agent' && scope.id === normalized.agentId)) {
    return false
  }
  if (normalized.tags.length > 0 && !normalized.tags.every((tag) => record.tags.includes(tag))) {
    return false
  }
  if (normalized.query) {
    const haystack = [
      record.title,
      record.summary,
      record.content,
      record.source,
      record.uri,
      record.kind,
      record.space,
      ...record.tags,
    ]
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .join('\n')
      .toLowerCase()

    if (!haystack.includes(normalized.query.toLowerCase()) && record.score === null) {
      return false
    }
  }
  return true
}

function mergeEvidenceRecord(target: Map<string, EvidenceRecord>, incoming: EvidenceRecord) {
  const canonicalId = incoming.memoryId
    ? `memory:${incoming.memoryId}`
    : incoming.taskEvidenceId
      ? `task_evidence:${incoming.taskEvidenceId}`
      : incoming.chunkId
        ? `rag:${incoming.collectionId || 'unknown'}:${incoming.chunkId}`
        : incoming.id

  const existing = target.get(canonicalId)
  if (!existing) {
    target.set(canonicalId, incoming)
    return
  }

  target.set(canonicalId, {
    ...existing,
    ...incoming,
    title: incoming.title || existing.title,
    summary: incoming.summary || existing.summary,
    content: incoming.content || existing.content,
    source: incoming.source || existing.source,
    uri: incoming.uri || existing.uri,
    tags: Array.from(new Set([...existing.tags, ...incoming.tags])),
    scopes: mergeScopes(existing.scopes, incoming.scopes),
    score: pickBetterScore(existing.score, incoming.score),
    metadata: {
      ...(existing.metadata || {}),
      ...(incoming.metadata || {}),
    },
  })
}

function mergeScopes(left: EvidenceScope[], right: EvidenceScope[]): EvidenceScope[] {
  const seen = new Set<string>()
  const items: EvidenceScope[] = []
  for (const item of [...left, ...right]) {
    const key = `${item.type}:${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  return items
}

function compactScopes(items: Array<EvidenceScope | null | undefined>): EvidenceScope[] {
  return items.filter((item): item is EvidenceScope => Boolean(item))
}

function pickBetterScore(left: number | null, right: number | null): number | null {
  if (left === null) return right
  if (right === null) return left
  return right > left ? right : left
}

function sortEvidenceRecords(items: EvidenceRecord[]): EvidenceRecord[] {
  return [...items].sort((a, b) => {
    const aScore = a.score ?? Number.NEGATIVE_INFINITY
    const bScore = b.score ?? Number.NEGATIVE_INFINITY
    if (aScore !== bScore) return bScore - aScore

    const aTime = a.updatedAt || a.createdAt || 0
    const bTime = b.updatedAt || b.createdAt || 0
    return bTime - aTime
  })
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function normalizeStringArray(values: unknown[]): string[] {
  return Array.from(new Set(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
