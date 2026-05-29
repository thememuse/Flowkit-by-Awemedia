import { useState, useEffect } from 'react'
import { fetchAPI } from './client'

interface HealthStatus {
  status: string
  version: string
  extension_connected: boolean
  flow_key_present?: boolean
  ws: {
    connected: boolean
    connects: number
    disconnects: number
    uptime_s: number | null
  }
}

/**
 * Hook to periodically poll the agent health endpoint.
 * Returns extension connection status and overall health.
 */
export function useHealthStatus() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function poll() {
      try {
        const data = await fetchAPI<HealthStatus>('/health')
        if (mounted) {
          setHealth(data)
          setError(null)
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Health check failed')
        }
      }
    }

    // Poll immediately, then every 5 seconds
    poll()
    const interval = setInterval(poll, 5000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return {
    health,
    error,
    extensionConnected: health?.extension_connected ?? false,
    flowKeyPresent: health?.flow_key_present ?? false,
    agentHealthy: health?.status === 'ok',
  }
}
