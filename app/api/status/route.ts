import { NextResponse } from 'next/server'
import { ping, testConnection } from '@/lib/minimemory'
import { smembers, getJson, KEYS } from '@/lib/minimemory'
import { LlamaService } from '@/types'

// GET /api/status - Get overall system status
export async function GET() {
  try {
    // Test MiniMemory connection
    const connectionTest = await testConnection()
    
    // Get services count
    const serviceIds = await smembers(KEYS.SERVICES)
    const services: LlamaService[] = []
    
    for (const id of serviceIds) {
      const service = await getJson<LlamaService>(KEYS.SERVICE(id))
      if (service) services.push(service)
    }
    
    const onlineCount = services.filter(s => s.status === 'online').length
    
    return NextResponse.json({
      success: true,
      data: {
        minimemory: {
          connected: connectionTest.success,
          error: connectionTest.error,
        },
        services: {
          total: services.length,
          online: onlineCount,
          offline: services.length - onlineCount,
        },
        uptime: process.uptime(),
        timestamp: Date.now(),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
