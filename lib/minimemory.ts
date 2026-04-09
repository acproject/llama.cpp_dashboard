import {
  createClient,
  type EvidenceSearchFOptions,
  type GraphNeighborsX2Options,
  MiniMemoryClient,
  MiniMemoryClientOptions,
  type RespValue,
} from './minimemory.node'

// MiniMemory configuration
const MINIMEMORY_HOST = process.env.MINIMEMORY_HOST || 'localhost'
const MINIMEMORY_PORT = parseInt(process.env.MINIMEMORY_PORT || '6379')

// Key prefixes for different data types
export const KEYS = {
  SERVICES: 'llama:services',
  SERVICE: (id: string) => `llama:service:${id}`,
  METRICS: (id: string) => `llama:metrics:${id}`,
  HEALTH: (id: string) => `llama:health:${id}`,
  DISPATCH_CONFIG: 'llama:dispatch:config',
  DISPATCH_STATE: 'llama:dispatch:state',
  NGINX_CONFIG: 'llama:nginx:config',
  NGINX_BACKUP: (id: string) => `llama:nginx:backup:${id}`,
  REQUEST_COUNTER: (id: string) => `llama:counter:${id}`,
  LOGS: (id: string) => `llama:logs:${id}`,
  SESSION_ROUTE: (sessionKey: string, modelKey?: string) =>
    `llama:session-route:${sessionKey}${modelKey ? `:${modelKey}` : ''}`,
  REPLICA_RR: (replicaGroup: string) => `llama:replica-rr:${replicaGroup}`,
  RUN: (id: string) => `agent:run:${id}`,
  RUN_EVENTS: (id: string) => `agent:run:events:${id}`,
  SESSION: (id: string) => `agent:session:${id}`,
  AGENT_SESSION_ROUTE: (sessionId: string, modelKey?: string) =>
    `agent:session-route:${sessionId}${modelKey ? `:${modelKey}` : ''}`,
  AGENTS: 'agent:profiles',
  AGENT: (id: string) => `agent:profile:${id}`,
  AGENT_GRAPH: (id: string) => `agent:graph:${id}`,
  AGENT_ACTIVE: (id: string) => `agent:runtime:active:${id}`,
  AGENT_TOTAL: (id: string) => `agent:runtime:total:${id}`,
  AGENT_ERROR: (id: string) => `agent:runtime:error:${id}`,
  SERVICE_ACTIVE: (id: string) => `agent:service:active:${id}`,
  SERVICE_TOTAL: (id: string) => `agent:service:total:${id}`,
  SERVICE_ERROR: (id: string) => `agent:service:error:${id}`,
  RUNS_RECENT: 'agent:runs:recent',
  RUNS_BY_AGENT: (agentId: string) => `agent:runs:by-agent:${agentId}`,
  RUNS_BY_SESSION: (sessionId: string) => `agent:runs:by-session:${sessionId}`,
  RUNS_BY_SERVICE: (serviceId: string) => `agent:runs:by-service:${serviceId}`,
  TASK: (id: string) => `task:${id}`,
  TASK_EVENTS: (id: string) => `task:event:${id}`,
  TASK_CHILDREN: (id: string) => `task:children:${id}`,
  TASK_LEASE: (id: string) => `task:lease:${id}`,
  TASK_RESULT: (id: string) => `task:result:${id}`,
  TASK_EVIDENCE: (taskId: string, evidenceId: string) => `task:evidence:${taskId}:${evidenceId}`,
  TASK_EVIDENCES: (taskId: string) => `task:evidences:${taskId}`,
  TASK_QUEUE: (queueName: string) => `task:queue:${queueName}`,
  RAG_COLLECTION: (id: string) => `rag:collection:${id}`,
  RAG_DOCUMENT: (collectionId: string, documentId: string) => `rag:document:${collectionId}:${documentId}`,
  RAG_CHUNK: (collectionId: string, documentId: string, chunkIndex: number) =>
    `rag:chunk:${collectionId}:${documentId}:${chunkIndex}`,
}

export function getClient(): MiniMemoryClient {
  const options: MiniMemoryClientOptions = {
    host: MINIMEMORY_HOST,
    port: MINIMEMORY_PORT,
    connectTimeoutMs: 5000,
    commandTimeoutMs: 10000,
  }
  return createClient(options)
}

export async function closeClient(): Promise<void> {
  return
}

