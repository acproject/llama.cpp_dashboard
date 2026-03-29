import { KEYS, deleteKey, evidenceSearchF, getJson, graphAddEdge, graphDelEdge, graphEdgePropSet, keys, metaset, objset, setJson, setString, tagadd } from '@/lib/minimemory'
import { generateId } from '@/lib/utils'
import { LlamaService, RagChunkRecord, RagCollection, RagDocument, RagMetric, RagRetrievalHit } from '@/types'

const DEFAULT_CHUNK_SIZE = 900
const DEFAULT_CHUNK_OVERLAP = 120
const DEFAULT_METRIC: RagMetric = 'cosine'
const DEFAULT_GRAPH_RELATION = 'HAS_CHUNK'
const DEFAULT_GRAPH_DEPTH = 1
const DEFAULT_EMBEDDING_SPACE = 'e5-multi-large-instruct_d1024_cosine'
const CHUNK_MIME = 'text/plain'
const MIN_EMBEDDING_CHUNK_SIZE = 180

type CollectionInput = {
  name?: string
  description?: string
  embeddingServiceId?: string
  embeddingModel?: string
  embeddingSpace?: string
  embeddingDimension?: number
  metric?: RagMetric
  graphRelation?: string
  chunkSize?: number
  chunkOverlap?: number
  enabled?: boolean
  metadata?: Record<string, unknown>
}

type DocumentInput = {
  title?: string
  source?: string
  content?: string
  tags?: string[]
  graphNodes?: string[]
  metadata?: Record<string, unknown>
}

type RetrieveInput = {
  collectionId?: string
  query?: string
  topK?: number
  tags?: string[]
  graphNodes?: string[]
  graphDepth?: number
}

type EmbeddingResponse = {
  data?: Array<{
    embedding?: number[]
  }>
}

type ChunkEmbeddingResult = {
  chunks: string[]
  vectors: number[][]
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)))
}

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function createContentPreview(content: string): string {
  return content.trim().replace(/\s+/g, ' ').slice(0, 240)
}

function getCollectionGraphNode(collectionId: string): string {
  return `rag:graph:collection:${collectionId}`
}

function getDocumentGraphNode(collectionId: string, documentId: string): string {
  return `rag:graph:document:${collectionId}:${documentId}`
}

function getTopicGraphNode(collectionId: string, label: string): string {
  return `rag:graph:topic:${collectionId}:${slugify(label)}`
}

function getChunkId(collectionId: string, documentId: string, chunkIndex: number): string {
  return `rag:${collectionId}:${documentId}:${chunkIndex}`
}

function getChunkKey(chunkId: string): string {
  return `__chunk:${chunkId}`
}

function getEmbeddingKey(embeddingSpace: string, chunkId: string): string {
  return `__emb:${embeddingSpace}:${chunkId}`
}

function getEmbeddingPrefix(embeddingSpace: string): string {
  return `__emb:${embeddingSpace}:`
}

function buildPassageInput(content: string): string {
  return `passage: ${content}`
}

function buildQueryInput(query: string): string {
  return `query: ${query}`
}

function splitTextIntoChunks(text: string, chunkSize: number, chunkOverlap: number): string[] {
  const normalized = String(text || '').trim().replace(/\r\n/g, '\n')
  if (!normalized) return []
  if (normalized.length <= chunkSize) return [normalized]

  const chunks: string[] = []
  let start = 0

  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + chunkSize)
    if (end < normalized.length) {
      const slice = normalized.slice(start, end)
      const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('。'), slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
      if (lastBreak >= Math.floor(slice.length * 0.55)) {
        end = start + lastBreak + 1
      }
    }

    const chunk = normalized.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= normalized.length) break
    start = Math.max(start + 1, end - chunkOverlap)
  }

  return chunks
}

function looksLikeEmbeddingService(service: LlamaService): boolean {
  const capabilitySet = new Set((service.capabilities || []).map((item) => item.toLowerCase()))
  if (
    capabilitySet.has('embeddings') ||
    capabilitySet.has('embedding') ||
    capabilitySet.has('vector') ||
    capabilitySet.has('vectors')
  ) {
    return true
  }

  const haystack = `${service.name} ${service.model} ${service.description || ''}`.toLowerCase()
  return haystack.includes('embedding') || haystack.includes('embed') || haystack.includes('e5')
}

