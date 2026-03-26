import { NextRequest, NextResponse } from 'next/server'
import { LlamaService } from '@/types'
import { getJson, setJson, deleteKey, KEYS } from '@/lib/minimemory'
import { checkLlamaServer } from '@/lib/health-check'

// GET /api/services/[id] - Get a specific service
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const service = await getJson<LlamaService>(KEYS.SERVICE(id))
    
    if (!service) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      )
    }
    
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

// PUT /api/services/[id] - Update a service
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    
    const existing = await getJson<LlamaService>(KEYS.SERVICE(id))
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      )
    }
    
    const updated: LlamaService = {
      ...existing,
      ...body,
      id, // Preserve ID
      updatedAt: Date.now(),
    }
    
    await setJson(KEYS.SERVICE(id), updated)
    
    return NextResponse.json({
      success: true,
      data: updated,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// DELETE /api/services/[id] - Delete a service
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    const existing = await getJson<LlamaService>(KEYS.SERVICE(id))
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      )
    }
    
    // Delete service data
    await deleteKey(KEYS.SERVICE(id))
    await deleteKey(KEYS.METRICS(id))
    await deleteKey(KEYS.HEALTH(id))
    
    return NextResponse.json({
      success: true,
      message: 'Service deleted',
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

// PATCH /api/services/[id] - Health check a service
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    
    const service = await getJson<LlamaService>(KEYS.SERVICE(id))
    if (!service) {
      return NextResponse.json(
        { success: false, error: 'Service not found' },
        { status: 404 }
      )
    }
    
    // Perform action based on body
    if (body.action === 'health-check') {
      const healthResult = await checkLlamaServer(service)
      const status = healthResult.healthy ? 'online' : 'error'
      
      const updated: LlamaService = {
        ...service,
        status,
        updatedAt: Date.now(),
      }
      
      await setJson(KEYS.SERVICE(id), updated)
      
      return NextResponse.json({
        success: true,
        data: {
          service: updated,
          health: healthResult,
        },
      })
    }

    if (body.action === 'set-enabled') {
      const enabled = Boolean(body.enabled)
      const updated: LlamaService = {
        ...service,
        enabled,
        updatedAt: Date.now(),
      }

      await setJson(KEYS.SERVICE(id), updated)

      return NextResponse.json({
        success: true,
        data: updated,
      })
    }
    
    return NextResponse.json(
      { success: false, error: 'Unknown action' },
      { status: 400 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
