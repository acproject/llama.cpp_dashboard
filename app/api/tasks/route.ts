import { NextRequest, NextResponse } from 'next/server'
import { TaskRecord, TaskStatus } from '@/types'
import { createTask, getTaskRuntimeSnapshot } from '@/lib/tasks'

function normalizeLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 50
  const rounded = Math.floor(parsed)
  return Math.max(1, Math.min(200, rounded))
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = (searchParams.get('status') as TaskStatus | null) || undefined
    const parentTaskId = searchParams.get('parentTaskId') || undefined
    const queueName = searchParams.get('queueName') || undefined
    const assignedAgentId = searchParams.get('assignedAgentId') || undefined
    const requestedAgentId = searchParams.get('requestedAgentId') || undefined
    const runId = searchParams.get('runId') || undefined
    const sessionId = searchParams.get('sessionId') || undefined
    const limit = normalizeLimit(searchParams.get('limit'))

    const snapshot = await getTaskRuntimeSnapshot({
      status,
      parentTaskId,
      queueName,
      assignedAgentId,
      requestedAgentId,
      runId,
      sessionId,
      limit,
    })

    return NextResponse.json({
      success: true,
      data: {
        items: snapshot.items,
        total: snapshot.total,
        queues: snapshot.queues,
        summary: snapshot.summary,
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
    const task = await createTask(body)

    return NextResponse.json({
      success: true,
      data: task satisfies TaskRecord,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
