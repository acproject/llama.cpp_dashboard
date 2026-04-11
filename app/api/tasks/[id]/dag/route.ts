import { NextResponse } from 'next/server'
import { getTaskDag } from '@/lib/tasks'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const dag = await getTaskDag(id)

    return NextResponse.json({
      success: true,
      data: dag,
    })
  } catch (error) {
    const message = String(error)
    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes('not found') ? 404 : 500 }
    )
  }
}
