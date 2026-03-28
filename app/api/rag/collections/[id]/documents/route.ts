import { NextRequest, NextResponse } from 'next/server'
import { getRagCollection, ingestRagDocument, listRagDocuments } from '@/lib/rag'

export async function GET(
  request: NextRequest,
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
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
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
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
