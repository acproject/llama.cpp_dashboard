import { NextRequest, NextResponse } from 'next/server'
import { retrieveRagContext } from '@/lib/rag'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await retrieveRagContext(body || {})

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
