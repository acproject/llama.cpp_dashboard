'use client'

import { useEffect, useState } from 'react'
import { Save, RefreshCw, Settings, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DispatchConfig, DispatchStrategy, LlamaService } from '@/types'

export default function ConfigPage() {
  const [config, setConfig] = useState<DispatchConfig | null>(null)
  const [services, setServices] = useState<LlamaService[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [distribution, setDistribution] = useState<Record<string, number>>({})

  const fetchData = async () => {
    try {
      const configRes = await fetch('/api/dispatch')
      const configData = await configRes.json()
      if (configData.success) {
        setConfig(configData.data.config)
        setDistribution(configData.data.distribution || {})
      }

      // Fetch services
      const servicesRes = await fetch('/api/services')
      const servicesData = await servicesRes.json()
      if (servicesData.success) {
        setServices(servicesData.data)
      }
    } catch (error) {
      console.error('Failed to fetch config:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config) return

    setSaving(true)
    try {
      await fetch('/api/dispatch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
    } catch (error) {
      console.error('Failed to save config:', error)
    } finally {
      setSaving(false)
    }
  }

  const updateConfig = (updates: Partial<DispatchConfig>) => {
    setConfig(prev => prev ? { ...prev, ...updates } : prev)
  }

  const replicaGroups = Array.from(
    new Set(services.map(s => (s.replicaGroup || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b))

  useEffect(() => {
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载配置...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">调度配置</h1>
          <p className="text-muted-foreground mt-1">配置负载均衡策略和参数</p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          保存配置
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Strategy Config */}
        <Card>
          <CardHeader>
            <CardTitle>调度策略</CardTitle>
            <CardDescription>默认直连；仅对同一分布式组 (replicaGroup) 开启调度</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>分布式组 (replicaGroup)</Label>
              <Select
                value={config?.replicaGroup ? config.replicaGroup : '__direct__'}
                onValueChange={(value: string) =>
                  updateConfig({ replicaGroup: value === '__direct__' ? null : value.trim() })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="直连 (默认)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__direct__">直连 (默认)</SelectItem>
                  {replicaGroups.map(g => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                未选择分布式组时，不启用调度策略；同名模型多服务默认直连到主副本（若配置）或按端口优先固定选择一个
              </p>
            </div>

            <div className="space-y-2">
              <Label>负载均衡策略</Label>
              <Select
                value={config?.strategy || 'weighted'}
                onValueChange={(value: DispatchStrategy) => updateConfig({ strategy: value })}
                disabled={!config?.replicaGroup}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weighted">加权随机 (推荐)</SelectItem>
                  <SelectItem value="round-robin">轮询</SelectItem>
                  <SelectItem value="least-connections">最少连接</SelectItem>
                  <SelectItem value="capability-based">能力匹配</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {!config?.replicaGroup && '直连模式下无需选择策略'}
                {config?.strategy === 'weighted' && '根据权重随机选择服务，权重高的服务获得更多请求'}
                {config?.strategy === 'round-robin' && '按顺序轮流选择服务'}
                {config?.strategy === 'least-connections' && '选择当前连接数最少的服务'}
                {config?.strategy === 'capability-based' && '根据请求能力需求匹配最合适的服务'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>默认权重</Label>
              <Input
                type="number"
                min="0.1"
                max="10"
                step="0.1"
                value={config?.defaultWeight || 1}
                onChange={(e) => updateConfig({ defaultWeight: parseFloat(e.target.value) })}
                disabled={!config?.replicaGroup}
              />
              <p className="text-sm text-muted-foreground">
                新服务的默认权重值
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Health Check Config */}
        <Card>
          <CardHeader>
            <CardTitle>健康检查</CardTitle>
            <CardDescription>服务健康检查参数配置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>检查间隔 (毫秒)</Label>
              <Input
                type="number"
                min="1000"
                max="60000"
                value={config?.healthCheckInterval || 10000}
                onChange={(e) => updateConfig({ healthCheckInterval: parseInt(e.target.value) })}
              />
            </div>

            <div className="space-y-2">
              <Label>超时时间 (毫秒)</Label>
              <Input
                type="number"
                min="1000"
                max="30000"
                value={config?.healthCheckTimeout || 5000}
                onChange={(e) => updateConfig({ healthCheckTimeout: parseInt(e.target.value) })}
              />
            </div>

            <div className="space-y-2">
              <Label>最大重试次数</Label>
              <Input
                type="number"
                min="1"
                max="10"
                value={config?.maxRetries || 3}
                onChange={(e) => updateConfig({ maxRetries: parseInt(e.target.value) })}
              />
            </div>

            <div className="space-y-2">
              <Label>重试延迟 (毫秒)</Label>
              <Input
                type="number"
                min="100"
                max="10000"
                value={config?.retryDelay || 1000}
                onChange={(e) => updateConfig({ retryDelay: parseInt(e.target.value) })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Load Distribution */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            负载分布预览
          </CardTitle>
          <CardDescription>当前权重下的预期负载分布</CardDescription>
        </CardHeader>
        <CardContent>
          {!config?.replicaGroup ? (
            <div className="text-center py-4 text-muted-foreground">
              直连模式不展示负载分布
            </div>
          ) : services.filter(s => (s.replicaGroup || '').trim() === (config.replicaGroup || '').trim()).length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              当前分布式组暂无服务
            </div>
          ) : (
            <div className="space-y-4">
              {services
                .filter(s => (s.replicaGroup || '').trim() === (config.replicaGroup || '').trim())
                .map((service) => (
                <div key={service.id} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{service.name}</span>
                    <span className="text-muted-foreground">
                      权重: {service.weight} | 分布: {(distribution[service.id] || 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${distribution[service.id] || 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
