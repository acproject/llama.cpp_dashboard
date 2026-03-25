'use client'

import { useEffect, useState } from 'react'
import { 
  Server, 
  Activity, 
  Zap, 
  AlertCircle,
  RefreshCw,
  TrendingUp
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface SystemStatus {
  minimemory: {
    connected: boolean
    error?: string
  }
  services: {
    total: number
    online: number
    offline: number
  }
  uptime: number
  timestamp: number
}

export default function HomePage() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/status')
      const data = await response.json()
      if (data.success) {
        setStatus(data.data)
        setError(null)
      } else {
        setError(data.error)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 10000) // Refresh every 10 seconds
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 mb-8">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">系统总览</h1>
        <p className="text-muted-foreground mt-1">llama.cpp Orchestrator Dashboard</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">MiniMemory</CardTitle>
            <Activity className={`h-4 w-4 ${status?.minimemory.connected ? 'text-green-500' : 'text-red-500'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.minimemory.connected ? '已连接' : '未连接'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              端口 6379
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">服务总数</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.services.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              已注册服务
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">在线服务</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {status?.services.online || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              正常运行
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">系统运行时间</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatUptime(status?.uptime || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Dashboard 进程
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">快速操作</h2>
        <div className="flex flex-wrap gap-4">
          <Button onClick={() => window.location.href = '/services'}>
            <Server className="h-4 w-4 mr-2" />
            管理服务
          </Button>
          <Button variant="outline" onClick={() => window.location.href = '/monitor'}>
            <Activity className="h-4 w-4 mr-2" />
            查看监控
          </Button>
          <Button variant="outline" onClick={() => window.location.href = '/nginx'}>
            <Zap className="h-4 w-4 mr-2" />
            Nginx配置
          </Button>
          <Button variant="outline" onClick={fetchStatus}>
            <RefreshCw className="h-4 w-4 mr-2" />
            刷新状态
          </Button>
        </div>
      </div>

      {/* Architecture Diagram */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">系统架构</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-lg font-semibold mb-2">Dashboard</div>
                <div className="text-sm text-muted-foreground">Next.js 管理界面</div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-lg font-semibold mb-2">Orchestrator</div>
                <div className="text-sm text-muted-foreground">负载均衡调度层</div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-lg font-semibold mb-2">MiniMemory</div>
                <div className="text-sm text-muted-foreground">数据存储 (6379)</div>
              </div>
            </div>
            <div className="mt-4 p-4 bg-primary/5 rounded-lg text-center">
              <div className="text-lg font-semibold mb-2">llama.cpp Services</div>
              <div className="text-sm text-muted-foreground">
                多个 llama server 实例，通过 Nginx 统一入口访问
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`
  return `${Math.floor(seconds / 86400)}天`
}
