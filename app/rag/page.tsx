'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Database, FileSearch, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { LlamaService, RagCollection, RagDocument, RagRetrievalHit } from '@/types'
import { formatTimestamp } from '@/lib/utils'

type CollectionListResponse = {
  items: RagCollection[]
  embeddingServices: LlamaService[]
}

type CollectionDetailResponse = {
  collection: RagCollection
  documents: RagDocument[]
}

type RetrievalResponse = {
  collection: RagCollection
  hits: RagRetrievalHit[]
  contextText: string
}

const emptyCollectionForm = {
  name: '',
  description: '',
  embeddingServiceId: '__auto__',
  embeddingSpace: '',
  graphRelation: 'HAS_CHUNK',
  metric: 'cosine',
  chunkSize: '900',
  chunkOverlap: '120',
}

const emptyDocumentForm = {
  title: '',
  source: '',
  tags: '',
  graphNodes: '',
  content: '',
}

const emptyRetrieveForm = {
  query: '',
  topK: '6',
  tags: '',
  graphNodes: '',
}

function csvToArray(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export default function RagPage() {
  const [collections, setCollections] = useState<RagCollection[]>([])
  const [embeddingServices, setEmbeddingServices] = useState<LlamaService[]>([])
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('')
  const [selectedCollection, setSelectedCollection] = useState<RagCollection | null>(null)
  const [documents, setDocuments] = useState<RagDocument[]>([])
  const [retrievalResult, setRetrievalResult] = useState<RetrievalResponse | null>(null)
  const [collectionForm, setCollectionForm] = useState(emptyCollectionForm)
  const [documentForm, setDocumentForm] = useState(emptyDocumentForm)
  const [retrieveForm, setRetrieveForm] = useState(emptyRetrieveForm)
  const [loading, setLoading] = useState(true)
  const [submittingCollection, setSubmittingCollection] = useState(false)
  const [submittingDocument, setSubmittingDocument] = useState(false)
  const [retrieving, setRetrieving] = useState(false)
  const [error, setError] = useState('')

  const selectedEmbeddingService = useMemo(
    () => embeddingServices.find((service) => service.id === selectedCollection?.embeddingServiceId),
    [embeddingServices, selectedCollection]
  )

  const fetchCollections = useCallback(async (preferredCollectionId?: string, fallbackSelectedId?: string) => {
    setError('')
    const response = await fetch('/api/rag/collections')
    const result = await response.json()
    if (!result.success) {
      throw new Error(result.error || '加载 RAG 集合失败')
    }

    const data = result.data as CollectionListResponse
    const nextCollections = data.items || []
    setCollections(nextCollections)
    setEmbeddingServices(data.embeddingServices || [])

    const fallbackId = preferredCollectionId || fallbackSelectedId
    const nextSelectedId =
      (fallbackId && nextCollections.some((item) => item.id === fallbackId) && fallbackId) ||
      nextCollections[0]?.id ||
      ''

    setSelectedCollectionId(nextSelectedId)
    return nextSelectedId
  }, [])

  const fetchCollectionDetail = useCallback(async (collectionId: string) => {
    if (!collectionId) {
      setSelectedCollection(null)
      setDocuments([])
      setRetrievalResult(null)
      return
    }

    const response = await fetch(`/api/rag/collections/${collectionId}`)
    const result = await response.json()
    if (!result.success) {
      throw new Error(result.error || '加载集合详情失败')
    }

    const data = result.data as CollectionDetailResponse
    setSelectedCollection(data.collection)
    setDocuments(data.documents || [])
  }, [])

  const refreshAll = useCallback(async (preferredCollectionId?: string, fallbackSelectedId?: string) => {
    try {
      const nextSelectedId = await fetchCollections(preferredCollectionId, fallbackSelectedId)
      await fetchCollectionDetail(nextSelectedId)
    } catch (refreshError) {
      setError(String(refreshError))
    } finally {
      setLoading(false)
    }
  }, [fetchCollectionDetail, fetchCollections])

  const handleCreateCollection = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmittingCollection(true)
    setError('')

    try {
      const response = await fetch('/api/rag/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: collectionForm.name,
          description: collectionForm.description || undefined,
          embeddingServiceId:
            collectionForm.embeddingServiceId === '__auto__' ? undefined : collectionForm.embeddingServiceId,
          embeddingSpace: collectionForm.embeddingSpace || undefined,
          graphRelation: collectionForm.graphRelation || undefined,
          metric: collectionForm.metric,
          chunkSize: Number(collectionForm.chunkSize),
          chunkOverlap: Number(collectionForm.chunkOverlap),
        }),
      })
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || '创建集合失败')
      }

      const collection = result.data as RagCollection
      setCollectionForm(emptyCollectionForm)
      await refreshAll(collection.id, selectedCollectionId)
    } catch (submitError) {
      setError(String(submitError))
    } finally {
      setSubmittingCollection(false)
    }
  }

  const handleDeleteCollection = async (collectionId: string) => {
    if (!confirm('确定要删除这个 RAG 集合及其已入库文档吗？')) return
    setError('')

    try {
      const response = await fetch(`/api/rag/collections/${collectionId}`, {
        method: 'DELETE',
      })
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || '删除集合失败')
      }

      await refreshAll(undefined, selectedCollectionId)
    } catch (deleteError) {
      setError(String(deleteError))
    }
  }

  const handleIngestDocument = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedCollectionId) return

    setSubmittingDocument(true)
    setError('')

    try {
      const response = await fetch(`/api/rag/collections/${selectedCollectionId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: documentForm.title,
          source: documentForm.source || undefined,
          tags: csvToArray(documentForm.tags),
          graphNodes: csvToArray(documentForm.graphNodes),
          content: documentForm.content,
        }),
      })
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || '文档入库失败')
      }

      setDocumentForm(emptyDocumentForm)
      await refreshAll(selectedCollectionId, selectedCollectionId)
    } catch (submitError) {
      setError(String(submitError))
    } finally {
      setSubmittingDocument(false)
    }
  }

  const handleRetrieve = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedCollectionId) return

    setRetrieving(true)
    setError('')

    try {
      const response = await fetch('/api/rag/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: selectedCollectionId,
          query: retrieveForm.query,
          topK: Number(retrieveForm.topK),
          tags: csvToArray(retrieveForm.tags),
          graphNodes: csvToArray(retrieveForm.graphNodes),
        }),
      })
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || '检索失败')
      }

      setRetrievalResult(result.data as RetrievalResponse)
    } catch (retrieveError) {
      setError(String(retrieveError))
    } finally {
      setRetrieving(false)
    }
  }

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!selectedCollectionId) {
      setSelectedCollection(null)
      setDocuments([])
      setRetrievalResult(null)
      return
    }

    fetchCollectionDetail(selectedCollectionId).catch((detailError) => {
      setError(String(detailError))
    })
  }, [fetchCollectionDetail, selectedCollectionId])

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>加载 RAG 管理页...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">RAG 管理</h1>
          <p className="mt-1 text-muted-foreground">
            用已注册 embeddings 服务做向量化，用 MiniMemory 图结构做主题增强，给其他模型提供统一检索上下文。
          </p>
        </div>
        <Button variant="outline" onClick={() => refreshAll(selectedCollectionId, selectedCollectionId)}>
          <RefreshCw className="mr-2 h-4 w-4" />
          刷新
        </Button>
      </div>

      {error && (
        <Card className="border-red-200">
          <CardContent className="pt-6 text-sm text-red-600">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              集合数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{collections.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />
              文档数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {collections.reduce((sum, item) => sum + item.documentCount, 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSearch className="h-4 w-4" />
              Chunk 数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {collections.reduce((sum, item) => sum + item.chunkCount, 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              Embeddings 服务
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{embeddingServices.length}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              在线 {embeddingServices.filter((item) => item.status === 'online').length} 个
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                新建 RAG 集合
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateCollection}>
                <div className="space-y-2">
                  <Label htmlFor="collection-name">集合名称</Label>
                  <Input
                    id="collection-name"
                    value={collectionForm.name}
                    onChange={(event) =>
                      setCollectionForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="例如：团队知识库"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="collection-description">描述</Label>
                  <Textarea
                    id="collection-description"
                    value={collectionForm.description}
                    onChange={(event) =>
                      setCollectionForm((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="说明集合的用途和服务对象"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Embeddings 服务</Label>
                  <Select
                    value={collectionForm.embeddingServiceId}
                    onValueChange={(value) =>
                      setCollectionForm((current) => ({ ...current, embeddingServiceId: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="自动选择在线服务" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">自动选择在线服务</SelectItem>
                      {embeddingServices.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name} · {service.model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="chunk-size">Chunk 大小</Label>
                    <Input
                      id="chunk-size"
                      type="number"
                      min="200"
                      value={collectionForm.chunkSize}
                      onChange={(event) =>
                        setCollectionForm((current) => ({ ...current, chunkSize: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="chunk-overlap">Chunk 重叠</Label>
                    <Input
                      id="chunk-overlap"
                      type="number"
                      min="0"
                      value={collectionForm.chunkOverlap}
                      onChange={(event) =>
                        setCollectionForm((current) => ({ ...current, chunkOverlap: event.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>向量度量</Label>
                    <Select
                      value={collectionForm.metric}
                      onValueChange={(value) =>
                        setCollectionForm((current) => ({ ...current, metric: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cosine">cosine</SelectItem>
                        <SelectItem value="l2">l2</SelectItem>
                        <SelectItem value="ip">ip</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="graph-relation">图关系名</Label>
                    <Input
                      id="graph-relation"
                      value={collectionForm.graphRelation}
                      onChange={(event) =>
                        setCollectionForm((current) => ({ ...current, graphRelation: event.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="embedding-space">向量空间名</Label>
                  <Input
                    id="embedding-space"
                    value={collectionForm.embeddingSpace}
                    onChange={(event) =>
                      setCollectionForm((current) => ({ ...current, embeddingSpace: event.target.value }))
                    }
                    placeholder="留空则自动生成"
                  />
                </div>
                <Button className="w-full" type="submit" disabled={submittingCollection}>
                  {submittingCollection ? '创建中...' : '创建集合'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>集合列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {collections.length === 0 && (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  还没有 RAG 集合，先在上面创建一个。
                </div>
              )}
              {collections.map((collection) => {
                const isActive = collection.id === selectedCollectionId
                return (
                  <button
                    key={collection.id}
                    type="button"
                    onClick={() => setSelectedCollectionId(collection.id)}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      isActive ? 'border-primary bg-accent' : 'hover:bg-accent/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{collection.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {collection.documentCount} 文档 · {collection.chunkCount} chunks
                        </div>
                      </div>
                      <div
                        className={`mt-1 h-2.5 w-2.5 rounded-full ${
                          collection.enabled ? 'bg-green-500' : 'bg-gray-400'
                        }`}
                      />
                    </div>
                    {collection.description && (
                      <div className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {collection.description}
                      </div>
                    )}
                  </button>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle>{selectedCollection?.name || '未选择集合'}</CardTitle>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {selectedCollection
                      ? `${selectedCollection.description || '暂无描述'}`
                      : '从左侧选择一个集合，查看文档与检索结果。'}
                  </div>
                </div>
                {selectedCollection && (
                  <Button
                    variant="outline"
                    onClick={() => handleDeleteCollection(selectedCollection.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除集合
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {selectedCollection ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border p-4">
                    <div className="text-xs text-muted-foreground">Embeddings</div>
                    <div className="mt-1 font-medium">
                      {selectedEmbeddingService?.name || selectedCollection.embeddingServiceId || '自动选择'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {selectedEmbeddingService?.host}:{selectedEmbeddingService?.port}
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-xs text-muted-foreground">向量空间</div>
                    <div className="mt-1 break-all text-sm font-medium">{selectedCollection.embeddingSpace}</div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-xs text-muted-foreground">图增强</div>
                    <div className="mt-1 font-medium">{selectedCollection.graphRelation}</div>
                    <div className="mt-1 text-xs text-muted-foreground break-all">
                      {selectedCollection.graphRootNode}
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-xs text-muted-foreground">更新时间</div>
                    <div className="mt-1 font-medium">{formatTimestamp(selectedCollection.updatedAt)}</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  还没有可查看的集合。
                </div>
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="documents">
            <TabsList>
              <TabsTrigger value="documents">文档入库</TabsTrigger>
              <TabsTrigger value="retrieve">检索测试</TabsTrigger>
            </TabsList>

            <TabsContent value="documents">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      入库文档
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form className="space-y-4" onSubmit={handleIngestDocument}>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="doc-title">标题</Label>
                          <Input
                            id="doc-title"
                            value={documentForm.title}
                            onChange={(event) =>
                              setDocumentForm((current) => ({ ...current, title: event.target.value }))
                            }
                            placeholder="例如：部署说明"
                            disabled={!selectedCollection}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="doc-source">来源</Label>
                          <Input
                            id="doc-source"
                            value={documentForm.source}
                            onChange={(event) =>
                              setDocumentForm((current) => ({ ...current, source: event.target.value }))
                            }
                            placeholder="URL、路径或业务系统名"
                            disabled={!selectedCollection}
                          />
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="doc-tags">标签</Label>
                          <Input
                            id="doc-tags"
                            value={documentForm.tags}
                            onChange={(event) =>
                              setDocumentForm((current) => ({ ...current, tags: event.target.value }))
                            }
                            placeholder="例如：运维, 发布, nginx"
                            disabled={!selectedCollection}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="doc-graph-nodes">图节点</Label>
                          <Input
                            id="doc-graph-nodes"
                            value={documentForm.graphNodes}
                            onChange={(event) =>
                              setDocumentForm((current) => ({ ...current, graphNodes: event.target.value }))
                            }
                            placeholder="例如：部署, 故障排查"
                            disabled={!selectedCollection}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="doc-content">正文</Label>
                        <Textarea
                          id="doc-content"
                          value={documentForm.content}
                          onChange={(event) =>
                            setDocumentForm((current) => ({ ...current, content: event.target.value }))
                          }
                          placeholder="直接粘贴要向量化和入库的文本内容"
                          rows={14}
                          disabled={!selectedCollection}
                          required
                        />
                      </div>
                      <Button type="submit" disabled={!selectedCollection || submittingDocument}>
                        {submittingDocument ? '入库中...' : '写入向量库'}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>已入库文档</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {documents.length === 0 && (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        当前集合还没有文档。
                      </div>
                    )}
                    {documents.map((document) => (
                      <div key={document.id} className="rounded-lg border p-4">
                        <div className="font-medium">{document.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {document.chunkCount} chunks · {formatTimestamp(document.updatedAt)}
                        </div>
                        {document.source && (
                          <div className="mt-2 break-all text-xs text-muted-foreground">{document.source}</div>
                        )}
                        {document.contentPreview && (
                          <div className="mt-3 text-sm text-muted-foreground line-clamp-4">
                            {document.contentPreview}
                          </div>
                        )}
                        {(document.tags.length > 0 || document.graphNodes.length > 0) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {document.tags.map((tag) => (
                              <span key={`tag-${document.id}-${tag}`} className="rounded-full border px-2 py-1 text-xs">
                                #{tag}
                              </span>
                            ))}
                            {document.graphNodes.map((node) => (
                              <span
                                key={`graph-${document.id}-${node}`}
                                className="rounded-full border px-2 py-1 text-xs text-blue-600"
                              >
                                图:{node}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="retrieve">
              <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>检索参数</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form className="space-y-4" onSubmit={handleRetrieve}>
                      <div className="space-y-2">
                        <Label htmlFor="retrieve-query">问题</Label>
                        <Textarea
                          id="retrieve-query"
                          value={retrieveForm.query}
                          onChange={(event) =>
                            setRetrieveForm((current) => ({ ...current, query: event.target.value }))
                          }
                          placeholder="例如：如何为 llama.cpp 网关配置 embeddings 能力？"
                          rows={5}
                          disabled={!selectedCollection}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="retrieve-topk">Top K</Label>
                        <Input
                          id="retrieve-topk"
                          type="number"
                          min="1"
                          max="20"
                          value={retrieveForm.topK}
                          onChange={(event) =>
                            setRetrieveForm((current) => ({ ...current, topK: event.target.value }))
                          }
                          disabled={!selectedCollection}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="retrieve-tags">标签过滤</Label>
                        <Input
                          id="retrieve-tags"
                          value={retrieveForm.tags}
                          onChange={(event) =>
                            setRetrieveForm((current) => ({ ...current, tags: event.target.value }))
                          }
                          placeholder="例如：运维, embeddings"
                          disabled={!selectedCollection}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="retrieve-graph">图节点增强</Label>
                        <Input
                          id="retrieve-graph"
                          value={retrieveForm.graphNodes}
                          onChange={(event) =>
                            setRetrieveForm((current) => ({ ...current, graphNodes: event.target.value }))
                          }
                          placeholder="例如：部署, 故障排查"
                          disabled={!selectedCollection}
                        />
                      </div>
                      <Button type="submit" disabled={!selectedCollection || retrieving}>
                        {retrieving ? '检索中...' : '执行检索'}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>可供模型使用的上下文</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        value={retrievalResult?.contextText || ''}
                        readOnly
                        rows={14}
                        placeholder="执行检索后，这里会生成可直接拼接到 prompt 的上下文片段。"
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>召回片段</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!retrievalResult?.hits?.length && (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                          还没有检索结果。
                        </div>
                      )}
                      {retrievalResult?.hits?.map((hit, index) => (
                        <div key={hit.chunkId} className="rounded-lg border p-4">
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div className="font-medium">
                              [{index + 1}] {hit.title || hit.documentId}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              score: {hit.score === null ? 'N/A' : hit.score.toFixed(6)}
                            </div>
                          </div>
                          {hit.source && (
                            <div className="mt-2 break-all text-xs text-muted-foreground">{hit.source}</div>
                          )}
                          <div className="mt-3 whitespace-pre-wrap text-sm">{hit.content}</div>
                          {(hit.tags.length > 0 || hit.graphNodes.length > 0) && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {hit.tags.map((tag) => (
                                <span key={`${hit.chunkId}-tag-${tag}`} className="rounded-full border px-2 py-1 text-xs">
                                  #{tag}
                                </span>
                              ))}
                              {hit.graphNodes.map((node) => (
                                <span
                                  key={`${hit.chunkId}-graph-${node}`}
                                  className="rounded-full border px-2 py-1 text-xs text-blue-600"
                                >
                                  图:{node}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