async function withClient<T>(callback: (client: MiniMemoryClient) => Promise<T>): Promise<T> {
  const client = getClient()
  await client.connect()
  try {
    return await callback(client)
  } finally {
    await client.disconnect().catch(() => undefined)
  }
}

// Connection test
export async function testConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await withClient(async (client) => client.set('llama:connection:test', '1'))
    return { success: result === 'PONG' || result === 'OK' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// Health check
export async function ping(): Promise<boolean> {
  try {
    const result = await withClient(async (client) => client.set('llama:ping:test', '1'))
    return result === 'OK'
  } catch {
    return false
  }
}

// Helper functions for JSON operations
export async function getJson<T>(key: string): Promise<T | null> {
  const data = await withClient(async (client) => client.get(key))
  if (!data) return null
  try {
    const str = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data)
    return JSON.parse(str) as T
  } catch {
    return null
  }
}

export async function setJson<T>(key: string, value: T, ttlMs?: number): Promise<void> {
  await withClient(async (client) => {
    const data = JSON.stringify(value)
    await client.set(key, data)
    if (ttlMs) {
      await client.pexpire(key, ttlMs)
    }
  })
}

export async function deleteKey(key: string): Promise<void> {
  await withClient(async (client) => {
    await client.del(key)
  })
}

export async function callMinimemory(
  args: Array<string | number | boolean | null | undefined>
): Promise<RespValue> {
  return await withClient(async (client) => client.call(args))
}

export async function setString(key: string, value: string, ttlMs?: number): Promise<void> {
  await withClient(async (client) => {
    await client.set(key, value)
    if (ttlMs) {
      await client.pexpire(key, ttlMs)
    }
  })
}

export async function existsKey(key: string): Promise<boolean> {
  const result = await withClient(async (client) => client.exists(key))
  return result === 1
}

// Counter operations
export async function incr(key: string): Promise<number> {
  return await withClient(async (client) => client.incr(key))
}

export async function incrBy(key: string, increment: number): Promise<number> {
  const result = await withClient(async (client) => client.call(['INCRBY', key, String(increment)]))
  return Number(result) || 0
}

export async function decr(key: string): Promise<number> {
  return decrBy(key, 1)
}

export async function decrBy(key: string, decrement: number): Promise<number> {
  const current = await getNumber(key)
  const next = current - decrement
  await setJson(key, next)
  return next
}

