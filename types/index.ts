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

export type OpenSourceCapabilitySourceType = 'agency-agent' | 'cli-anything'

export interface OpenSourceCapabilityCatalogItem {
  sourceType: OpenSourceCapabilitySourceType
  slug: string
  title: string
  description?: string
  category: string
  repoUrl?: string
  homepage?: string
  docsPath?: string
  capabilities: string[]
  tools: string[]
  promptExcerpt?: string
  metadata?: Record<string, unknown>
}

export interface AgentImportedCapabilitySource extends OpenSourceCapabilityCatalogItem {
  importedAt: number
}

export type RagMetric = 'cosine' | 'l2' | 'ip'

export interface RagCollection {
  id: string
  name: string
  description?: string
  embeddingServiceId?: string
  embeddingModel?: string
  embeddingSpace: string
  embeddingDimension?: number
  metric: RagMetric
  graphRootNode: string
  graphRelation: string
  chunkSize: number
  chunkOverlap: number
  enabled: boolean
  documentCount: number
  chunkCount: number
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export interface RagDocument {
  id: string
  collectionId: string
  title: string
  source?: string
  tags: string[]
  graphNodes: string[]
  chunkCount: number
  contentPreview?: string
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export interface RagChunkRecord {
  id: string
  collectionId: string
  documentId: string
  chunkIndex: number
  chunkKey: string
  embeddingKey: string
  title?: string
  source?: string
  content: string
  tags: string[]
  graphNodes: string[]
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface RagRetrievalHit {
  chunkId: string
  documentId: string
  title?: string
  source?: string
  content: string
  score: number | null
  tags: string[]
  graphNodes: string[]
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

export interface AgentRuntimeStats {
  agentId: string
  agentName: string
  role?: string
  activeRuns: number
  totalRuns: number
  failedRuns: number
  successRate: number
  lastRunAt?: number
  lastErrorAt?: number
}

export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export type TaskKind =
  | 'mock'
  | 'agent.chat'
  | 'agent.completion'
  | 'service.chat'
  | 'service.completion'
  | 'service.embedding'
  | 'tool.http'

export interface AgentChatTaskPayload {
  agentId?: string
  model?: string
  path?: string
  routePath?: string
  messages: unknown[]
  stream?: boolean
  request?: Record<string, unknown>
}

export interface AgentCompletionTaskPayload {
  agentId?: string
  model?: string
  path?: string
  routePath?: string
  prompt: string
  stream?: boolean
  request?: Record<string, unknown>
}

export interface ServiceChatTaskPayload {
  serviceId: string
  model?: string
  path?: string
  servicePath?: string
  messages: unknown[]
  stream?: boolean
  request?: Record<string, unknown>
}

export interface ServiceCompletionTaskPayload {
  serviceId: string
  model?: string
  path?: string
  servicePath?: string
  prompt: string
  stream?: boolean
  request?: Record<string, unknown>
}

export interface ServiceEmbeddingTaskPayload {
  serviceId: string
  model?: string
  path?: string
  servicePath?: string
  input: string | string[]
  request?: Record<string, unknown>
}

export interface ToolHttpTaskPayload {
  url?: string
  path?: string
  baseUrl?: string
  method?: string
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean>
  body?: unknown
  stream?: boolean
  unwrapSuccessEnvelope?: boolean
}

export type TaskPayload =
  | AgentChatTaskPayload
  | AgentCompletionTaskPayload
  | ServiceChatTaskPayload
  | ServiceCompletionTaskPayload
  | ServiceEmbeddingTaskPayload
  | ToolHttpTaskPayload
  | Record<string, unknown>

export type TaskEventType =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'child_added'
  | 'leased'
  | 'heartbeat'
  | 'lease_released'
  | 'result_set'
  | 'timed_out'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stream_started'
  | 'stream_delta'
  | 'stream_completed'
  | 'evidence_indexed'

export interface TaskRecord {
  id: string
  title: string
  description?: string
  kind?: TaskKind | string
  status: TaskStatus
  priority: TaskPriority
  parentTaskId?: string
  rootTaskId?: string
  queueName?: string
  runId?: string
  sessionId?: string
  requestedAgentId?: string
  assignedAgentId?: string
  assignedAgentName?: string
  retryCount: number
  maxRetries: number
  dependsOnTaskIds: string[]
  childrenCount: number
  payload?: TaskPayload
  metadata?: Record<string, unknown>
  error?: string
  createdAt: number
  updatedAt: number
  claimedAt?: number
  startedAt?: number
  completedAt?: number
}

export interface TaskEvent {
  taskId: string
  type: TaskEventType
  timestamp: number
  detail?: string
  actorId?: string
  actorType?: string
  metadata?: Record<string, unknown>
}

export interface TaskLease {
  taskId: string
  holderId: string
  holderType: 'agent' | 'worker' | 'system'
  acquiredAt: number
  heartbeatAt: number
  expiresAt: number
  metadata?: Record<string, unknown>
}

export interface TaskResult {
  taskId: string
  status: 'success' | 'error' | 'partial'
  summary?: string
  output?: unknown
  metadata?: Record<string, unknown>
  updatedAt: number
}

export interface TaskEvidenceRecord {
  id: string
  taskId: string
  kind: string
  title?: string
  content?: string
  source?: string
  uri?: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface TaskQueueStats {
  queueName: string
  depth: number
  claimable: number
  running: number
  updatedAt?: number
}

export interface TaskRuntimeView extends TaskRecord {
  lease: TaskLease | null
  result: TaskResult | null
  queueDepth: number
  isClaimable: boolean
}

export interface TaskClaimResult {
  task: TaskRecord
  lease: TaskLease
}

export interface TaskDependencyNode {
  taskId: string
  title: string
  kind?: string
  status: TaskStatus
  priority: TaskPriority
  queueName?: string
  parentTaskId?: string
  rootTaskId?: string
  dependsOnTaskIds: string[]
  dependentTaskIds: string[]
  blockedByTaskIds: string[]
  failedDependencyTaskIds: string[]
  dependencyDepth: number
  isClaimable: boolean
  createdAt: number
  updatedAt: number
}

export interface TaskDependencyEdge {
  fromTaskId: string
  toTaskId: string
  relation: 'depends_on' | 'parent_child'
}

export interface TaskDependencyUnlockData {
  taskId: string
  completedDependencyTaskIds: string[]
  newlyClaimableTaskIds: string[]
  stillBlockedTaskIds: string[]
  failedPropagationCandidates: string[]
}

export interface TaskDagView {
  rootTaskId: string
  focusTaskId: string
  nodes: TaskDependencyNode[]
  edges: TaskDependencyEdge[]
  unlock: TaskDependencyUnlockData
}

export type MemoryKind =
  | 'run_summary'
  | 'fact'
  | 'artifact'
  | 'evidence'
  | 'review_comment'
  | 'note'

export type MemoryScopeType = 'global' | 'agent' | 'task' | 'run' | 'session'

export interface MemoryRecord {
  id: string
  space: string
  kind: MemoryKind
  scopeType: MemoryScopeType
  scopeId?: string
  title?: string
  summary?: string
  content?: string
  tags: string[]
  source?: string
  uri?: string
  agentId?: string
  taskId?: string
  runId?: string
  sessionId?: string
  version: number
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type EvidenceSourceType = 'task_evidence' | 'memory' | 'rag_hit'

export type EvidenceScopeType = 'collection' | 'task' | 'run' | 'session' | 'agent' | 'memory_space'

export interface EvidenceScope {
  type: EvidenceScopeType
  id: string
}

export interface EvidenceRecord {
  id: string
  sourceType: EvidenceSourceType
  title?: string
  summary?: string
  content?: string
  source?: string
  uri?: string
  tags: string[]
  score: number | null
  scopes: EvidenceScope[]
  collectionId?: string
  documentId?: string
  chunkId?: string
  memoryId?: string
  taskEvidenceId?: string
  space?: string
  taskId?: string
  runId?: string
  sessionId?: string
  agentId?: string
  kind?: string
  createdAt?: number
  updatedAt?: number
  metadata?: Record<string, unknown>
}

export interface RuntimeSummary {
  recentRuns: number
  activeRequests: number
  activeAgents: number
  activeSessions: number
  activeTasks: number
  queuedTasks: number
  totalTasks: number
  leasedTasks: number
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
    agentStats: Record<string, AgentRuntimeStats>
    tasks: TaskRuntimeView[]
    taskQueues: TaskQueueStats[]
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
