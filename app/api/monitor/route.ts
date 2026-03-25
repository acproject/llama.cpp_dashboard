import { NextRequest, NextResponse } from 'next/server'
import { ServiceMetrics, HealthCheckResult, LlamaService } from '@/types'
import { getJson, setJson, lrange, lpush, ltrim, KEYS } from '@/lib/minimemory'
import { checkAllServices } from '@/lib/health-check'
import { keys } from '@/lib/minimemory'

// GET /api/monitor - Get monitoring data for all services
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const serviceId = searchParams.get('serviceId')
    
    if (serviceId) {
      // Get data for specific service
      const [metrics, health] = await Promise.all([
        getJson<ServiceMetrics>(KEYS.METRICS(serviceId)),
        getJson<HealthCheckResult>(KEYS.HEALTH(serviceId)),
      ])
      
      return NextResponse.json({
        success: true,
        data: { metrics, health },
      })
    }
    
    const serviceKeys = await keys('llama:service:*')
    const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))
    const services: LlamaService[] = []
    const metricsMap: Record<string, ServiceMetrics> = {}
    const healthMap: Record<string, HealthCheckResult> = {}
    
    for (const id of serviceIds) {
      const [service, metrics, health] = await Promise.all([
        getJson<LlamaService>(KEYS.SERVICE(id)),
        getJson<ServiceMetrics>(KEYS.METRICS(id)),
        getJson<HealthCheckResult>(KEYS.HEALTH(id)),
      ])
      
      if (service) services.push(service)
      if (metrics) metricsMap[id] = metrics
      if (health) healthMap[id] = health
    }
    
    // Calculate summary
    const summary = {
      totalServices: services.length,
      onlineServices: services.filter(s => s.status === 'online').length,
      offlineServices: services.filter(s => s.status === 'offline').length,
      errorServices: services.filter(s => s.status === 'error').length,
      totalRequests: Object.values(metricsMap).reduce((sum, m) => sum + m.totalRequests, 0),
      avgResponseTime: calculateAvgResponseTime(metricsMap),
    }
    
    return NextResponse.json({
      success: true,
      data: {
        services,
        metrics: metricsMap,
        health: healthMap,
        summary,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/monitor - Trigger health check
export async function POST(request: NextRequest) {
  try {
    const serviceKeys = await keys('llama:service:*')
    const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))
    const services: LlamaService[] = []
    
    for (const id of serviceIds) {
      const service = await getJson<LlamaService>(KEYS.SERVICE(id))
      if (service) services.push(service)
    }
    
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

function calculateAvgResponseTime(metrics: Record<string, ServiceMetrics>): number {
  const values = Object.values(metrics)
  if (values.length === 0) return 0
  
  const total = values.reduce((sum, m) => sum + m.avgResponseTime, 0)
  return total / values.length
}
