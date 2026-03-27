import { NextResponse } from 'next/server'
import { LlamaService, RunRecord, ServiceRuntimeStats } from '@/types'
import { getJson, getJsonList, getNumber, keys, KEYS } from '@/lib/minimemory'

export async function GET() {
  try {
    const serviceKeys = await keys('llama:service:*')
    const serviceIds = serviceKeys.map((key) => key.slice('llama:service:'.length))
    const servicesRaw = await Promise.all(
      serviceIds.map((id) => getJson<LlamaService>(KEYS.SERVICE(id)))
    )
    const services = servicesRaw.filter((item): item is LlamaService => Boolean(item))

    const items = await Promise.all(
      services.map(async (service) => {
        const [activeRequests, totalRequests, failedRequests, serviceRunIds] = await Promise.all([
          getNumber(KEYS.SERVICE_ACTIVE(service.id)),
          getNumber(KEYS.SERVICE_TOTAL(service.id)),
          getNumber(KEYS.SERVICE_ERROR(service.id)),
          getJsonList<string>(KEYS.RUNS_BY_SERVICE(service.id), 0, 0),
        ])

        const lastRunId = serviceRunIds[0]
        const lastRun = lastRunId ? await getJson<RunRecord>(KEYS.RUN(lastRunId)) : null

        const stats: ServiceRuntimeStats = {
          serviceId: service.id,
          activeRequests,
          totalRequests,
          failedRequests,
          lastRunAt: lastRun?.startedAt,
          lastErrorAt: lastRun?.status === 'failed' ? (lastRun.completedAt || lastRun.startedAt) : undefined,
        }

        return stats
      })
    )

    return NextResponse.json({
      success: true,
      data: {
        items,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
