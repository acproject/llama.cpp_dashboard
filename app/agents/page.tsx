'use client'

import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Bot, Plus, RefreshCw, Trash2, Edit, Link2, Wrench } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AgentProfile, AgentRuntimeStats, LlamaService } from '@/types'
import { cn, formatTimestamp, getStatusBgColor } from '@/lib/utils'

type AgentFormState = {
  name: string
  description: string
  role: string
  systemPrompt: string
  defaultModel: string
  preferredServiceId: string
  enabled: boolean
  capabilities: string
  tools: string
  serviceIds: string[]
}

type AgentRuntimeResponse = {
  items: AgentRuntimeStats[]
  total: number
}

const initialFormState: AgentFormState = {
  name: '',
  description: '',
  role: '',
  systemPrompt: '',
  defaultModel: '',
  preferredServiceId: '',
  enabled: true,
  capabilities: '',
  tools: '',
  serviceIds: [],
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [agentRuntimeStats, setAgentRuntimeStats] = useState<Record<string, AgentRuntimeStats>>({})
  const [services, setServices] = useState<LlamaService[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AgentProfile | null>(null)
  const [formData, setFormData] = useState<AgentFormState>(initialFormState)

  const fetchData = async () => {
    try {
      const [agentsResponse, servicesResponse, runtimeResponse] = await Promise.all([
        fetch('/api/agents'),
        fetch('/api/services'),
        fetch('/api/runtime/agents'),
      ])
      const [agentsResult, servicesResult, runtimeResult] = await Promise.all([
        agentsResponse.json(),
        servicesResponse.json(),
        runtimeResponse.json(),
      ])

      if (agentsResult.success) {
        setAgents(agentsResult.data)
      }

      if (servicesResult.success) {
        setServices(servicesResult.data)
      }

      if (runtimeResult.success) {
        const runtimeData = runtimeResult.data as AgentRuntimeResponse
        const nextStats = Object.fromEntries(
          (runtimeData.items || []).map((item) => [item.agentId, item])
        )
        setAgentRuntimeStats(nextStats)
      }
    } catch (error) {
      console.error('Failed to fetch agent registry data:', error)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData(initialFormState)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const payload = {
      name: formData.name,
      description: formData.description,
      role: formData.role,
      systemPrompt: formData.systemPrompt,
      defaultModel: formData.defaultModel,
      preferredServiceId: formData.preferredServiceId || undefined,
      enabled: formData.enabled,
      serviceIds: formData.serviceIds,
      capabilities: formData.capabilities.split(',').map(item => item.trim()).filter(Boolean),
      tools: formData.tools.split(',').map(item => item.trim()).filter(Boolean),
    }

    try {
      if (editingAgent) {
        await fetch(`/api/agents/${editingAgent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      setShowForm(false)
      setEditingAgent(null)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Failed to save agent profile:', error)
    }
  }

  const handleEdit = (agent: AgentProfile) => {
    setEditingAgent(agent)
    setFormData({
      name: agent.name,
      description: agent.description || '',
      role: agent.role || '',
      systemPrompt: agent.systemPrompt || '',
      defaultModel: agent.defaultModel || '',
      preferredServiceId: agent.preferredServiceId || '',
      enabled: agent.enabled,
      capabilities: agent.capabilities.join(', '),
      tools: agent.tools.join(', '),
      serviceIds: agent.serviceIds,
    })
    setShowForm(true)
  }

  const handleDelete = async (agentId: string) => {
    if (!confirm('确定要删除这个 Agent 档案吗？')) return

    try {
      await fetch(`/api/agents/${agentId}`, { method: 'DELETE' })
      fetchData()
    } catch (error) {
      console.error('Failed to delete agent profile:', error)
    }
  }

  const handleSetEnabled = async (agent: AgentProfile, enabled: boolean) => {
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      fetchData()
    } catch (error) {
      console.error('Failed to update agent enabled state:', error)
    }
  }

  const toggleService = (serviceId: string) => {
    setFormData(current => ({
      ...current,
      serviceIds: current.serviceIds.includes(serviceId)
        ? current.serviceIds.filter(id => id !== serviceId)
        : [...current.serviceIds, serviceId],
      preferredServiceId:
        current.preferredServiceId === serviceId && current.serviceIds.includes(serviceId)
          ? ''
          : current.preferredServiceId,
    }))
  }

  useEffect(() => {
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载 Agent Registry...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Agent Registry</h1>
          <p className="mt-1 text-muted-foreground">管理 AgentProfile、服务映射、能力与工具索引</p>
        </div>
        <Button
          onClick={() => {
            setShowForm(true)
            setEditingAgent(null)
            resetForm()
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          添加 Agent
        </Button>
      </div>

      {showForm && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>{editingAgent ? '编辑 Agent' : '新增 Agent'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Agent 名称</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="planner-agent"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">角色</Label>
                  <Input
                    id="role"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    placeholder="planner / coder / reviewer"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="defaultModel">默认模型</Label>
                  <Input
                    id="defaultModel"
                    value={formData.defaultModel}
                    onChange={(e) => setFormData({ ...formData, defaultModel: e.target.value })}
                    placeholder="Qwen3.5-4B-GGUF"
                  />
                </div>
                <div className="space-y-2">
                  <Label>优先服务</Label>
                  <Select
                    value={formData.preferredServiceId || '__auto__'}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        preferredServiceId: value === '__auto__' ? '' : value,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="自动选择" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">自动选择</SelectItem>
                      {services
                        .filter(service => formData.serviceIds.length === 0 || formData.serviceIds.includes(service.id))
                        .map(service => (
                          <SelectItem key={service.id} value={service.id}>
                            {service.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">描述</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="说明这个 Agent 负责什么任务"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="systemPrompt">系统提示</Label>
                <Textarea
                  id="systemPrompt"
                  value={formData.systemPrompt}
                  onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                  placeholder="可选的系统提示模板"
                  rows={4}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="capabilities">能力标签</Label>
                  <Input
                    id="capabilities"
                    value={formData.capabilities}
                    onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
                    placeholder="code, plan, reasoning"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tools">工具标签</Label>
                  <Input
                    id="tools"
                    value={formData.tools}
                    onChange={(e) => setFormData({ ...formData, tools: e.target.value })}
                    placeholder="shell, monitor, search"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label>绑定服务</Label>
                <div className="flex flex-wrap gap-2">
                  {services.map(service => {
                    const active = formData.serviceIds.includes(service.id)
                    return (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => toggleService(service.id)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-sm transition-colors',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background text-foreground hover:bg-accent'
                        )}
                      >
                        {service.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                <div>
                  <p className="font-medium">启用 Agent</p>
                  <p className="text-sm text-muted-foreground">禁用后不会参与网关路由过滤</p>
                </div>
                <Switch
                  checked={formData.enabled}
                  onCheckedChange={(enabled) => setFormData({ ...formData, enabled })}
                />
              </div>

              <div className="flex gap-3">
                <Button type="submit">{editingAgent ? '保存修改' : '创建 Agent'}</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false)
                    setEditingAgent(null)
                    resetForm()
                  }}
                >
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {agents.map(agent => {
          const mappedServices = services.filter(service => agent.serviceIds.includes(service.id))
          const runtime = agentRuntimeStats[agent.id]
          return (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="h-5 w-5" />
                      {agent.name}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {agent.role || 'general'} · {agent.defaultModel || '未指定默认模型'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn('h-2.5 w-2.5 rounded-full', agent.enabled ? 'bg-green-500' : 'bg-gray-400')} />
                    <span className="text-sm text-muted-foreground">{agent.enabled ? '启用' : '禁用'}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {agent.description || '暂无描述'}
                </p>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Link2 className="h-4 w-4" />
                      映射服务
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{mappedServices.length}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Bot className="h-4 w-4" />
                      能力标签
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{agent.capabilities.length}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Wrench className="h-4 w-4" />
                      工具标签
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{agent.tools.length}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Activity className="h-4 w-4" />
                      活跃 Run
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{runtime?.activeRuns || 0}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Bot className="h-4 w-4" />
                      总 Run
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{runtime?.totalRuns || 0}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="h-4 w-4" />
                      失败 Run
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{runtime?.failedRuns || 0}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-sm text-muted-foreground">
                      成功率
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{runtime ? `${runtime.successRate}%` : '0%'}</div>
                  </div>
                </div>

                {mappedServices.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">绑定服务</p>
                    <div className="flex flex-wrap gap-2">
                      {mappedServices.map(service => (
                        <span
                          key={service.id}
                          className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                        >
                          <span className={cn('h-2 w-2 rounded-full', getStatusBgColor(service.status))} />
                          {service.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {agent.capabilities.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">能力索引</p>
                    <div className="flex flex-wrap gap-2">
                      {agent.capabilities.map(capability => (
                        <span key={capability} className="rounded-full bg-secondary px-3 py-1 text-xs">
                          {capability}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {agent.tools.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">工具索引</p>
                    <div className="flex flex-wrap gap-2">
                      {agent.tools.map(tool => (
                        <span key={tool} className="rounded-full bg-secondary px-3 py-1 text-xs">
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  更新于 {formatTimestamp(agent.updatedAt)}
                </div>
                {runtime?.lastRunAt && (
                  <div className="text-xs text-muted-foreground">
                    最近 Run {formatTimestamp(runtime.lastRunAt)}
                    {runtime.lastErrorAt ? ` · 最近失败 ${formatTimestamp(runtime.lastErrorAt)}` : ''}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleEdit(agent)}>
                    <Edit className="mr-2 h-4 w-4" />
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetEnabled(agent, !agent.enabled)}
                  >
                    {agent.enabled ? '禁用' : '启用'}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(agent.id)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {agents.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Bot className="mb-4 h-10 w-10 text-muted-foreground" />
            <h3 className="text-lg font-semibold">还没有 AgentProfile</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              创建第一个 Agent，将服务实例、能力标签和工具索引组织成可复用的注册表。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
