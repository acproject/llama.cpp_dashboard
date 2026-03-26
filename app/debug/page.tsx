'use client'

import { useEffect, useState } from 'react'
import { Send, RefreshCw, Server, Terminal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LlamaService } from '@/types'
import { getStatusBgColor } from '@/lib/utils'

export default function DebugPage() {
  const [services, setServices] = useState<LlamaService[]>([])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [responseTime, setResponseTime] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchServices = async () => {
    try {
      const response = await fetch('/api/services')
      const result = await response.json()
      if (result.success) {
        setServices(result.data)
        if (result.data.length > 0 && !selectedServiceId) {
          setSelectedServiceId(result.data[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch services:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleTest = async () => {
    if (!prompt.trim() || !selectedServiceId) return

    setTesting(true)
    setError(null)
    setResponse('')
    setResponseTime(null)

    const startTime = Date.now()
    const service = services.find(s => s.id === selectedServiceId)

    try {
      if (!service) {
        throw new Error('Service not found')
      }
      if (!service.model) {
        throw new Error('Model is required for /v1/chat/completions')
      }

      const url = `http://${service.host}:${service.port}/v1/chat/completions`
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (service.apiKey) {
        headers.Authorization = `Bearer ${service.apiKey}`
        headers['api-key'] = service.apiKey
      }
      
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: service.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 128,
          temperature: 0.7,
        }),
      })

      const endTime = Date.now()
      setResponseTime(endTime - startTime)

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()
      const content =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        data?.message?.content
      setResponse(content || JSON.stringify(data, null, 2))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  const handleDispatch = async () => {
    if (!prompt.trim()) return

    setTesting(true)
    setError(null)
    setResponse('')
    setResponseTime(null)

    const startTime = Date.now()

    try {
      // Get service from dispatcher
      const dispatchRes = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })

      const dispatchData = await dispatchRes.json()
      if (!dispatchData.success) {
        throw new Error(dispatchData.error || 'No available service')
      }

      const service = dispatchData.data.selectedService

      // Call the selected service
      if (!service?.model) {
        throw new Error('Model is required for /v1/chat/completions')
      }

      const url = `http://${service.host}:${service.port}/v1/chat/completions`
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (service.apiKey) {
        headers.Authorization = `Bearer ${service.apiKey}`
        headers['api-key'] = service.apiKey
      }
      
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: service.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 128,
          temperature: 0.7,
        }),
      })

      const endTime = Date.now()
      setResponseTime(endTime - startTime)

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()
      const content =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        data?.message?.content
      setResponse(`[通过调度器选择: ${service.name}]\n\n${content || JSON.stringify(data, null, 2)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    fetchServices()
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载服务列表...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">服务调试</h1>
        <p className="text-muted-foreground mt-1">测试 llama server 服务连接和响应</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Test Panel */}
        <Card>
          <CardHeader>
            <CardTitle>测试面板</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>选择服务</Label>
              <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择一个服务" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${getStatusBgColor(service.status)}`} />
                        {service.name} ({service.host}:{service.port})
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>输入提示词</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="输入测试提示词..."
                rows={4}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleTest} disabled={testing || !selectedServiceId}>
                <Send className="h-4 w-4 mr-2" />
                直接测试
              </Button>
              <Button variant="outline" onClick={handleDispatch} disabled={testing}>
                <Terminal className="h-4 w-4 mr-2" />
                通过调度器
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Response Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>响应结果</span>
              {responseTime && (
                <span className="text-sm font-normal text-muted-foreground">
                  耗时: {responseTime}ms
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                {error}
              </div>
            ) : response ? (
              <div className="p-4 bg-muted rounded-lg whitespace-pre-wrap font-mono text-sm">
                {response}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                输入提示词并点击测试按钮查看响应
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Services Status */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>服务状态</CardTitle>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              暂无注册的服务
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {services.map((service) => (
                <div
                  key={service.id}
                  className="p-4 bg-muted rounded-lg"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-2 w-2 rounded-full ${getStatusBgColor(service.status)}`} />
                    <span className="font-medium">{service.name}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {service.host}:{service.port}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    模型: {service.model}
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
