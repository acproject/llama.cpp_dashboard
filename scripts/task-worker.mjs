import os from 'node:os'

const config = buildConfig()
const TASK_HANDLERS = {
  mock: executeMockTask,
  agent: executeAgentTask,
  service: executeServiceTask,
  tool: executeToolTask,
}

let running = true
let activeTaskId = null

process.on('SIGINT', handleStopSignal)
process.on('SIGTERM', handleStopSignal)

void main()

async function main() {
  log('starting worker', config)

  while (running) {
    try {
      await recoverExpiredTasks()
      const claim = await request('/api/tasks/claim-next', {
        method: 'POST',
        body: {
          queueName: config.queueName,
          holderId: config.executorId,
          holderType: 'worker',
        },
      })

      if (!claim?.task) {
        log(`no claimable task in queue ${config.queueName}, waiting ${config.pollMs}ms`)
        if (config.runOnce) break
        await sleep(config.pollMs)
        continue
      }

      await executeTask(claim.task)

      if (config.runOnce) break
    } catch (error) {
      logError('worker cycle failed', error)
      if (config.runOnce) {
        process.exitCode = 1
        break
      }
      await sleep(config.pollMs)
    }
  }

  log(activeTaskId ? `stop requested, current task ${activeTaskId} released to timeout recovery if interrupted` : 'worker stopped')
}

async function executeTask(task) {
  activeTaskId = task.id
  const startedAt = Date.now()
  const heartbeatTimer = setInterval(() => {
    if (!running) return
    void heartbeat(task.id).catch((error) => {
      logError(`heartbeat failed for ${task.id}`, error)
    })
  }, config.heartbeatMs)

  try {
    log(`claimed task ${task.id} (${task.title})`)
    const result = await dispatchTask(task, { startedAt })
    const finishedAt = Date.now()

    if (Array.isArray(result.evidence) && result.evidence.length > 0) {
      await persistTaskEvidence(task.id, result.evidence)
    }

    if (result.status === 'error') {
      await request(`/api/tasks/${task.id}/fail`, {
        method: 'POST',
        body: {
          holderId: config.executorId,
          summary: result.summary || `${task.title} failed by ${config.executorId}`,
          metadata: buildTaskMetadata(task, startedAt, finishedAt, 'failed', result.metadata),
        },
      })
      log(`task ${task.id} failed`)
      return
    }

    await request(`/api/tasks/${task.id}/complete`, {
      method: 'POST',
      body: {
        holderId: config.executorId,
        summary: result.summary || `${task.title} completed by ${config.executorId}`,
        output: result.output,
        metadata: buildTaskMetadata(task, startedAt, finishedAt, 'completed', result.metadata),
      },
    })
    log(`task ${task.id} completed`)
  } catch (error) {
    const finishedAt = Date.now()
    const detail = serializeError(error)

    try {
      await persistTaskEvidence(task.id, [
        {
          kind: 'worker-error',
          title: task.title || task.id,
          content: detail.message,
          metadata: detail,
        },
      ])
      await request(`/api/tasks/${task.id}/fail`, {
        method: 'POST',
        body: {
          holderId: config.executorId,
          summary: detail.message,
          metadata: buildTaskMetadata(task, startedAt, finishedAt, 'failed', {
            error: detail,
          }),
        },
      })
      log(`task ${task.id} failed`)
    } catch (failError) {
      logError(`failed to persist failure for ${task.id}`, failError)
      throw failError
    }
  } finally {
    clearInterval(heartbeatTimer)
    activeTaskId = null
  }
}

async function heartbeat(taskId) {
  await request(`/api/tasks/${taskId}/heartbeat`, {
    method: 'POST',
    body: {
      holderId: config.executorId,
      ttlMs: config.leaseTtlMs,
      metadata: {
        source: 'task-worker',
        executorId: config.executorId,
        queueName: config.queueName,
        pid: process.pid,
      },
    },
  })
}

async function recoverExpiredTasks() {
  const result = await request('/api/tasks/recover-expired', {
    method: 'POST',
    body: {
      queueName: config.queueName,
      actorId: config.executorId,
      actorType: 'worker',
      reason: `lease expired while monitored by ${config.executorId}`,
    },
  })

  if (result?.expired > 0) {
    log(`recovered ${result.expired} expired tasks`, result)
  }
}

