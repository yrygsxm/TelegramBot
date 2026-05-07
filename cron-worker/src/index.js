export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url)
      const force = url.searchParams.get('force') === '1'
      const result = await triggerWeeklyReport(env, { force })
      return new Response(result.body, { status: result.status })
    } catch (error) {
      console.error('manual trigger failed', error)
      return new Response(`Trigger failed: ${error.message}`, { status: 500 })
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(triggerWeeklyReport(env, { force: false, scheduledTime: controller.scheduledTime }))
  },
}

async function triggerWeeklyReport(env, { force = false, scheduledTime = Date.now() } = {}) {
  if (!env.REPORT_ENDPOINT) {
    throw new Error('Missing REPORT_ENDPOINT')
  }
  if (!env.REPORT_SECRET) {
    throw new Error('Missing REPORT_SECRET')
  }

  const endpoint = new URL(env.REPORT_ENDPOINT)
  if (force) {
    endpoint.searchParams.set('force', '1')
  }
  endpoint.searchParams.set('scheduled_at', String(scheduledTime))

  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.REPORT_SECRET}`,
    },
  })

  const body = await response.text()
  if (!response.ok) {
    throw new Error(body || `HTTP ${response.status}`)
  }

  return {
    status: 200,
    body,
  }
}
