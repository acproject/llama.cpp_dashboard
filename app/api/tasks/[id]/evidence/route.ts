import { NextRequest, NextResponse } from 'next/server'
import { listTaskEvidenceWithLinks } from '@/lib/evidence'
import { addTaskEvidence, getTask, listTaskEvidence } from '@/lib/tasks'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(_request.url)
    const include = new Set(
      searchParams
        .getAll('include')
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    )
    const task = await getTask(id)

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: include.has('memory')
        ? await listTaskEvidenceWithLinks(id)
        : await listTaskEvidence(id),
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
    const evidence = await addTaskEvidence(id, body)

    return NextResponse.json({
      success: true,
      data: evidence,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
