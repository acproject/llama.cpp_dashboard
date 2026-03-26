import { NextResponse } from 'next/server'
import { getJson, keys, KEYS } from '@/lib/minimemory'
import { LlamaService } from '@/types'

export async function GET() {
  const serviceKeys = await keys('llama:service:*')
  const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))

  const services: LlamaService[] = []
  for (const id of serviceIds) {
    const service = await getJson<LlamaService>(KEYS.SERVICE(id))
    if (service) services.push(service)
  }

  const models = services
    .filter(s => s.status === 'online')
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

