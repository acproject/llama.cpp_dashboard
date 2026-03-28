import { NextRequest, NextResponse } from 'next/server'
import { claimTask, getTask } from '@/lib/tasks'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await getTask(id)
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const result = await claimTask(id, body)

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    const message = String(error)
    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes('not found') ? 404 : message.includes('required') ? 400 : 500 }
    )
  }
}
