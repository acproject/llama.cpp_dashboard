import { NextRequest, NextResponse } from 'next/server'
import { deleteRagCollection, getRagCollection, listRagDocuments, updateRagCollection } from '@/lib/rag'

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

    const documents = await listRagDocuments(id)

    return NextResponse.json({
      success: true,
      data: {
        collection,
        documents,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const collection = await updateRagCollection(id, body || {})

    return NextResponse.json({
      success: true,
      data: collection,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteRagCollection(id)

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
