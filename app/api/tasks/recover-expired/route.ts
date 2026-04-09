import { NextRequest, NextResponse } from 'next/server'
import { recoverExpiredTasks } from '@/lib/tasks'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const result = await recoverExpiredTasks(body)

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
