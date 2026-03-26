// Service Types
export interface LlamaService {
  id: string
  name: string
  description?: string
  host: string
  port: number
  model: string
  modelPath?: string
  apiKey?: string
  status: ServiceStatus
  weight: number
  capabilities: string[]
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export type ServiceStatus = 'online' | 'offline' | 'starting' | 'stopping' | 'error'

// Monitoring Types
export interface ServiceMetrics {
  serviceId: string
  requestsPerSecond: number
  avgResponseTime: number
  errorRate: number
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  lastCheckAt: number
  gpuUsage?: number
  cpuUsage?: number
  memoryUsage?: number
  queueLength?: number
}

export interface HealthCheckResult {
  serviceId: string
  healthy: boolean
  responseTime: number
  checkedAt: number
  error?: string
}

// Dispatch Types
export interface DispatchRequest {
  id: string
  prompt: string
  maxTokens?: number
  temperature?: number
  topP?: number
  stream?: boolean
  capability?: string
  metadata?: Record<string, unknown>
}

export interface DispatchResponse {
  id: string
  serviceId: string
  model: string
  content: string
  tokensGenerated: number
  responseTime: number
  finishReason: string
}

export type DispatchStrategy = 'round-robin' | 'least-connections' | 'weighted' | 'capability-based'

export interface DispatchConfig {
  strategy: DispatchStrategy
  defaultWeight: number
  healthCheckInterval: number
  healthCheckTimeout: number
  maxRetries: number
  retryDelay: number
}

// Nginx Types
export interface NginxUpstream {
  name: string
  servers: NginxUpstreamServer[]
  loadBalancingMethod: 'round-robin' | 'least-conn' | 'ip-hash'
  keepalive?: number
}

export interface NginxUpstreamServer {
  serviceId: string
  host: string
  port: number
  weight: number
  maxFails?: number
  failTimeout?: string
  backup?: boolean
}

export interface NginxConfig {
  upstreams: NginxUpstream[]
  serverPort: number
  proxyTimeout: number
  proxyBufferSize: string
  additionalConfig?: string
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
