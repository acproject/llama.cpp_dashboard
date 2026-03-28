import { NextRequest, NextResponse } from 'next/server'
import { appendTaskEvent, getTask, listTaskEvents } from '@/lib/tasks'

function normalizeLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 100
  const rounded = Math.floor(parsed)
  return Math.max(1, Math.min(200, rounded))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const task = await getTask(id)
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      )
    }

    const { searchParams } = new URL(request.url)
    const limit = normalizeLimit(searchParams.get('limit'))
    const events = await listTaskEvents(id, limit)

    return NextResponse.json({
      success: true,
      data: {
        items: events,
        total: events.length,
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
    const event = await appendTaskEvent(id, body)

    return NextResponse.json({
      success: true,
      data: event,
    })
  } catch (error) {
    const message = String(error)
    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes('not found') ? 404 : 500 }
    )
  }
}
