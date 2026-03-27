import { NextRequest, NextResponse } from 'next/server'
import { AgentProfile } from '@/types'
import { createAgentProfile, listAgents } from '@/lib/agents'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const serviceId = searchParams.get('serviceId')
    const capability = searchParams.get('capability')
    const enabled = searchParams.get('enabled')

    let agents = await listAgents()

    if (serviceId) {
      agents = agents.filter(agent => agent.serviceIds.includes(serviceId))
    }

    if (capability) {
      agents = agents.filter(agent => agent.capabilities.includes(capability))
    }

    if (enabled === 'true') {
      agents = agents.filter(agent => agent.enabled)
    }

    if (enabled === 'false') {
      agents = agents.filter(agent => !agent.enabled)
    }

    return NextResponse.json({
      success: true,
      data: agents,
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
    const agent = await createAgentProfile(body)

    return NextResponse.json({
      success: true,
      data: agent satisfies AgentProfile,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
