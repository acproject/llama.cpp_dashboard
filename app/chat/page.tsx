'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Database, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AgentProfile, LlamaService, RagCollection } from '@/types'
import { formatTimestamp, generateId, getStatusBgColor } from '@/lib/utils'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  meta?: {
    runId?: string | null
    serviceId?: string | null
    upstream?: string | null
    agentId?: string | null
    ragCollectionId?: string | null
    ragHits?: string | null
  }
}

type ReferenceDataResponse<T> = {
  success: boolean
  data: T
  error?: string
}

type CollectionListResponse = {
  items: RagCollection[]
  embeddingServices: LlamaService[]
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const record = item as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractAssistantText(payload: any): string {
  const choice = payload?.choices?.[0]
  const messageContent = choice?.message?.content
  const text = choice?.text
  const fallback = payload?.message?.content
  return (
    extractTextContent(messageContent) ||
    (typeof text === 'string' ? text : '') ||
    extractTextContent(fallback) ||
    JSON.stringify(payload, null, 2)
  )
}

export default function ChatPage() {
  const [services, setServices] = useState<LlamaService[]>([])
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [collections, setCollections] = useState<RagCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('__none__')
  const [ragEnabled, setRagEnabled] = useState(false)
  const [selectedCollectionId, setSelectedCollectionId] = useState('__none__')
  const [sessionId, setSessionId] = useState(() => generateId())

  const onlineServices = useMemo(
    () => services.filter((service) => service.enabled !== false && service.status === 'online'),
    [services]
  )
  const enabledAgents = useMemo(
    () => agents.filter((agent) => agent.enabled),
    [agents]
  )
  const enabledCollections = useMemo(
    () => collections.filter((collection) => collection.enabled),
    [collections]
  )
  const modelOptions = useMemo(
    () => Array.from(new Set(onlineServices.map((service) => service.model).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [onlineServices]
  )
  const selectedAgent = useMemo(
    () => enabledAgents.find((agent) => agent.id === selectedAgentId) || null,
    [enabledAgents, selectedAgentId]
  )
  const selectedCollection = useMemo(
    () => enabledCollections.find((collection) => collection.id === selectedCollectionId) || null,
    [enabledCollections, selectedCollectionId]
  )

  const loadReferenceData = useCallback(async () => {
    const [servicesRes, agentsRes, collectionsRes] = await Promise.all([
      fetch('/api/services'),
      fetch('/api/agents?enabled=true'),
      fetch('/api/rag/collections'),
    ])

    const [servicesJson, agentsJson, collectionsJson] = await Promise.all([
      servicesRes.json() as Promise<ReferenceDataResponse<LlamaService[]>>,
      agentsRes.json() as Promise<ReferenceDataResponse<AgentProfile[]>>,
      collectionsRes.json() as Promise<ReferenceDataResponse<CollectionListResponse>>,
    ])

    if (!servicesJson.success) {
      throw new Error(servicesJson.error || '加载服务失败')
    }
    if (!agentsJson.success) {
      throw new Error(agentsJson.error || '加载 Agent 失败')
    }
    if (!collectionsJson.success) {
      throw new Error(collectionsJson.error || '加载 RAG 集合失败')
    }

    const nextServices = servicesJson.data || []
    const nextAgents = agentsJson.data || []
    const nextCollections = collectionsJson.data?.items || []

    setServices(nextServices)
    setAgents(nextAgents)
    setCollections(nextCollections)

    setSelectedModel((current) => {
      if (current && nextServices.some((service) => service.model === current)) return current
      const fallbackModel = Array.from(
        new Set(nextServices.filter((service) => service.enabled !== false && service.status === 'online').map((service) => service.model).filter(Boolean))
      )[0]
      return fallbackModel || ''
    })

    setSelectedAgentId((current) => {
      if (current !== '__none__' && nextAgents.some((agent) => agent.id === current && agent.enabled)) return current
      return '__none__'
    })

    setSelectedCollectionId((current) => {
      if (current !== '__none__' && nextCollections.some((collection) => collection.id === current && collection.enabled)) return current
      return '__none__'
    })
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        await loadReferenceData()
        setError(null)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [loadReferenceData])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadReferenceData()
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setRefreshing(false)
    }
  }, [loadReferenceData])

  const handleNewSession = useCallback(() => {
    setMessages([])
    setDraft('')
    setError(null)
    setSessionId(generateId())
  }, [])

  const handleSubmit = useCallback(async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()

    const content = draft.trim()
    if (!content || sending) return
    if (!selectedModel) {
      setError('请先选择一个模型')
      return
    }
    if (ragEnabled && selectedCollectionId === '__none__') {
      setError('已开启 RAG，请选择一个集合')
      return
    }

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      createdAt: Date.now(),
    }

    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setDraft('')
    setSending(true)
    setError(null)

    try {
      const response = await fetch('/api/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          agentId: selectedAgentId !== '__none__' ? selectedAgentId : undefined,
          session_id: sessionId,
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          rag: ragEnabled && selectedCollectionId !== '__none__'
            ? { collectionId: selectedCollectionId }
            : undefined,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.error || `HTTP ${response.status}`)
      }

      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: extractAssistantText(payload),
        createdAt: Date.now(),
        meta: {
          runId: response.headers.get('x-orchestrator-run-id'),
          serviceId: response.headers.get('x-orchestrator-service-id'),
          upstream: response.headers.get('x-orchestrator-upstream'),
          agentId: response.headers.get('x-orchestrator-agent-profile'),
          ragCollectionId: response.headers.get('x-orchestrator-rag-collection'),
          ragHits: response.headers.get('x-orchestrator-rag-hits'),
        },
      }

      setMessages((current) => [...current, assistantMessage])
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSending(false)
    }
  }, [draft, messages, ragEnabled, selectedAgentId, selectedCollectionId, selectedModel, sending, sessionId])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载聊天配置中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold">聊天</h1>
          <p className="text-muted-foreground mt-1">
            通过统一网关发起对话，并可直接为本轮请求挂接透明 RAG
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            刷新配置
          </Button>
          <Button variant="outline" onClick={handleNewSession} disabled={sending}>
            <Trash2 className="h-4 w-4 mr-2" />
            新会话
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              对话配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>模型</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger>
                  <SelectValue placeholder="选择一个可用模型" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Agent</Label>
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="不指定 Agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不指定 Agent</SelectItem>
                  {enabledAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAgent && (
                <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground space-y-1">
                  <div>{selectedAgent.role || '未设置角色'}</div>
                  <div>默认模型 {selectedAgent.defaultModel || '未设置'}</div>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">透明 RAG</div>
                  <div className="text-sm text-muted-foreground">
                    开启后会在网关内自动检索并注入上下文
                  </div>
                </div>
                <Switch checked={ragEnabled} onCheckedChange={setRagEnabled} />
              </div>
              <div className="space-y-2">
                <Label>RAG 集合</Label>
                <Select
                  value={selectedCollectionId}
                  onValueChange={setSelectedCollectionId}
                  disabled={!ragEnabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择一个 RAG 集合" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不使用 RAG</SelectItem>
                    {enabledCollections.map((collection) => (
                      <SelectItem key={collection.id} value={collection.id}>
                        {collection.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedCollection && ragEnabled && (
                <div className="rounded-lg bg-primary/5 px-3 py-2 text-sm text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">{selectedCollection.name}</div>
                  <div>{selectedCollection.description || '未填写描述'}</div>
                  <div>
                    文档 {selectedCollection.documentCount} · Chunk {selectedCollection.chunkCount}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Session ID</Label>
              <Input value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-sm text-muted-foreground">在线服务</div>
                <div className="mt-1 text-2xl font-semibold">{onlineServices.length}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-sm text-muted-foreground">可用集合</div>
                <div className="mt-1 text-2xl font-semibold">{enabledCollections.length}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[720px]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              网关对话
            </CardTitle>
          </CardHeader>
          <CardContent className="flex h-full min-h-[620px] flex-col gap-4">
            <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border bg-muted/20 p-4">
              {messages.length === 0 ? (
                <div className="flex h-full min-h-[420px] items-center justify-center text-center text-muted-foreground">
                  <div className="space-y-2">
                    <div className="text-base font-medium text-foreground">开始一轮新的网关对话</div>
                    <div>你可以选择模型、Agent，并按需启用某个 RAG collection。</div>
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-xl border px-4 py-3 ${
                      message.role === 'user'
                        ? 'ml-auto max-w-3xl bg-primary text-primary-foreground'
                        : 'mr-auto max-w-4xl bg-background'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 text-xs opacity-80">
                      <span>{message.role === 'user' ? '用户' : '助手'}</span>
                      <span>{formatTimestamp(message.createdAt)}</span>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6">
                      {message.content}
                    </div>
                    {message.meta && (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {message.meta.runId && (
                          <span className="rounded-full bg-muted px-2 py-1">Run {message.meta.runId}</span>
                        )}
                        {message.meta.agentId && (
                          <span className="rounded-full bg-muted px-2 py-1">Agent {message.meta.agentId}</span>
                        )}
                        {message.meta.serviceId && (
                          <span className="rounded-full bg-muted px-2 py-1">Service {message.meta.serviceId}</span>
                        )}
                        {message.meta.upstream && (
                          <span className="rounded-full bg-muted px-2 py-1">{message.meta.upstream}</span>
                        )}
                        {message.meta.ragCollectionId && (
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-foreground">
                            RAG {message.meta.ragCollectionId}
                          </span>
                        )}
                        {message.meta.ragHits && (
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-foreground">
                            命中 {message.meta.ragHits}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="输入你的问题。若启用 RAG，网关会自动从所选集合中检索上下文。"
                rows={5}
                disabled={sending}
              />
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-1">模型 {selectedModel || '未选择'}</span>
                  <span className="rounded-full bg-muted px-2 py-1">
                    Agent {selectedAgent?.name || '自动'}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-1">
                    RAG {ragEnabled && selectedCollection ? selectedCollection.name : '关闭'}
                  </span>
                </div>
                <Button type="submit" disabled={sending || !draft.trim() || !selectedModel}>
                  <Send className="h-4 w-4 mr-2" />
                  {sending ? '发送中...' : '发送到网关'}
                </Button>
              </div>
            </form>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <Database className="h-4 w-4" />
                  本页如何使用透明 RAG
                </div>
                <div className="space-y-1 text-muted-foreground">
                  <div>1. 打开透明 RAG 开关</div>
                  <div>2. 选择一个 RAG collection</div>
                  <div>3. 正常发送聊天请求</div>
                  <div>4. 网关自动检索并注入上下文</div>
                </div>
              </div>
              <div className="rounded-lg border p-4 text-sm">
                <div className="mb-2 font-medium">当前资源概览</div>
                <div className="space-y-2 text-muted-foreground">
                  {onlineServices.slice(0, 4).map((service) => (
                    <div key={service.id} className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${getStatusBgColor(service.status)}`} />
                      <span>{service.name}</span>
                      <span className="truncate">{service.model}</span>
                    </div>
                  ))}
                  {onlineServices.length === 0 && <div>暂无在线模型服务</div>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
