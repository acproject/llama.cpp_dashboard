import { NextRequest, NextResponse } from 'next/server'
import { RunRecord, SessionRecord } from '@/types'
import { getJson, keys, KEYS } from '@/lib/minimemory'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getJson<SessionRecord>(KEYS.SESSION(id))

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      )
    }

    const [currentRun, lastRun, routeKeys] = await Promise.all([
      session.currentRunId ? getJson<RunRecord>(KEYS.RUN(session.currentRunId)) : Promise.resolve(null),
      session.lastRunId ? getJson<RunRecord>(KEYS.RUN(session.lastRunId)) : Promise.resolve(null),
      keys(`agent:session-route:${id}:*`).catch(() => [] as string[]),
    ])

    const limitedRouteKeys = routeKeys.slice(0, 20)
    const routesRaw = await Promise.all(
      limitedRouteKeys.map((key) => getJson<Record<string, unknown>>(key))
    )
    const routes = routesRaw
      .map((value, index) => ({ key: limitedRouteKeys[index], value }))
      .filter((item) => Boolean(item.value))

    return NextResponse.json({
      success: true,
      data: {
        session,
        currentRun: currentRun || undefined,
        lastRun: lastRun || undefined,
        routes,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
