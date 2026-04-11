import { NextRequest, NextResponse } from 'next/server'
import { MemoryKind, MemoryRecord, MemoryScopeType } from '@/types'
import { createMemory, listMemories } from '@/lib/memory'

function normalizeLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 50
  const rounded = Math.floor(parsed)
  return Math.max(1, Math.min(200, rounded))
}

function normalizeTags(values: string[]): string[] {
  return Array.from(new Set(
    values
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean)
  ))
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const space = searchParams.get('space') || undefined
    const kind = (searchParams.get('kind') as MemoryKind | null) || undefined
    const scopeType = (searchParams.get('scopeType') as MemoryScopeType | null) || undefined
    const scopeId = searchParams.get('scopeId') || undefined
    const taskId = searchParams.get('taskId') || undefined
    const runId = searchParams.get('runId') || undefined
    const sessionId = searchParams.get('sessionId') || undefined
    const agentId = searchParams.get('agentId') || undefined
    const query = searchParams.get('query') || undefined
    const tags = normalizeTags(searchParams.getAll('tag'))
    const limit = normalizeLimit(searchParams.get('limit'))

    const items = await listMemories({
      space,
      kind,
      scopeType,
      scopeId,
      taskId,
      runId,
      sessionId,
      agentId,
      tags,
      query,
      limit,
    })

    return NextResponse.json({
      success: true,
      data: {
        items,
        total: items.length,
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
    const memory = await createMemory(body)

    return NextResponse.json({
      success: true,
      data: memory satisfies MemoryRecord,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
