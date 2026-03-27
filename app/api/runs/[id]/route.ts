import { NextRequest, NextResponse } from 'next/server'
import { RunEvent, RunRecord } from '@/types'
import { getJson, getJsonList, KEYS } from '@/lib/minimemory'

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

    return NextResponse.json({
      success: true,
      data: {
        run,
        events,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
