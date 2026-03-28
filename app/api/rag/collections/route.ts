import { NextRequest, NextResponse } from 'next/server'
import { createRagCollection, listEmbeddingServices, listRagCollections } from '@/lib/rag'

export async function GET() {
  try {
    const [items, embeddingServices] = await Promise.all([
      listRagCollections(),
      listEmbeddingServices(),
    ])

    return NextResponse.json({
      success: true,
      data: {
        items,
        embeddingServices,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const collection = await createRagCollection(body || {})

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