async function request(path, options = {}) {
  const url = new URL(path, config.baseUrl).toString()
  return await fetchJson(url, {
    ...options,
    unwrapSuccessEnvelope: options.unwrapSuccessEnvelope !== false,
  })
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs)

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })

    const payload = await parseResponseBody(response)
    if (!response.ok) {
      throw new Error(extractErrorMessage(payload, response.status))
    }

    if (options.unwrapSuccessEnvelope === false) {
      return payload
    }

    if (!payload?.success) {
      throw new Error(payload?.error || `request failed: ${response.status}`)
    }

    return payload.data
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildConfig() {
  const executorId = readString('TASK_WORKER_ID') || `worker-${os.hostname()}-${process.pid}`
  const queueName = readString('TASK_WORKER_QUEUE') || 'default'
  const baseUrl = normalizeBaseUrl(readString('TASK_WORKER_BASE_URL') || 'http://127.0.0.1:3000')
  const pollMs = readInt('TASK_WORKER_POLL_MS', 3000)
  const heartbeatMs = readInt('TASK_WORKER_HEARTBEAT_MS', 15000)
  const leaseTtlMs = Math.max(readInt('TASK_WORKER_LEASE_TTL_MS', heartbeatMs * 2), heartbeatMs + 1000)
  const processMs = readInt('TASK_WORKER_PROCESS_MS', 5000)
  const requestTimeoutMs = readInt('TASK_WORKER_REQUEST_TIMEOUT_MS', 10000)
  const mode = readMode('TASK_WORKER_MODE')
  const runOnce = readBoolean('TASK_WORKER_ONCE', false)

  return {
    executorId,
    queueName,
    baseUrl,
    pollMs,
    heartbeatMs,
    leaseTtlMs,
    processMs,
    requestTimeoutMs,
    mode,
    runOnce,
  }
}

function resolveTaskOutcome(task) {
  if (config.mode === 'success') return 'success'
  if (config.mode === 'fail') return 'fail'

  const taskOutcome = readTaskString(task, 'mockOutcome')
  return taskOutcome === 'fail' ? 'fail' : 'success'
}

function resolveTaskProcessMs(task) {
  const taskProcessMs = readTaskNumber(task, 'processMs')
  if (taskProcessMs && taskProcessMs > 0) {
    return taskProcessMs
  }
  return config.processMs
}

async function dispatchTask(task, executionContext) {
  if (config.mode !== 'payload') {
    return await executeMockTask(task)
  }

  const handlerKey = resolveTaskHandlerKey(task.kind)
  const handler = TASK_HANDLERS[handlerKey]

  if (!handler) {
    throw new Error(`Unsupported task kind: ${task.kind || 'unknown'}`)
  }

  return await handler(task, executionContext)
}

function resolveTaskHandlerKey(kind) {
  if (typeof kind !== 'string' || !kind.trim()) {
    return 'mock'
  }

  if (kind === 'mock') {
    return 'mock'
  }

  const namespace = kind.trim().split('.')[0]
  return namespace in TASK_HANDLERS ? namespace : 'mock'
}

async function executeMockTask(task) {
  const processMs = resolveTaskProcessMs(task)
  await sleep(processMs)

  const outcome = resolveTaskOutcome(task)
  if (outcome === 'fail') {
    return {
      status: 'error',
      summary: `${task.title} failed by ${config.executorId}`,
      output: {
        executorId: config.executorId,
        queueName: config.queueName,
        processedAt: Date.now(),
        taskKind: task.kind || null,
        taskPayload: task.payload || null,
      },
      metadata: {
        handler: 'mock',
        processMs,
      },
      evidence: [
        {
          kind: 'mock-error',
          title: task.title || task.id,
          content: `${task.title} failed by ${config.executorId}`,
          metadata: {
            processMs,
          },
        },
      ],
    }
  }

  return {
    status: 'success',
    summary: `${task.title} completed by ${config.executorId}`,
    output: {
      executorId: config.executorId,
      queueName: config.queueName,
      processedAt: Date.now(),
      taskKind: task.kind || null,
      taskPayload: task.payload || null,
    },
    metadata: {
      handler: 'mock',
      processMs,
    },
    evidence: [
      {
        kind: 'mock-output',
        title: task.title || task.id,
        content: stringifyData(task.payload || null),
        metadata: {
          processMs,
        },
      },
    ],
  }
}

async function executeAgentTask(task) {
  const payload = readTaskPayload(task)
  const agentId = firstString(
    payload.agentId,
    payload.agent_id,
    task.requestedAgentId,
    task.assignedAgentId
  )
  const routePath = firstString(
    payload.path,
    payload.routePath,
    isChatKind(task.kind) ? '/api/openai/v1/chat/completions' : '/api/openai/v1/completions'
  )
  const body = buildAgentRequestBody(task, payload, agentId)
  const response = await request(routePath, {
    method: 'POST',
    headers: {
      'x-orchestrator-task-id': task.id,
      ...(agentId ? { 'x-agent-profile': agentId } : {}),
    },
    body,
    unwrapSuccessEnvelope: false,
  })
  const content = extractCompletionContent(response)

  return {
    status: 'success',
    summary: summarizeTaskResult(task, content, `agent handler completed ${task.id}`),
    output: response,
    metadata: {
      handler: 'agent',
      routePath,
      agentId: agentId || null,
      model: typeof response?.model === 'string' ? response.model : body.model || null,
    },
    evidence: [
      {
        kind: 'agent-response',
        title: task.title || task.id,
        content,
        source: routePath,
        metadata: {
          agentId: agentId || null,
          model: typeof response?.model === 'string' ? response.model : body.model || null,
          finishReason: extractFinishReason(response),
        },
      },
    ],
  }
}

