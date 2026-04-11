import { NextRequest, NextResponse } from 'next/server'
import { searchEvidence } from '@/lib/evidence'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await searchEvidence(body || {})

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
