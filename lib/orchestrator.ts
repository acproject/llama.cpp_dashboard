import { LlamaService, DispatchConfig, DispatchStrategy } from '@/types'
import { getJson, setJson, incr, KEYS } from './minimemory'

// Default dispatch configuration
const DEFAULT_CONFIG: DispatchConfig = {
  strategy: 'weighted',
  replicaGroup: null,
  defaultWeight: 1,
  healthCheckInterval: 10000, // 10 seconds
  healthCheckTimeout: 5000, // 5 seconds
  maxRetries: 3,
  retryDelay: 1000, // 1 second
}

// Round-robin state
let roundRobinIndex = 0

/**
 * Get current dispatch configuration
 */
export async function getDispatchConfig(): Promise<DispatchConfig> {
  const config = await getJson<DispatchConfig>(KEYS.DISPATCH_CONFIG)
  return { ...DEFAULT_CONFIG, ...(config || {}) }
}

/**
 * Update dispatch configuration
 */
export async function setDispatchConfig(config: Partial<DispatchConfig>): Promise<DispatchConfig> {
  const current = await getDispatchConfig()
  const updated = { ...current, ...config }
  await setJson(KEYS.DISPATCH_CONFIG, updated)
  return updated
}

/**
 * Select a service based on dispatch strategy
 */
export async function selectService(
  services: LlamaService[],
  strategy?: DispatchStrategy
): Promise<LlamaService | null> {
  if (services.length === 0) return null
  
  // Filter only online services
  const onlineServices = services.filter(s => s.status === 'online' && s.enabled !== false)
  if (onlineServices.length === 0) return null
  
  const config = await getDispatchConfig()
  const activeStrategy = strategy || config.strategy
  
  switch (activeStrategy) {
    case 'round-robin':
      return selectRoundRobin(onlineServices)
    case 'weighted':
      return selectWeighted(onlineServices)
    case 'least-connections':
      return selectLeastConnections(onlineServices)
    case 'capability-based':
      // Requires capability context, fallback to weighted
      return selectWeighted(onlineServices)
    default:
      return selectWeighted(onlineServices)
  }
}

/**
 * Select service by capability
 */
export async function selectServiceByCapability(
  services: LlamaService[],
  capability: string
): Promise<LlamaService | null> {
  const onlineServices = services.filter(s => 
    s.status === 'online' && s.enabled !== false && s.capabilities.includes(capability)
  )
  
  if (onlineServices.length === 0) return null
  
  const config = await getDispatchConfig()
  
  // Use weighted selection for capability-matched services
  return selectWeighted(onlineServices)
}

/**
 * Round-robin selection
 */
function selectRoundRobin(services: LlamaService[]): LlamaService {
  const index = roundRobinIndex % services.length
  roundRobinIndex++
  return services[index]
}

/**
 * Weighted random selection
 */
function selectWeighted(services: LlamaService[]): LlamaService {
  const totalWeight = services.reduce((sum, s) => sum + s.weight, 0)
  let random = Math.random() * totalWeight
  
  for (const service of services) {
    random -= service.weight
    if (random <= 0) {
      return service
    }
  }
  
  return services[services.length - 1]
}

/**
 * Select service with least connections (based on request counter)
 */
async function selectLeastConnections(services: LlamaService[]): Promise<LlamaService> {
  let minConnections = Infinity
  let selectedService = services[0]
  
  for (const service of services) {
    const count = await getConnectionCount(service.id)
    if (count < minConnections) {
      minConnections = count
      selectedService = service
    }
  }
  
  return selectedService
}

/**
 * Get connection count for a service
 */
export async function getConnectionCount(serviceId: string): Promise<number> {
  const count = await incr(KEYS.REQUEST_COUNTER(serviceId))
  // Decrement after a simulated "connection duration"
  // In real implementation, this would be tied to actual request lifecycle
  return count
}

/**
 * Increment request counter
 */
export async function incrementRequestCounter(serviceId: string): Promise<void> {
  await incr(KEYS.REQUEST_COUNTER(serviceId))
}

/**
 * Calculate load distribution percentages
 */
export function calculateLoadDistribution(services: LlamaService[]): Record<string, number> {
  const totalWeight = services.reduce((sum, s) => sum + s.weight, 0)
  const distribution: Record<string, number> = {}
  
  for (const service of services) {
    distribution[service.id] = totalWeight > 0 
      ? (service.weight / totalWeight) * 100 
      : 100 / services.length
  }
  
  return distribution
}

/**
 * Calculate optimal weights based on service metrics
 */
export function calculateOptimalWeights(
  services: LlamaService[],
  metrics: Record<string, { avgResponseTime: number; errorRate: number }>
): Record<string, number> {
  const weights: Record<string, number> = {}
  
  for (const service of services) {
    const metric = metrics[service.id]
    if (!metric) {
      weights[service.id] = 1
      continue
    }
    
    // Lower response time and error rate = higher weight
    const responseScore = 1 / (metric.avgResponseTime || 1)
    const errorPenalty = 1 - (metric.errorRate || 0)
    
    // Normalize to a reasonable weight range (0.1 to 10)
    const rawWeight = responseScore * errorPenalty * 100
    weights[service.id] = Math.max(0.1, Math.min(10, rawWeight))
  }
  
  return weights
}
