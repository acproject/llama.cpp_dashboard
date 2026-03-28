import { NextRequest, NextResponse } from 'next/server'
import { TaskStatus } from '@/types'
import { getTaskRuntimeSnapshot } from '@/lib/tasks'

function normalizeLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 50
  return Math.max(1, Math.min(200, Math.floor(parsed)))
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = normalizeLimit(searchParams.get('limit'))
    const status = (searchParams.get('status') as TaskStatus | null) || undefined
    const queueName = searchParams.get('queueName') || undefined
    const snapshot = await getTaskRuntimeSnapshot({ limit, status, queueName })

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
