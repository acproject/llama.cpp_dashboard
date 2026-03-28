import { NextRequest, NextResponse } from 'next/server'
import { claimNextTask } from '@/lib/tasks'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const result = await claimNextTask(body)

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    const message = String(error)
    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes('required') ? 400 : 500 }
    )
  }
}