async function executeServiceTask(task) {
  const payload = readTaskPayload(task)
  const serviceId = firstString(payload.serviceId, payload.service_id, payload.targetServiceId)

  if (!serviceId) {
    throw new Error(`Task ${task.id} is missing serviceId`)
  }

  const service = await request(`/api/services/${encodeURIComponent(serviceId)}`)
  const servicePath = firstString(
    payload.path,
    payload.servicePath,
    isChatKind(task.kind) ? '/v1/chat/completions' : '/v1/completions'
  )
  const requestBody = buildServiceRequestBody(task, payload, service)
  const serviceUrl = joinUrl(`http://${service.host}:${service.port}`, servicePath)
  const headers = {
    'x-orchestrator-task-id': task.id,
    ...(service.apiKey ? { Authorization: `Bearer ${service.apiKey}` } : {}),
  }
  const response = await fetchJson(serviceUrl, {
    method: 'POST',
    headers,
    body: requestBody,
    unwrapSuccessEnvelope: false,
  })
  const content = extractCompletionContent(response)

  return {
    status: 'success',
    summary: summarizeTaskResult(task, content, `service handler completed ${task.id}`),
    output: response,
    metadata: {
      handler: 'service',
      serviceId: service.id,
      servicePath,
      model: typeof response?.model === 'string' ? response.model : service.model || null,
    },
    evidence: [
      {
        kind: 'service-response',
        title: task.title || task.id,
        content,
        source: serviceUrl,
        metadata: {
          serviceId: service.id,
          model: typeof response?.model === 'string' ? response.model : service.model || null,
          finishReason: extractFinishReason(response),
        },
      },
    ],
  }
}

async function executeToolTask(task) {
  const payload = readTaskPayload(task)
  const url = resolveToolUrl(payload)

  if (!url) {
    throw new Error(`Task ${task.id} is missing tool url`)
  }

  const method = normalizeHttpMethod(payload.method)
  const response = await fetchJson(url, {
    method,
    headers: isRecord(payload.headers) ? payload.headers : undefined,
    body: method === 'GET' || method === 'HEAD' ? undefined : payload.body,
    unwrapSuccessEnvelope: payload.unwrapSuccessEnvelope === true ? true : false,
  })
  const content = stringifyData(response)

  return {
    status: 'success',
    summary: summarizeTaskResult(task, content, `tool handler completed ${task.id}`),
    output: response,
    metadata: {
      handler: 'tool',
      url,
      method,
    },
    evidence: [
      {
        kind: 'tool-response',
        title: task.title || task.id,
        content,
        source: url,
        metadata: {
          method,
        },
      },
    ],
  }
}

async function persistTaskEvidence(taskId, evidenceItems) {
  for (const item of evidenceItems) {
    await request(`/api/tasks/${taskId}/evidence`, {
      method: 'POST',
      body: {
        kind: firstString(item?.kind, 'artifact'),
        title: firstString(item?.title),
        content: firstString(item?.content),
        source: firstString(item?.source),
        uri: firstString(item?.uri),
        metadata: isRecord(item?.metadata) ? item.metadata : undefined,
      },
    })
  }
}

function buildTaskMetadata(task, startedAt, finishedAt, status, metadata) {
  return {
    source: 'task-worker',
    executorId: config.executorId,
    queueName: config.queueName,
    pid: process.pid,
    host: os.hostname(),
    taskKind: task.kind || null,
    startedAt,
    finishedAt,
    processMs: finishedAt - startedAt,
    status,
    ...(isRecord(metadata) ? metadata : {}),
  }
}

function readTaskString(task, key) {
  if (task?.payload && typeof task.payload[key] === 'string') {
    return task.payload[key]
  }
  if (task?.metadata && typeof task.metadata[key] === 'string') {
    return task.metadata[key]
  }
  return undefined
}

function readTaskNumber(task, key) {
  const payloadValue = task?.payload?.[key]
  if (typeof payloadValue === 'number' && Number.isFinite(payloadValue)) {
    return payloadValue
  }

  const metadataValue = task?.metadata?.[key]
  if (typeof metadataValue === 'number' && Number.isFinite(metadataValue)) {
    return metadataValue
  }

  return undefined
}

