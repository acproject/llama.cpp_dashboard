'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RunRecord, RunStatus } from '@/types'
import { formatDuration, formatTimestamp } from '@/lib/utils'

type RunsResponse = {
  items: RunRecord[]
  total: number
}

const STATUS_OPTIONS: Array<{ value: RunStatus | '__all__'; label: string }> = [
  { value: '__all__', label: '全部' },
  { value: 'received', label: '已接收' },
  { value: 'routed', label: '已路由' },
  { value: 'running', label: '执行中' },
  { value: 'completed', label: '完成' },
  { value: 'failed', label: '失败' },
]

export default function RunsPage() {
  const [items, setItems] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState<RunStatus | '__all__'>('__all__')
  const [agentId, setAgentId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [model, setModel] = useState('')

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    params.set('limit', '60')
    if (status !== '__all__') params.set('status', status)
    if (agentId.trim()) params.set('agentId', agentId.trim())
    if (sessionId.trim()) params.set('sessionId', sessionId.trim())
    if (serviceId.trim()) params.set('serviceId', serviceId.trim())
    if (model.trim()) params.set('model', model.trim())
    return params.toString()
  }, [agentId, model, serviceId, sessionId, status])

  const fetchRuns = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/runs?${queryString}`)
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch runs')
      }
      const data = result.data as RunsResponse
      setItems(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [queryString])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await fetchRuns()
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchRuns()
    const interval = setInterval(fetchRuns, 5000)
    return () => clearInterval(interval)
  }, [fetchRuns])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载运行态数据...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">运行态</h1>
          <p className="text-muted-foreground mt-1">查看最近 Run 记录与事件详情</p>
        </div>
        <Button onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>过滤</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="space-y-2">
            <Label>状态</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>AgentId</Label>
            <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="可选" />
          </div>
          <div className="space-y-2">
            <Label>SessionId</Label>
            <Input value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="可选" />
          </div>
          <div className="space-y-2">
            <Label>ServiceId</Label>
            <Input value={serviceId} onChange={(e) => setServiceId(e.target.value)} placeholder="可选" />
          </div>
          <div className="space-y-2">
            <Label>Model</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="可选" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="h-5 w-5" />
            最近 Run
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">暂无运行记录</div>
          ) : (
            <div className="space-y-4">
              {items.map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${encodeURIComponent(run.id)}`}
                  className="block rounded-lg border p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusTag status={run.status} />
                        <span className="font-medium break-all">
                          {run.serviceName || run.serviceId || '未命中服务'}
                        </span>
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
                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 text-sm mt-3">
                    <InfoRow label="Run ID" value={run.id} />
                    <InfoRow label="Agent" value={run.agentName || run.agentId || '无'} />
                    <InfoRow label="Session" value={run.sessionId || '无'} />
                    <InfoRow label="调度模式" value={run.schedulingMode || 'direct'} />
                  </div>
                  {run.error && (
                    <div className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
                      {run.error}
                    </div>
                  )}
                </Link>
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

function InfoColumn({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium break-all">{value}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium break-all">{value}</div>
    </div>
  )
}
