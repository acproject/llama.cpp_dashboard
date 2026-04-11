import { createRagCollection, ingestRagDocument, listRagCollections } from '@/lib/rag'
import { deleteKey, getJson, KEYS, keys, metaset, graphAddEdge, graphDelEdge, setJson, tagadd } from '@/lib/minimemory'
import { generateId } from '@/lib/utils'
import { MemoryKind, MemoryRecord, MemoryScopeType, TaskEvidenceRecord, TaskRecord } from '@/types'

const SHARED_MEMORY_COLLECTION_NAME = 'Shared Memory'
const SHARED_MEMORY_COLLECTION_DESCRIPTION = 'Shared summaries, facts, artifacts, evidence, and review notes across agents, tasks, runs, and sessions'
const SHARED_MEMORY_COLLECTION_TYPE = 'shared_memory'

type MemoryFilters = {
  space?: string
  kind?: MemoryKind
  scopeType?: MemoryScopeType
  scopeId?: string
  taskId?: string
  runId?: string
  sessionId?: string
  agentId?: string
  tags?: string[]
  query?: string
  limit?: number
}

type NormalizedMemoryInput = {
  space?: string
  kind?: MemoryKind
  scopeType?: MemoryScopeType
  scopeId?: string
  title?: string
  summary?: string
  content?: string
  tags?: string[]
  source?: string
  uri?: string
  taskId?: string
  runId?: string
  sessionId?: string
  agentId?: string
  metadata?: Record<string, unknown>
  indexInRag?: boolean
}