function readTaskPayload(task) {
  return isRecord(task?.payload) ? task.payload : {}
}

function buildAgentRequestBody(task, payload, agentId) {
  const requestBody = isRecord(payload.request)
    ? { ...payload.request }
    : isRecord(payload.body)
      ? { ...payload.body }
      : {}

  if (!requestBody.model && typeof payload.model === 'string') {
    requestBody.model = payload.model
  }
  if (!requestBody.agentId && agentId) {
    requestBody.agentId = agentId
  }
  if (!requestBody.messages && Array.isArray(payload.messages)) {
    requestBody.messages = payload.messages
  }
  if (!requestBody.prompt && typeof payload.prompt === 'string') {
    requestBody.prompt = payload.prompt
  }
  requestBody.metadata = {
    ...(isRecord(requestBody.metadata) ? requestBody.metadata : {}),
    orchestratorTaskId: task.id,
    workerExecutorId: config.executorId,
  }

  return requestBody
}

function buildServiceRequestBody(task, payload, service) {
  const requestBody = isRecord(payload.request)
    ? { ...payload.request }
    : isRecord(payload.body)
      ? { ...payload.body }
      : {}

  if (!requestBody.model && typeof payload.model === 'string') {
    requestBody.model = payload.model
  }
  if (!requestBody.model && typeof service?.model === 'string') {
    requestBody.model = service.model
  }
  if (!requestBody.messages && Array.isArray(payload.messages)) {
    requestBody.messages = payload.messages
  }
  if (!requestBody.prompt && typeof payload.prompt === 'string') {
    requestBody.prompt = payload.prompt
  }
  requestBody.metadata = {
    ...(isRecord(requestBody.metadata) ? requestBody.metadata : {}),
    orchestratorTaskId: task.id,
    workerExecutorId: config.executorId,
  }

  return requestBody
}

function resolveToolUrl(payload) {
  if (typeof payload.url === 'string' && payload.url.trim()) {
    return payload.url.trim()
  }

  if (typeof payload.path !== 'string' || !payload.path.trim()) {
    return null
  }

  const base = firstString(payload.baseUrl, config.baseUrl)
  return joinUrl(base, payload.path)
}

function joinUrl(base, path) {
  return new URL(path, normalizeBaseUrl(base)).toString()
}

function isChatKind(kind) {
  return typeof kind === 'string' && kind.includes('chat')
}

function normalizeHttpMethod(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : 'POST'
  return normalized || 'POST'
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function parseResponseBody(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return await response.json().catch(() => ({}))
  }

  const text = await response.text().catch(() => '')
  if (!text) {
    return {}
  }

  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

function extractErrorMessage(payload, status) {
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message
  }
  if (typeof payload?.text === 'string' && payload.text.trim()) {
    return payload.text
  }
  return `request failed: ${status}`
}

function extractCompletionContent(payload) {
  if (typeof payload?.content === 'string') {
    return payload.content
  }

  if (Array.isArray(payload?.choices) && payload.choices.length > 0) {
    const choice = payload.choices[0]

    if (typeof choice?.text === 'string') {
      return choice.text
    }

    if (typeof choice?.message?.content === 'string') {
      return choice.message.content
    }

    if (Array.isArray(choice?.message?.content)) {
      return choice.message.content
        .map((part) => {
          if (typeof part === 'string') return part
          if (typeof part?.text === 'string') return part.text
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
  }

  return stringifyData(payload)
}

function extractFinishReason(payload) {
  if (Array.isArray(payload?.choices) && payload.choices.length > 0) {
    const value = payload.choices[0]?.finish_reason
    return typeof value === 'string' ? value : null
  }
  return null
}

function summarizeTaskResult(task, content, fallback) {
  const text = typeof content === 'string' ? content.trim() : ''
  if (text) {
    return truncate(text, 160)
  }
  return task.title ? `${task.title}: ${fallback}` : fallback
}

function stringifyData(value) {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function truncate(value, maxLength) {
  if (typeof value !== 'string' || value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null,
    }
  }

  return {
    name: 'Error',
    message: String(error),
    stack: null,
  }
}

function readMode(name) {
  const value = readString(name)
  return value === 'success' || value === 'fail' ? value : 'payload'
}

function readBoolean(name, fallback) {
  const value = readString(name)
  if (!value) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function readInt(name, fallback) {
  const value = readString(name)
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readString(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value : `${value}/`
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function handleStopSignal(signal) {
  log(`received ${signal}, stopping after current cycle`)
  running = false
}

function log(message, payload) {
  if (typeof payload === 'undefined') {
    console.log(`[task-worker] ${message}`)
    return
  }
  console.log(`[task-worker] ${message}`, payload)
}

function logError(message, error) {
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`[task-worker] ${message}: ${detail}`)
}
