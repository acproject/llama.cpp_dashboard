import { NextRequest, NextResponse } from 'next/server'
import { RunRecord, RunStatus } from '@/types'
import { getJson, getJsonList, KEYS } from '@/lib/minimemory'

function normalizeLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 50
  const rounded = Math.floor(parsed)
  return Math.max(1, Math.min(200, rounded))
}

async function loadRunRecords(runIds: string[]): Promise<RunRecord[]> {
  const results = await Promise.all(runIds.map((id) => getJson<RunRecord>(KEYS.RUN(id))))
  return results.filter((item): item is RunRecord => Boolean(item))
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId') || undefined
    const serviceId = searchParams.get('serviceId') || undefined
    const status = (searchParams.get('status') as RunStatus | null) || undefined
    const model = searchParams.get('model') || undefined
    const limit = normalizeLimit(searchParams.get('limit'))

    const baseKey = sessionId && !serviceId
      ? KEYS.RUNS_BY_SESSION(sessionId)
      : serviceId && !sessionId
        ? KEYS.RUNS_BY_SERVICE(serviceId)
        : KEYS.RUNS_RECENT

    const scanCount = Math.min(500, Math.max(50, limit * 6))
    const runIds = await getJsonList<string>(baseKey, 0, scanCount - 1)
    const runsRaw = await loadRunRecords(runIds)

    const filtered = runsRaw.filter((run) => {
      if (sessionId && run.sessionId !== sessionId) return false
      if (serviceId && run.serviceId !== serviceId) return false
      if (status && run.status !== status) return false
      if (model && run.model !== model) return false
      return true
    })

    filtered.sort((a, b) => b.startedAt - a.startedAt)

    return NextResponse.json({
      success: true,
      data: {
        items: filtered.slice(0, limit),
        total: filtered.length,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
