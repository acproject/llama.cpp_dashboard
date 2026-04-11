import { deleteKey, getJson, getJsonList, KEYS, keys, pushJsonList, setJson, tagadd } from '@/lib/minimemory'
import { createMemoryFromTaskEvidence } from '@/lib/memory'
import { indexTaskEvidenceInRag } from '@/lib/rag'
import { generateId } from '@/lib/utils'
import { TaskClaimResult, TaskDagView, TaskDependencyEdge, TaskDependencyNode, TaskDependencyUnlockData, TaskEvent, TaskEventType, TaskEvidenceRecord, TaskKind, TaskLease, TaskPayload, TaskPriority, TaskQueueStats, TaskRecord, TaskResult, TaskRuntimeView, TaskStatus } from '@/types'

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

export async function listDependentTasks(taskId: string): Promise<TaskRecord[]> {
  const target = await getTask(taskId)
  if (!target) return []

  const tasks = await listTasks()
  const scopeRootId = target.rootTaskId || target.id

  return tasks.filter((task) => {
    if (task.id === taskId) return false
    if ((task.rootTaskId || task.id) !== scopeRootId) return false
    return task.dependsOnTaskIds.includes(taskId)
  })
}

export async function getTaskDependencyUnlockData(taskId: string): Promise<TaskDependencyUnlockData> {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const dependents = await listDependentTasks(taskId)
  const states = await Promise.all(
    dependents.map(async (dependent) => ({
      taskId: dependent.id,
      state: await getTaskDependencyState(dependent),
      status: dependent.status,
    }))
  )

  return {
    taskId,
    completedDependencyTaskIds: task.status === 'completed' ? [taskId] : [],
    newlyClaimableTaskIds: states
      .filter((item) => item.state.satisfied && item.state.failedDependencyTaskIds.length === 0 && (item.status === 'queued' || item.status === 'pending'))
      .map((item) => item.taskId),
    stillBlockedTaskIds: states
      .filter((item) => !item.state.satisfied && item.state.failedDependencyTaskIds.length === 0)
      .map((item) => item.taskId),
    failedPropagationCandidates: states
      .filter((item) => item.state.failedDependencyTaskIds.length > 0)
      .map((item) => item.taskId),
  }
}

