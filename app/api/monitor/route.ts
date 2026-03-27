import { NextRequest, NextResponse } from 'next/server'
import {
  ServiceMetrics,
  HealthCheckResult,
  LlamaService,
  MonitorData,
  RunRecord,
  RuntimeSummary,
  ServiceRuntimeStats,
  SessionBindingView,
} from '@/types'
import { getJson, getJsonList, getNumber, setJson, KEYS } from '@/lib/minimemory'
import { checkAllServices } from '@/lib/health-check'
import { keys } from '@/lib/minimemory'

const ACTIVE_RUN_STALE_MS = 5 * 60 * 1000

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const serviceId = searchParams.get('serviceId')
    
    if (serviceId) {
      const [metrics, health] = await Promise.all([
        getJson<ServiceMetrics>(KEYS.METRICS(serviceId)),
        getJson<HealthCheckResult>(KEYS.HEALTH(serviceId)),
      ])
      
      return NextResponse.json({
        success: true,
        data: { metrics, health },
      })
    }
    
    const services = await listServices()
    const metricsMap: Record<string, ServiceMetrics> = {}
    const healthMap: Record<string, HealthCheckResult> = {}
    
    for (const service of services) {
      const [metrics, health] = await Promise.all([
        getJson<ServiceMetrics>(KEYS.METRICS(service.id)),
        getJson<HealthCheckResult>(KEYS.HEALTH(service.id)),
      ])
      
      if (metrics) metricsMap[service.id] = metrics
      if (health) healthMap[service.id] = health
    }
    
    const summary = {
      totalServices: services.length,
      onlineServices: services.filter(s => s.status === 'online' && s.enabled !== false).length,
      offlineServices: services.filter(s => s.status === 'offline').length,
      errorServices: services.filter(s => s.status === 'error').length,
      totalRequests: Object.values(metricsMap).reduce((sum, m) => sum + m.totalRequests, 0),
      avgResponseTime: calculateAvgResponseTime(metricsMap),
    }

    const runtime = await getRuntimeData(services)
    const data: MonitorData = {
      services,
      metrics: metricsMap,
      health: healthMap,
      summary,
      runtime,
    }
    
    return NextResponse.json({
      success: true,
      data,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const services = await listServices()
    
    const healthResults = await checkAllServices(services)
    
    for (const result of healthResults) {
      const service = services.find(s => s.id === result.serviceId)
      if (service) {
        const status = result.healthy ? 'online' : 'error'
        await setJson(KEYS.SERVICE(service.id), {
          ...service,
          status,
          updatedAt: Date.now(),
        })
      }
    }
    
    return NextResponse.json({
      success: true,
      data: healthResults,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

async function listServices(): Promise<LlamaService[]> {
  const serviceKeys = await keys('llama:service:*')
  const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))
  const services = await Promise.all(
    serviceIds.map(id => getJson<LlamaService>(KEYS.SERVICE(id)))
  )
  return services.filter((service): service is LlamaService => Boolean(service))
}

async function getRuntimeData(services: LlamaService[]): Promise<MonitorData['runtime']> {
  const now = Date.now()
  const recentRunIds = await getJsonList<string>(KEYS.RUNS_RECENT, 0, 29)
  const recentRunsRaw = await Promise.all(
    recentRunIds.map(runId => getJson<RunRecord>(KEYS.RUN(runId)))
  )
  const runs = recentRunsRaw
    .filter((run): run is RunRecord => Boolean(run))
    .sort((a, b) => b.startedAt - a.startedAt)

  const activeRunStatuses = new Set<RunRecord['status']>(['received', 'routed', 'running'])
  const runById = new Map(runs.map(run => [run.id, run]))
  const activeRunCountsByService = runs.reduce<Record<string, number>>((acc, run) => {
    if (!run.serviceId || !isRunActive(run, activeRunStatuses, now)) return acc
    acc[run.serviceId] = (acc[run.serviceId] || 0) + 1
    return acc
  }, {})

  const sessionKeys = await keys('agent:session:*')
  const sessionsRaw = await Promise.all(
    sessionKeys.map(key => getJson<SessionBindingView>(key))
  )
  const serviceById = Object.fromEntries(services.map(service => [service.id, service]))
  const sessions = sessionsRaw
    .filter((session): session is SessionBindingView => Boolean(session))
    .map(session => {
      const currentRun = session.currentRunId ? runById.get(session.currentRunId) : undefined
      const boundService = session.boundServiceId ? serviceById[session.boundServiceId] : undefined
      const currentRunId =
        currentRun && !isRunActive(currentRun, activeRunStatuses, now)
          ? undefined
          : session.currentRunId

      return {
        ...session,
        currentRunId,
        serviceName: boundService?.name,
        serviceHost: boundService?.host,
        servicePort: boundService?.port,
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const serviceStatsEntries = await Promise.all(
    services.map(async (service) => {
      const [activeRequests, totalRequests, failedRequests, serviceRunIds] = await Promise.all([
        getNumber(KEYS.SERVICE_ACTIVE(service.id)),
        getNumber(KEYS.SERVICE_TOTAL(service.id)),
        getNumber(KEYS.SERVICE_ERROR(service.id)),
        getJsonList<string>(KEYS.RUNS_BY_SERVICE(service.id), 0, 0),
      ])

      const lastRunId = serviceRunIds[0]
      const lastRun = lastRunId ? await getJson<RunRecord>(KEYS.RUN(lastRunId)) : null

      const stats: ServiceRuntimeStats = {
        serviceId: service.id,
        activeRequests: activeRunCountsByService[service.id] ?? (activeRequests > 0 ? 0 : activeRequests),
        totalRequests,
        failedRequests,
        lastRunAt: lastRun?.startedAt,
        lastErrorAt: lastRun?.status === 'failed' ? (lastRun.completedAt || lastRun.startedAt) : undefined,
      }

      return [service.id, stats] as const
    })
  )

  const serviceStats = Object.fromEntries(serviceStatsEntries)
  const runtimeSummary: RuntimeSummary = {
    recentRuns: runs.length,
    activeRequests: Object.values(serviceStats).reduce((sum, item) => sum + item.activeRequests, 0),
    activeSessions: sessions.filter(session => Boolean(session.currentRunId)).length,
    totalRuntimeRequests: Object.values(serviceStats).reduce((sum, item) => sum + item.totalRequests, 0),
    failedRuntimeRequests: Object.values(serviceStats).reduce((sum, item) => sum + item.failedRequests, 0),
  }

  return {
    runs,
    sessions,
    serviceStats,
    summary: runtimeSummary,
  }
}

function calculateAvgResponseTime(metrics: Record<string, ServiceMetrics>): number {
  const values = Object.values(metrics)
  if (values.length === 0) return 0
  
  const total = values.reduce((sum, m) => sum + m.avgResponseTime, 0)
  return total / values.length
}

function isRunActive(
  run: RunRecord,
  activeRunStatuses: Set<RunRecord['status']>,
  now: number
): boolean {
  if (!activeRunStatuses.has(run.status)) return false
  return now - run.startedAt <= ACTIVE_RUN_STALE_MS
}
