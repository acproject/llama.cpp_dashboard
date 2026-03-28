import { NextRequest, NextResponse } from 'next/server'
import { getAgentRuntimeStats, listAgents } from '@/lib/agents'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId') || undefined
    const agents = await listAgents()
    const scopedAgents = agentId
      ? agents.filter((agent) => agent.id === agentId)
      : agents
    const statsMap = await getAgentRuntimeStats(scopedAgents, { runSampleSize: 30 })
    const items = scopedAgents.map((agent) => statsMap[agent.id]).filter(Boolean)

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
