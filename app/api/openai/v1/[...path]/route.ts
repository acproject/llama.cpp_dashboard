import { NextRequest, NextResponse } from 'next/server'
import { getJson, incr, keys, KEYS, setJson } from '@/lib/minimemory'
import { DispatchConfig, LlamaService } from '@/types'
import { getDispatchConfig } from '@/lib/orchestrator'

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

function getSessionKey(request: NextRequest, parsedJson: any): string | null {
  const sessionId = parsedJson?.session_id
  if (typeof sessionId === 'string' && sessionId.trim()) return sessionId.trim()

  const headerSession = request.headers.get('x-session-id')
  if (headerSession && headerSession.trim()) return headerSession.trim()

  const auth = request.headers.get('authorization')
  if (auth && auth.trim()) return auth.trim()

  const apiKey = request.headers.get('api-key')
  if (apiKey && apiKey.trim()) return apiKey.trim()

  const xff = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || ''
  const ip = xff.split(',')[0]?.trim() || 'unknown'
  const ua = request.headers.get('user-agent') || 'unknown'
  return `${ip}|${ua}`
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
      if (strategy === 'round-robin' || strategy === 'least-connections') {
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

async function handleModels() {
  const services = await listServices()
  const models = services
    .filter(s => s.status === 'online' && s.enabled !== false)
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  if (path.length === 1 && path[0] === 'models') {
    return handleModels()
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const upstreamPath = `/v1/${path.join('/')}`

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

  const services = await listServices()
  const model = routingHints?.model ?? null
  const rawSessionKey = getSessionKey(request, routingHints)
  const sessionRouteKey = rawSessionKey ? toSessionRouteKey(rawSessionKey) : null
  const modelRouteKey = model && typeof model === 'string' ? toModelRouteKey(model) : null
  const dispatchConfig = await getDispatchConfig()

  let selected: LlamaService | null = null
  let sticky: StickyRoute | null = null
  let candidateCount = 0
  let schedulingMode: 'direct' | 'enabled' = 'direct'

  if (model) {
    const online = services.filter(s => s.status === 'online' && s.enabled !== false)
    const candidates = online.filter(s => serviceMatchesModel(s, model))
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
    schedulingMode = schedulingEnabled ? 'enabled' : 'direct'

    if (!schedulingEnabled) {
      if (!hasSinglePrimary && stableCandidates.length > 1) {
        const baseModelNorm = normalizeModelText(stableCandidates[0].model || '')
        const allSameModelNorm = Boolean(
          baseModelNorm &&
            stableCandidates.every(s => normalizeModelText(s.model || '') === baseModelNorm)
        )
        const allInOneReplicaGroup = groups.size === 1 && Boolean(groupName)
        if (!allSameModelNorm && !allInOneReplicaGroup) {
          selected = null
        } else {
          selected = stableCandidates[0] || null
        }
      } else {
        selected = hasSinglePrimary ? primaries[0] : (stableCandidates[0] || null)
      }
    } else {
      if (sessionRouteKey && modelRouteKey) {
        sticky = await getJson<StickyRoute>(KEYS.SESSION_ROUTE(sessionRouteKey, modelRouteKey))
        if (sticky) {
          selected =
            services.find(s => s.status === 'online' && s.enabled !== false && s.id === sticky!.serviceId) ||
            services.find(s => s.status === 'online' && s.enabled !== false && s.host === sticky!.host && s.port === sticky!.port) ||
            null
        }
      }
      if (!selected) selected = await pickServiceByModel(services, model, rawSessionKey, dispatchConfig)
    }
  } else {
    if (!selected && requiresModel(upstreamPath)) {
      return NextResponse.json(
        {
          error: 'model name is missing from the request',
          type: 'invalid_request_error',
        },
        { status: 400 }
      )
    }
  }

  if (!selected) {
    return NextResponse.json(
      {
        error: 'No available service for model (or model is ambiguous; enable replicaGroup scheduling in config)',
        type: 'invalid_request_error',
        model,
      },
      { status: 400 }
    )
  }

  if (model && sessionRouteKey && modelRouteKey) {
    const route: StickyRoute = {
      serviceId: selected.id,
      host: selected.host,
      port: selected.port,
      model: selected.model,
      updatedAt: Date.now(),
    }
    await setJson(KEYS.SESSION_ROUTE(sessionRouteKey, modelRouteKey), route, 2 * 60 * 60 * 1000)
  }

  if (parsedJson && typeof parsedJson === 'object' && parsedJson.model == null && selected.model) {
    parsedJson = { ...parsedJson, model: selected.model }
  }
  parsedJson = sanitizeBodyForLlamaCpp(upstreamPath, parsedJson, Boolean(selected.supportsTools))

  const url = `http://${selected.host}:${selected.port}${upstreamPath}`

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

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(url, {
      method: 'POST',
      headers,
      body: upstreamBody as any,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Upstream fetch failed',
        detail: String(error),
        upstream: { url, serviceId: selected.id, name: selected.name },
      },
      { status: 502 }
    )
  }

  const resHeaders = new Headers(upstreamRes.headers)
  resHeaders.delete('content-encoding')
  resHeaders.delete('content-length')
  resHeaders.set('x-orchestrator-gateway', 'llama.cpp_dashboard')
  resHeaders.set('x-orchestrator-service-id', selected.id)
  resHeaders.set('x-orchestrator-upstream', `${selected.host}:${selected.port}`)
  if (sessionRouteKey) resHeaders.set('x-orchestrator-session', sessionRouteKey)
  if (modelRouteKey) resHeaders.set('x-orchestrator-model-key', modelRouteKey)
  if (typeof model === 'string') resHeaders.set('x-orchestrator-request-model', model)
  resHeaders.set('x-orchestrator-candidates', String(candidateCount))
  resHeaders.set('x-orchestrator-scheduling', schedulingMode)

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers: resHeaders,
  })
}