export async function listMemories(filters: MemoryFilters = {}): Promise<MemoryRecord[]> {
  const memoryKeys = await keys('memory:item:*')
  const itemsRaw = await Promise.all(
    memoryKeys.map((key) => {
      const id = key.slice('memory:item:'.length)
      return getJson<MemoryRecord>(KEYS.MEMORY(id))
    })
  )

  const normalizedTags = normalizeStringArray(filters.tags || [])
  const query = normalizeOptionalString(filters.query)?.toLowerCase()
  const items = itemsRaw
    .filter((item): item is MemoryRecord => Boolean(item))
    .filter((item) => {
      if (filters.space && item.space !== filters.space) return false
      if (filters.kind && item.kind !== filters.kind) return false
      if (filters.scopeType && item.scopeType !== filters.scopeType) return false
      if (filters.scopeId && item.scopeId !== filters.scopeId) return false
      if (filters.taskId && item.taskId !== filters.taskId) return false
      if (filters.runId && item.runId !== filters.runId) return false
      if (filters.sessionId && item.sessionId !== filters.sessionId) return false
      if (filters.agentId && item.agentId !== filters.agentId) return false
      if (normalizedTags.length > 0 && !normalizedTags.every((tag) => item.tags.includes(tag))) return false
      if (query && !buildMemorySearchText(item).includes(query)) return false
      return true
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  if (typeof filters.limit === 'number' && filters.limit >= 0) {
    return items.slice(0, filters.limit)
  }

  return items
}

export async function getMemory(memoryId: string): Promise<MemoryRecord | null> {
  return await getJson<MemoryRecord>(KEYS.MEMORY(memoryId))
}

export async function createMemory(input: unknown): Promise<MemoryRecord> {
  const now = Date.now()
  const normalized = normalizeMemoryInput(input)
  const scopeType = resolveScopeType(normalized)
  const scopeId = resolveScopeId(scopeType, normalized)
  validateMemoryFields(normalized.kind, scopeType, scopeId, normalized)

  let record: MemoryRecord = {
    id: generateId(),
    space: resolveSpace(normalized, scopeType, scopeId),
    kind: normalized.kind as MemoryKind,
    scopeType,
    scopeId,
    title: normalized.title,
    summary: normalized.summary,
    content: normalized.content,
    tags: normalized.tags || [],
    source: normalized.source,
    uri: normalized.uri,
    taskId: normalized.taskId,
    runId: normalized.runId,
    sessionId: normalized.sessionId,
    agentId: normalized.agentId,
    version: 1,
    metadata: normalized.metadata,
    createdAt: now,
    updatedAt: now,
  }

  await setJson(KEYS.MEMORY(record.id), record)
  await tagMemoryRecord(record)
  await syncMemoryGraph(null, record)
  record = await indexMemoryRecord(record, normalized.indexInRag)
  await setJson(KEYS.MEMORY(record.id), record)

  return record
}

export async function updateMemory(memoryId: string, input: unknown): Promise<MemoryRecord | null> {
  const existing = await getMemory(memoryId)
  if (!existing) return null

  const normalized = normalizeMemoryInput(input)
  const scopeType = resolveScopeType(normalized, existing)
  const scopeId = resolveScopeId(scopeType, normalized, existing)
  validateMemoryFields(normalized.kind ?? existing.kind, scopeType, scopeId, normalized, existing)

  let next: MemoryRecord = {
    ...existing,
    space: normalized.space || existing.space || resolveSpace(normalized, scopeType, scopeId),
    kind: normalized.kind ?? existing.kind,
    scopeType,
    scopeId,
    title: normalized.title ?? existing.title,
    summary: normalized.summary ?? existing.summary,
    content: normalized.content ?? existing.content,
    tags: normalized.tags ?? existing.tags,
    source: normalized.source ?? existing.source,
    uri: normalized.uri ?? existing.uri,
    taskId: normalized.taskId ?? existing.taskId,
    runId: normalized.runId ?? existing.runId,
    sessionId: normalized.sessionId ?? existing.sessionId,
    agentId: normalized.agentId ?? existing.agentId,
    metadata: normalized.metadata ?? existing.metadata,
    version: existing.version + 1,
    updatedAt: Date.now(),
  }

  await tagMemoryRecord(next)
  await syncMemoryGraph(existing, next)
  next = await indexMemoryRecord(next, normalized.indexInRag)
  await setJson(KEYS.MEMORY(memoryId), next)

  return next
}

export async function deleteMemory(memoryId: string): Promise<MemoryRecord | null> {
  const existing = await getMemory(memoryId)
  if (!existing) return null

  await syncMemoryGraph(existing, null)
  await deleteKey(KEYS.MEMORY(memoryId))

  return existing
}

export async function createMemoryFromTaskEvidence(
  task: Pick<TaskRecord, 'id' | 'title' | 'kind' | 'runId' | 'sessionId' | 'requestedAgentId' | 'assignedAgentId'>,
  evidence: TaskEvidenceRecord
): Promise<MemoryRecord> {
  return await createMemory({
    kind: 'evidence',
    scopeType: 'task',
    scopeId: task.id,
    taskId: task.id,
    runId: task.runId,
    sessionId: task.sessionId,
    agentId: task.assignedAgentId || task.requestedAgentId,
    title: evidence.title || task.title || `Task ${task.id} evidence`,
    content: evidence.content,
    source: evidence.source,
    uri: evidence.uri,
    tags: [
      'task-evidence',
      `task:${task.id}`,
      `evidence:${evidence.kind}`,
      ...(task.kind ? [`task-kind:${task.kind}`] : []),
    ],
    metadata: {
      ...(evidence.metadata || {}),
      taskEvidenceId: evidence.id,
      taskEvidenceKind: evidence.kind,
      taskKind: task.kind || null,
    },
  })
}

function normalizeMemoryInput(input: unknown): NormalizedMemoryInput {
  const body = isRecord(input) ? input : {}

  return {
    space: normalizeOptionalString(body.space),
    kind: normalizeMemoryKind(body.kind),
    scopeType: normalizeMemoryScopeType(body.scopeType),
    scopeId: normalizeOptionalString(body.scopeId),
    title: normalizeOptionalString(body.title),
    summary: normalizeOptionalString(body.summary),
    content: normalizeOptionalString(body.content),
    tags: Array.isArray(body.tags) ? normalizeStringArray(body.tags) : undefined,
    source: normalizeOptionalString(body.source),
    uri: normalizeOptionalString(body.uri),
    taskId: normalizeOptionalString(body.taskId),
    runId: normalizeOptionalString(body.runId),
    sessionId: normalizeOptionalString(body.sessionId),
    agentId: normalizeOptionalString(body.agentId),
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    indexInRag: typeof body.indexInRag === 'boolean' ? body.indexInRag : undefined,
  }
}

function validateMemoryFields(
  kind: MemoryKind | undefined,
  scopeType: MemoryScopeType,
  scopeId: string | undefined,
  normalized: NormalizedMemoryInput,
  existing?: MemoryRecord
) {
  if (!kind) {
    throw new Error('Memory kind is required')
  }

  if (scopeType !== 'global' && !scopeId) {
    throw new Error(`Memory scopeId is required for scopeType "${scopeType}"`)
  }

  const title = normalized.title ?? existing?.title
  const summary = normalized.summary ?? existing?.summary
  const content = normalized.content ?? existing?.content
  const source = normalized.source ?? existing?.source
  const uri = normalized.uri ?? existing?.uri
  if (!title && !summary && !content && !source && !uri) {
    throw new Error('Memory requires at least one of title, summary, content, source, or uri')
  }
}

function resolveScopeType(normalized: NormalizedMemoryInput, existing?: MemoryRecord): MemoryScopeType {
  if (normalized.scopeType) return normalized.scopeType
  if (normalized.taskId || existing?.taskId) return 'task'
  if (normalized.runId || existing?.runId) return 'run'
  if (normalized.sessionId || existing?.sessionId) return 'session'
  if (normalized.agentId || existing?.agentId) return 'agent'
  return existing?.scopeType || 'global'
}

function resolveScopeId(
  scopeType: MemoryScopeType,
  normalized: NormalizedMemoryInput,
  existing?: MemoryRecord
): string | undefined {
  if (normalized.scopeId) return normalized.scopeId
  if (scopeType === 'task') return normalized.taskId || existing?.taskId || existing?.scopeId
  if (scopeType === 'run') return normalized.runId || existing?.runId || existing?.scopeId
  if (scopeType === 'session') return normalized.sessionId || existing?.sessionId || existing?.scopeId
  if (scopeType === 'agent') return normalized.agentId || existing?.agentId || existing?.scopeId
  return undefined
}

function resolveSpace(
  normalized: NormalizedMemoryInput,
  scopeType: MemoryScopeType,
  scopeId?: string
): string {
  if (normalized.space) return normalized.space
  if (scopeType !== 'global' && scopeId) return `${scopeType}:${scopeId}`
  return 'shared'
}

function normalizeMemoryKind(value: unknown): MemoryKind | undefined {
  const normalized = normalizeOptionalString(value)
  if (
    normalized === 'run_summary' ||
    normalized === 'fact' ||
    normalized === 'artifact' ||
    normalized === 'evidence' ||
    normalized === 'review_comment' ||
    normalized === 'note'
  ) {
    return normalized
  }
  return undefined
}

function normalizeMemoryScopeType(value: unknown): MemoryScopeType | undefined {
  const normalized = normalizeOptionalString(value)
  if (
    normalized === 'global' ||
    normalized === 'agent' ||
    normalized === 'task' ||
    normalized === 'run' ||
    normalized === 'session'
  ) {
    return normalized
  }
  return undefined
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

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildMemorySearchText(memory: MemoryRecord): string {
  return [
    memory.space,
    memory.kind,
    memory.scopeType,
    memory.scopeId,
    memory.title,
    memory.summary,
    memory.content,
    memory.source,
    memory.uri,
    ...memory.tags,
  ]
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .join('\n')
    .toLowerCase()
}

function buildMemoryRagContent(memory: MemoryRecord): string {
  return [
    memory.title ? `Title: ${memory.title}` : null,
    memory.summary ? `Summary: ${memory.summary}` : null,
    memory.content ? `Content:\n${memory.content}` : null,
    memory.source ? `Source: ${memory.source}` : null,
    memory.uri ? `URI: ${memory.uri}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n\n')
    .trim()
}

function getMemoryGraphNode(memoryId: string): string {
  return `memory:graph:item:${memoryId}`
}

function getMemorySpaceGraphNode(space: string): string {
  return `memory:graph:space:${slugify(space) || 'shared'}`
}

function getGenericScopeGraphNode(scopeType: MemoryScopeType, scopeId: string): string {
  return `memory:graph:scope:${scopeType}:${slugify(scopeId)}`
}

function getTaskGraphNode(taskId: string): string {
  return `task:graph:task:${taskId}`
}

function getAgentGraphNode(agentId: string): string {
  return `agent:${encodeURIComponent(agentId)}`
}

function getRunGraphNode(runId: string): string {
  return `run:${encodeURIComponent(runId)}`
}

function getSessionGraphNode(sessionId: string): string {
  return `session:${encodeURIComponent(sessionId)}`
}

function getRagDocumentGraphNode(collectionId: string, documentId: string): string {
  return `rag:graph:document:${collectionId}:${documentId}`
}

function getRecordRagReference(record: MemoryRecord): { collectionId: string; documentId: string } | null {
  const metadata = record.metadata
  if (!isRecord(metadata)) return null
  const rag = metadata.rag
  if (!isRecord(rag)) return null
  const collectionId = normalizeOptionalString(rag.collectionId)
  const documentId = normalizeOptionalString(rag.documentId)
  if (!collectionId || !documentId) return null
  return { collectionId, documentId }
}

function resolveRelatedNodes(memory: MemoryRecord): Array<{ node: string; type: string; label: string }> {
  const nodes = new Map<string, { node: string; type: string; label: string }>()
  nodes.set(getMemorySpaceGraphNode(memory.space), {
    node: getMemorySpaceGraphNode(memory.space),
    type: 'memory_space',
    label: memory.space,
  })

  if (memory.agentId) {
    nodes.set(getAgentGraphNode(memory.agentId), {
      node: getAgentGraphNode(memory.agentId),
      type: 'agent',
      label: memory.agentId,
    })
  }

  if (memory.taskId) {
    nodes.set(getTaskGraphNode(memory.taskId), {
      node: getTaskGraphNode(memory.taskId),
      type: 'task',
      label: memory.taskId,
    })
  }

  if (memory.runId) {
    nodes.set(getRunGraphNode(memory.runId), {
      node: getRunGraphNode(memory.runId),
      type: 'run',
      label: memory.runId,
    })
  }

  if (memory.sessionId) {
    nodes.set(getSessionGraphNode(memory.sessionId), {
      node: getSessionGraphNode(memory.sessionId),
      type: 'session',
      label: memory.sessionId,
    })
  }

  if (memory.scopeType === 'global') {
    nodes.set(getGenericScopeGraphNode('global', 'shared'), {
      node: getGenericScopeGraphNode('global', 'shared'),
      type: 'memory_scope',
      label: 'global',
    })
  } else if (memory.scopeId) {
    const scopedNode =
      memory.scopeType === 'task'
        ? getTaskGraphNode(memory.scopeId)
        : memory.scopeType === 'agent'
          ? getAgentGraphNode(memory.scopeId)
          : memory.scopeType === 'run'
            ? getRunGraphNode(memory.scopeId)
            : memory.scopeType === 'session'
              ? getSessionGraphNode(memory.scopeId)
              : getGenericScopeGraphNode(memory.scopeType, memory.scopeId)

    nodes.set(scopedNode, {
      node: scopedNode,
      type: memory.scopeType,
      label: memory.scopeId,
    })
  }

  return Array.from(nodes.values())
}

async function syncMemoryGraph(previous: MemoryRecord | null, next: MemoryRecord | null): Promise<void> {
  const current = next || previous
  if (!current) return

  const memoryNode = getMemoryGraphNode(current.id)
  const previousNodes = new Map((previous ? resolveRelatedNodes(previous) : []).map((item) => [item.node, item]))
  const nextNodes = new Map((next ? resolveRelatedNodes(next) : []).map((item) => [item.node, item]))

  for (const [node] of previousNodes) {
    if (nextNodes.has(node)) continue
    await graphDelEdge(node, 'HAS_MEMORY', memoryNode).catch(() => undefined)
  }

  if (next) {
    await metaset(memoryNode, 'type', 'memory')
    await metaset(memoryNode, 'memoryId', next.id)
    await metaset(memoryNode, 'kind', next.kind)
    await metaset(memoryNode, 'space', next.space)
    await metaset(memoryNode, 'scopeType', next.scopeType)
    await metaset(memoryNode, 'label', next.title || next.summary || next.kind)
    if (next.scopeId) {
      await metaset(memoryNode, 'scopeId', next.scopeId)
    }

    for (const nodeInfo of nextNodes.values()) {
      await metaset(nodeInfo.node, 'type', nodeInfo.type)
      await metaset(nodeInfo.node, 'label', nodeInfo.label)
      await graphAddEdge(nodeInfo.node, 'HAS_MEMORY', memoryNode)
    }
  }

  const previousRag = previous ? getRecordRagReference(previous) : null
  const nextRag = next ? getRecordRagReference(next) : null
  if (previousRag && (!nextRag || previousRag.collectionId !== nextRag.collectionId || previousRag.documentId !== nextRag.documentId)) {
    await graphDelEdge(
      memoryNode,
      'HAS_RAG_DOCUMENT',
      getRagDocumentGraphNode(previousRag.collectionId, previousRag.documentId)
    ).catch(() => undefined)
  }

  if (nextRag) {
    await graphAddEdge(
      memoryNode,
      'HAS_RAG_DOCUMENT',
      getRagDocumentGraphNode(nextRag.collectionId, nextRag.documentId)
    )
  }
}

async function tagMemoryRecord(record: MemoryRecord): Promise<void> {
  const tags = [
    'memory',
    `kind:${record.kind}`,
    `scope:${record.scopeType}`,
    `space:${slugify(record.space) || 'shared'}`,
    ...record.tags,
    ...(record.taskId ? [`task:${record.taskId}`] : []),
    ...(record.runId ? [`run:${record.runId}`] : []),
    ...(record.sessionId ? [`session:${record.sessionId}`] : []),
    ...(record.agentId ? [`agent:${record.agentId}`] : []),
  ]

  await tagadd(KEYS.MEMORY(record.id), ...Array.from(new Set(tags)))
}

async function indexMemoryRecord(record: MemoryRecord, indexOverride?: boolean): Promise<MemoryRecord> {
  const shouldIndex = indexOverride !== false && Boolean(buildMemoryRagContent(record))
  if (!shouldIndex) return record

  try {
    const collection = await ensureSharedMemoryCollection()
    const indexed = await ingestRagDocument(collection.id, {
      title: record.title || record.summary || `${record.kind} ${record.id.slice(0, 8)}`,
      source: record.source || record.uri || `memory:${record.id}`,
      content: buildMemoryRagContent(record),
      tags: [
        'shared-memory',
        `memory:${record.id}`,
        `memory-kind:${record.kind}`,
        `memory-space:${slugify(record.space) || 'shared'}`,
        ...record.tags,
      ],
      graphNodes: [
        record.space,
        record.kind,
        ...(record.title ? [record.title] : []),
      ],
      metadata: {
        memoryId: record.id,
        memoryKind: record.kind,
        memorySpace: record.space,
        scopeType: record.scopeType,
        scopeId: record.scopeId || null,
        taskId: record.taskId || null,
        runId: record.runId || null,
        sessionId: record.sessionId || null,
        agentId: record.agentId || null,
        version: record.version,
        source: record.source || null,
        uri: record.uri || null,
      },
    })

    const metadata = {
      ...(record.metadata || {}),
      rag: {
        collectionId: indexed.collection.id,
        documentId: indexed.document.id,
      },
    }

    const next = {
      ...record,
      metadata,
    }

    await syncMemoryGraph(record, next)
    return next
  } catch (error) {
    return {
      ...record,
      metadata: {
        ...(record.metadata || {}),
        ragError: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

async function ensureSharedMemoryCollection() {
  const collections = await listRagCollections()
  const existing = collections.find(
    (item) => item.metadata?.systemCollectionType === SHARED_MEMORY_COLLECTION_TYPE
  )
  if (existing) return existing

  return await createRagCollection({
    name: SHARED_MEMORY_COLLECTION_NAME,
    description: SHARED_MEMORY_COLLECTION_DESCRIPTION,
    metadata: {
      systemCollectionType: SHARED_MEMORY_COLLECTION_TYPE,
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
