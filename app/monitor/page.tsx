'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle,
  Clock3,
  Link2,
  ListTodo,
  RefreshCw,
  Route,
  Server,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MonitorData, RunRecord, SessionBindingView, TaskEvent, TaskLease, TaskRecord, TaskResult, TaskRuntimeView } from '@/types'
import { formatDuration, formatTimestamp, getStatusBgColor } from '@/lib/utils'

type TaskDetailData = {
  task: TaskRecord
  events: TaskEvent[]
  children: TaskRecord[]
  lease: TaskLease | null
  result: TaskResult | null
}

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [executorId, setExecutorId] = useState('monitor-executor')
  const [selectedQueue, setSelectedQueue] = useState('default')
  const [taskActionKey, setTaskActionKey] = useState<string | null>(null)
  const [taskActionError, setTaskActionError] = useState<string | null>(null)
  const [taskActionMessage, setTaskActionMessage] = useState<string | null>(null)
  const [taskQueueFilter, setTaskQueueFilter] = useState('__all__')
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [taskDetail, setTaskDetail] = useState<TaskDetailData | null>(null)
  const [taskDetailLoading, setTaskDetailLoading] = useState(false)
  const [taskDetailError, setTaskDetailError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch('/api/monitor')
      const result = await response.json()
      if (result.success) {
        setData(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch monitor data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const triggerHealthCheck = async () => {
    setChecking(true)
    try {
      await fetch('/api/monitor', { method: 'POST' })
      await fetchData()
    } finally {
      setChecking(false)
    }
  }

  const fetchTaskDetail = useCallback(async (taskId: string) => {
    setTaskDetailLoading(true)
    setTaskDetailError(null)
    try {
      const response = await fetch(`/api/tasks/${taskId}`)
      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || '加载任务详情失败')
      }
      setTaskDetail(result.data)
    } catch (error) {
      setTaskDetailError(error instanceof Error ? error.message : String(error))
      setTaskDetail(null)
    } finally {
      setTaskDetailLoading(false)
    }
  }, [])

  const runTaskAction = useCallback(async (
    actionKey: string,
    request: () => Promise<Response>,
    getMessage: (data: any) => string
  ) => {
    setTaskActionKey(actionKey)
    setTaskActionError(null)
    setTaskActionMessage(null)
    try {
      const response = await request()
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) {
        throw new Error(result.error || '任务操作失败')
      }
      setTaskActionMessage(getMessage(result.data))
      await fetchData()
      if (detailTaskId) {
        await fetchTaskDetail(detailTaskId)
      }
    } catch (error) {
      setTaskActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setTaskActionKey(null)
    }
  }, [detailTaskId, fetchData, fetchTaskDetail])

  const claimNextTask = useCallback(async (queueName: string) => {
    const holderId = executorId.trim()
    if (!holderId) {
      setTaskActionError('请先填写执行器 ID')
      return
    }
    await runTaskAction(
      `claim-next:${queueName}`,
      () => fetch('/api/tasks/claim-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueName,
          holderId,
          holderType: 'worker',
        }),
      }),
      (data) => data?.task
        ? `已从 ${queueName} 认领任务 ${data.task.title}`
        : `${queueName} 暂无可认领任务`
    )
  }, [executorId, runTaskAction])

  const releaseTask = useCallback(async (task: TaskRuntimeView) => {
    await runTaskAction(
      `release:${task.id}`,
      () => fetch(`/api/tasks/${task.id}/lease`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holderId: task.lease?.holderId || executorId.trim() || undefined,
        }),
      }),
      () => `已释放任务 ${task.title} 的租约`
    )
  }, [executorId, runTaskAction])

  const completeTask = useCallback(async (task: TaskRuntimeView, summary: string) => {
    await runTaskAction(
      `complete:${task.id}`,
      () => fetch(`/api/tasks/${task.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: summary.trim() || `${task.title} completed`,
          holderId: task.lease?.holderId || executorId.trim() || undefined,
          metadata: {
            source: 'monitor',
            executorId: executorId.trim() || null,
          },
        }),
      }),
      () => `已完成任务 ${task.title}`
    )
  }, [executorId, runTaskAction])

  const failTask = useCallback(async (task: TaskRuntimeView, summary: string) => {
    await runTaskAction(
      `fail:${task.id}`,
      () => fetch(`/api/tasks/${task.id}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: summary.trim() || `${task.title} failed`,
          holderId: task.lease?.holderId || executorId.trim() || undefined,
          metadata: {
            source: 'monitor',
            executorId: executorId.trim() || null,
          },
        }),
      }),
      () => `已标记任务 ${task.title} 失败`
    )
  }, [executorId, runTaskAction])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  useEffect(() => {
    if (!detailTaskId) {
      setTaskDetail(null)
      setTaskDetailError(null)
      setTaskDetailLoading(false)
      return
    }
    fetchTaskDetail(detailTaskId)
  }, [detailTaskId, fetchTaskDetail])

  const visibleTasks = data?.runtime.tasks.filter((task) => {
    if (taskQueueFilter === '__all__') return true
    return task.queueName === taskQueueFilter
  }) || []

  const activeFilterLabel = taskQueueFilter === '__all__' ? '全部队列' : taskQueueFilter

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载监控数据...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">服务监控</h1>
          <p className="text-muted-foreground mt-1">实时查看服务健康、运行轨迹与会话绑定</p>
        </div>
        <Button onClick={triggerHealthCheck} disabled={checking}>
          <RefreshCw className={`h-4 w-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
          健康检查
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-9 gap-6 mb-8">
        <SummaryCard title="服务总数" value={String(data?.summary.totalServices || 0)} icon={<Server className="h-4 w-4 text-muted-foreground" />} />
        <SummaryCard title="在线服务" value={String(data?.summary.onlineServices || 0)} icon={<CheckCircle className="h-4 w-4 text-green-500" />} valueClassName="text-green-500" />
        <SummaryCard title="离线服务" value={String(data?.summary.offlineServices || 0)} icon={<XCircle className="h-4 w-4 text-gray-500" />} valueClassName="text-gray-500" />
        <SummaryCard title="异常服务" value={String(data?.summary.errorServices || 0)} icon={<AlertTriangle className="h-4 w-4 text-red-500" />} valueClassName="text-red-500" />
        <SummaryCard title="活跃请求" value={String(data?.runtime.summary.activeRequests || 0)} icon={<Activity className="h-4 w-4 text-blue-500" />} valueClassName="text-blue-500" />
        <SummaryCard title="活跃 Agent" value={String(data?.runtime.summary.activeAgents || 0)} icon={<Bot className="h-4 w-4 text-emerald-500" />} valueClassName="text-emerald-500" />
        <SummaryCard title="活跃任务" value={String(data?.runtime.summary.activeTasks || 0)} icon={<ListTodo className="h-4 w-4 text-amber-500" />} valueClassName="text-amber-500" />
        <SummaryCard title="排队任务" value={String(data?.runtime.summary.queuedTasks || 0)} icon={<Clock3 className="h-4 w-4 text-orange-500" />} valueClassName="text-orange-500" />
        <SummaryCard title="近期 Run" value={String(data?.runtime.summary.recentRuns || 0)} icon={<Route className="h-4 w-4 text-violet-500" />} valueClassName="text-violet-500" />
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Service Active 面板
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.services.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无注册的服务，请前往服务管理页面添加
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
              {data?.services.map((service) => {
                const stats = data.runtime.serviceStats[service.id]
                const health = data.health[service.id]
                return (
                  <div key={service.id} className="rounded-lg border bg-muted/40 p-4 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className={`h-3 w-3 rounded-full ${getStatusBgColor(service.status)}`} />
                          <div className="font-medium truncate">{service.name}</div>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {service.host}:{service.port}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                          {service.model}
                        </div>
                      </div>
                      <StatusBadge status={service.status} />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <MetricBox label="Active" value={String(stats?.activeRequests || 0)} accent="text-blue-500" />
                      <MetricBox label="Total" value={String(stats?.totalRequests || 0)} />
                      <MetricBox label="Failed" value={String(stats?.failedRequests || 0)} accent="text-red-500" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <InfoRow label="最近 Run" value={stats?.lastRunAt ? formatTimestamp(stats.lastRunAt) : '暂无'} />
                      <InfoRow label="健康检查" value={health ? formatTimestamp(health.checkedAt) : '暂无'} />
                      <InfoRow label="响应时间" value={health ? formatDuration(health.responseTime) : '暂无'} />
                      <InfoRow label="权重" value={String(service.weight)} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="runs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="runs">Run 列表</TabsTrigger>
          <TabsTrigger value="tasks">Task 面板</TabsTrigger>
          <TabsTrigger value="agents">Agent 运行态</TabsTrigger>
          <TabsTrigger value="sessions">Session 绑定</TabsTrigger>
          <TabsTrigger value="services">服务健康</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Route className="h-5 w-5" />
                Run 列表
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data?.runtime.runs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无运行态请求记录
                </div>
              ) : (
                <div className="space-y-4">
                  {data?.runtime.runs.map((run) => (
                    <RunItem key={run.id} run={run} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListTodo className="h-5 w-5" />
                Task 面板
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border bg-muted/40 p-4 space-y-4">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="font-medium">任务执行器操作流</div>
                    <div className="text-sm text-muted-foreground">
                      在监控页直接认领、释放、完成或失败任务，验证 pull-based 执行闭环
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => fetchData()}
                    disabled={Boolean(taskActionKey)}
                  >
                    刷新任务
                  </Button>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">执行器 ID</div>
                    <Input
                      value={executorId}
                      onChange={(event) => setExecutorId(event.target.value)}
                      placeholder="例如 worker-a"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">默认队列</div>
                    <Input
                      value={selectedQueue}
                      onChange={(event) => setSelectedQueue(event.target.value)}
                      placeholder="default"
                    />
                  </div>
                  <div className="rounded-md bg-background p-3">
                    <div className="text-xs text-muted-foreground">HolderType</div>
                    <div className="mt-1 text-lg font-semibold">worker</div>
                  </div>
                </div>
                {(taskActionMessage || taskActionError) && (
                  <div className={`rounded-md px-3 py-2 text-sm ${
                    taskActionError ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'
                  }`}>
                    {taskActionError || taskActionMessage}
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => claimNextTask(selectedQueue)}
                    disabled={!executorId.trim() || !selectedQueue.trim() || Boolean(taskActionKey)}
                  >
                    claim next
                  </Button>
                  <Button
                    variant="outline"
                    onClick={triggerHealthCheck}
                    disabled={checking || Boolean(taskActionKey)}
                  >
                    联动健康检查
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/40 p-4 space-y-4">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="font-medium">队列筛选</div>
                    <div className="text-sm text-muted-foreground">
                      当前查看 {activeFilterLabel}，共 {visibleTasks.length} 条任务
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTaskQueueFilter('__all__')}
                    disabled={taskQueueFilter === '__all__'}
                  >
                    清空筛选
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={taskQueueFilter === '__all__' ? 'default' : 'outline'}
                    onClick={() => setTaskQueueFilter('__all__')}
                  >
                    全部队列
                  </Button>
                  {data?.runtime.taskQueues.map((queue) => (
                    <Button
                      key={queue.queueName}
                      size="sm"
                      variant={taskQueueFilter === queue.queueName ? 'default' : 'outline'}
                      onClick={() => {
                        setTaskQueueFilter(queue.queueName)
                        setSelectedQueue(queue.queueName)
                      }}
                    >
                      {queue.queueName} · {queue.depth}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                <MetricBox label="Total" value={String(data?.runtime.summary.totalTasks || 0)} />
                <MetricBox label="Queued" value={String(data?.runtime.summary.queuedTasks || 0)} accent="text-orange-500" />
                <MetricBox label="Running" value={String(data?.runtime.summary.activeTasks || 0)} accent="text-blue-500" />
                <MetricBox label="Leased" value={String(data?.runtime.summary.leasedTasks || 0)} accent="text-emerald-500" />
                <MetricBox label="Queues" value={String(data?.runtime.taskQueues.length || 0)} />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {data?.runtime.taskQueues.length ? (
                  data.runtime.taskQueues.map((queue) => (
                    <div
                      key={queue.queueName}
                      className={`rounded-lg border bg-muted/40 p-4 space-y-3 ${
                        taskQueueFilter === queue.queueName ? 'ring-2 ring-primary' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="font-medium break-all">{queue.queueName}</div>
                        <span className="rounded-full px-3 py-1 text-xs font-medium bg-background text-muted-foreground">
                          depth {queue.depth}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <MetricBox label="Depth" value={String(queue.depth)} />
                        <MetricBox label="Claimable" value={String(queue.claimable)} accent="text-amber-500" />
                        <MetricBox label="Running" value={String(queue.running)} accent="text-blue-500" />
                      </div>
                      <InfoRow label="更新时间" value={queue.updatedAt ? formatTimestamp(queue.updatedAt) : '暂无'} />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant={taskQueueFilter === queue.queueName ? 'default' : 'outline'}
                          onClick={() => {
                            setTaskQueueFilter(queue.queueName)
                            setSelectedQueue(queue.queueName)
                          }}
                        >
                          筛选队列
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => claimNextTask(queue.queueName)}
                          disabled={!executorId.trim() || Boolean(taskActionKey)}
                        >
                          {taskActionKey === `claim-next:${queue.queueName}` ? '认领中...' : 'claim next'}
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="xl:col-span-3 text-center py-8 text-muted-foreground rounded-lg border">
                    暂无任务队列数据
                  </div>
                )}
              </div>

              {visibleTasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  当前筛选下暂无任务数据
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleTasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      actionKey={taskActionKey}
                      onOpenDetail={() => setDetailTaskId(task.id)}
                      onRelease={releaseTask}
                      onComplete={completeTask}
                      onFail={failTask}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Agent 运行态
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(data?.runtime.agentStats || {}).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无 Agent 运行态数据
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
                  {Object.values(data?.runtime.agentStats || {})
                    .sort((a, b) => (b.lastRunAt || 0) - (a.lastRunAt || 0))
                    .map((agent) => (
                      <div key={agent.agentId} className="rounded-lg border bg-muted/40 p-4 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Bot className="h-4 w-4 text-muted-foreground" />
                              <div className="font-medium truncate">{agent.agentName}</div>
                            </div>
                            <div className="text-sm text-muted-foreground mt-1 break-all">
                              {agent.agentId}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {agent.role || 'general'}
                            </div>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                            agent.activeRuns > 0
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {agent.activeRuns > 0 ? '活跃中' : '空闲'}
                          </span>
                        </div>

                        <div className="grid grid-cols-4 gap-3">
                          <MetricBox label="Active" value={String(agent.activeRuns)} accent="text-blue-500" />
                          <MetricBox label="Total" value={String(agent.totalRuns)} />
                          <MetricBox label="Failed" value={String(agent.failedRuns)} accent="text-red-500" />
                          <MetricBox label="Success" value={`${agent.successRate}%`} accent="text-emerald-500" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <InfoRow label="最近 Run" value={agent.lastRunAt ? formatTimestamp(agent.lastRunAt) : '暂无'} />
                          <InfoRow label="最近失败" value={agent.lastErrorAt ? formatTimestamp(agent.lastErrorAt) : '暂无'} />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                Session 绑定视图
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data?.runtime.sessions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无会话绑定数据
                </div>
              ) : (
                <div className="space-y-4">
                  {data?.runtime.sessions.map((session) => (
                    <SessionItem key={session.sessionId} session={session} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services">
          <Card>
            <CardHeader>
              <CardTitle>服务列表</CardTitle>
            </CardHeader>
            <CardContent>
              {data?.services.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无注册的服务，请前往服务管理页面添加
                </div>
              ) : (
                <div className="space-y-4">
                  {data?.services.map((service) => {
                    const health = data.health[service.id]
                    return (
                      <div
                        key={service.id}
                        className="flex flex-col gap-4 rounded-lg bg-muted p-4 xl:flex-row xl:items-center xl:justify-between"
                      >
                        <div className="flex items-center gap-4">
                          <div className={`h-3 w-3 rounded-full ${getStatusBgColor(service.status)}`} />
                          <div>
                            <div className="font-medium">{service.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {service.host}:{service.port} | {service.model}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-6 text-sm">
                          <InfoColumn label="权重" value={String(service.weight)} />
                          <InfoColumn label="活跃请求" value={String(data.runtime.serviceStats[service.id]?.activeRequests || 0)} />
                          <InfoColumn label="响应时间" value={health ? formatDuration(health.responseTime) : '暂无'} />
                          <InfoColumn label="检查时间" value={health ? formatTimestamp(health.checkedAt) : '暂无'} />
                          <StatusBadge status={service.status} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog.Root open={Boolean(detailTaskId)} onOpenChange={(open) => !open && setDetailTaskId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 h-full w-full max-w-3xl overflow-y-auto border-l bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <Dialog.Title className="text-lg font-semibold">任务详情</Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  查看任务主记录、事件流、子任务、租约与结果
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon">
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>

            <div className="space-y-6 p-6">
              {taskDetailLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  加载任务详情中...
                </div>
              ) : taskDetailError ? (
                <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
                  {taskDetailError}
                </div>
              ) : taskDetail ? (
                <>
                  <div className="rounded-lg border p-4 space-y-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TaskStatusTag status={taskDetail.task.status} />
                      <div className="font-medium break-all">{taskDetail.task.title}</div>
                      {taskDetail.task.kind && (
                        <span className="text-sm text-muted-foreground">{taskDetail.task.kind}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      <InfoRow label="Task ID" value={taskDetail.task.id} />
                      <InfoRow label="Root Task" value={taskDetail.task.rootTaskId || taskDetail.task.id} />
                      <InfoRow label="Parent Task" value={taskDetail.task.parentTaskId || '无'} />
                      <InfoRow label="Queue" value={taskDetail.task.queueName || '未入队'} />
                      <InfoRow label="Agent" value={taskDetail.task.assignedAgentName || taskDetail.task.assignedAgentId || '无'} />
                      <InfoRow label="Requested Agent" value={taskDetail.task.requestedAgentId || '无'} />
                      <InfoRow label="Run ID" value={taskDetail.task.runId || '无'} />
                      <InfoRow label="Session" value={taskDetail.task.sessionId || '无'} />
                    </div>
                    {taskDetail.task.runId && (
                      <div className="flex justify-start">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/runs/${encodeURIComponent(taskDetail.task.runId)}`}>
                            查看关联 Run
                          </Link>
                        </Button>
                      </div>
                    )}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                      <InfoRow label="创建时间" value={formatTimestamp(taskDetail.task.createdAt)} />
                      <InfoRow label="更新时间" value={formatTimestamp(taskDetail.task.updatedAt)} />
                      <InfoRow label="完成时间" value={taskDetail.task.completedAt ? formatTimestamp(taskDetail.task.completedAt) : '暂无'} />
                    </div>
                    {(taskDetail.lease || taskDetail.result || taskDetail.task.error) && (
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                        <InfoRow
                          label="Lease"
                          value={taskDetail.lease ? `${taskDetail.lease.holderId} · ${formatTimestamp(taskDetail.lease.expiresAt)}` : '无'}
                        />
                        <InfoRow
                          label="Result"
                          value={taskDetail.result ? `${taskDetail.result.status}${taskDetail.result.summary ? ` · ${taskDetail.result.summary}` : ''}` : '无'}
                        />
                        <InfoRow label="错误" value={taskDetail.task.error || '无'} />
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border p-4 space-y-4">
                    <div className="font-medium">事件流</div>
                    {taskDetail.events.length === 0 ? (
                      <div className="text-sm text-muted-foreground">暂无事件</div>
                    ) : (
                      <div className="space-y-3">
                        {taskDetail.events
                          .slice()
                          .sort((a, b) => b.timestamp - a.timestamp)
                          .map((event, index) => (
                            <div key={`${event.timestamp}-${event.type}-${index}`} className="rounded-md bg-muted/40 p-3 space-y-2">
                              <div className="flex flex-col gap-1 xl:flex-row xl:items-center xl:justify-between">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="rounded-full bg-background px-2 py-1 text-xs font-medium">
                                    {event.type}
                                  </span>
                                  <span className="text-sm">{event.detail || '无详情'}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {formatTimestamp(event.timestamp)}
                                </div>
                              </div>
                              {(event.actorId || event.actorType) && (
                                <div className="text-sm text-muted-foreground">
                                  Actor {event.actorType || 'unknown'} · {event.actorId || 'unknown'}
                                </div>
                              )}
                              {event.metadata && (
                                <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
                                  {JSON.stringify(event.metadata, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border p-4 space-y-4">
                    <div className="font-medium">子任务</div>
                    {taskDetail.children.length === 0 ? (
                      <div className="text-sm text-muted-foreground">暂无子任务</div>
                    ) : (
                      <div className="space-y-3">
                        {taskDetail.children.map((child) => (
                          <div key={child.id} className="rounded-md bg-muted/40 p-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <TaskStatusTag status={child.status} />
                              <div className="font-medium break-all">{child.title}</div>
                              {child.kind && (
                                <span className="text-sm text-muted-foreground">{child.kind}</span>
                              )}
                            </div>
                            <div className="mt-2 grid grid-cols-1 xl:grid-cols-3 gap-3 text-sm">
                              <InfoRow label="Task ID" value={child.id} />
                              <InfoRow label="Queue" value={child.queueName || '未入队'} />
                              <InfoRow label="更新时间" value={formatTimestamp(child.updatedAt)} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">请选择任务查看详情</div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function SummaryCard({
  title,
  value,
  icon,
  valueClassName,
}: {
  title: string
  value: string
  icon: React.ReactNode
  valueClassName?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueClassName || ''}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

function MetricBox({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="rounded-md bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${accent || ''}`}>{value}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium break-all">{value}</div>
    </div>
  )
}

function InfoColumn({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <div className={`px-3 py-1 rounded-full text-xs font-medium ${
      status === 'online' ? 'bg-green-500/10 text-green-500' :
      status === 'error' ? 'bg-red-500/10 text-red-500' :
      'bg-gray-500/10 text-gray-500'
    }`}>
      {status === 'online' ? '在线' :
       status === 'error' ? '异常' : '离线'}
    </div>
  )
}

function RunItem({ run }: { run: RunRecord }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusTag status={run.status} />
            <span className="font-medium">{run.serviceName || run.serviceId || '未命中服务'}</span>
            {run.model && (
              <span className="text-sm text-muted-foreground break-all">{run.model}</span>
            )}
          </div>
          <div className="mt-2 text-sm text-muted-foreground break-all">
            {run.upstreamPath}
          </div>
          {(run.agentName || run.agentId) && (
            <div className="mt-2 text-sm text-muted-foreground break-all">
              Agent {run.agentName || run.agentId}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm xl:text-right">
          <InfoColumn label="开始时间" value={formatTimestamp(run.startedAt)} />
          <InfoColumn label="耗时" value={typeof run.latencyMs === 'number' ? formatDuration(run.latencyMs) : '进行中'} />
          <InfoColumn label="重试" value={String(run.retryCount)} />
          <InfoColumn label="候选数" value={String(run.candidateCount)} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 text-sm">
        <InfoRow label="Run ID" value={run.id} />
        <InfoRow label="Agent" value={run.agentName || run.agentId || '无'} />
        <InfoRow label="Session" value={run.sessionId || '无'} />
        <InfoRow label="调度模式" value={run.schedulingMode || 'direct'} />
      </div>

      {run.error && (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {run.error}
        </div>
      )}
    </div>
  )
}

function SessionItem({ session }: { session: SessionBindingView }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium break-all">{session.sessionId}</span>
            <span className={`px-2 py-1 rounded-full text-xs ${
              session.currentRunId ? 'bg-blue-500/10 text-blue-500' : 'bg-muted text-muted-foreground'
            }`}>
              {session.currentRunId ? '活跃中' : '空闲'}
            </span>
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {session.serviceName
              ? `${session.serviceName} (${session.serviceHost}:${session.servicePort})`
              : '未绑定服务'}
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          更新时间 {formatTimestamp(session.updatedAt)}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 text-sm">
        <InfoRow label="当前 Run" value={session.currentRunId || '无'} />
        <InfoRow label="最后 Run" value={session.lastRunId || '无'} />
        <InfoRow label="最近模型" value={session.lastModel || '无'} />
      </div>
    </div>
  )
}

function TaskItem({
  task,
  actionKey,
  onOpenDetail,
  onRelease,
  onComplete,
  onFail,
}: {
  task: TaskRuntimeView
  actionKey: string | null
  onOpenDetail: () => void
  onRelease: (task: TaskRuntimeView) => Promise<void>
  onComplete: (task: TaskRuntimeView, summary: string) => Promise<void>
  onFail: (task: TaskRuntimeView, summary: string) => Promise<void>
}) {
  const [summary, setSummary] = useState('')
  const canRelease = Boolean(task.lease)
  const canComplete = task.status === 'running' || Boolean(task.lease)
  const canFail = task.status === 'running' || Boolean(task.lease)

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TaskStatusTag status={task.status} />
            <span className="font-medium break-all">{task.title}</span>
            {task.kind && (
              <span className="text-sm text-muted-foreground">{task.kind}</span>
            )}
          </div>
          <div className="mt-2 text-sm text-muted-foreground break-all">
            Queue {task.queueName || '未入队'} · Priority {task.priority}
          </div>
          {(task.assignedAgentName || task.assignedAgentId) && (
            <div className="mt-1 text-sm text-muted-foreground break-all">
              Agent {task.assignedAgentName || task.assignedAgentId}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm xl:text-right">
          <InfoColumn label="重试" value={String(task.retryCount)} />
          <InfoColumn label="子任务" value={String(task.childrenCount)} />
          <InfoColumn label="可认领" value={task.isClaimable ? '是' : '否'} />
          <InfoColumn label="队列深度" value={String(task.queueDepth)} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-3 text-sm">
        <InfoRow label="Task ID" value={task.id} />
        <InfoRow label="Root Task" value={task.rootTaskId || task.id} />
        <InfoRow label="Run ID" value={task.runId || '无'} />
        <InfoRow label="Session" value={task.sessionId || '无'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 text-sm">
        <InfoRow label="创建时间" value={formatTimestamp(task.createdAt)} />
        <InfoRow label="认领时间" value={task.claimedAt ? formatTimestamp(task.claimedAt) : '暂无'} />
        <InfoRow label="完成时间" value={task.completedAt ? formatTimestamp(task.completedAt) : '暂无'} />
      </div>

      {(task.lease || task.result || task.error) && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 text-sm">
          <InfoRow
            label="Lease"
            value={task.lease ? `${task.lease.holderId} · ${formatTimestamp(task.lease.expiresAt)}` : '无'}
          />
          <InfoRow
            label="Result"
            value={task.result ? `${task.result.status}${task.result.summary ? ` · ${task.result.summary}` : ''}` : '无'}
          />
          <InfoRow label="错误" value={task.error || '无'} />
        </div>
      )}

      <div className="rounded-md bg-muted/40 p-3 space-y-3">
        <div className="text-sm font-medium">执行器操作</div>
        <Input
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="填写完成/失败摘要，留空则自动生成"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenDetail}
            disabled={Boolean(actionKey)}
          >
            详情
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRelease(task)}
            disabled={!canRelease || Boolean(actionKey)}
          >
            {actionKey === `release:${task.id}` ? '释放中...' : 'release'}
          </Button>
          <Button
            size="sm"
            onClick={() => onComplete(task, summary)}
            disabled={!canComplete || Boolean(actionKey)}
          >
            {actionKey === `complete:${task.id}` ? '完成中...' : 'complete'}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onFail(task, summary)}
            disabled={!canFail || Boolean(actionKey)}
          >
            {actionKey === `fail:${task.id}` ? '提交中...' : 'fail'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function StatusTag({ status }: { status: RunRecord['status'] }) {
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
      status === 'completed' ? 'bg-green-500/10 text-green-500' :
      status === 'failed' ? 'bg-red-500/10 text-red-500' :
      status === 'running' ? 'bg-blue-500/10 text-blue-500' :
      'bg-yellow-500/10 text-yellow-500'
    }`}>
      {status === 'completed' ? '完成' :
       status === 'failed' ? '失败' :
       status === 'running' ? '执行中' :
       status === 'routed' ? '已路由' : '已接收'}
    </span>
  )
}

function TaskStatusTag({ status }: { status: TaskRuntimeView['status'] }) {
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
      status === 'completed' ? 'bg-green-500/10 text-green-500' :
      status === 'failed' ? 'bg-red-500/10 text-red-500' :
      status === 'running' ? 'bg-blue-500/10 text-blue-500' :
      status === 'queued' ? 'bg-orange-500/10 text-orange-500' :
      status === 'cancelled' ? 'bg-gray-500/10 text-gray-500' :
      'bg-yellow-500/10 text-yellow-500'
    }`}>
      {status === 'completed' ? '完成' :
       status === 'failed' ? '失败' :
       status === 'running' ? '执行中' :
       status === 'queued' ? '排队中' :
       status === 'cancelled' ? '已取消' : '待处理'}
    </span>
  )
}
