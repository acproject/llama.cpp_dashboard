import { NextRequest, NextResponse } from 'next/server'
import { existsKey, getJson, getNumber, keys, KEYS, setJson } from '@/lib/minimemory'

const RUN_TTL_MS = 24 * 60 * 60 * 1000

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const max = Math.max(50, Math.min(500, Number(url.searchParams.get('max')) || 200))

    const activeKeys = [
      ...(await keys('agent:service:active:*')),
      ...(await keys('agent:runtime:active:*')),
    ]
    const activeValues = await Promise.all(activeKeys.map((key) => getNumber(key)))
    const negativeActiveKeys = activeKeys.filter((key, index) => activeValues[index] < 0)
    await Promise.all(negativeActiveKeys.map((key) => setJson(key, 0)))

    const listKeys = [
      KEYS.RUNS_RECENT,
      ...(await keys('agent:runs:by-agent:*')),
      ...(await keys('agent:runs:by-session:*')),
      ...(await keys('agent:runs:by-service:*')),
    ]

    const cleanedLists = await Promise.all(
      listKeys.map(async (listKey) => {
        const existing = (await getJson<string[]>(listKey)) || []
        const limited = existing.slice(0, max)
        const exists = await Promise.all(limited.map((id) => existsKey(KEYS.RUN(id))))
        const filtered = limited.filter((_, index) => exists[index])
        const changed = filtered.length !== limited.length
        if (changed) {
          await setJson(listKey, filtered, RUN_TTL_MS)
        }
        return { key: listKey, before: limited.length, after: filtered.length, changed }
      })
    )

    const taskListKeys = [
      ...(await keys('task:children:*')),
      ...(await keys('task:queue:*')),
    ]
    const cleanedTaskLists = await Promise.all(
      taskListKeys.map(async (listKey) => {
        const existing = (await getJson<string[]>(listKey)) || []
        const limited = existing.slice(0, max)
        const exists = await Promise.all(limited.map((id) => existsKey(KEYS.TASK(id))))
        const filtered = limited.filter((_, index) => exists[index])
        const changed = filtered.length !== limited.length
        if (changed) {
          await setJson(listKey, filtered, RUN_TTL_MS)
        }
        return { key: listKey, before: limited.length, after: filtered.length, changed }
      })
    )

    return NextResponse.json({
      success: true,
      data: {
        fixedNegativeActiveCounters: negativeActiveKeys.length,
        cleanedLists,
        cleanedTaskLists,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
