import { NextRequest, NextResponse } from 'next/server'
import { NginxConfig } from '@/types'
import { getNginxConfig, setNginxConfig, generateNginxConfig, syncServicesToNginx, validateNginxConfig, writeNginxFiles, readNginxLog } from '@/lib/nginx-manager'
import { getJson, keys, KEYS } from '@/lib/minimemory'
import { LlamaService } from '@/types'

// GET /api/nginx - Get Nginx configuration
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format')
    
    const config = await getNginxConfig()
    
    if (format === 'conf') {
      // Return nginx.conf format
      const confContent = generateNginxConfig(config)
      return new NextResponse(confContent, {
        headers: {
          'Content-Type': 'text/plain',
          'Content-Disposition': 'attachment; filename="nginx.conf"',
        },
      })
    }
    
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

// PUT /api/nginx - Update Nginx configuration
export async function PUT(request: NextRequest) {
  try {
    const body: Partial<NginxConfig> = await request.json()
    const config = await setNginxConfig(body)
    
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

// POST /api/nginx - Sync services to Nginx or validate config
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const actionFromQuery = searchParams.get('action')
    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const action = body?.action || actionFromQuery
    
    if (action === 'sync') {
      const serviceKeys = await keys('llama:service:*')
      const serviceIds = serviceKeys.map(k => k.slice('llama:service:'.length))
      const services: LlamaService[] = []
      
      for (const id of serviceIds) {
        const service = await getJson<LlamaService>(KEYS.SERVICE(id))
        if (service) services.push(service)
      }
      
      const config = await syncServicesToNginx(services)
      const confContent = generateNginxConfig(config)
      const onlineServices = services.filter(s => s.status === 'online')
      const written = await writeNginxFiles(config, onlineServices)
      
      return NextResponse.json({
        success: true,
        data: {
          config,
          nginxConf: confContent,
          syncedServices: onlineServices.length,
          written,
        },
      })
    }
    
    if (action === 'validate') {
      const config = await getNginxConfig()
      const confContent = generateNginxConfig(config)
      const validation = validateNginxConfig(confContent)
      
      return NextResponse.json({
        success: true,
        data: {
          valid: validation.valid,
          error: validation.error,
        },
      })
    }
    
    if (action === 'generate') {
      const config = await getNginxConfig()
      const confContent = generateNginxConfig(config)
      
      return NextResponse.json({
        success: true,
        data: {
          nginxConf: confContent,
        },
      })
    }

    if (action === 'logs') {
      const typeFromQuery = searchParams.get('type')
      const linesFromQuery = searchParams.get('lines')
      const type = (body?.type || typeFromQuery || 'error') as 'access' | 'error'
      const lines = Number(body?.lines ?? linesFromQuery ?? 200)

      try {
        const result = await readNginxLog(type, lines)
        return NextResponse.json({
          success: true,
          data: result,
        })
      } catch (error) {
        return NextResponse.json(
          { success: false, error: String(error) },
          { status: 500 }
        )
      }
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