export async function getNumber(key: string): Promise<number> {
  const result = await withClient(async (client) => client.get(key))
  if (result === null || result === undefined) return 0
  const value = Buffer.isBuffer(result) ? result.toString('utf-8') : String(result)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Set operations for service registry
export async function sadd(key: string, ...members: string[]): Promise<number> {
  const args = ['SADD', key, ...members]
  const result = await withClient(async (client) => client.call(args))
  return Number(result) || 0
}

export async function srem(key: string, ...members: string[]): Promise<number> {
  const args = ['SREM', key, ...members]
  const result = await withClient(async (client) => client.call(args))
  return Number(result) || 0
}

export async function smembers(key: string): Promise<string[]> {
  const result = await withClient(async (client) => client.call(['SMEMBERS', key]))
  if (Array.isArray(result)) {
    return result.map((r: unknown) => Buffer.isBuffer(r) ? r.toString('utf-8') : String(r))
  }
  return []
}

export async function sismember(key: string, member: string): Promise<boolean> {
  const result = await withClient(async (client) => client.call(['SISMEMBER', key, member]))
  return result === 1 || result === '1'
}

// Keys pattern matching
export async function keys(pattern: string): Promise<string[]> {
  const result = await withClient(async (client) => client.keys(pattern))
  if (Array.isArray(result)) {
    return result.map((r: unknown) => Buffer.isBuffer(r) ? r.toString('utf-8') : String(r))
  }
  return []
}

// Metadata operations (MiniMemory specific)
export async function metaset(subject: string, field: string, value: string): Promise<string> {
  return await withClient(async (client) => client.metaset(subject, field, value))
}

export async function metaget(subject: string, field: string): Promise<string | null> {
  const result = await withClient(async (client) => client.metaget(subject, field))
  if (result === null) return null
  return Buffer.isBuffer(result) ? result.toString('utf-8') : String(result)
}

// Graph operations (MiniMemory specific)
export async function graphAddEdge(from: string, rel: string, to: string): Promise<string> {
  return await withClient(async (client) => client.graphAddEdge(from, rel, to))
}

export async function graphDelEdge(from: string, rel: string, to: string): Promise<string> {
  return await withClient(async (client) => client.graphDelEdge(from, rel, to))
}

export async function graphHasEdge(from: string, rel: string, to: string): Promise<boolean> {
  const result = await withClient(async (client) => client.graphHasEdge(from, rel, to))
  return result === 1 || result === '1'
}

export async function graphEdgePropSet(
  from: string,
  rel: string,
  to: string,
  field: string,
  value: string
): Promise<string> {
  return await withClient(async (client) => client.graphEdgePropSet(from, rel, to, field, value))
}

export async function graphNeighborsX2(
  node: string,
  rel?: string,
  limit?: number,
  options?: GraphNeighborsX2Options
): Promise<RespValue> {
  return await withClient(async (client) => client.graphNeighborsX2(node, rel, limit, options))
}

// Tag operations (MiniMemory specific)
export async function tagadd(key: string, ...tags: string[]): Promise<string> {
  return await withClient(async (client) => client.tagadd(key, ...tags))
}

export async function objset(key: string, mime: string, data: string): Promise<string> {
  return await withClient(async (client) => client.objset(key, mime, data))
}

export async function objget(key: string): Promise<string | null> {
  const result = await withClient(async (client) => client.objget(key))
  if (result === null) return null
  return Buffer.isBuffer(result) ? result.toString('utf-8') : String(result)
}

export async function evidenceSearchF(
  topk: number,
  metric: string,
  dim: number,
  queryVector: Array<number | string>,
  options?: EvidenceSearchFOptions
): Promise<RespValue> {
  return await withClient(async (client) => client.evidenceSearchF(topk, metric, dim, queryVector, options))
}

// List operations for logs
export async function lpush(key: string, value: string): Promise<number> {
  const result = await withClient(async (client) => client.call(['LPUSH', key, value]))
  return Number(result) || 0
}

export async function lrange(key: string, start: number, stop: number): Promise<string[]> {
  const result = await withClient(async (client) => client.call(['LRANGE', key, String(start), String(stop)]))
  if (Array.isArray(result)) {
    return result.map((r: unknown) => Buffer.isBuffer(r) ? r.toString('utf-8') : String(r))
  }
  return []
}

export async function ltrim(key: string, start: number, stop: number): Promise<void> {
  await withClient(async (client) => {
    await client.call(['LTRIM', key, String(start), String(stop)])
  })
}

export async function pushJsonList<T>(
  key: string,
  value: T,
  options: { maxLength?: number; ttlMs?: number } = {}
): Promise<number> {
  const existing = (await getJson<T[]>(key)) || []
  const next = [value, ...existing]
  const normalized =
    typeof options.maxLength === 'number' && options.maxLength >= 0
      ? next.slice(0, options.maxLength)
      : next
  await setJson(key, normalized, options.ttlMs)
  return normalized.length
}

export async function getJsonList<T>(key: string, start = 0, stop = -1): Promise<T[]> {
  const items = (await getJson<T[]>(key)) || []
  const normalizedStart = Math.max(0, start)
  const normalizedStop = stop < 0 ? items.length - 1 : stop
  if (normalizedStart >= items.length || normalizedStop < normalizedStart) return []
  return items.slice(normalizedStart, normalizedStop + 1)
}

// Hash operations
export async function hset(key: string, field: string, value: string): Promise<number> {
  const result = await withClient(async (client) => client.call(['HSET', key, field, value]))
  return Number(result) || 0
}

export async function hget(key: string, field: string): Promise<string | null> {
  const result = await withClient(async (client) => client.call(['HGET', key, field]))
  if (result === null) return null
  return Buffer.isBuffer(result) ? result.toString('utf-8') : String(result)
}

export async function hgetall(key: string): Promise<Record<string, string>> {
  const result = await withClient(async (client) => client.call(['HGETALL', key]))
  const obj: Record<string, string> = {}
  if (Array.isArray(result)) {
    for (let i = 0; i + 1 < result.length; i += 2) {
      const keyVal = result[i]
      const valVal = result[i + 1]
      if (keyVal !== null && keyVal !== undefined) {
        const k = Buffer.isBuffer(keyVal) ? keyVal.toString('utf-8') : `${keyVal}`
        const v = valVal !== null && valVal !== undefined
          ? (Buffer.isBuffer(valVal) ? valVal.toString('utf-8') : `${valVal}`)
          : ''
        obj[k] = v
      }
    }
  }
  return obj
}

export async function hdel(key: string, field: string): Promise<number> {
  const result = await withClient(async (client) => client.call(['HDEL', key, field]))
  return Number(result) || 0
}
