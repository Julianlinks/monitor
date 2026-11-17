import { displayText } from '../lib/displayText'
import { API_URL } from './endpoints'

const BASE = `${API_URL}/api`

function requestError(detail, status) {
  if (typeof detail !== 'string') return `请求失败（${status}）`
  const translated = displayText(detail)
  if (translated !== detail) return translated
  if (/^Scenario .* is still running/.test(detail)) return '已有模拟场景在运行，请等待结束后再试。'
  if (detail.includes('nothing to acknowledge')) return '该告警的状态已变化，目前无需确认。'
  if (detail.endsWith('is not shelved')) return '该告警未被暂搁。'
  if (detail.endsWith('is shelved')) return '该告警已被暂搁。'
  if (detail.endsWith('is suppressed by design')) return '该告警已按工况规则抑制。'
  if (detail.startsWith('Shelve time must')) return '暂搁时长超出允许范围。'
  return `请求失败（${status}），请核对输入与服务日志。`
}

async function request(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(requestError(data?.detail, res.status))
    return data
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试。')
    if (error instanceof TypeError) throw new Error('无法连接本地服务。')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  health:           (timeout)         => request('/health', { timeout }),
  getConfig:        ()                => request('/config'),
  getMeterHistory:  (id, period)      => request(`/meters/${encodeURIComponent(id)}/history?period=${period}`),
  getAlarmHistory:  (limit = 200)     => request(`/alarms/history?limit=${limit}`),
  getAlarmDefs:     ()                => request('/alarms/definitions'),
  acknowledge:      (tag, operator)   => request(`/alarms/${encodeURIComponent(tag)}/acknowledge`, { method: 'POST', body: { operator } }),
  shelve:           (tag, minutes, reason, operator) =>
                      request(`/alarms/${encodeURIComponent(tag)}/shelve`, { method: 'POST', body: { minutes, reason, operator } }),
  unshelve:         (tag, operator)   => request(`/alarms/${encodeURIComponent(tag)}/unshelve`, { method: 'POST', body: { operator } }),
  triggerEvent:     (name)            => request(`/demo/events/${encodeURIComponent(name)}`, { method: 'POST' }),
  getTriageGrading: ()                => request('/triage/grading'),
  getTriageEvent:   (timeZone)        => request(`/triage/event?time_zone=${encodeURIComponent(timeZone || 'UTC')}`),
  // The first run imports the agent on the server, so allow longer than usual
  runTriage:        (window)          => request('/triage', { method: 'POST', body: window || {}, timeout: 60000 }),
}

// Download link for the alarm journal and trend history, in the triage agent's format
export function exportJournalUrl(start, end) {
  const q = new URLSearchParams({ start, end })
  return `${BASE}/export/journal?${q}`
}
