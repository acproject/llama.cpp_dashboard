'use client'

import { useEffect, useState, useCallback } from 'react'
import { 
  Activity, 
  RefreshCw, 
  Server, 
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LlamaService, HealthCheckResult } from '@/types'
import { getStatusBgColor, formatDuration, formatTimestamp } from '@/lib/utils'

interface MonitorData {
  services: LlamaService[]
  health: Record<string, HealthCheckResult>
  summary: {
    totalServices: number
    onlineServices: number
    offlineServices: number
    errorServices: number
    totalRequests: number
    avgResponseTime: number
  }
}

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
          <p className="text-muted-foreground mt-1">实时监控所有 llama server 服务状态</p>
        </div>
        <Button onClick={triggerHealthCheck} disabled={checking}>
          <RefreshCw className={`h-4 w-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
          健康检查
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">服务总数</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary.totalServices || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">在线服务</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {data?.summary.onlineServices || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">离线服务</CardTitle>
            <XCircle className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-500">
              {data?.summary.offlineServices || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">异常服务</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {data?.summary.errorServices || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Services List */}
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
                    className="flex items-center justify-between p-4 bg-muted rounded-lg"
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
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-right">
                        <div className="text-muted-foreground">权重</div>
                        <div className="font-medium">{service.weight}</div>
                      </div>
                      {health && (
                        <div className="text-right">
                          <div className="text-muted-foreground">响应时间</div>
                          <div className="font-medium">
                            {formatDuration(health.responseTime)}
                          </div>
                        </div>
                      )}
                      {health && (
                        <div className="text-right">
                          <div className="text-muted-foreground">检查时间</div>
                          <div className="font-medium">
                            {formatTimestamp(health.checkedAt)}
                          </div>
                        </div>
                      )}
                      <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                        service.status === 'online' ? 'bg-green-500/10 text-green-500' :
                        service.status === 'error' ? 'bg-red-500/10 text-red-500' :
                        'bg-gray-500/10 text-gray-500'
                      }`}>
                        {service.status === 'online' ? '在线' :
                         service.status === 'error' ? '异常' : '离线'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
