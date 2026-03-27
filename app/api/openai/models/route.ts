import { NextRequest, NextResponse } from 'next/server'
import { getJson, keys, KEYS } from '@/lib/minimemory'
import { AgentProfile, LlamaService } from '@/types'

export async function GET(request: NextRequest) {
  const serviceKeys = await keys('llama:service:*')
  const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))

  const services: LlamaService[] = []
  for (const id of serviceIds) {
    const service = await getJson<LlamaService>(KEYS.SERVICE(id))
    if (service) services.push(service)
  }

  const requestedAgentId = request.headers.get('x-agent-profile')
  const agent = requestedAgentId ? await getJson<AgentProfile>(KEYS.AGENT(requestedAgentId)) : null
  const scopedServices = !agent
    ? services
    : services.filter(service => {
        if (service.status !== 'online' || service.enabled === false) return false
        if (!agent.enabled) return false
        if (agent.serviceIds.length > 0 && !agent.serviceIds.includes(service.id)) return false
        if (agent.capabilities.length > 0 && !agent.capabilities.some(capability => service.capabilities.includes(capability))) return false
        return true
      })

  const models = scopedServices
    .filter(s => s.status === 'online' && s.enabled !== false)
    .map(s => ({
      id: s.model || `${s.host}:${s.port}`,
      object: 'model',
      owned_by: s.name,
      created: Math.floor((s.createdAt || Date.now()) / 1000),
    }))

  return NextResponse.json({
    object: 'list',
    data: models,
  })
}
