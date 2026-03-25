'use client'

import { useEffect, useState } from 'react'
import { 
  Plus, 
  Trash2, 
  RefreshCw, 
  Edit,
  Server,
  Activity
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LlamaService } from '@/types'
import { formatTimestamp, getStatusBgColor } from '@/lib/utils'

export default function ServicesPage() {
  const [services, setServices] = useState<LlamaService[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingService, setEditingService] = useState<LlamaService | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    host: 'localhost',
    port: '8080',
    model: '',
    weight: '1',
    capabilities: '',
  })

  const fetchServices = async () => {
    try {
      const response = await fetch('/api/services')
      const result = await response.json()
      if (result.success) {
        setServices(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch services:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const payload = {
      name: formData.name,
      description: formData.description,
      host: formData.host,
      port: parseInt(formData.port),
      model: formData.model,
      weight: parseInt(formData.weight),
      capabilities: formData.capabilities.split(',').map(c => c.trim()).filter(Boolean),
    }

    try {
      if (editingService) {
        await fetch(`/api/services/${editingService.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        await fetch('/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      
      setShowForm(false)
      setEditingService(null)
      resetForm()
      fetchServices()
    } catch (error) {
      console.error('Failed to save service:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个服务吗？')) return
    
    try {
      await fetch(`/api/services/${id}`, { method: 'DELETE' })
      fetchServices()
    } catch (error) {
      console.error('Failed to delete service:', error)
    }
  }

  const handleHealthCheck = async (id: string) => {
    try {
      await fetch(`/api/services/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'health-check' }),
      })
      fetchServices()
    } catch (error) {
      console.error('Failed to health check service:', error)
    }
  }

  const handleEdit = (service: LlamaService) => {
    setEditingService(service)
    setFormData({
      name: service.name,
      description: service.description || '',
      host: service.host,
      port: service.port.toString(),
      model: service.model,
      weight: service.weight.toString(),
      capabilities: service.capabilities.join(', '),
    })
    setShowForm(true)
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      host: 'localhost',
      port: '8080',
      model: '',
      weight: '1',
      capabilities: '',
    })
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">服务管理</h1>
          <p className="text-muted-foreground mt-1">管理所有 llama server 服务实例</p>
        </div>
        <Button onClick={() => { setShowForm(true); setEditingService(null); resetForm(); }}>
          <Plus className="h-4 w-4 mr-2" />
          添加服务
        </Button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>{editingService ? '编辑服务' : '添加新服务'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">服务名称</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="llama-server-1"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">模型名称</Label>
                  <Input
                    id="model"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    placeholder="llama-2-7b-chat"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="host">主机地址</Label>
                  <Input
                    id="host"
                    value={formData.host}
                    onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    placeholder="localhost"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port">端口</Label>
                  <Input
                    id="port"
                    type="number"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                    placeholder="8080"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="weight">权重</Label>
                  <Input
                    id="weight"
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    value={formData.weight}
                    onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capabilities">能力标签 (逗号分隔)</Label>
                  <Input
                    id="capabilities"
                    value={formData.capabilities}
                    onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
                    placeholder="chat, code, translation"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">描述</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="服务描述信息..."
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit">
                  {editingService ? '更新' : '添加'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingService(null); }}>
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Services List */}
      <Card>
        <CardHeader>
          <CardTitle>服务列表</CardTitle>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无注册的服务，点击上方按钮添加新服务
            </div>
          ) : (
            <div className="space-y-4">
              {services.map((service) => (
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
                      {service.description && (
                        <div className="text-sm text-muted-foreground mt-1">
                          {service.description}
                        </div>
                      )}
                      {service.capabilities.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {service.capabilities.map((cap) => (
                            <span
                              key={cap}
                              className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded"
                            >
                              {cap}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-muted-foreground mr-4">
                      权重: {service.weight}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleHealthCheck(service.id)}
                    >
                      <Activity className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(service)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(service.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
