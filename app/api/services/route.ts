import { NextRequest, NextResponse } from 'next/server'
import { LlamaService } from '@/types'
import { 
  getJson, 
  setJson, 
  deleteKey, 
  keys, 
  KEYS 
} from '@/lib/minimemory'
import { generateId } from '@/lib/utils'

// GET /api/services - List all services
export async function GET() {
  try {
    const serviceKeys = await keys('llama:service:*')
    const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))
    const services: LlamaService[] = []
    
    for (const id of serviceIds) {
      const service = await getJson<LlamaService>(KEYS.SERVICE(id))
      if (service) {
        services.push(service)
      }
    }
    
    return NextResponse.json({
      success: true,
      data: services,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/services - Create a new service
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const id = generateId()
    const now = Date.now()
    
    const service: LlamaService = {
      id,
      name: body.name || `llama-server-${id.slice(0, 8)}`,
      description: body.description,
      host: body.host || 'localhost',
      port: body.port || 8080,
      model: body.model || 'unknown',
      modelPath: body.modelPath,
      apiKey: body.apiKey,
      enabled: body.enabled !== false,
      supportsTools: Boolean(body.supportsTools),
      replicaGroup: typeof body.replicaGroup === 'string' ? body.replicaGroup : undefined,
      primaryReplica: Boolean(body.primaryReplica),
      status: 'offline',
      weight: body.weight || 1,
      capabilities: body.capabilities || [],
      createdAt: now,
      updatedAt: now,
      metadata: body.metadata,
    }
    
    // Save service
    await setJson(KEYS.SERVICE(id), service)
    
    return NextResponse.json({
      success: true,
      data: service,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