async function listServices(): Promise<LlamaService[]> {
  const serviceKeys = await keys('llama:service:*')
  const items = await Promise.all(
    serviceKeys.map((key) => {
      const id = key.slice('llama:service:'.length)
      return getJson<LlamaService>(KEYS.SERVICE(id))
    })
  )

  return items
    .filter((item): item is LlamaService => Boolean(item))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
}

export async function listEmbeddingServices(): Promise<LlamaService[]> {
  const services = await listServices()
  return services
    .filter((service) => service.enabled !== false && looksLikeEmbeddingService(service))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'online' ? -1 : 1
      return (a.name || a.id).localeCompare(b.name || b.id)
    })
}

async function resolveEmbeddingService(collection: RagCollection): Promise<LlamaService> {
  const services = await listEmbeddingServices()
  const preferred = services.find((item) => item.id === collection.embeddingServiceId)
  if (preferred && preferred.status === 'online') return preferred

  const online = services.find((item) => item.status === 'online')
  if (online) return online

  if (preferred) return preferred
  throw new Error('没有找到可用的 embeddings 服务，请先为集合选择一个已注册的向量服务')
}

function normalizeMetric(value?: string): RagMetric {
  if (value === 'l2' || value === 'ip' || value === 'cosine') return value
  return DEFAULT_METRIC
}

function parseChunkId(chunkId: string): { collectionId: string; documentId: string; chunkIndex: number } | null {
  const parts = chunkId.split(':')
  if (parts.length < 4 || parts[0] !== 'rag') return null
  const chunkIndex = Number(parts[parts.length - 1])
  if (!Number.isFinite(chunkIndex)) return null
  return {
    collectionId: parts[1],
    documentId: parts[2],
    chunkIndex,
  }
}