export async function getTaskDag(taskId: string): Promise<TaskDagView> {
  const focusTask = await getTask(taskId)
  if (!focusTask) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const workflowTasks = await listWorkflowTasks(focusTask)
  const taskMap = new Map(workflowTasks.map((task) => [task.id, task]))
  const dependentMap = buildDependentMap(workflowTasks)
  const nodes = await Promise.all(
    workflowTasks.map(async (task) => {
      const dependencyState = await getTaskDependencyState(task, taskMap)
      const lease = await getTaskLease(task.id)

      return {
        taskId: task.id,
        title: task.title,
        kind: task.kind,
        status: task.status,
        priority: task.priority,
        queueName: task.queueName,
        parentTaskId: task.parentTaskId,
        rootTaskId: task.rootTaskId,
        dependsOnTaskIds: task.dependsOnTaskIds,
        dependentTaskIds: dependentMap.get(task.id) || [],
        blockedByTaskIds: dependencyState.blockedByTaskIds,
        failedDependencyTaskIds: dependencyState.failedDependencyTaskIds,
        dependencyDepth: computeTaskDependencyDepth(task.id, taskMap),
        isClaimable: await isTaskClaimable(task, lease, Date.now()),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      } satisfies TaskDependencyNode
    })
  )

  const edges = buildTaskDagEdges(workflowTasks)
  const unlock = await getTaskDependencyUnlockData(taskId)

  return {
    rootTaskId: focusTask.rootTaskId || focusTask.id,
    focusTaskId: focusTask.id,
    nodes: nodes.sort((a, b) => a.dependencyDepth - b.dependencyDepth || a.createdAt - b.createdAt || a.taskId.localeCompare(b.taskId)),
    edges,
    unlock,
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

export async function heartbeatTaskLease(taskId: string, input: unknown): Promise<TaskLease> {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const existing = await getTaskLease(taskId)
  if (!existing) {
    throw new Error(`Task lease not found: ${taskId}`)
  }

  const body = isRecord(input) ? input : {}
  const holderId = normalizeOptionalString(body.holderId)
  if (!holderId) {
    throw new Error('holderId is required')
  }
  if (existing.holderId !== holderId) {
    throw new Error(`Task lease is held by ${existing.holderId}`)
  }

  const now = Date.now()
  const ttlMs = normalizeLeaseMs(body.ttlMs)
  const lease: TaskLease = {
    ...existing,
    heartbeatAt: now,
    expiresAt: now + ttlMs,
    metadata: isRecord(body.metadata)
      ? { ...(existing.metadata || {}), ...body.metadata }
      : existing.metadata,
  }

  await setJson(KEYS.TASK_LEASE(taskId), lease, ttlMs)
  await setJson(KEYS.TASK(taskId), {
    ...task,
    status: isTerminalTaskStatus(task.status) ? task.status : 'running',
    updatedAt: now,
    claimedAt: task.claimedAt || existing.acquiredAt,
    startedAt: task.startedAt || existing.acquiredAt,
  }, TASK_TTL_MS)
  await appendTaskEvent(taskId, {
    type: 'heartbeat',
    detail: `lease heartbeat from ${holderId}`,
    actorId: holderId,
    actorType: existing.holderType,
    metadata: { expiresAt: lease.expiresAt },
  })

  return lease
}

export async function recoverExpiredTasks(input: unknown): Promise<{
  scanned: number
  expired: number
  requeuedTaskIds: string[]
  failedTaskIds: string[]
  releasedTaskIds: string[]
}> {
  const body = isRecord(input) ? input : {}
  const queueName = normalizeOptionalString(body.queueName)
  const actorId = normalizeOptionalString(body.actorId) || 'system'
  const actorType = normalizeOptionalString(body.actorType) || 'system'
  const reason = normalizeOptionalString(body.reason) || 'task lease expired'
  const now = Date.now()
  const tasks = await listTasks(queueName ? { queueName, limit: 500 } : { limit: 500 })
  const taskEntries = await Promise.all(
    tasks.map(async (task) => ({
      task,
      lease: await getTaskLease(task.id),
    }))
  )
  const expiredEntries = taskEntries.filter(({ lease }) => Boolean(lease && lease.expiresAt <= now))
  const requeuedTaskIds: string[] = []
  const failedTaskIds: string[] = []
  const releasedTaskIds: string[] = []

  for (const entry of expiredEntries) {
    const { task, lease } = entry
    if (!lease) continue

    await deleteKey(KEYS.TASK_LEASE(task.id))
    await appendTaskEvent(task.id, {
      type: 'timed_out',
      detail: reason,
      actorId,
      actorType,
      metadata: {
        expiredAt: lease.expiresAt,
        holderId: lease.holderId,
        holderType: lease.holderType,
      },
    })

    if (task.status === 'running') {
      const canRetry = Boolean(task.queueName) && task.retryCount < task.maxRetries
      if (canRetry) {
        const next = await updateTask(task.id, {
          status: 'queued',
          retryCount: task.retryCount + 1,
          error: reason,
        })
        if (next?.queueName) {
          requeuedTaskIds.push(task.id)
          await appendTaskEvent(task.id, {
            type: 'updated',
            detail: `task requeued after timeout in ${next.queueName}`,
            actorId,
            actorType,
            metadata: {
              queueName: next.queueName,
              retryCount: next.retryCount,
            },
          })
          continue
        }
      }

      await updateTask(task.id, {
        status: 'failed',
        error: reason,
        completedAt: now,
      })
      failedTaskIds.push(task.id)
      continue
    }

    releasedTaskIds.push(task.id)
  }

  return {
    scanned: tasks.length,
    expired: expiredEntries.length,
    requeuedTaskIds,
    failedTaskIds,
    releasedTaskIds,
  }
}

export async function getTaskResult(taskId: string): Promise<TaskResult | null> {
  return await getJson<TaskResult>(KEYS.TASK_RESULT(taskId))
}

export async function listTaskEvidence(taskId: string): Promise<TaskEvidenceRecord[]> {
  const ids = await getJsonList<string>(KEYS.TASK_EVIDENCES(taskId), 0, 199)
  const records = await Promise.all(
    ids.map((id) => getJson<TaskEvidenceRecord>(KEYS.TASK_EVIDENCE(taskId, id)))
  )
  return records.filter((record): record is TaskEvidenceRecord => Boolean(record))
}

export async function addTaskEvidence(taskId: string, input: unknown): Promise<TaskEvidenceRecord> {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)

  const body = isRecord(input) ? input : {}
  const now = Date.now()
  const record: TaskEvidenceRecord = {
    id: generateId(),
    taskId,
    kind: normalizeOptionalString(body.kind) || 'artifact',
    title: normalizeOptionalString(body.title),
    content: normalizeOptionalString(body.content),
    source: normalizeOptionalString(body.source),
    uri: normalizeOptionalString(body.uri),
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    createdAt: now,
  }

  await setJson(KEYS.TASK_EVIDENCE(taskId, record.id), record, TASK_TTL_MS)
  await pushJsonList(KEYS.TASK_EVIDENCES(taskId), record.id, { maxLength: 200, ttlMs: TASK_TTL_MS })
  await tagadd(
    KEYS.TASK_EVIDENCE(taskId, record.id),
    'task-evidence',
    `task:${taskId}`,
    `kind:${record.kind}`
  )
  await appendTaskEvent(taskId, {
    type: 'updated',
    detail: `task evidence added: ${record.kind}`,
    metadata: {
      evidenceId: record.id,
      kind: record.kind,
      title: record.title || null,
    },
  })

  if (shouldIndexTaskEvidence(task, record)) {
    try {
      const indexed = await indexTaskEvidenceInRag(task, record)
      record.metadata = {
        ...(record.metadata || {}),
        rag: {
          collectionId: indexed.collection.id,
          documentId: indexed.document.id,
        },
      }
      await setJson(KEYS.TASK_EVIDENCE(taskId, record.id), record, TASK_TTL_MS)
      await appendTaskEvent(taskId, {
        type: 'evidence_indexed',
        detail: `task evidence indexed into rag: ${indexed.collection.name}`,
        metadata: {
          evidenceId: record.id,
          collectionId: indexed.collection.id,
          documentId: indexed.document.id,
        },
      })
    } catch (error) {
      record.metadata = {
        ...(record.metadata || {}),
        ragError: error instanceof Error ? error.message : String(error),
      }
      await setJson(KEYS.TASK_EVIDENCE(taskId, record.id), record, TASK_TTL_MS)
      await appendTaskEvent(taskId, {
        type: 'updated',
        detail: `task evidence rag indexing failed: ${record.kind}`,
        metadata: {
          evidenceId: record.id,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  try {
    const memory = await createMemoryFromTaskEvidence(task, record)
    record.metadata = {
      ...(record.metadata || {}),
      memory: {
        id: memory.id,
        space: memory.space,
      },
    }
    await setJson(KEYS.TASK_EVIDENCE(taskId, record.id), record, TASK_TTL_MS)
    await appendTaskEvent(taskId, {
      type: 'updated',
      detail: `task evidence mirrored into memory: ${record.kind}`,
      metadata: {
        evidenceId: record.id,
        memoryId: memory.id,
        space: memory.space,
      },
    })
  } catch (error) {
    record.metadata = {
      ...(record.metadata || {}),
      memoryError: error instanceof Error ? error.message : String(error),
    }
    await setJson(KEYS.TASK_EVIDENCE(taskId, record.id), record, TASK_TTL_MS)
    await appendTaskEvent(taskId, {
      type: 'updated',
      detail: `task evidence memory mirror failed: ${record.kind}`,
      metadata: {
        evidenceId: record.id,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  return record
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
  const kind = normalizeTaskKind(body.kind)
  const hasPayload = Object.prototype.hasOwnProperty.call(body, 'payload')

  return {
    title: normalizeOptionalString(body.title),
    description: normalizeOptionalString(body.description),
    kind,
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
    payload: hasPayload ? normalizeTaskPayload(kind, body.payload) : undefined,
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    error: normalizeOptionalString(body.error),
    claimedAt: normalizeOptionalNumber(body.claimedAt),
    startedAt: normalizeOptionalNumber(body.startedAt),
    completedAt: normalizeOptionalNumber(body.completedAt),
  }
}

function normalizeTaskKind(value: unknown): TaskKind | undefined {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return undefined

  const resolved = isOneOf<TaskKind>(normalized, [
    'mock',
    'agent.chat',
    'agent.completion',
    'service.chat',
    'service.completion',
    'service.embedding',
    'tool.http',
  ]) || inferLegacyTaskKind(normalized)

  if (!resolved) {
    throw new Error(`Unsupported task kind: ${normalized}`)
  }

  return resolved
}

function inferLegacyTaskKind(kind: string): TaskKind | undefined {
  if (kind === 'agent') return 'agent.chat'
  if (kind === 'service') return 'service.chat'
  if (kind === 'tool') return 'tool.http'
  return undefined
}

function normalizeTaskPayload(kind: TaskKind | undefined, payload: unknown): TaskPayload | undefined {
  if (typeof payload === 'undefined') return undefined
  if (!isRecord(payload)) {
    if (kind && kind !== 'mock') {
      throw new Error(`${kind} payload 必须是对象`)
    }
    return undefined
  }

  switch (kind) {
    case 'agent.chat':
      return normalizeAgentChatPayload(payload)
    case 'agent.completion':
      return normalizeAgentCompletionPayload(payload)
    case 'service.chat':
      return normalizeServiceChatPayload(payload)
    case 'service.completion':
      return normalizeServiceCompletionPayload(payload)
    case 'service.embedding':
      return normalizeServiceEmbeddingPayload(payload)
    case 'tool.http':
      return normalizeToolHttpPayload(payload)
    default:
      return payload
  }
}

function normalizeAgentChatPayload(payload: Record<string, unknown>): TaskPayload {
  const messages = Array.isArray(payload.messages)
    ? payload.messages
    : typeof payload.prompt === 'string' && payload.prompt.trim()
      ? [{ role: 'user', content: payload.prompt.trim() }]
      : []

  if (messages.length === 0) {
    throw new Error('agent.chat payload.messages 不能为空')
  }

  return {
    agentId: normalizeOptionalString(payload.agentId) || normalizeOptionalString(payload.agent_id),
    model: normalizeOptionalString(payload.model),
    path: normalizeOptionalString(payload.path),
    routePath: normalizeOptionalString(payload.routePath),
    messages,
    stream: normalizeOptionalBoolean(payload.stream),
    request: isRecord(payload.request)
      ? payload.request
      : isRecord(payload.body)
        ? payload.body
        : undefined,
  }
}

function normalizeAgentCompletionPayload(payload: Record<string, unknown>): TaskPayload {
  const prompt = normalizeOptionalString(payload.prompt)
  if (!prompt) {
    throw new Error('agent.completion payload.prompt 不能为空')
  }

  return {
    agentId: normalizeOptionalString(payload.agentId) || normalizeOptionalString(payload.agent_id),
    model: normalizeOptionalString(payload.model),
    path: normalizeOptionalString(payload.path),
    routePath: normalizeOptionalString(payload.routePath),
    prompt,
    stream: normalizeOptionalBoolean(payload.stream),
    request: isRecord(payload.request)
      ? payload.request
      : isRecord(payload.body)
        ? payload.body
        : undefined,
  }
}

function normalizeServiceChatPayload(payload: Record<string, unknown>): TaskPayload {
  const serviceId =
    normalizeOptionalString(payload.serviceId) ||
    normalizeOptionalString(payload.service_id) ||
    normalizeOptionalString(payload.targetServiceId)
  const messages = Array.isArray(payload.messages)
    ? payload.messages
    : typeof payload.prompt === 'string' && payload.prompt.trim()
      ? [{ role: 'user', content: payload.prompt.trim() }]
      : []

  if (!serviceId) {
    throw new Error('service.chat payload.serviceId 不能为空')
  }
  if (messages.length === 0) {
    throw new Error('service.chat payload.messages 不能为空')
  }

  return {
    serviceId,
    model: normalizeOptionalString(payload.model),
    path: normalizeOptionalString(payload.path),
    servicePath: normalizeOptionalString(payload.servicePath),
    messages,
    stream: normalizeOptionalBoolean(payload.stream),
    request: isRecord(payload.request)
      ? payload.request
      : isRecord(payload.body)
        ? payload.body
        : undefined,
  }
}

function normalizeServiceCompletionPayload(payload: Record<string, unknown>): TaskPayload {
  const serviceId =
    normalizeOptionalString(payload.serviceId) ||
    normalizeOptionalString(payload.service_id) ||
    normalizeOptionalString(payload.targetServiceId)
  const prompt = normalizeOptionalString(payload.prompt)

  if (!serviceId) {
    throw new Error('service.completion payload.serviceId 不能为空')
  }
  if (!prompt) {
    throw new Error('service.completion payload.prompt 不能为空')
  }

  return {
    serviceId,
    model: normalizeOptionalString(payload.model),
    path: normalizeOptionalString(payload.path),
    servicePath: normalizeOptionalString(payload.servicePath),
    prompt,
    stream: normalizeOptionalBoolean(payload.stream),
    request: isRecord(payload.request)
      ? payload.request
      : isRecord(payload.body)
        ? payload.body
        : undefined,
  }
}

function normalizeServiceEmbeddingPayload(payload: Record<string, unknown>): TaskPayload {
  const serviceId =
    normalizeOptionalString(payload.serviceId) ||
    normalizeOptionalString(payload.service_id) ||
    normalizeOptionalString(payload.targetServiceId)
  const input = Array.isArray(payload.input)
    ? payload.input.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : normalizeOptionalString(payload.input)

  if (!serviceId) {
    throw new Error('service.embedding payload.serviceId 不能为空')
  }
  if (!input || (Array.isArray(input) && input.length === 0)) {
    throw new Error('service.embedding payload.input 不能为空')
  }

  return {
    serviceId,
    model: normalizeOptionalString(payload.model),
    path: normalizeOptionalString(payload.path),
    servicePath: normalizeOptionalString(payload.servicePath),
    input,
    request: isRecord(payload.request)
      ? payload.request
      : isRecord(payload.body)
        ? payload.body
        : undefined,
  }
}

function normalizeToolHttpPayload(payload: Record<string, unknown>): TaskPayload {
  const url = normalizeOptionalString(payload.url)
  const path = normalizeOptionalString(payload.path)

  if (!url && !path) {
    throw new Error('tool.http payload.url 或 payload.path 至少提供一个')
  }

  return {
    url,
    path,
    baseUrl: normalizeOptionalString(payload.baseUrl),
    method: normalizeOptionalString(payload.method),
    headers: normalizeStringRecord(payload.headers),
    query: normalizePrimitiveRecord(payload.query),
    body: payload.body,
    stream: normalizeOptionalBoolean(payload.stream),
    unwrapSuccessEnvelope: normalizeOptionalBoolean(payload.unwrapSuccessEnvelope),
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

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function normalizeStringArray(values: unknown[]): string[] {
  return Array.from(new Set(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
  ))
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined

  const entries = Object.entries(value)
    .map(([key, entry]) => [key, normalizeOptionalString(entry)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizePrimitiveRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isRecord(value)) return undefined

  const entries = Object.entries(value)
    .filter((entry): entry is [string, string | number | boolean] => {
      const current = entry[1]
      return typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean'
    })

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function shouldIndexTaskEvidence(task: TaskRecord, record: TaskEvidenceRecord): boolean {
  if (!record.content && !record.metadata) {
    return false
  }

  if (process.env.TASK_EVIDENCE_RAG_ENABLED === 'false') {
    return false
  }

  const taskMetadata = isRecord(task.metadata) ? task.metadata : {}
  const ragConfig = isRecord(taskMetadata.evidenceRag) ? taskMetadata.evidenceRag : {}
  if (ragConfig.enabled === false) {
    return false
  }

  return true
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

type TaskDependencyState = {
  satisfied: boolean
  blockedByTaskIds: string[]
  failedDependencyTaskIds: string[]
}

async function getTaskDependencyState(
  task: TaskRecord,
  taskMap?: Map<string, TaskRecord>
): Promise<TaskDependencyState> {
  if (task.dependsOnTaskIds.length === 0) {
    return {
      satisfied: true,
      blockedByTaskIds: [],
      failedDependencyTaskIds: [],
    }
  }

  const dependencies = await Promise.all(
    task.dependsOnTaskIds.map(async (dependencyId) => taskMap?.get(dependencyId) || await getTask(dependencyId))
  )
  const blockedByTaskIds: string[] = []
  const failedDependencyTaskIds: string[] = []

  for (let index = 0; index < task.dependsOnTaskIds.length; index += 1) {
    const dependencyId = task.dependsOnTaskIds[index]
    const dependency = dependencies[index]
    if (!dependency) {
      blockedByTaskIds.push(dependencyId)
      continue
    }
    if (dependency.status === 'failed' || dependency.status === 'cancelled') {
      failedDependencyTaskIds.push(dependency.id)
      continue
    }
    if (dependency.status !== 'completed') {
      blockedByTaskIds.push(dependency.id)
    }
  }

  return {
    satisfied: blockedByTaskIds.length === 0 && failedDependencyTaskIds.length === 0,
    blockedByTaskIds,
    failedDependencyTaskIds,
  }
}

async function listWorkflowTasks(task: TaskRecord): Promise<TaskRecord[]> {
  const tasks = await listTasks()
  const rootTaskId = task.rootTaskId || task.id
  const rootScoped = tasks.filter((item) => (item.rootTaskId || item.id) === rootTaskId)
  if (rootScoped.length > 0) return rootScoped

  const localIds = new Set<string>([
    task.id,
    ...(task.parentTaskId ? [task.parentTaskId] : []),
    ...task.dependsOnTaskIds,
  ])
  return tasks.filter((item) => localIds.has(item.id) || item.dependsOnTaskIds.some((dependencyId) => localIds.has(dependencyId)))
}

function buildDependentMap(tasks: TaskRecord[]): Map<string, string[]> {
  const dependentMap = new Map<string, string[]>()

  for (const task of tasks) {
    for (const dependencyId of task.dependsOnTaskIds) {
      const existing = dependentMap.get(dependencyId) || []
      if (!existing.includes(task.id)) {
        dependentMap.set(dependencyId, [...existing, task.id])
      }
    }
  }

  return dependentMap
}

function buildTaskDagEdges(tasks: TaskRecord[]): TaskDependencyEdge[] {
  const edges: TaskDependencyEdge[] = []
  const edgeKeys = new Set<string>()

  for (const task of tasks) {
    for (const dependencyId of task.dependsOnTaskIds) {
      const key = `depends_on:${task.id}:${dependencyId}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edges.push({
        fromTaskId: task.id,
        toTaskId: dependencyId,
        relation: 'depends_on',
      })
    }

    if (task.parentTaskId) {
      const key = `parent_child:${task.parentTaskId}:${task.id}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edges.push({
        fromTaskId: task.parentTaskId,
        toTaskId: task.id,
        relation: 'parent_child',
      })
    }
  }

  return edges
}

function computeTaskDependencyDepth(
  taskId: string,
  taskMap: Map<string, TaskRecord>,
  visiting = new Set<string>()
): number {
  const task = taskMap.get(taskId)
  if (!task || task.dependsOnTaskIds.length === 0) return 0
  if (visiting.has(taskId)) return 0

  visiting.add(taskId)
  let depth = 0
  for (const dependencyId of task.dependsOnTaskIds) {
    depth = Math.max(depth, computeTaskDependencyDepth(dependencyId, taskMap, visiting) + 1)
  }
  visiting.delete(taskId)
  return depth
}

async function areTaskDependenciesSatisfied(task: TaskRecord): Promise<boolean> {
  const state = await getTaskDependencyState(task)
  return state.satisfied
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
