import { createClient, MiniMemoryClient, MiniMemoryClientOptions } from './minimemory.node'

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
}

// Singleton client
let client: MiniMemoryClient | null = null

export function getClient(): MiniMemoryClient {
  if (!client) {
    const options: MiniMemoryClientOptions = {
      host: MINIMEMORY_HOST,
      port: MINIMEMORY_PORT,
      connectTimeoutMs: 5000,
      commandTimeoutMs: 10000,
    }
    client = createClient(options)
  }
  return client
}

export async function closeClient(): Promise<void> {
  if (client) {
    await client.disconnect()
    client = null
  }
}

// Connection test
export async function testConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const c = getClient()
    await c.connect()
    const result = await c.ping()
    return { success: result === 'PONG' || result === 'OK' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// Health check
export async function ping(): Promise<boolean> {
  try {
    const c = getClient()
    const result = await c.ping()
    return result === 'PONG' || result === 'OK'
  } catch {
    return false
  }
}

// Helper functions for JSON operations
export async function getJson<T>(key: string): Promise<T | null> {
  const c = getClient()
  const data = await c.get(key)
  if (!data) return null
  try {
    const str = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data)
    return JSON.parse(str) as T
  } catch {
    return null
  }
}

export async function setJson<T>(key: string, value: T, ttlMs?: number): Promise<void> {
  const c = getClient()
  const data = JSON.stringify(value)
  await c.set(key, data)
  if (ttlMs) {
    await c.pexpire(key, ttlMs)
  }
}

export async function deleteKey(key: string): Promise<void> {
  const c = getClient()
  await c.del(key)
}

export async function existsKey(key: string): Promise<boolean> {
  const c = getClient()
  const result = await c.exists(key)
  return result === 1
}

// Counter operations
export async function incr(key: string): Promise<number> {
  const c = getClient()
  return await c.incr(key)
}

export async function incrBy(key: string, increment: number): Promise<number> {
  const c = getClient()
  const result = await c.call(['INCRBY', key, String(increment)])
  return Number(result) || 0
}

// Set operations for service registry
export async function sadd(key: string, ...members: string[]): Promise<number> {
  const c = getClient()
  const args = ['SADD', key, ...members]
  const result = await c.call(args)
  return Number(result) || 0
}

export async function srem(key: string, ...members: string[]): Promise<number> {
  const c = getClient()
  const args = ['SREM', key, ...members]
  const result = await c.call(args)
  return Number(result) || 0
}

export async function smembers(key: string): Promise<string[]> {
  const c = getClient()
  const result = await c.call(['SMEMBERS', key])
  if (Array.isArray(result)) {
    return result.map((r: unknown) => Buffer.isBuffer(r) ? r.toString('utf-8') : String(r))
  }
  return []
}

export async function sismember(key: string, member: string): Promise<boolean> {
  const c = getClient()
  const result = await c.call(['SISMEMBER', key, member])
  return result === 1 || result === '1'
}

// Keys pattern matching
export async function keys(pattern: string): Promise<string[]> {
  const c = getClient()
  const result = await c.keys(pattern)
  if (Array.isArray(result)) {
    return result.map((r: unknown) => Buffer.isBuffer(r) ? r.toString('utf-8') : String(r))
  }
  return []
}

// Metadata operations (MiniMemory specific)
export async function metaset(subject: string, field: string, value: string): Promise<string> {
  const c = getClient()
  return await c.metaset(subject, field, value)
}

export async function metaget(subject: string, field: string): Promise<string | null> {
  const c = getClient()
  const result = await c.metaget(subject, field)
  if (result === null) return null
  return Buffer.isBuffer(result) ? result.toString('utf-8') : String(result)
}

// Graph operations (MiniMemory specific)
export async function graphAddEdge(from: string, rel: string, to: string): Promise<string> {
  const c = getClient()
  return await c.graphAddEdge(from, rel, to)
}

export async function graphDelEdge(from: string, rel: string, to: string): Promise<string> {
  const c = getClient()
  return await c.graphDelEdge(from, rel, to)
}

export async function graphHasEdge(from: string, rel: string, to: string): Promise<boolean> {
  const c = getClient()
  const result = await c.graphHasEdge(from, rel, to)
  return result === 1 || result === '1'
}

// Tag operations (MiniMemory specific)
export async function tagadd(key: string, ...tags: string[]): Promise<string> {
  const c = getClient()
  return await c.tagadd(key, ...tags)
}

// List operations for logs
export async function lpush(key: string, value: string): Promise<number> {
  const c = getClient()
  const result = await c.call(['LPUSH', key, value])
  return Number(result) || 0
}

export async function lrange(key: string, start: number, stop: number): Promise<string[]> {
  const c = getClient()
  const result = await c.call(['LRANGE', key, String(start), String(stop)])
  if (Array.isArray(result)) {
    return result.map((r: unknown) => Buffer.isBuffer(r) ? r.toString('utf-8') : String(r))
  }
  return []
}

export async function ltrim(key: string, start: number, stop: number): Promise<void> {
  const c = getClient()
  await c.call(['LTRIM', key, String(start), String(stop)])
}

// Hash operations
export async function hset(key: string, field: string, value: string): Promise<number> {
  const c = getClient()
  const result = await c.call(['HSET', key, field, value])
  return Number(result) || 0
}

export async function hget(key: string, field: string): Promise<string | null> {
  const c = getClient()
  const result = await c.call(['HGET', key, field])
  if (result === null) return null
  return Buffer.isBuffer(result) ? result.toString('utf-8') : String(result)
}

export async function hgetall(key: string): Promise<Record<string, string>> {
  const c = getClient()
  const result = await c.call(['HGETALL', key])
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
  const c = getClient()
  const result = await c.call(['HDEL', key, field])
  return Number(result) || 0
}
