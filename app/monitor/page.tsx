'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle,
  Link2,
  RefreshCw,
  Route,
  Server,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MonitorData, RunRecord, SessionBindingView } from '@/types'
import { formatDuration, formatTimestamp, getStatusBgColor } from '@/lib/utils'

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)

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

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-6 mb-8">
        <SummaryCard title="服务总数" value={String(data?.summary.totalServices || 0)} icon={<Server className="h-4 w-4 text-muted-foreground" />} />
        <SummaryCard title="在线服务" value={String(data?.summary.onlineServices || 0)} icon={<CheckCircle className="h-4 w-4 text-green-500" />} valueClassName="text-green-500" />
        <SummaryCard title="离线服务" value={String(data?.summary.offlineServices || 0)} icon={<XCircle className="h-4 w-4 text-gray-500" />} valueClassName="text-gray-500" />
        <SummaryCard title="异常服务" value={String(data?.summary.errorServices || 0)} icon={<AlertTriangle className="h-4 w-4 text-red-500" />} valueClassName="text-red-500" />
        <SummaryCard title="活跃请求" value={String(data?.runtime.summary.activeRequests || 0)} icon={<Activity className="h-4 w-4 text-blue-500" />} valueClassName="text-blue-500" />
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
