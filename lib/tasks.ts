import { deleteKey, getJson, getJsonList, KEYS, keys, pushJsonList, setJson } from '@/lib/minimemory'
import { generateId } from '@/lib/utils'
import { TaskClaimResult, TaskEvent, TaskEventType, TaskLease, TaskPriority, TaskQueueStats, TaskRecord, TaskResult, TaskRuntimeView, TaskStatus } from '@/types'

const TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000
const TASK_EVENT_LIMIT = 200
const TASK_CHILD_LIMIT = 200
const DEFAULT_LEASE_MS = 60 * 1000
const MAX_LEASE_MS = 30 * 60 * 1000

type TaskFilters = {
  status?: TaskStatus
  parentTaskId?: string
  queueName?: string
  assignedAgentId?: string
  requestedAgentId?: string
  runId?: string
  sessionId?: string
  limit?: number
}

type TaskInput = Partial<Omit<TaskRecord, 'id' | 'createdAt' | 'updatedAt' | 'rootTaskId' | 'childrenCount'>>

export async function listTasks(filters: TaskFilters = {}): Promise<TaskRecord[]> {
  const taskKeys = await keys('task:*')
  const recordKeys = taskKeys.filter((key) => /^task:[^:]+$/.test(key))
  const tasksRaw = await Promise.all(
    recordKeys.map((key) => getJson<TaskRecord>(key))
  )
  const tasks = tasksRaw
    .filter((task): task is TaskRecord => Boolean(task))
    .filter((task) => {
      if (filters.status && task.status !== filters.status) return false
      if (filters.parentTaskId && task.parentTaskId !== filters.parentTaskId) return false
      if (filters.queueName && task.queueName !== filters.queueName) return false
      if (filters.assignedAgentId && task.assignedAgentId !== filters.assignedAgentId) return false
      if (filters.requestedAgentId && task.requestedAgentId !== filters.requestedAgentId) return false
      if (filters.runId && task.runId !== filters.runId) return false
      if (filters.sessionId && task.sessionId !== filters.sessionId) return false
      return true
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)

  if (typeof filters.limit === 'number' && filters.limit >= 0) {
    return tasks.slice(0, filters.limit)
  }

  return tasks
}

export async function getTask(taskId: string): Promise<TaskRecord | null> {
  return await getJson<TaskRecord>(KEYS.TASK(taskId))
}

export async function createTask(input: unknown): Promise<TaskRecord> {
  const now = Date.now()
  const normalized = normalizeTaskInput(input)
  const parentTask = normalized.parentTaskId
    ? await getTask(normalized.parentTaskId)
    : null

  if (normalized.parentTaskId && !parentTask) {
    throw new Error(`Parent task not found: ${normalized.parentTaskId}`)
  }

  const task: TaskRecord = {
    id: generateId(),
    title: normalized.title || `task-${now}`,
    description: normalized.description,
    kind: normalized.kind,
    status: normalized.status || 'pending',
    priority: normalized.priority || 'normal',
    parentTaskId: normalized.parentTaskId,
    rootTaskId: parentTask?.rootTaskId || parentTask?.id || undefined,
    queueName: normalized.queueName,
    runId: normalized.runId,
    sessionId: normalized.sessionId,
    requestedAgentId: normalized.requestedAgentId,
    assignedAgentId: normalized.assignedAgentId,
    assignedAgentName: normalized.assignedAgentName,
    retryCount: normalized.retryCount ?? 0,
    maxRetries: normalized.maxRetries ?? 3,
    dependsOnTaskIds: normalized.dependsOnTaskIds || [],
    childrenCount: 0,
    payload: normalized.payload,
    metadata: normalized.metadata,
    error: normalized.error,
    createdAt: now,
    updatedAt: now,
    claimedAt: normalized.claimedAt,
    startedAt: normalized.startedAt,
    completedAt: normalized.completedAt,
  }

  task.rootTaskId = task.rootTaskId || task.id

  await setJson(KEYS.TASK(task.id), task, TASK_TTL_MS)
  if (task.queueName && task.status === 'queued') {
    await addTaskIdToQueue(task.queueName, task.id)
  }
  await appendTaskEvent(task.id, {
    type: 'created',
    detail: 'task created',
    metadata: {
      status: task.status,
      priority: task.priority,
      parentTaskId: task.parentTaskId || null,
      queueName: task.queueName || null,
    },
  })

  if (task.parentTaskId) {
    await linkChildTask(task.parentTaskId, task.id)
  }

  return task
}

export async function updateTask(taskId: string, input: unknown): Promise<TaskRecord | null> {
  const existing = await getTask(taskId)
  if (!existing) return null

  const normalized = normalizeTaskInput(input)
  const previousStatus = existing.status
  const nextStatus = normalized.status || existing.status
  const now = Date.now()
  const isTerminal = isTerminalTaskStatus(nextStatus)

  const next: TaskRecord = {
    ...existing,
    title: normalized.title ?? existing.title,
    description: normalized.description ?? existing.description,
    kind: normalized.kind ?? existing.kind,
    status: nextStatus,
    priority: normalized.priority ?? existing.priority,
    queueName: normalized.queueName ?? existing.queueName,
    runId: normalized.runId ?? existing.runId,
    sessionId: normalized.sessionId ?? existing.sessionId,
    requestedAgentId: normalized.requestedAgentId ?? existing.requestedAgentId,
    assignedAgentId: normalized.assignedAgentId ?? existing.assignedAgentId,
    assignedAgentName: normalized.assignedAgentName ?? existing.assignedAgentName,
    retryCount: normalized.retryCount ?? existing.retryCount,
    maxRetries: normalized.maxRetries ?? existing.maxRetries,
    dependsOnTaskIds: normalized.dependsOnTaskIds ?? existing.dependsOnTaskIds,
    payload: normalized.payload ?? existing.payload,
    metadata: normalized.metadata ?? existing.metadata,
    error: normalized.error ?? existing.error,
    updatedAt: now,
    claimedAt: normalized.claimedAt ?? existing.claimedAt,
    startedAt:
      normalized.startedAt ??
      existing.startedAt ??
      (nextStatus === 'running' ? now : undefined),
    completedAt:
      normalized.completedAt ??
      (isTerminal ? existing.completedAt || now : existing.completedAt),
  }

  await setJson(KEYS.TASK(taskId), next, TASK_TTL_MS)
  if (existing.queueName && (existing.queueName !== next.queueName || next.status !== 'queued')) {
    await removeTaskIdFromQueue(existing.queueName, taskId)
  }
  if (next.queueName && next.status === 'queued') {
    await addTaskIdToQueue(next.queueName, taskId)
  }

  if (previousStatus !== next.status) {
    await appendTaskEvent(taskId, {
      type: toStatusEventType(next.status),
      detail: `task status changed to ${next.status}`,
      metadata: { from: previousStatus, to: next.status },
    })
  } else {
    await appendTaskEvent(taskId, {
      type: 'updated',
      detail: 'task updated',
    })
  }

  return next
}

export async function deleteTask(taskId: string): Promise<TaskRecord | null> {
  const existing = await getTask(taskId)
  if (!existing) return null

  if (existing.parentTaskId) {
    await unlinkChildTask(existing.parentTaskId, taskId)
  }
  if (existing.queueName) {
    await removeTaskIdFromQueue(existing.queueName, taskId)
  }

  await Promise.all([
    deleteKey(KEYS.TASK(taskId)),
    deleteKey(KEYS.TASK_EVENTS(taskId)),
    deleteKey(KEYS.TASK_CHILDREN(taskId)),
    deleteKey(KEYS.TASK_LEASE(taskId)),
    deleteKey(KEYS.TASK_RESULT(taskId)),
  ])

  return existing
}

export async function listTaskEvents(taskId: string, limit = 100): Promise<TaskEvent[]> {
  return await getJsonList<TaskEvent>(KEYS.TASK_EVENTS(taskId), 0, Math.max(0, limit - 1))
}

export async function appendTaskEvent(taskId: string, input: {
  type: TaskEventType
  detail?: string
  actorId?: string
  actorType?: string
  metadata?: Record<string, unknown>
}): Promise<TaskEvent> {
  const task = await getTask(taskId)
  if (!task) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const event: TaskEvent = {
    taskId,
    type: input.type,
    timestamp: Date.now(),
    detail: input.detail,
    actorId: input.actorId,
    actorType: input.actorType,
    metadata: input.metadata,
  }

  await pushJsonList(KEYS.TASK_EVENTS(taskId), event, {
    maxLength: TASK_EVENT_LIMIT,
    ttlMs: TASK_TTL_MS,
  })

  return event
}

export async function listTaskChildren(taskId: string): Promise<TaskRecord[]> {
  const childIds = await getJsonList<string>(KEYS.TASK_CHILDREN(taskId), 0, TASK_CHILD_LIMIT - 1)
  const childrenRaw = await Promise.all(
    childIds.map((childId) => getTask(childId))
  )

  return childrenRaw.filter((task): task is TaskRecord => Boolean(task))
}

export async function addTaskChild(parentTaskId: string, input: unknown): Promise<TaskRecord> {
  const body = isRecord(input) ? input : {}
  const childTaskId = normalizeOptionalString(body.childTaskId)

  if (childTaskId) {
    const parentTask = await getTask(parentTaskId)
    if (!parentTask) throw new Error(`Parent task not found: ${parentTaskId}`)

    const childTask = await getTask(childTaskId)
    if (!childTask) throw new Error(`Child task not found: ${childTaskId}`)
    if (childTask.parentTaskId && childTask.parentTaskId !== parentTaskId) {
      throw new Error(`Task ${childTaskId} already belongs to parent ${childTask.parentTaskId}`)
    }

    const nextChild: TaskRecord = {
      ...childTask,
      parentTaskId,
      rootTaskId: parentTask.rootTaskId || parentTask.id,
      updatedAt: Date.now(),
    }
    await setJson(KEYS.TASK(childTaskId), nextChild, TASK_TTL_MS)
    await linkChildTask(parentTaskId, childTaskId)
    return nextChild
  }

  return await createTask({
    ...body,
    parentTaskId,
  })
}

export async function queueTask(taskId: string, input: unknown): Promise<TaskRecord> {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const body = isRecord(input) ? input : {}
  const queueName = normalizeOptionalString(body.queueName) || task.queueName
  if (!queueName) {
    throw new Error('queueName is required')
  }

  const next = await updateTask(taskId, {
    queueName,
    status: 'queued',
    assignedAgentId: normalizeOptionalString(body.assignedAgentId) ?? task.assignedAgentId,
    assignedAgentName: normalizeOptionalString(body.assignedAgentName) ?? task.assignedAgentName,
    error: undefined,
    completedAt: undefined,
  })
  if (!next) {
    throw new Error(`Task not found: ${taskId}`)
  }

  await appendTaskEvent(taskId, {
    type: 'updated',
    detail: `task queued in ${queueName}`,
    actorId: normalizeOptionalString(body.actorId),
    actorType: normalizeOptionalString(body.actorType),
    metadata: { queueName },
  })

  return next
}

export async function claimTask(taskId: string, input: unknown): Promise<TaskClaimResult> {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const body = isRecord(input) ? input : {}
  const holderId = normalizeOptionalString(body.holderId)
  if (!holderId) {
    throw new Error('holderId is required')
  }

  const holderType = normalizeLeaseHolderType(body.holderType)
  const assignedAgentName = normalizeOptionalString(body.assignedAgentName)
  const now = Date.now()

  const [lease, dependenciesSatisfied] = await Promise.all([
    getTaskLease(taskId),
    areTaskDependenciesSatisfied(task),
  ])

  if (!dependenciesSatisfied) {
    throw new Error(`Task dependencies are not satisfied: ${taskId}`)
  }
  if (lease && lease.expiresAt > now && lease.holderId !== holderId) {
    throw new Error(`Task lease is held by ${lease.holderId} until ${lease.expiresAt}`)
  }
  if (!isClaimableTask(task, lease, now)) {
    throw new Error(`Task is not claimable: ${taskId}`)
  }

  const next = await updateTask(taskId, {
    status: 'running',
    queueName: undefined,
    claimedAt: now,
    assignedAgentId: holderType === 'agent' ? holderId : task.assignedAgentId,
    assignedAgentName: holderType === 'agent' ? assignedAgentName ?? task.assignedAgentName : task.assignedAgentName,
  })
  if (!next) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const nextLease = await upsertTaskLease(taskId, {
    holderId,
    holderType,
    ttlMs: body.ttlMs,
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
  })

  await appendTaskEvent(taskId, {
    type: 'updated',
    detail: `task claimed by ${holderId}`,
    actorId: holderId,
    actorType: holderType,
    metadata: { queueName: task.queueName || null },
  })

  return {
    task: next,
    lease: nextLease,
  }
}

export async function claimNextTask(input: unknown): Promise<TaskClaimResult | null> {
  const body = isRecord(input) ? input : {}
  const queueName = normalizeOptionalString(body.queueName)
  const holderId = normalizeOptionalString(body.holderId)
  if (!queueName) {
    throw new Error('queueName is required')
  }
  if (!holderId) {
    throw new Error('holderId is required')
  }

  const queueIds = await getTaskQueueIds(queueName)
  const tasksRaw = await Promise.all(queueIds.map((taskId) => getTask(taskId)))
  const now = Date.now()
  const requestedAgentId = normalizeOptionalString(body.requestedAgentId)
  const validQueueIds: string[] = []
  const candidates: TaskRecord[] = []
  const leaseEntries = await Promise.all(
    tasksRaw.map(async (task) => task ? await getTaskLease(task.id) : null)
  )

  for (let index = 0; index < tasksRaw.length; index += 1) {
    const task = tasksRaw[index]
    if (!task) continue
    if (task.queueName !== queueName) continue

    const lease = leaseEntries[index]
    const claimable = await isTaskClaimable(task, lease, now, holderId, requestedAgentId)
    if (task.status === 'queued' || task.status === 'pending') {
      validQueueIds.push(task.id)
    }
    if (!claimable) continue
    candidates.push(task)
  }

  if (validQueueIds.length !== queueIds.length) {
    await setJson(KEYS.TASK_QUEUE(queueName), validQueueIds, TASK_TTL_MS)
  }

  const candidate = candidates
    .sort((a, b) => compareTaskClaimOrder(a, b))[0]
  if (!candidate) return null

  return await claimTask(candidate.id, {
    ...body,
    queueName,
  })
}

export async function listTaskQueue(queueName: string, limit = 100): Promise<TaskRecord[]> {
  const queueIds = await getTaskQueueIds(queueName)
  const tasksRaw = await Promise.all(
    queueIds.slice(0, Math.max(0, limit)).map((taskId) => getTask(taskId))
  )

  return tasksRaw.filter((task): task is TaskRecord => Boolean(task))
}

export async function getTaskRuntimeSnapshot(filters: TaskFilters = {}): Promise<{
  items: TaskRuntimeView[]
  total: number
  queues: TaskQueueStats[]
  summary: {
    pending: number
    queued: number
    running: number
    completed: number
    failed: number
    cancelled: number
    leased: number
    claimable: number
    total: number
    queueCount: number
  }
}> {
  const tasks = await listTasks(filters)
  const queueNames = Array.from(new Set(
    [
      ...tasks.map((task) => task.queueName).filter((value): value is string => Boolean(value)),
      ...(await keys('task:queue:*')).map((key) => key.slice('task:queue:'.length)),
    ]
  ))

  const queueEntries = await Promise.all(
    queueNames.map(async (queueName) => {
      const queueIds = await getTaskQueueIds(queueName)
      const queueItems = tasks.filter((task) => task.queueName === queueName && task.status === 'queued')
      const claimableFlags = await Promise.all(
        queueItems.map(async (task) => {
          const lease = await getTaskLease(task.id)
          return await isTaskClaimable(task, lease, Date.now())
        })
      )
      const updatedAt = queueItems.reduce<number | undefined>((latest, task) => {
        if (!latest || task.updatedAt > latest) return task.updatedAt
        return latest
      }, undefined)

      return {
        queueName,
        depth: queueIds.length,
        claimable: claimableFlags.filter(Boolean).length,
        running: tasks.filter((task) => task.queueName === queueName && task.status === 'running').length,
        updatedAt,
      } satisfies TaskQueueStats
    })
  )

  const queueDepthMap = Object.fromEntries(queueEntries.map((entry) => [entry.queueName, entry.depth]))
  const items = await Promise.all(
    tasks.map(async (task) => {
      const [lease, result] = await Promise.all([
        getTaskLease(task.id),
        getTaskResult(task.id),
      ])
      const isClaimable = await isTaskClaimable(task, lease, Date.now())

      return {
        ...task,
        lease,
        result,
        queueDepth: task.queueName ? (queueDepthMap[task.queueName] || 0) : 0,
        isClaimable,
      } satisfies TaskRuntimeView
    })
  )

  return {
    items,
    total: items.length,
    queues: queueEntries.sort((a, b) => b.depth - a.depth || a.queueName.localeCompare(b.queueName)),
    summary: {
      pending: items.filter((item) => item.status === 'pending').length,
      queued: items.filter((item) => item.status === 'queued').length,
      running: items.filter((item) => item.status === 'running').length,
      completed: items.filter((item) => item.status === 'completed').length,
      failed: items.filter((item) => item.status === 'failed').length,
      cancelled: items.filter((item) => item.status === 'cancelled').length,
      leased: items.filter((item) => item.lease && item.lease.expiresAt > Date.now()).length,
      claimable: items.filter((item) => item.isClaimable).length,
      total: items.length,
      queueCount: queueEntries.length,
    },
  }
}

export async function getTaskLease(taskId: string): Promise<TaskLease | null> {
  return await getJson<TaskLease>(KEYS.TASK_LEASE(taskId))
}

export async function upsertTaskLease(taskId: string, input: unknown): Promise<TaskLease> {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const body = isRecord(input) ? input : {}
  const holderId = normalizeOptionalString(body.holderId)
  if (!holderId) {
    throw new Error('holderId is required')
  }

  const now = Date.now()
  const existing = await getTaskLease(taskId)
  const holderType = normalizeLeaseHolderType(body.holderType)
  const ttlMs = normalizeLeaseMs(body.ttlMs)

  if (existing && existing.expiresAt > now && existing.holderId !== holderId) {
    throw new Error(`Task lease is held by ${existing.holderId} until ${existing.expiresAt}`)
  }

  const lease: TaskLease = {
    taskId,
    holderId,
    holderType,
    acquiredAt: existing?.holderId === holderId ? existing.acquiredAt : now,
    heartbeatAt: now,
    expiresAt: now + ttlMs,
    metadata: isRecord(body.metadata) ? body.metadata : existing?.metadata,
  }

  await setJson(KEYS.TASK_LEASE(taskId), lease, ttlMs)
  await setJson(KEYS.TASK(taskId), {
    ...task,
    status: task.status === 'pending' ? 'running' : task.status,
    assignedAgentId: holderType === 'agent' ? holderId : task.assignedAgentId,
    updatedAt: now,
    claimedAt: task.claimedAt || now,
    startedAt: task.startedAt || now,
  }, TASK_TTL_MS)
  await appendTaskEvent(taskId, {
    type: 'leased',
    detail: `lease assigned to ${holderId}`,
    actorId: holderId,
    actorType: holderType,
    metadata: { expiresAt: lease.expiresAt },
  })

  return lease
}

export async function releaseTaskLease(taskId: string, input: unknown): Promise<TaskLease | null> {
  const existing = await getTaskLease(taskId)
  if (!existing) return null

  const body = isRecord(input) ? input : {}
  const holderId = normalizeOptionalString(body.holderId)
  if (holderId && existing.holderId !== holderId) {
    throw new Error(`Task lease is held by ${existing.holderId}`)
  }

  await deleteKey(KEYS.TASK_LEASE(taskId))
  await appendTaskEvent(taskId, {
    type: 'lease_released',
    detail: `lease released from ${existing.holderId}`,
    actorId: existing.holderId,
    actorType: existing.holderType,
  })

  return existing
}

export async function getTaskResult(taskId: string): Promise<TaskResult | null> {
  return await getJson<TaskResult>(KEYS.TASK_RESULT(taskId))
}

export async function setTaskResult(taskId: string, input: unknown): Promise<TaskResult> {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const body = isRecord(input) ? input : {}
  const status = normalizeTaskResultStatus(body.status)
  const result: TaskResult = {
    taskId,
    status,
    summary: normalizeOptionalString(body.summary),
    output: body.output,
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    updatedAt: Date.now(),
  }

  await setJson(KEYS.TASK_RESULT(taskId), result, TASK_TTL_MS)

  const nextStatus =
    status === 'success'
      ? 'completed'
      : status === 'error'
        ? 'failed'
        : task.status === 'pending'
          ? 'running'
          : task.status

  await updateTask(taskId, {
    status: nextStatus,
    error: status === 'error' ? result.summary || task.error : task.error,
  })
  await appendTaskEvent(taskId, {
    type: 'result_set',
    detail: `task result set: ${status}`,
    metadata: { status },
  })

  return result
}

export async function deleteTaskResult(taskId: string): Promise<TaskResult | null> {
  const existing = await getTaskResult(taskId)
  if (!existing) return null

  await deleteKey(KEYS.TASK_RESULT(taskId))
  return existing
}

async function linkChildTask(parentTaskId: string, childTaskId: string) {
  const existingIds = await getJsonList<string>(KEYS.TASK_CHILDREN(parentTaskId), 0, TASK_CHILD_LIMIT - 1)
  const nextIds = existingIds.includes(childTaskId)
    ? existingIds
    : [childTaskId, ...existingIds].slice(0, TASK_CHILD_LIMIT)

  await setJson(KEYS.TASK_CHILDREN(parentTaskId), nextIds, TASK_TTL_MS)

  const parentTask = await getTask(parentTaskId)
  if (parentTask) {
    await setJson(KEYS.TASK(parentTaskId), {
      ...parentTask,
      childrenCount: nextIds.length,
      updatedAt: Date.now(),
    }, TASK_TTL_MS)
  }

  await appendTaskEvent(parentTaskId, {
    type: 'child_added',
    detail: `child task linked: ${childTaskId}`,
    metadata: { childTaskId },
  })
}

async function unlinkChildTask(parentTaskId: string, childTaskId: string) {
  const existingIds = await getJsonList<string>(KEYS.TASK_CHILDREN(parentTaskId), 0, TASK_CHILD_LIMIT - 1)
  const nextIds = existingIds.filter((id) => id !== childTaskId)
  await setJson(KEYS.TASK_CHILDREN(parentTaskId), nextIds, TASK_TTL_MS)

  const parentTask = await getTask(parentTaskId)
  if (parentTask) {
    await setJson(KEYS.TASK(parentTaskId), {
      ...parentTask,
      childrenCount: nextIds.length,
      updatedAt: Date.now(),
    }, TASK_TTL_MS)
  }
}

function normalizeTaskInput(input: unknown): TaskInput {
  const body = isRecord(input) ? input : {}

  return {
    title: normalizeOptionalString(body.title),
    description: normalizeOptionalString(body.description),
    kind: normalizeOptionalString(body.kind),
    status: normalizeTaskStatus(body.status),
    priority: normalizeTaskPriority(body.priority),
    parentTaskId: normalizeOptionalString(body.parentTaskId),
    queueName: normalizeOptionalString(body.queueName),
    runId: normalizeOptionalString(body.runId),
    sessionId: normalizeOptionalString(body.sessionId),
    requestedAgentId: normalizeOptionalString(body.requestedAgentId),
    assignedAgentId: normalizeOptionalString(body.assignedAgentId),
    assignedAgentName: normalizeOptionalString(body.assignedAgentName),
    retryCount: normalizeOptionalNumber(body.retryCount),
    maxRetries: normalizeOptionalNumber(body.maxRetries),
    dependsOnTaskIds: Array.isArray(body.dependsOnTaskIds) ? normalizeStringArray(body.dependsOnTaskIds) : undefined,
    payload: isRecord(body.payload) ? body.payload : undefined,
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    error: normalizeOptionalString(body.error),
    claimedAt: normalizeOptionalNumber(body.claimedAt),
    startedAt: normalizeOptionalNumber(body.startedAt),
    completedAt: normalizeOptionalNumber(body.completedAt),
  }
}

function normalizeTaskStatus(value: unknown): TaskStatus | undefined {
  return isOneOf<TaskStatus>(value, ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled'])
}

function normalizeTaskPriority(value: unknown): TaskPriority | undefined {
  return isOneOf<TaskPriority>(value, ['low', 'normal', 'high', 'urgent'])
}

function normalizeTaskResultStatus(value: unknown): TaskResult['status'] {
  return isOneOf<TaskResult['status']>(value, ['success', 'error', 'partial']) || 'success'
}

function normalizeLeaseHolderType(value: unknown): TaskLease['holderType'] {
  return isOneOf<TaskLease['holderType']>(value, ['agent', 'worker', 'system']) || 'agent'
}

function normalizeLeaseMs(value: unknown): number {
  const parsed = normalizeOptionalNumber(value)
  if (!parsed) return DEFAULT_LEASE_MS
  return Math.max(1000, Math.min(MAX_LEASE_MS, parsed))
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function normalizeStringArray(values: unknown[]): string[] {
  return Array.from(new Set(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
  ))
}

function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

async function getTaskQueueIds(queueName: string): Promise<string[]> {
  return (await getJson<string[]>(KEYS.TASK_QUEUE(queueName))) || []
}

async function addTaskIdToQueue(queueName: string, taskId: string) {
  const existingIds = await getTaskQueueIds(queueName)
  const nextIds = [...existingIds.filter((id) => id !== taskId), taskId]
  await setJson(KEYS.TASK_QUEUE(queueName), nextIds, TASK_TTL_MS)
}

async function removeTaskIdFromQueue(queueName: string, taskId: string) {
  const existingIds = await getTaskQueueIds(queueName)
  const nextIds = existingIds.filter((id) => id !== taskId)
  if (nextIds.length === existingIds.length) return
  if (nextIds.length === 0) {
    await deleteKey(KEYS.TASK_QUEUE(queueName))
    return
  }
  await setJson(KEYS.TASK_QUEUE(queueName), nextIds, TASK_TTL_MS)
}

async function areTaskDependenciesSatisfied(task: TaskRecord): Promise<boolean> {
  if (task.dependsOnTaskIds.length === 0) return true
  const dependencies = await Promise.all(task.dependsOnTaskIds.map((taskId) => getTask(taskId)))
  return dependencies.every((dependency) => dependency?.status === 'completed')
}

function isClaimableTask(task: TaskRecord, lease: TaskLease | null, now: number): boolean {
  return (task.status === 'queued' || task.status === 'pending') && (!lease || lease.expiresAt <= now)
}

async function isTaskClaimable(
  task: TaskRecord,
  lease: TaskLease | null,
  now: number,
  holderId?: string,
  requestedAgentId?: string
): Promise<boolean> {
  if (!isClaimableTask(task, lease, now)) return false
  if (task.requestedAgentId && holderId && task.requestedAgentId !== holderId) return false
  if (requestedAgentId && task.requestedAgentId && task.requestedAgentId !== requestedAgentId) return false
  return await areTaskDependenciesSatisfied(task)
}

function compareTaskClaimOrder(a: TaskRecord, b: TaskRecord): number {
  const priorityDelta = getTaskPriorityWeight(b.priority) - getTaskPriorityWeight(a.priority)
  if (priorityDelta !== 0) return priorityDelta
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id.localeCompare(b.id)
}

function getTaskPriorityWeight(priority: TaskPriority): number {
  if (priority === 'urgent') return 4
  if (priority === 'high') return 3
  if (priority === 'normal') return 2
  return 1
}

function toStatusEventType(status: TaskStatus): TaskEventType {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'status_changed'
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isOneOf<T extends string>(value: unknown, allowed: T[]): T | undefined {
  if (typeof value !== 'string') return undefined
  return allowed.includes(value as T) ? (value as T) : undefined
}
