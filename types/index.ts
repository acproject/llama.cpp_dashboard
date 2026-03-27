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
  enabled?: boolean
  supportsTools?: boolean
  replicaGroup?: string
  primaryReplica?: boolean
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
  replicaGroup?: string | null
  defaultWeight: number
  healthCheckInterval: number
  healthCheckTimeout: number
  maxRetries: number
  retryDelay: number
}

export interface AgentProfile {
  id: string
  name: string
  description?: string
  role?: string
  systemPrompt?: string
  defaultModel?: string
  preferredServiceId?: string
  enabled: boolean
  serviceIds: string[]
  capabilities: string[]
  tools: string[]
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export type RunStatus = 'received' | 'routed' | 'running' | 'completed' | 'failed'

export type RunEventType = 'received' | 'parsed' | 'routed' | 'retry' | 'completed' | 'failed'

export interface RunRecord {
  id: string
  status: RunStatus
  upstreamPath: string
  method: string
  agentId?: string
  agentName?: string
  model?: string
  sessionId?: string
  sessionRouteKey?: string
  modelRouteKey?: string
  serviceId?: string
  serviceName?: string
  serviceHost?: string
  servicePort?: number
  schedulingMode?: 'direct' | 'enabled'
  candidateCount: number
  retryCount: number
  startedAt: number
  completedAt?: number
  latencyMs?: number
  error?: string
}

export interface RunEvent {
  runId: string
  type: RunEventType
  timestamp: number
  serviceId?: string
  serviceName?: string
  detail?: string
  metadata?: Record<string, unknown>
}

export interface SessionRecord {
  sessionId: string
  currentRunId?: string
  lastRunId?: string
  lastModel?: string
  boundServiceId?: string
  updatedAt: number
}

export interface ServiceRuntimeStats {
  serviceId: string
  activeRequests: number
  totalRequests: number
  failedRequests: number
  lastRunAt?: number
  lastErrorAt?: number
}

export interface RuntimeSummary {
  recentRuns: number
  activeRequests: number
  activeSessions: number
  totalRuntimeRequests: number
  failedRuntimeRequests: number
}

export interface SessionBindingView extends SessionRecord {
  serviceName?: string
  serviceHost?: string
  servicePort?: number
}

export interface MonitorData {
  services: LlamaService[]
  metrics: Record<string, ServiceMetrics>
  health: Record<string, HealthCheckResult>
  summary: {
    totalServices: number
    onlineServices: number
    offlineServices: number
    errorServices: number
    totalRequests: number
    avgResponseTime: number
  }
  runtime: {
    runs: RunRecord[]
    sessions: SessionBindingView[]
    serviceStats: Record<string, ServiceRuntimeStats>
    summary: RuntimeSummary
  }
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
  replicaGroup?: string | null
  nodeProxyBase?: string
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
