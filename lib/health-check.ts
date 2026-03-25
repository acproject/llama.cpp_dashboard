import { LlamaService, HealthCheckResult, ServiceStatus } from '@/types'
import { getJson, setJson, KEYS } from './minimemory'

// Health check configuration
const HEALTH_CHECK_TIMEOUT = 5000 // 5 seconds
const HEALTH_CHECK_ENDPOINT = '/health'

export interface HealthCheckOptions {
  timeout?: number
  endpoint?: string
}

/**
 * Perform health check on a single service
 */
export async function checkServiceHealth(
  service: LlamaService,
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult> {
  const timeout = options.timeout || HEALTH_CHECK_TIMEOUT
  const startTime = Date.now()
  
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    const url = `http://${service.host}:${service.port}${options.endpoint || HEALTH_CHECK_ENDPOINT}`
    
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
    const responseTime = Date.now() - startTime
    
    const result: HealthCheckResult = {
      serviceId: service.id,
      healthy: response.ok,
      responseTime,
      checkedAt: Date.now(),
    }
    
    if (!response.ok) {
      result.error = `HTTP ${response.status}: ${response.statusText}`
    }
    
    // Store health check result
    await setJson(KEYS.HEALTH(service.id), result, 60000) // TTL 1 minute
    
    return result
  } catch (error) {
    const responseTime = Date.now() - startTime
    const result: HealthCheckResult = {
      serviceId: service.id,
      healthy: false,
      responseTime,
      checkedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    }
    
    // Store health check result
    await setJson(KEYS.HEALTH(service.id), result, 60000)
    
    return result
  }
}

/**
 * Check if llama.cpp server is responding (using /props endpoint)
 */
export async function checkLlamaServer(
  service: LlamaService,
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult> {
  const timeout = options.timeout || HEALTH_CHECK_TIMEOUT
  const startTime = Date.now()
  
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    // llama.cpp server provides /props endpoint for model info
    const url = `http://${service.host}:${service.port}/props`
    
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
    const responseTime = Date.now() - startTime
    
    const result: HealthCheckResult = {
      serviceId: service.id,
      healthy: response.ok,
      responseTime,
      checkedAt: Date.now(),
    }
    
    if (!response.ok) {
      result.error = `HTTP ${response.status}: ${response.statusText}`
    }
    
    await setJson(KEYS.HEALTH(service.id), result, 60000)
    
    return result
  } catch (error) {
    const responseTime = Date.now() - startTime
    const result: HealthCheckResult = {
      serviceId: service.id,
      healthy: false,
      responseTime,
      checkedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    }
    
    await setJson(KEYS.HEALTH(service.id), result, 60000)
    
    return result
  }
}

/**
 * Get last health check result for a service
 */
export async function getLastHealthCheck(serviceId: string): Promise<HealthCheckResult | null> {
  return await getJson<HealthCheckResult>(KEYS.HEALTH(serviceId))
}

/**
 * Determine service status based on health check
 */
export function determineStatus(healthResult: HealthCheckResult | null): ServiceStatus {
  if (!healthResult) return 'offline'
  
  const timeSinceCheck = Date.now() - healthResult.checkedAt
  if (timeSinceCheck > 60000) return 'offline' // No check in 1 minute
  
  if (healthResult.healthy) return 'online'
  return 'error'
}

/**
 * Batch health check for multiple services
 */
export async function checkAllServices(
  services: LlamaService[]
): Promise<HealthCheckResult[]> {
  const results = await Promise.all(
    services.map(service => checkLlamaServer(service))
  )
  return results
}
