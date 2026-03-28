import { NextRequest, NextResponse } from 'next/server'
import { RunEvent, RunRecord, TaskRuntimeView } from '@/types'
import { getJson, getJsonList, KEYS } from '@/lib/minimemory'
import { getTaskRuntimeSnapshot } from '@/lib/tasks'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const run = await getJson<RunRecord>(KEYS.RUN(id))

    if (!run) {
      return NextResponse.json(
        { success: false, error: 'Run not found' },
        { status: 404 }
      )
    }

    const eventsRaw = await getJsonList<RunEvent>(KEYS.RUN_EVENTS(id), 0, -1)
    const events = [...eventsRaw].reverse()
    const taskSnapshot = await getTaskRuntimeSnapshot({
      runId: id,
      limit: 200,
    })
    const tasks = taskSnapshot.items
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt) satisfies TaskRuntimeView[]

    return NextResponse.json({
      success: true,
      data: {
        run,
        events,
        tasks,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
