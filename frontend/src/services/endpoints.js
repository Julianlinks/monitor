// Both the installed build and the dev server use the local API by default.
export function resolveApiUrl(env = import.meta.env) {
  const configured = (env.VITE_API_URL || '').trim().replace(/\/+$/, '')
  return configured
}

export const API_URL = resolveApiUrl()

export function buildWsUrl(apiUrl = API_URL, loc = globalThis.location) {
  if (apiUrl) return apiUrl.replace(/^http/, 'ws') + '/ws/live'
  if (!loc) return '/ws/live'
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc.host}/ws/live`
}

export const WS_URL = buildWsUrl()