async function fetchEmbeddings(service: LlamaService, input: string[]): Promise<number[][]> {
  const url = `http://${service.host}:${service.port}/v1/embeddings`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(service.apiKey ? { Authorization: `Bearer ${service.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: service.model,
      input,
    }),
  })

  if (!response.ok) {
    const bodyText = await response.text()
    let detail = bodyText.trim()
    if (detail) {
      try {
        const parsed = JSON.parse(detail) as {
          error?: {
            message?: string
          }
        }
        detail = parsed.error?.message?.trim() || detail
      } catch {}
    }

    throw new Error(
      detail
        ? `Embeddings 服务调用失败: ${response.status} ${response.statusText} - ${detail}`
        : `Embeddings 服务调用失败: ${response.status} ${response.statusText}`
    )
  }

  const payload = (await response.json()) as EmbeddingResponse
  const vectors = (payload.data || [])
    .map((item) => item.embedding)
    .filter((value): value is number[] => Array.isArray(value) && value.every((entry) => Number.isFinite(entry)))

  if (vectors.length !== input.length) {
    throw new Error(`Embeddings 返回数量异常，期望 ${input.length} 条，实际 ${vectors.length} 条`)
  }

  return vectors
}

function isEmbeddingInputTooLarge(message: string): boolean {
  return message.includes('too large to process') || (message.includes('input (') && message.includes('tokens'))
}

function splitChunkForEmbedding(chunk: string): string[] {
  const preferredSize = Math.max(
    MIN_EMBEDDING_CHUNK_SIZE,
    Math.min(Math.floor(chunk.length * 0.6), chunk.length - 1)
  )

  if (preferredSize >= chunk.length) {
    const midpoint = Math.max(1, Math.floor(chunk.length / 2))
    return [chunk.slice(0, midpoint).trim(), chunk.slice(midpoint).trim()].filter(Boolean)
  }

  const overlap = Math.min(Math.floor(preferredSize / 5), 60)
  return splitTextIntoChunks(chunk, preferredSize, overlap).filter(Boolean)
}

async function embedChunkWithFallback(service: LlamaService, chunk: string): Promise<ChunkEmbeddingResult> {
  const normalizedChunk = String(chunk || '').trim()
  if (!normalizedChunk) {
    return {
      chunks: [],
      vectors: [],
    }
  }

  try {
    const vectors = await fetchEmbeddings(service, [buildPassageInput(normalizedChunk)])
    return {
      chunks: [normalizedChunk],
      vectors,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!isEmbeddingInputTooLarge(message)) {
      throw error
    }

    const smallerChunks = splitChunkForEmbedding(normalizedChunk)
    if (smallerChunks.length <= 1 || smallerChunks.some((item) => item === normalizedChunk)) {
      throw new Error(`文档分块超过 embeddings 服务限制，且无法继续缩小: ${message}`)
    }

    const embedded = await Promise.all(smallerChunks.map((item) => embedChunkWithFallback(service, item)))
    return embedded.reduce<ChunkEmbeddingResult>(
      (accumulator, item) => {
        accumulator.chunks.push(...item.chunks)
        accumulator.vectors.push(...item.vectors)
        return accumulator
      },
      {
        chunks: [],
        vectors: [],
      }
    )
  }
}

async function embedDocumentChunks(service: LlamaService, chunks: string[]): Promise<ChunkEmbeddingResult> {
  const result: ChunkEmbeddingResult = {
    chunks: [],
    vectors: [],
  }

  for (const chunk of chunks) {
    const embedded = await embedChunkWithFallback(service, chunk)
    result.chunks.push(...embedded.chunks)
    result.vectors.push(...embedded.vectors)
  }

  return result
}

async function ensureGraphMetadata(collection: RagCollection, document: RagDocument, graphNodes: string[]): Promise<void> {
  await metaset(collection.graphRootNode, 'type', 'rag_collection')
  await metaset(collection.graphRootNode, 'collectionId', collection.id)
  await metaset(collection.graphRootNode, 'label', collection.name)

  const documentNode = getDocumentGraphNode(collection.id, document.id)
  await metaset(documentNode, 'type', 'rag_document')
  await metaset(documentNode, 'collectionId', collection.id)
  await metaset(documentNode, 'documentId', document.id)
  await metaset(documentNode, 'label', document.title)
  await graphAddEdge(collection.graphRootNode, 'HAS_DOCUMENT', documentNode)

  for (const nodeLabel of graphNodes) {
    const topicNode = getTopicGraphNode(collection.id, nodeLabel)
    await metaset(topicNode, 'type', 'rag_topic')
    await metaset(topicNode, 'collectionId', collection.id)
    await metaset(topicNode, 'label', nodeLabel)
    await graphAddEdge(collection.graphRootNode, 'HAS_TOPIC', topicNode)
  }
}

function createCollectionRecord(id: string, input: CollectionInput, embeddingServiceId?: string): RagCollection {
  const now = Date.now()
  return {
    id,
    name: String(input.name || '').trim() || `RAG 集合 ${id.slice(0, 8)}`,
    description: typeof input.description === 'string' ? input.description.trim() : undefined,
    embeddingServiceId: input.embeddingServiceId || embeddingServiceId,
    embeddingModel: typeof input.embeddingModel === 'string' ? input.embeddingModel.trim() : undefined,
    embeddingSpace: String(input.embeddingSpace || `${DEFAULT_EMBEDDING_SPACE}:${id}`).trim(),
    embeddingDimension: Number.isFinite(input.embeddingDimension) ? Number(input.embeddingDimension) : undefined,
    metric: normalizeMetric(input.metric),
    graphRootNode: getCollectionGraphNode(id),
    graphRelation: String(input.graphRelation || DEFAULT_GRAPH_RELATION).trim() || DEFAULT_GRAPH_RELATION,
    chunkSize: Math.max(200, Number(input.chunkSize) || DEFAULT_CHUNK_SIZE),
    chunkOverlap: Math.max(0, Math.min(Number(input.chunkOverlap) || DEFAULT_CHUNK_OVERLAP, Math.max(0, (Number(input.chunkSize) || DEFAULT_CHUNK_SIZE) - 50))),
    enabled: input.enabled !== false,
    documentCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  }
}

export async function listRagCollections(): Promise<RagCollection[]> {
  const collectionKeys = await keys('rag:collection:*')
  const items = await Promise.all(
    collectionKeys.map((key) => {
      const id = key.slice('rag:collection:'.length)
      return getJson<RagCollection>(KEYS.RAG_COLLECTION(id))
    })
  )

  return items
    .filter((item): item is RagCollection => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getRagCollection(collectionId: string): Promise<RagCollection | null> {
  return await getJson<RagCollection>(KEYS.RAG_COLLECTION(collectionId))
}

export async function listRagDocuments(collectionId: string): Promise<RagDocument[]> {
  const documentKeys = await keys(`rag:document:${collectionId}:*`)
  const items = await Promise.all(
    documentKeys.map((key) => {
      const documentId = key.slice(`rag:document:${collectionId}:`.length)
      return getJson<RagDocument>(KEYS.RAG_DOCUMENT(collectionId, documentId))
    })
  )

  return items
    .filter((item): item is RagDocument => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createRagCollection(input: CollectionInput): Promise<RagCollection> {
  const embeddingServices = await listEmbeddingServices()
  const preferredService = input.embeddingServiceId
    ? embeddingServices.find((item) => item.id === input.embeddingServiceId)
    : embeddingServices.find((item) => item.status === 'online') || embeddingServices[0]
  const collection = createCollectionRecord(generateId(), input, preferredService?.id)

  await setJson(KEYS.RAG_COLLECTION(collection.id), collection)
  await metaset(collection.graphRootNode, 'type', 'rag_collection')
  await metaset(collection.graphRootNode, 'collectionId', collection.id)
  await metaset(collection.graphRootNode, 'label', collection.name)

  return collection
}

export async function updateRagCollection(collectionId: string, input: CollectionInput): Promise<RagCollection> {
  const existing = await getRagCollection(collectionId)
  if (!existing) {
    throw new Error('RAG 集合不存在')
  }

  const chunkSize = Math.max(200, Number(input.chunkSize) || existing.chunkSize || DEFAULT_CHUNK_SIZE)
  const next: RagCollection = {
    ...existing,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : existing.name,
    description: typeof input.description === 'string' ? input.description.trim() || undefined : existing.description,
    embeddingServiceId:
      typeof input.embeddingServiceId === 'string'
        ? input.embeddingServiceId.trim() || undefined
        : existing.embeddingServiceId,
    embeddingModel:
      typeof input.embeddingModel === 'string'
        ? input.embeddingModel.trim() || undefined
        : existing.embeddingModel,
    embeddingSpace:
      typeof input.embeddingSpace === 'string' && input.embeddingSpace.trim()
        ? input.embeddingSpace.trim()
        : existing.embeddingSpace,
    embeddingDimension:
      Number.isFinite(input.embeddingDimension) && Number(input.embeddingDimension) > 0
        ? Number(input.embeddingDimension)
        : existing.embeddingDimension,
    metric: normalizeMetric(input.metric || existing.metric),
    graphRelation:
      typeof input.graphRelation === 'string' && input.graphRelation.trim()
        ? input.graphRelation.trim()
        : existing.graphRelation,
    chunkSize,
    chunkOverlap: Math.max(0, Math.min(Number(input.chunkOverlap) || existing.chunkOverlap, chunkSize - 50)),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : existing.enabled,
    updatedAt: Date.now(),
    metadata: input.metadata ?? existing.metadata,
  }

  await setJson(KEYS.RAG_COLLECTION(collectionId), next)
  await metaset(next.graphRootNode, 'label', next.name)

  return next
}

export async function deleteRagCollection(collectionId: string): Promise<void> {
  const collection = await getRagCollection(collectionId)
  if (!collection) return

  const documents = await listRagDocuments(collectionId)

  for (const document of documents) {
    const documentNode = getDocumentGraphNode(collectionId, document.id)
    for (let chunkIndex = 0; chunkIndex < document.chunkCount; chunkIndex++) {
      const chunkId = getChunkId(collectionId, document.id, chunkIndex)
      const chunkKey = getChunkKey(chunkId)
      const embeddingKey = getEmbeddingKey(collection.embeddingSpace, chunkId)
      await deleteKey(KEYS.RAG_CHUNK(collectionId, document.id, chunkIndex))
      await deleteKey(chunkKey)
      await deleteKey(embeddingKey)
      await graphDelEdge(collection.graphRootNode, collection.graphRelation, chunkKey).catch(() => undefined)
      await graphDelEdge(documentNode, collection.graphRelation, chunkKey).catch(() => undefined)

      for (const graphNode of document.graphNodes) {
        await graphDelEdge(getTopicGraphNode(collectionId, graphNode), collection.graphRelation, chunkKey).catch(() => undefined)
      }
    }

    await graphDelEdge(collection.graphRootNode, 'HAS_DOCUMENT', documentNode).catch(() => undefined)
    await deleteKey(KEYS.RAG_DOCUMENT(collectionId, document.id))
  }

  await deleteKey(KEYS.RAG_COLLECTION(collectionId))
}

export async function ingestRagDocument(collectionId: string, input: DocumentInput): Promise<{ collection: RagCollection; document: RagDocument }> {
  const collection = await getRagCollection(collectionId)
  if (!collection || !collection.enabled) {
    throw new Error('RAG 集合不存在或已禁用')
  }

  const content = String(input.content || '').trim()
  if (!content) {
    throw new Error('文档内容不能为空')
  }

  const initialChunks = splitTextIntoChunks(content, collection.chunkSize, collection.chunkOverlap)
  if (!initialChunks.length) {
    throw new Error('文档切块后为空')
  }

  const service = await resolveEmbeddingService(collection)
  const { chunks, vectors } = await embedDocumentChunks(service, initialChunks)
  const documentId = generateId()
  const tags = normalizeStringArray(input.tags)
  const graphNodes = normalizeStringArray(input.graphNodes)
  const now = Date.now()
  const document: RagDocument = {
    id: documentId,
    collectionId,
    title: String(input.title || '').trim() || `文档 ${documentId.slice(0, 8)}`,
    source: typeof input.source === 'string' ? input.source.trim() || undefined : undefined,
    tags,
    graphNodes,
    chunkCount: chunks.length,
    contentPreview: createContentPreview(content),
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  }

  await setJson(KEYS.RAG_DOCUMENT(collectionId, documentId), document)
  await ensureGraphMetadata(collection, document, graphNodes)

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunkId = getChunkId(collectionId, documentId, chunkIndex)
    const chunkKey = getChunkKey(chunkId)
    const embeddingKey = getEmbeddingKey(collection.embeddingSpace, chunkId)
    const chunkRecord: RagChunkRecord = {
      id: chunkId,
      collectionId,
      documentId,
      chunkIndex,
      chunkKey,
      embeddingKey,
      title: document.title,
      source: document.source,
      content: chunks[chunkIndex],
      tags,
      graphNodes,
      createdAt: now,
      metadata: input.metadata,
    }

    await setJson(KEYS.RAG_CHUNK(collectionId, documentId, chunkIndex), chunkRecord)
    await objset(chunkKey, CHUNK_MIME, chunks[chunkIndex])
    await setString(embeddingKey, vectors[chunkIndex].join(' '))
    await metaset(chunkKey, 'collectionId', collectionId)
    await metaset(chunkKey, 'documentId', documentId)
    await metaset(chunkKey, 'chunkIndex', String(chunkIndex))
    await metaset(chunkKey, 'title', document.title)
    if (document.source) {
      await metaset(chunkKey, 'source', document.source)
    }
    if (tags.length > 0) {
      await tagadd(chunkKey, ...tags)
    }

    const documentNode = getDocumentGraphNode(collectionId, documentId)
    await graphAddEdge(collection.graphRootNode, collection.graphRelation, chunkKey)
    await graphAddEdge(documentNode, collection.graphRelation, chunkKey)
    await graphEdgePropSet(collection.graphRootNode, collection.graphRelation, chunkKey, 'documentId', documentId)
    await graphEdgePropSet(collection.graphRootNode, collection.graphRelation, chunkKey, 'chunkIndex', String(chunkIndex))
    await graphEdgePropSet(documentNode, collection.graphRelation, chunkKey, 'chunkIndex', String(chunkIndex))

    for (const graphNode of graphNodes) {
      const topicNode = getTopicGraphNode(collectionId, graphNode)
      await graphAddEdge(topicNode, collection.graphRelation, chunkKey)
      await graphEdgePropSet(topicNode, collection.graphRelation, chunkKey, 'documentId', documentId)
    }
  }

  const nextCollection: RagCollection = {
    ...collection,
    embeddingServiceId: collection.embeddingServiceId || service.id,
    embeddingModel: collection.embeddingModel || service.model,
    embeddingDimension: collection.embeddingDimension || vectors[0]?.length,
    documentCount: collection.documentCount + 1,
    chunkCount: collection.chunkCount + chunks.length,
    updatedAt: now,
  }

  await setJson(KEYS.RAG_COLLECTION(collectionId), nextCollection)

  return {
    collection: nextCollection,
    document,
  }
}

type ParsedEvidenceHit = {
  rawId: string
  score: number | null
}

function responseToString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (Buffer.isBuffer(value)) return value.toString('utf-8')
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return null
}

function responseToScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Buffer.isBuffer(value)) {
    const parsed = Number(value.toString('utf-8'))
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseEvidenceHits(raw: unknown): ParsedEvidenceHit[] {
  if (!Array.isArray(raw)) return []

  const items: ParsedEvidenceHit[] = []
  for (let index = 0; index < raw.length; index++) {
    const current = raw[index]

    if (Array.isArray(current)) {
      const nested = parseEvidenceHits(current)
      if (nested.length > 0) {
        items.push(...nested)
        continue
      }

      const rawId = responseToString(current[0])
      if (rawId) {
        items.push({
          rawId,
          score: responseToScore(current[1]),
        })
      }
      continue
    }

    const rawId = responseToString(current)
    const nextScore = responseToScore(raw[index + 1])
    if (!rawId) continue

    if (nextScore !== null) {
      items.push({ rawId, score: nextScore })
      index += 1
    } else {
      items.push({ rawId, score: null })
    }
  }

  return items
}

function resolveChunkIdFromHit(rawId: string, collection: RagCollection): string | null {
  if (rawId.startsWith('__chunk:')) {
    return rawId.slice('__chunk:'.length)
  }

  const exactPrefix = getEmbeddingPrefix(collection.embeddingSpace)
  if (rawId.startsWith(exactPrefix)) {
    return rawId.slice(exactPrefix.length)
  }

  const ragIndex = rawId.indexOf(':rag:')
  if (ragIndex >= 0) {
    return rawId.slice(ragIndex + 1)
  }

  if (rawId.startsWith('rag:')) {
    return rawId
  }

  return null
}

function sortHits(items: RagRetrievalHit[]): RagRetrievalHit[] {
  return [...items].sort((a, b) => {
    if (a.score === null && b.score === null) return 0
    if (a.score === null) return 1
    if (b.score === null) return -1
    return b.score - a.score
  })
}

export async function retrieveRagContext(input: RetrieveInput): Promise<{ collection: RagCollection; hits: RagRetrievalHit[]; contextText: string }> {
  const collectionId = String(input.collectionId || '').trim()
  const query = String(input.query || '').trim()

  if (!collectionId) {
    throw new Error('collectionId 不能为空')
  }
  if (!query) {
    throw new Error('query 不能为空')
  }

  const collection = await getRagCollection(collectionId)
  if (!collection || !collection.enabled) {
    throw new Error('RAG 集合不存在或已禁用')
  }

  const service = await resolveEmbeddingService(collection)
  const vectors = await fetchEmbeddings(service, [buildQueryInput(query)])
  const topK = Math.max(1, Math.min(20, Number(input.topK) || 6))
  const tags = normalizeStringArray(input.tags)
  const graphNodes = normalizeStringArray(input.graphNodes)
  const searchTargets = [
    collection.graphRootNode,
    ...graphNodes.map((item) => getTopicGraphNode(collection.id, item)),
  ]
  const rawResults = await Promise.all(
    searchTargets.map((graphFrom) =>
      evidenceSearchF(topK, collection.metric, collection.embeddingDimension || vectors[0].length, vectors[0], {
        keyPrefix: getEmbeddingPrefix(collection.embeddingSpace),
        graphFrom,
        graphRel: collection.graphRelation,
        graphDepth: Math.max(1, Number(input.graphDepth) || DEFAULT_GRAPH_DEPTH),
        tag: tags.length > 0 ? tags : undefined,
      })
    )
  )

  const bestByChunkId = new Map<string, RagRetrievalHit>()

  for (const rawResult of rawResults) {
    const parsed = parseEvidenceHits(rawResult)
    for (const item of parsed) {
      const chunkId = resolveChunkIdFromHit(item.rawId, collection)
      if (!chunkId) continue
      const parsedChunkId = parseChunkId(chunkId)
      if (!parsedChunkId) continue
      const chunk = await getJson<RagChunkRecord>(
        KEYS.RAG_CHUNK(parsedChunkId.collectionId, parsedChunkId.documentId, parsedChunkId.chunkIndex)
      )
      if (!chunk) continue

      const hit: RagRetrievalHit = {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        title: chunk.title,
        source: chunk.source,
        content: chunk.content,
        score: item.score,
        tags: chunk.tags,
        graphNodes: chunk.graphNodes,
        metadata: chunk.metadata,
      }

      const current = bestByChunkId.get(chunk.id)
      if (!current || (hit.score ?? Number.NEGATIVE_INFINITY) > (current.score ?? Number.NEGATIVE_INFINITY)) {
        bestByChunkId.set(chunk.id, hit)
      }
    }
  }

  const hits = sortHits(Array.from(bestByChunkId.values())).slice(0, topK)
  const contextText = hits
    .map((item, index) => {
      const title = item.title || `片段 ${index + 1}`
      const source = item.source ? ` | 来源: ${item.source}` : ''
      return `[${index + 1}] ${title}${source}\n${item.content}`
    })
    .join('\n\n')

  return {
    collection,
    hits,
    contextText,
  }
}
