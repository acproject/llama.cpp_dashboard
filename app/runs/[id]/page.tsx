'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RunEvent, RunRecord, TaskRuntimeView } from '@/types'
import { formatDuration, formatTimestamp } from '@/lib/utils'

type RunDetailResponse = {
  run: RunRecord
  events: RunEvent[]
  tasks: TaskRuntimeView[]
}

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const runId = use(params).id
  const [data, setData] = useState<RunDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDetail = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`)
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch run detail')
      }
      setData(result.data as RunDetailResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [runId])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await fetchDetail()
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchDetail()
    const interval = setInterval(fetchDetail, 5000)
    return () => clearInterval(interval)
  }, [fetchDetail])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载 Run 详情...</span>
        </div>
      </div>
    )
  }

  const run = data?.run
  const events = data?.events || []
  const tasks = data?.tasks || []

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Link href="/runs" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4 mr-1" />
              返回
            </Link>
          </div>
          <h1 className="text-3xl font-bold break-all">Run {runId}</h1>
          <p className="text-muted-foreground">查看一次运行的完整信息与事件时间线</p>
        </div>
        <Button onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>主记录</CardTitle>
        </CardHeader>
        <CardContent>
          {!run ? (
            <div className="text-muted-foreground">未找到 Run 记录</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <InfoRow label="状态" value={<StatusTag status={run.status} />} />
              <InfoRow label="开始时间" value={formatTimestamp(run.startedAt)} />
              <InfoRow label="耗时" value={typeof run.latencyMs === 'number' ? formatDuration(run.latencyMs) : '进行中'} />
              <InfoRow label="上游路径" value={run.upstreamPath} />
              <InfoRow label="Method" value={run.method} />
              <InfoRow label="Model" value={run.model || '无'} />
              <InfoRow label="Agent" value={run.agentName || run.agentId || '无'} />
              <InfoRow label="Session" value={run.sessionId || '无'} />
              <InfoRow label="Service" value={run.serviceName || run.serviceId || '无'} />
              <InfoRow label="Host" value={run.serviceHost && run.servicePort ? `${run.serviceHost}:${run.servicePort}` : '无'} />
              <InfoRow label="调度模式" value={run.schedulingMode || 'direct'} />
              <InfoRow label="候选数" value={String(run.candidateCount)} />
              <InfoRow label="重试次数" value={String(run.retryCount)} />
              <InfoRow label="错误" value={run.error || '无'} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>关联 Task</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">当前 Run 暂无关联任务</div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div key={task.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <TaskStatusTag status={task.status} />
                        <span className="font-medium break-all">{task.title}</span>
                        {task.kind && (
                          <span className="text-sm text-muted-foreground">{task.kind}</span>
                        )}
                      </div>
                      {task.description && (
                        <div className="text-sm text-muted-foreground break-all">{task.description}</div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:text-right">
                      <InfoColumn label="更新时间" value={formatTimestamp(task.updatedAt)} />
                      <InfoColumn label="队列" value={task.queueName || '未入队'} />
                      <InfoColumn label="优先级" value={task.priority} />
                      <InfoColumn label="可认领" value={task.isClaimable ? '是' : '否'} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
                    <InfoRow label="Task ID" value={task.id} />
                    <InfoRow label="Agent" value={task.assignedAgentName || task.assignedAgentId || '无'} />
                    <InfoRow label="Session" value={task.sessionId || '无'} />
                    <InfoRow
                      label="Result"
                      value={task.result ? `${task.result.status}${task.result.summary ? ` · ${task.result.summary}` : ''}` : '无'}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>事件时间线</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">暂无事件</div>
          ) : (
            <div className="space-y-3">
              {events.map((event, index) => (
                <div key={`${event.type}-${event.timestamp}-${index}`} className="rounded-lg border p-4 space-y-2">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <EventTag type={event.type} />
                      <span className="text-sm text-muted-foreground">{formatTimestamp(event.timestamp)}</span>
                    </div>
                    <div className="text-sm text-muted-foreground break-all">
                      {event.serviceName || event.serviceId || ''}
                    </div>
                  </div>
                  {event.detail && (
                    <div className="text-sm break-all">{event.detail}</div>
                  )}
                  {event.metadata && Object.keys(event.metadata).length > 0 && (
                    <pre className="rounded-md bg-muted/40 px-3 py-2 text-xs overflow-auto">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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

function EventTag({ type }: { type: RunEvent['type'] }) {
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
      type === 'completed' ? 'bg-green-500/10 text-green-500' :
      type === 'failed' ? 'bg-red-500/10 text-red-500' :
      type === 'retry' ? 'bg-orange-500/10 text-orange-500' :
      type === 'routed' ? 'bg-violet-500/10 text-violet-500' :
      type === 'parsed' ? 'bg-blue-500/10 text-blue-500' :
      'bg-gray-500/10 text-gray-500'
    }`}>
      {type}
    </span>
  )
}

function TaskStatusTag({ status }: { status: TaskRuntimeView['status'] }) {
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
      status === 'completed' ? 'bg-green-500/10 text-green-500' :
      status === 'failed' ? 'bg-red-500/10 text-red-500' :
      status === 'running' ? 'bg-blue-500/10 text-blue-500' :
      status === 'queued' ? 'bg-violet-500/10 text-violet-500' :
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-muted-foreground text-sm">{label}</div>
      <div className="font-medium break-all">{value}</div>
    </div>
  )
}

function InfoColumn({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="font-medium break-all">{value}</div>
    </div>
  )
}
