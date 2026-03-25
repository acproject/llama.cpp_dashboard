'use client'

import { useEffect, useState } from 'react'
import { Save, RefreshCw, Download, FileCode, Server, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NginxConfig } from '@/types'

export default function NginxPage() {
  const [config, setConfig] = useState<NginxConfig | null>(null)
  const [nginxConf, setNginxConf] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/nginx')
      const result = await response.json()
      if (result.success) {
        setConfig(result.data)
      }

      // Generate nginx.conf preview
      const confResponse = await fetch('/api/nginx?action=generate', { method: 'POST' })
      const confResult = await confResponse.json()
      if (confResult.success) {
        setNginxConf(confResult.data.nginxConf)
      }
    } catch (error) {
      console.error('Failed to fetch nginx config:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config) return

    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/nginx', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const result = await response.json()
      if (result.success) {
        setMessage({ type: 'success', text: '配置已保存' })
      } else {
        setMessage({ type: 'error', text: result.error })
      }
    } catch (error) {
      setMessage({ type: 'error', text: String(error) })
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const response = await fetch('/api/nginx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const result = await response.json()
      if (result.success) {
        setConfig(result.data.config)
        setNginxConf(result.data.nginxConf)
        setMessage({ 
          type: 'success', 
          text: `已同步 ${result.data.syncedServices} 个在线服务到 Nginx` 
        })
      } else {
        setMessage({ type: 'error', text: result.error })
      }
    } catch (error) {
      setMessage({ type: 'error', text: String(error) })
    } finally {
      setSyncing(false)
    }
  }

  const handleValidate = async () => {
    try {
      const response = await fetch('/api/nginx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate' }),
      })
      const result = await response.json()
      if (result.success && result.data.valid) {
        setMessage({ type: 'success', text: '配置验证通过' })
      } else {
        setMessage({ type: 'error', text: `验证失败: ${result.data.error}` })
      }
    } catch (error) {
      setMessage({ type: 'error', text: String(error) })
    }
  }

  const handleDownload = () => {
    const blob = new Blob([nginxConf], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'nginx.conf'
    a.click()
    URL.revokeObjectURL(url)
  }

  const updateConfig = (updates: Partial<NginxConfig>) => {
    setConfig(prev => prev ? { ...prev, ...updates } : prev)
  }

  useEffect(() => {
    fetchConfig()
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载 Nginx 配置...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Nginx 配置</h1>
          <p className="text-muted-foreground mt-1">管理 Nginx 反向代理配置</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            同步服务
          </Button>
          <Button variant="outline" onClick={handleValidate}>
            <FileCode className="h-4 w-4 mr-2" />
            验证配置
          </Button>
          <Button variant="outline" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            下载配置
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            保存
          </Button>
        </div>
      </div>

      {message && (
        <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
          message.type === 'success' 
            ? 'bg-green-500/10 border border-green-500/20 text-green-600' 
            : 'bg-destructive/10 border border-destructive/20 text-destructive'
        }`}>
          {message.type === 'error' && <AlertCircle className="h-5 w-5" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Server Config */}
        <Card>
          <CardHeader>
            <CardTitle>服务器配置</CardTitle>
            <CardDescription>Nginx 服务器基本参数</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>监听端口</Label>
              <Input
                type="number"
                value={config?.serverPort || 8080}
                onChange={(e) => updateConfig({ serverPort: parseInt(e.target.value) })}
              />
            </div>

            <div className="space-y-2">
              <Label>代理超时 (秒)</Label>
              <Input
                type="number"
                min="1"
                max="3600"
                value={config?.proxyTimeout || 300}
                onChange={(e) => updateConfig({ proxyTimeout: parseInt(e.target.value) })}
              />
              <p className="text-sm text-muted-foreground">
                代理请求的超时时间
              </p>
            </div>

            <div className="space-y-2">
              <Label>代理缓冲区大小</Label>
              <Input
                value={config?.proxyBufferSize || '128k'}
                onChange={(e) => updateConfig({ proxyBufferSize: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Upstream Config */}
        <Card>
          <CardHeader>
            <CardTitle>Upstream 配置</CardTitle>
            <CardDescription>负载均衡上游服务器组配置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {config?.upstreams.map((upstream, index) => (
              <div key={upstream.name} className="p-4 bg-muted rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{upstream.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {upstream.servers.length} 个服务器
                  </span>
                </div>

                <div className="space-y-2">
                  <Label>负载均衡方式</Label>
                  <Select
                    value={upstream.loadBalancingMethod}
                    onValueChange={(value: 'round-robin' | 'least-conn' | 'ip-hash') => {
                      const newUpstreams = [...(config?.upstreams || [])]
                      newUpstreams[index] = { ...upstream, loadBalancingMethod: value }
                      updateConfig({ upstreams: newUpstreams })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round-robin">轮询 (加权)</SelectItem>
                      <SelectItem value="least-conn">最少连接</SelectItem>
                      <SelectItem value="ip-hash">IP 哈希</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>服务器列表</Label>
                  <div className="space-y-2">
                    {upstream.servers.map((server, sIndex) => (
                      <div key={sIndex} className="flex items-center gap-2 text-sm">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <span>{server.host}:{server.port}</span>
                        <span className="text-muted-foreground">weight={server.weight}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {(!config?.upstreams || config.upstreams.length === 0) && (
              <div className="text-center py-4 text-muted-foreground">
                点击"同步服务"按钮将在线服务同步到 Nginx
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Nginx Config Preview */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>nginx.conf 预览</CardTitle>
          <CardDescription>生成的 Nginx 配置文件内容</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={nginxConf}
            onChange={(e) => setNginxConf(e.target.value)}
            rows={20}
            className="font-mono text-sm"
          />
        </CardContent>
      </Card>
    </div>
  )
}
