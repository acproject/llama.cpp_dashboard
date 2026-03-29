import { NextRequest, NextResponse } from 'next/server'
import { getRagCollection, ingestRagDocument, listRagDocuments } from '@/lib/rag'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toRagDocumentErrorStatus(message: string): number {
  if (message.includes('RAG 集合不存在')) return 404
  if (message.includes('不能为空') || message.includes('切块后为空') || message.includes('已禁用')) return 400
  if (message.includes('没有找到可用的 embeddings 服务')) return 503
  if (message.includes('Embeddings 服务调用失败') || message.includes('Embeddings 返回数量异常')) return 502
  return 500
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const collection = await getRagCollection(id)

    if (!collection) {
      return NextResponse.json(
        { success: false, error: 'RAG 集合不存在' },
        { status: 404 }
      )
    }

    const items = await listRagDocuments(id)

    return NextResponse.json({
      success: true,
      data: {
        collection,
        items,
      },
    })
  } catch (error) {
    const message = toErrorMessage(error)
    return NextResponse.json(
      { success: false, error: message },
      { status: toRagDocumentErrorStatus(message) }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const result = await ingestRagDocument(id, body || {})

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    const message = toErrorMessage(error)
    return NextResponse.json(
      { success: false, error: message },
      { status: toRagDocumentErrorStatus(message) }
    )
  }
}
