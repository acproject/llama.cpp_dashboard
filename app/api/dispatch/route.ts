import { NextRequest, NextResponse } from 'next/server'
import { DispatchConfig, LlamaService, DispatchRequest } from '@/types'
import { getJson, setJson, keys, KEYS } from '@/lib/minimemory'
import { 
  getDispatchConfig, 
  setDispatchConfig, 
  selectService,
  selectServiceByCapability,
  calculateLoadDistribution,
} from '@/lib/orchestrator'

// GET /api/dispatch - Get dispatch configuration
export async function GET() {
  try {
    const config = await getDispatchConfig()
    
    const serviceKeys = await keys('llama:service:*')
    const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))
    const services: LlamaService[] = []
    
    for (const id of serviceIds) {
      const service = await getJson<LlamaService>(KEYS.SERVICE(id))
      if (service) services.push(service)
    }
    
    const replicaGroup = (config.replicaGroup || '').trim()
    const online = services.filter(s => s.status === 'online' && s.enabled !== false)
    const groupOnline = replicaGroup
      ? online.filter(s => (s.replicaGroup || '').trim() === replicaGroup)
      : []
    const distribution = replicaGroup ? calculateLoadDistribution(groupOnline) : {}
    
    return NextResponse.json({
      success: true,
      data: {
        config,
        distribution,
        onlineServices: replicaGroup ? groupOnline.length : online.length,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// PUT /api/dispatch - Update dispatch configuration
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const config = await setDispatchConfig(body)
    
    return NextResponse.json({
      success: true,
      data: config,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// POST /api/dispatch - Select a service for dispatching
export async function POST(request: NextRequest) {
  try {
    const body: DispatchRequest = await request.json()
    
    const serviceKeys = await keys('llama:service:*')
    const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))
    const services: LlamaService[] = []
    
    for (const id of serviceIds) {
      const service = await getJson<LlamaService>(KEYS.SERVICE(id))
      if (service) services.push(service)
    }
    
    const config = await getDispatchConfig()
    const replicaGroup = (config.replicaGroup || '').trim()
    const candidateServices = replicaGroup
      ? services.filter(s => (s.replicaGroup || '').trim() === replicaGroup)
      : services

    // Select service
    let selectedService: LlamaService | null = null
    
    if (body.capability) {
      selectedService = await selectServiceByCapability(candidateServices, body.capability)
    } else {
      selectedService = await selectService(candidateServices)
    }
    
    if (!selectedService) {
      return NextResponse.json(
        { success: false, error: 'No available service' },
        { status: 503 }
      )
    }
    
    return NextResponse.json({
      success: true,
      data: {
        selectedService,
        endpoint: `http://${selectedService.host}:${selectedService.port}`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
