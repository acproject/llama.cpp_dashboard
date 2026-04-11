'use client'

import Link from 'next/link'
import type { FormEvent, ReactNode } from 'react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, type ReadonlyURLSearchParams } from 'next/navigation'
import { Database, FileSearch, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { EvidenceRecord, MemoryKind, MemoryRecord, MemoryScopeType } from '@/types'
import { formatTimestamp } from '@/lib/utils'

type EvidenceSearchResponse = {
  items: EvidenceRecord[]
  total: number
}

type MemoryListResponse = {
  items: MemoryRecord[]
  total: number
}

type EvidenceSearchForm = {
  query: string
  topK: string
  limit: string
  taskId: string
  runId: string
  sessionId: string
  agentId: string
  space: string
  tags: string
  collectionIds: string
  includeTaskEvidence: boolean
  includeMemory: boolean
  includeRag: boolean
}

type MemoryFilters = {
  query: string
  kind: string
  scopeType: string
  scopeId: string
  space: string
  tags: string
}

type MemoryForm = {
  kind: MemoryKind
  scopeType: MemoryScopeType
  scopeId: string
  space: string
  title: string
  summary: string
  content: string
  tags: string
  source: string
  uri: string
}

const memoryKinds: MemoryKind[] = ['run_summary', 'fact', 'artifact', 'evidence', 'review_comment', 'note']
const memoryScopeTypes: MemoryScopeType[] = ['global', 'agent', 'task', 'run', 'session']

function buildInitialEvidenceSearchForm(searchParams: URLSearchParams | ReadonlyURLSearchParams): EvidenceSearchForm {
  return {
    query: searchParams.get('query') || '',
    topK: searchParams.get('topK') || '8',
    limit: searchParams.get('limit') || '20',
    taskId: searchParams.get('taskId') || '',
    runId: searchParams.get('runId') || '',
    sessionId: searchParams.get('sessionId') || '',
    agentId: searchParams.get('agentId') || '',
    space: searchParams.get('space') || '',
    tags: searchParams.get('tags') || '',
    collectionIds: searchParams.get('collectionIds') || '',
    includeTaskEvidence: searchParams.get('includeTaskEvidence') !== 'false',
    includeMemory: searchParams.get('includeMemory') !== 'false',
    includeRag: searchParams.get('includeRag') !== 'false',
  }
}

function buildInitialMemoryFilters(searchParams: URLSearchParams | ReadonlyURLSearchParams): MemoryFilters {
  return {
    query: searchParams.get('memoryQuery') || searchParams.get('query') || '',
    kind: searchParams.get('kind') || '__all__',
    scopeType: searchParams.get('scopeType') || '__all__',
    scopeId: searchParams.get('scopeId') || searchParams.get('taskId') || searchParams.get('runId') || searchParams.get('agentId') || '',
    space: searchParams.get('space') || '',
    tags: searchParams.get('memoryTags') || searchParams.get('tags') || '',
  }
}

const emptyMemoryForm: MemoryForm = {
  kind: 'note',
  scopeType: 'global',
  scopeId: '',
  space: '',
  title: '',
  summary: '',
  content: '',
  tags: '',
  source: '',
  uri: '',
}

export default function EvidencePage() {
  return (
    <Suspense fallback={<EvidencePageFallback />}>
      <EvidencePageContent />
    </Suspense>
  )
}

function EvidencePageContent() {
  const searchParams = useSearchParams()
  const [searchForm, setSearchForm] = useState<EvidenceSearchForm>(() => buildInitialEvidenceSearchForm(searchParams))
  const [searchResult, setSearchResult] = useState<EvidenceSearchResponse | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [memoryFilters, setMemoryFilters] = useState<MemoryFilters>(() => buildInitialMemoryFilters(searchParams))
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [memoryTotal, setMemoryTotal] = useState(0)
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [memoryError, setMemoryError] = useState('')
  const [memoryForm, setMemoryForm] = useState<MemoryForm>(emptyMemoryForm)
  const [creatingMemory, setCreatingMemory] = useState(false)
  const [memoryActionMessage, setMemoryActionMessage] = useState('')

  useEffect(() => {
    setSearchForm(buildInitialEvidenceSearchForm(searchParams))
    setMemoryFilters(buildInitialMemoryFilters(searchParams))
  }, [searchParams])

  const fetchMemories = useCallback(async (nextFilters?: MemoryFilters) => {
    const activeFilters = nextFilters || memoryFilters
    setMemoryLoading(true)
    setMemoryError('')

    try {
      const query = new URLSearchParams()
      if (activeFilters.query.trim()) query.set('query', activeFilters.query.trim())
      if (activeFilters.kind !== '__all__') query.set('kind', activeFilters.kind)
      if (activeFilters.scopeType !== '__all__') query.set('scopeType', activeFilters.scopeType)
      if (activeFilters.scopeId.trim()) query.set('scopeId', activeFilters.scopeId.trim())
      if (activeFilters.space.trim()) query.set('space', activeFilters.space.trim())
      csvToArray(activeFilters.tags).forEach((tag) => query.append('tag', tag))
      query.set('limit', '100')

      const response = await fetch(`/api/memories?${query.toString()}`)
      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || '加载共享记忆失败')
      }

      const data = result.data as MemoryListResponse
      setMemories(data.items || [])
      setMemoryTotal(data.total || 0)
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : String(error))
      setMemories([])
      setMemoryTotal(0)
    } finally {
      setMemoryLoading(false)
    }
  }, [memoryFilters])

  const runEvidenceSearch = useCallback(async (event?: FormEvent) => {
    event?.preventDefault()
    setSearchLoading(true)
    setSearchError('')

    try {
      const response = await fetch('/api/evidence/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchForm.query.trim() || undefined,
          topK: Number(searchForm.topK) || 8,
          limit: Number(searchForm.limit) || 20,
          taskId: searchForm.taskId.trim() || undefined,
          runId: searchForm.runId.trim() || undefined,
          sessionId: searchForm.sessionId.trim() || undefined,
          agentId: searchForm.agentId.trim() || undefined,
          space: searchForm.space.trim() || undefined,
          tags: csvToArray(searchForm.tags),
          collectionIds: csvToArray(searchForm.collectionIds),
          includeTaskEvidence: searchForm.includeTaskEvidence,
          includeMemory: searchForm.includeMemory,
          includeRag: searchForm.includeRag,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || '证据检索失败')
      }

      setSearchResult(result.data as EvidenceSearchResponse)
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error))
      setSearchResult(null)
    } finally {
      setSearchLoading(false)
    }
  }, [searchForm])

  const handleCreateMemory = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    setCreatingMemory(true)
    setMemoryError('')
    setMemoryActionMessage('')

    try {
      const scopeId = memoryForm.scopeId.trim()
      const response = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: memoryForm.kind,
          scopeType: memoryForm.scopeType,
          scopeId: scopeId || undefined,
          space: memoryForm.space.trim() || undefined,
          title: memoryForm.title.trim() || undefined,
          summary: memoryForm.summary.trim() || undefined,
          content: memoryForm.content.trim() || undefined,
          tags: csvToArray(memoryForm.tags),
          source: memoryForm.source.trim() || undefined,
          uri: memoryForm.uri.trim() || undefined,
          ...(memoryForm.scopeType === 'task' && scopeId ? { taskId: scopeId } : {}),
          ...(memoryForm.scopeType === 'run' && scopeId ? { runId: scopeId } : {}),
          ...(memoryForm.scopeType === 'session' && scopeId ? { sessionId: scopeId } : {}),
          ...(memoryForm.scopeType === 'agent' && scopeId ? { agentId: scopeId } : {}),
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || '创建共享记忆失败')
      }

      setMemoryForm(emptyMemoryForm)
      setMemoryActionMessage('共享记忆已写入')
      await fetchMemories()
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreatingMemory(false)
    }
  }, [fetchMemories, memoryForm])

  useEffect(() => {
    fetchMemories().catch(() => undefined)
  }, [fetchMemories])

  const evidenceSummary = useMemo(() => {
    const items = searchResult?.items || []
    return {
      total: items.length,
      taskEvidence: items.filter((item) => item.sourceType === 'task_evidence').length,
      memory: items.filter((item) => item.sourceType === 'memory').length,
      rag: items.filter((item) => item.sourceType === 'rag_hit').length,
    }
  }, [searchResult])

  const memorySummary = useMemo(() => {
    return {
      total: memories.length,
      scoped: memories.filter((item) => item.scopeType !== 'global').length,
      indexed: memories.filter((item) => Boolean(item.metadata?.rag)).length,
    }
  }, [memories])

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">证据中心</h1>
          <p className="text-muted-foreground mt-2">
            把 task evidence、共享记忆与 RAG 命中统一到一个可检索入口，补齐 P1 阶段的通用证据层与共享记忆视图。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => fetchMemories()}>
            <RefreshCw className={`mr-2 h-4 w-4 ${memoryLoading ? 'animate-spin' : ''}`} />
            刷新记忆
          </Button>
          <Button variant="outline" onClick={() => runEvidenceSearch()}>
            <FileSearch className={`mr-2 h-4 w-4 ${searchLoading ? 'animate-spin' : ''}`} />
            执行检索
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="证据命中" value={String(evidenceSummary.total)} description="聚合 task / memory / rag" />
        <SummaryCard title="Task Evidence" value={String(evidenceSummary.taskEvidence)} description="来自任务运行链路" />
        <SummaryCard title="共享记忆" value={String(memorySummary.total)} description={`${memorySummary.scoped} 条为 scoped memory`} />
        <SummaryCard title="已索引记忆" value={String(memorySummary.indexed)} description="已同步到共享 RAG 集合" />
      </div>

      <Tabs defaultValue="evidence" className="space-y-6">
        <TabsList>
          <TabsTrigger value="evidence">证据检索</TabsTrigger>
          <TabsTrigger value="memory">共享记忆</TabsTrigger>
        </TabsList>

        <TabsContent value="evidence" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSearch className="h-5 w-5" />
                通用证据搜索
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-6" onSubmit={runEvidenceSearch}>
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2 xl:col-span-2">
                    <Label htmlFor="evidence-query">查询语句</Label>
                    <Textarea
                      id="evidence-query"
                      value={searchForm.query}
                      onChange={(event) => setSearchForm((current) => ({ ...current, query: event.target.value }))}
                      placeholder="例如：查找某次任务失败原因、某个 Agent 的历史证据、共享记忆里的事实条目"
                      rows={3}
                    />
                  </div>
                  <Field label="Task ID">
                    <Input
                      value={searchForm.taskId}
                      onChange={(event) => setSearchForm((current) => ({ ...current, taskId: event.target.value }))}
                      placeholder="可按任务过滤"
                    />
                  </Field>
                  <Field label="Run ID">
                    <Input
                      value={searchForm.runId}
                      onChange={(event) => setSearchForm((current) => ({ ...current, runId: event.target.value }))}
                      placeholder="可按运行链过滤"
                    />
                  </Field>
                  <Field label="Session ID">
                    <Input
                      value={searchForm.sessionId}
                      onChange={(event) => setSearchForm((current) => ({ ...current, sessionId: event.target.value }))}
                      placeholder="可按会话过滤"
                    />
                  </Field>
                  <Field label="Agent ID">
                    <Input
                      value={searchForm.agentId}
                      onChange={(event) => setSearchForm((current) => ({ ...current, agentId: event.target.value }))}
                      placeholder="可按 Agent 过滤"
                    />
                  </Field>
                  <Field label="Memory Space">
                    <Input
                      value={searchForm.space}
                      onChange={(event) => setSearchForm((current) => ({ ...current, space: event.target.value }))}
                      placeholder="例如 task:abc / shared / agent:reviewer"
                    />
                  </Field>
                  <Field label="Tags">
                    <Input
                      value={searchForm.tags}
                      onChange={(event) => setSearchForm((current) => ({ ...current, tags: event.target.value }))}
                      placeholder="逗号分隔，如 bug,release"
                    />
                  </Field>
                  <Field label="Collection IDs">
                    <Input
                      value={searchForm.collectionIds}
                      onChange={(event) => setSearchForm((current) => ({ ...current, collectionIds: event.target.value }))}
                      placeholder="逗号分隔，限制 RAG 搜索范围"
                    />
                  </Field>
                  <Field label="Top K">
                    <Input
                      value={searchForm.topK}
                      onChange={(event) => setSearchForm((current) => ({ ...current, topK: event.target.value }))}
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="展示条数">
                    <Input
                      value={searchForm.limit}
                      onChange={(event) => setSearchForm((current) => ({ ...current, limit: event.target.value }))}
                      inputMode="numeric"
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <SourceToggle
                    checked={searchForm.includeTaskEvidence}
                    label="Task Evidence"
                    description="任务运行链写回的 artifact / worker-error / review 证据"
                    onCheckedChange={(checked) => setSearchForm((current) => ({ ...current, includeTaskEvidence: checked }))}
                  />
                  <SourceToggle
                    checked={searchForm.includeMemory}
                    label="共享记忆"
                    description="统一 memory schema 下的 run summary、fact、artifact 等"
                    onCheckedChange={(checked) => setSearchForm((current) => ({ ...current, includeMemory: checked }))}
                  />
                  <SourceToggle
                    checked={searchForm.includeRag}
                    label="RAG 命中"
                    description="跨 collection 检索召回结果"
                    onCheckedChange={(checked) => setSearchForm((current) => ({ ...current, includeRag: checked }))}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={searchLoading}>
                    <FileSearch className={`mr-2 h-4 w-4 ${searchLoading ? 'animate-spin' : ''}`} />
                    {searchLoading ? '检索中...' : '开始检索'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const next = buildInitialEvidenceSearchForm(new URLSearchParams())
                      setSearchForm(next)
                      setSearchResult(null)
                      setSearchError('')
                    }}
                  >
                    重置条件
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {searchError && (
            <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {searchError}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>检索结果</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!searchResult ? (
                <div className="text-sm text-muted-foreground">
                  还没有执行证据检索。你可以先按 task、run、agent 或共享记忆空间做范围过滤。
                </div>
              ) : searchResult.items.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  当前条件下没有命中结果。
                </div>
              ) : (
                <div className="space-y-4">
                  {searchResult.items.map((item) => (
                    <div key={item.id} className="rounded-lg border p-4 space-y-3">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                              {formatEvidenceSourceLabel(item.sourceType)}
                            </span>
                            {item.kind && (
                              <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                                {item.kind}
                              </span>
                            )}
                            {typeof item.score === 'number' && (
                              <span className="text-xs text-muted-foreground">
                                score {item.score.toFixed(4)}
                              </span>
                            )}
                          </div>
                          <div className="font-medium break-all">
                            {item.title || item.source || item.id}
                          </div>
                          {item.summary && (
                            <div className="text-sm text-muted-foreground">
                              {item.summary}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {item.createdAt ? formatTimestamp(item.createdAt) : '无时间信息'}
                        </div>
                      </div>

                      {item.content && (
                        <div className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap break-words">
                          {item.content}
                        </div>
                      )}

                      <div className="grid gap-3 xl:grid-cols-3 text-sm">
                        <InfoBlock label="Task">{item.taskId || '无'}</InfoBlock>
                        <InfoBlock label="Run">
                          {item.runId ? <Link className="text-primary underline-offset-4 hover:underline" href={`/runs/${encodeURIComponent(item.runId)}`}>{item.runId}</Link> : '无'}
                        </InfoBlock>
                        <InfoBlock label="Memory">{item.memoryId || '无'}</InfoBlock>
                        <InfoBlock label="Collection">{item.collectionId || '无'}</InfoBlock>
                        <InfoBlock label="Document">{item.documentId || '无'}</InfoBlock>
                        <InfoBlock label="Agent">{item.agentId || '无'}</InfoBlock>
                      </div>

                      {item.scopes.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {item.scopes.map((scope) => (
                            <span key={`${item.id}-${scope.type}-${scope.id}`} className="rounded-full bg-muted px-2 py-1 text-xs">
                              {scope.type}:{scope.id}
                            </span>
                          ))}
                        </div>
                      )}

                      {item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {item.tags.map((tag) => (
                            <span key={`${item.id}-${tag}`} className="rounded-full border px-2 py-1 text-xs text-muted-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {(item.source || item.uri) && (
                        <div className="grid gap-3 xl:grid-cols-2 text-sm">
                          <InfoBlock label="Source">{item.source || '无'}</InfoBlock>
                          <InfoBlock label="URI">{item.uri || '无'}</InfoBlock>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="memory" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  写入共享记忆
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleCreateMemory}>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Field label="Kind">
                      <Select
                        value={memoryForm.kind}
                        onValueChange={(value) => setMemoryForm((current) => ({ ...current, kind: value as MemoryKind }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {memoryKinds.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {kind}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Scope">
                      <Select
                        value={memoryForm.scopeType}
                        onValueChange={(value) => setMemoryForm((current) => ({ ...current, scopeType: value as MemoryScopeType }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {memoryScopeTypes.map((scopeType) => (
                            <SelectItem key={scopeType} value={scopeType}>
                              {scopeType}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <Field label="Scope ID">
                    <Input
                      value={memoryForm.scopeId}
                      onChange={(event) => setMemoryForm((current) => ({ ...current, scopeId: event.target.value }))}
                      placeholder={memoryForm.scopeType === 'global' ? 'global 可留空' : `填写 ${memoryForm.scopeType} 对应 ID`}
                    />
                  </Field>

                  <Field label="Memory Space">
                    <Input
                      value={memoryForm.space}
                      onChange={(event) => setMemoryForm((current) => ({ ...current, space: event.target.value }))}
                      placeholder="留空时按 scope 自动生成"
                    />
                  </Field>

                  <Field label="标题">
                    <Input
                      value={memoryForm.title}
                      onChange={(event) => setMemoryForm((current) => ({ ...current, title: event.target.value }))}
                      placeholder="例如：发布事实、代码评审结论、任务总结"
                    />
                  </Field>

                  <Field label="摘要">
                    <Textarea
                      value={memoryForm.summary}
                      onChange={(event) => setMemoryForm((current) => ({ ...current, summary: event.target.value }))}
                      rows={2}
                    />
                  </Field>

                  <Field label="内容">
                    <Textarea
                      value={memoryForm.content}
                      onChange={(event) => setMemoryForm((current) => ({ ...current, content: event.target.value }))}
                      rows={5}
                    />
                  </Field>

                  <Field label="Tags">
                    <Input
                      value={memoryForm.tags}
                      onChange={(event) => setMemoryForm((current) => ({ ...current, tags: event.target.value }))}
                      placeholder="逗号分隔"
                    />
                  </Field>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <Field label="Source">
                      <Input
                        value={memoryForm.source}
                        onChange={(event) => setMemoryForm((current) => ({ ...current, source: event.target.value }))}
                      />
                    </Field>
                    <Field label="URI">
                      <Input
                        value={memoryForm.uri}
                        onChange={(event) => setMemoryForm((current) => ({ ...current, uri: event.target.value }))}
                      />
                    </Field>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={creatingMemory}>
                      <Plus className={`mr-2 h-4 w-4 ${creatingMemory ? 'animate-spin' : ''}`} />
                      {creatingMemory ? '写入中...' : '写入记忆'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setMemoryForm(emptyMemoryForm)
                        setMemoryActionMessage('')
                      }}
                    >
                      重置表单
                    </Button>
                  </div>
                </form>

                {memoryActionMessage && (
                  <div className="mt-4 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600">
                    {memoryActionMessage}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  共享记忆列表
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-3">
                  <Field label="查询">
                    <Input
                      value={memoryFilters.query}
                      onChange={(event) => setMemoryFilters((current) => ({ ...current, query: event.target.value }))}
                      placeholder="按标题、摘要、内容搜索"
                    />
                  </Field>
                  <Field label="Kind">
                    <Select
                      value={memoryFilters.kind}
                      onValueChange={(value) => setMemoryFilters((current) => ({ ...current, kind: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">全部</SelectItem>
                        {memoryKinds.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {kind}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Scope">
                    <Select
                      value={memoryFilters.scopeType}
                      onValueChange={(value) => setMemoryFilters((current) => ({ ...current, scopeType: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">全部</SelectItem>
                        {memoryScopeTypes.map((scopeType) => (
                          <SelectItem key={scopeType} value={scopeType}>
                            {scopeType}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Scope ID">
                    <Input
                      value={memoryFilters.scopeId}
                      onChange={(event) => setMemoryFilters((current) => ({ ...current, scopeId: event.target.value }))}
                      placeholder="例如 task id / agent id"
                    />
                  </Field>
                  <Field label="Space">
                    <Input
                      value={memoryFilters.space}
                      onChange={(event) => setMemoryFilters((current) => ({ ...current, space: event.target.value }))}
                      placeholder="例如 shared / task:xxx"
                    />
                  </Field>
                  <Field label="Tags">
                    <Input
                      value={memoryFilters.tags}
                      onChange={(event) => setMemoryFilters((current) => ({ ...current, tags: event.target.value }))}
                      placeholder="逗号分隔"
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => fetchMemories()} disabled={memoryLoading}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${memoryLoading ? 'animate-spin' : ''}`} />
                    {memoryLoading ? '加载中...' : '刷新列表'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const next = buildInitialMemoryFilters(new URLSearchParams())
                      setMemoryFilters(next)
                      fetchMemories(next).catch(() => undefined)
                    }}
                  >
                    重置过滤
                  </Button>
                </div>

                {memoryError && (
                  <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
                    {memoryError}
                  </div>
                )}

                {memoryLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    加载共享记忆中...
                  </div>
                ) : memories.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    当前没有符合条件的共享记忆。
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      共 {memoryTotal} 条共享记忆
                    </div>
                    {memories.map((memory) => (
                      <div key={memory.id} className="rounded-lg border p-4 space-y-3">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                                {memory.kind}
                              </span>
                              <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                                {formatMemoryScopeLabel(memory.scopeType, memory.scopeId)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                v{memory.version}
                              </span>
                            </div>
                            <div className="font-medium break-all">
                              {memory.title || memory.summary || memory.id}
                            </div>
                            {memory.summary && (
                              <div className="text-sm text-muted-foreground">
                                {memory.summary}
                              </div>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            更新于 {formatTimestamp(memory.updatedAt)}
                          </div>
                        </div>

                        {memory.content && (
                          <div className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap break-words">
                            {memory.content}
                          </div>
                        )}

                        <div className="grid gap-3 xl:grid-cols-3 text-sm">
                          <InfoBlock label="Memory ID">{memory.id}</InfoBlock>
                          <InfoBlock label="Space">{memory.space}</InfoBlock>
                          <InfoBlock label="Scope ID">{memory.scopeId || '无'}</InfoBlock>
                          <InfoBlock label="Task">{memory.taskId || '无'}</InfoBlock>
                          <InfoBlock label="Run">
                            {memory.runId ? <Link className="text-primary underline-offset-4 hover:underline" href={`/runs/${encodeURIComponent(memory.runId)}`}>{memory.runId}</Link> : '无'}
                          </InfoBlock>
                          <InfoBlock label="Agent">{memory.agentId || '无'}</InfoBlock>
                        </div>

                        {memory.tags.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {memory.tags.map((tag) => (
                              <span key={`${memory.id}-${tag}`} className="rounded-full border px-2 py-1 text-xs text-muted-foreground">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function EvidencePageFallback() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-2 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin" />
        <span>加载证据中心...</span>
      </div>
    </div>
  )
}

function SummaryCard({
  title,
  value,
  description,
}: {
  title: string
  value: string
  description: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{description}</div>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function InfoBlock({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all">{children}</div>
    </div>
  )
}

function SourceToggle({
  checked,
  label,
  description,
  onCheckedChange,
}: {
  checked: boolean
  label: string
  description: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="rounded-lg border p-4 flex items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function csvToArray(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatEvidenceSourceLabel(sourceType: EvidenceRecord['sourceType']) {
  if (sourceType === 'task_evidence') return 'task evidence'
  if (sourceType === 'memory') return 'shared memory'
  return 'rag hit'
}

function formatMemoryScopeLabel(scopeType: MemoryScopeType, scopeId?: string) {
  if (scopeType === 'global') return 'global'
  return scopeId ? `${scopeType}:${scopeId}` : scopeType
}
