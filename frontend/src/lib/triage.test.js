import { describe, expect, it } from 'vitest'
import {
  chartGeometry, dipText, episodeKey, eventFinished, evidenceText, floodParts, graderTitle, itemWriter, passRate, reduction,
  ruleLabel, seconds, valueText, writerLabel,
} from './triage'
import outage from '../test/triage-outage.json'
import outageUtc from '../test/triage-outage-utc.json'

const cause = outage.triage.items[0]

describe('triage helpers', () => {
  it('names the rules and the writer', () => {
    expect(ruleLabel('E-P1')).toBe('趋势支持该原因')
    expect(ruleLabel('R-P3')).toBe('R-P3')
    expect(writerLabel({ kind: 'template' })).toBe('根据模板生成')
    expect(writerLabel({ kind: 'haiku', name: 'Claude Haiku' })).toBe('由 Claude Haiku 生成')
    expect(itemWriter('Claude Haiku')).toBe('Claude Haiku')
    expect(itemWriter('template, no model')).toBe('本地模板')
  })

  it('formats durations and values', () => {
    expect(seconds(0.4)).toBe('单个采样点')
    expect(seconds(108)).toBe('108 秒')
    expect(seconds(600)).toBe('10 分钟')
    expect(valueText({ kind: 'discrete', limit: 0.5 }, 1)).toBe('告警')
    expect(valueText({ kind: 'low', units: 'Hz' }, 58.8)).toBe('58.80 Hz')
  })

  it('states the trend evidence in one line', () => {
    expect(evidenceText(cause.evidence)).toMatch(/^\d+ 个样本中有 \d+ 个处于告警状态，持续 /)
    expect(evidenceText({ samples_past_limit: 0 })).toMatch(/未见越限/)
    const sag = { kind: 'low', direction: 'LOW', limit: 432, units: 'V', samples: 12, samples_past_limit: 3,
      seconds_past_limit: 6, worst_value: 410.3 }
    expect(evidenceText(sag)).toBe('12 个样本中有 3 个越限（阈值 < 432.0 V），持续 6 秒，极值 410.3 V。')
  })

  it('breaks the flood into its parts', () => {
    expect(floodParts(outage.triage.counts)).toBe('6 条告警、6 条恢复、12 条确认和抑制记录')
  })

  it('measures the reduction from the flood', () => {
    const r = reduction(outage.triage.counts)
    expect(r.flood).toBe(24)
    expect(r.items).toBe(1)
    expect(r.ratio).toBe(24)
  })

  it('draws the trend, the limit, and the time past it', () => {
    const g = chartGeometry(cause.evidence, 320, 72)
    expect(g.path.startsWith('M')).toBe(true)
    expect(g.path).toContain('H') // a status point is drawn as steps
    expect(g.limitY).toBeGreaterThan(0)
    expect(g.limitY).toBeLessThan(72)
    expect(g.shade.width).toBeGreaterThan(2)
    expect(chartGeometry({ trend: [] }, 320, 72)).toBeNull()
  })

  it('offers triage only when an event has just finished', () => {
    const sc = { name: 'utility_outage', label: 'Utility outage' }
    expect(eventFinished(sc, null)).toBe(true)
    expect(eventFinished(null, sc)).toBe(false)
    expect(eventFinished(sc, sc)).toBe(false)
    expect(eventFinished(null, null)).toBe(false)
  })
})

describe('frequency dip', () => {
  const dipOf = data => data.triage.items[0].consequences.find(c => c.signal === 'frequency_low').evidence.dip

  it('reports the load step dip in the viewer zone, labeled', () => {
    const ny = dipText(dipOf(outage), outage.zone)
    expect(ny).toMatch(/^负载投入 \d\d:\d\d:\d\d EDT（电源切换），最低 58\.\d\d Hz，比额定 60 Hz 低 1\.\d\d Hz，\d\d:\d\d:\d\d EDT 回到 ±0\.5 Hz 范围，耗时 2 秒。$/)
    const utc = dipText(dipOf(outageUtc), outageUtc.zone)
    expect(utc).toMatch(/^负载投入 \d\d:\d\d:\d\d UTC.*\d\d:\d\d:\d\d UTC 回到 .*耗时 2 秒。$/)
  })

  it('never shows a crank value', () => {
    const text = dipText(dipOf(outage), outage.zone)
    expect(text).not.toMatch(/(^|[^\d.])(0|20|40)\.00 Hz/)
  })

  it('shows no number when nothing was measured', () => {
    const none = { measured: false, reason: 'no transfer to the emergency source and the generator never reached its rated 60 Hz in this export' }
    const t = dipText(none)
    expect(t).toBe('无法测量频率暂降，未观察到切至应急电源，且发电机未达到额定 60 Hz。')
    expect(t).not.toMatch(/\d+\.\d\d Hz/)
  })

  it('says when the frequency never came back', () => {
    const dip = { ...dipOf(outageUtc), recovered_at: null, recovery_s: null }
    expect(dipText(dip, outageUtc.zone)).toMatch(/截至 \d\d:\d\d:\d\d UTC 仍未回到 ±0\.5 Hz 范围。$/)
  })

  it('is what the consequence line shows', () => {
    const c = outage.triage.items[0].consequences.find(x => x.signal === 'frequency_low')
    expect(evidenceText(c.evidence, outage.zone)).toBe(dipText(c.evidence.dip, outage.zone))
  })
})

describe('grading', () => {
  it('names each grader in plain words', () => {
    expect(graderTitle('root_cause')).toBe('主要原因')
    expect(graderTitle('next_step')).toBe('建议核对事项')
    expect(graderTitle('something_new')).toBe('Something new')
  })

  it('writes a pass rate as a percentage', () => {
    expect(passRate(1)).toBe('100%')
    expect(passRate(0.9483)).toBe('94.8%')
    expect(passRate(null)).toBe('--')
  })
})

describe('episodeKey', () => {
  it('tells two episodes on one point apart by their start', () => {
    const a = episodeKey({ point: 'SIM-DC/UPS-B/ONBATT', start: '2026-09-21T14:18:20+00:00' }, 0)
    const b = episodeKey({ point: 'SIM-DC/UPS-B/ONBATT', start: '2026-09-21T14:28:20+00:00' }, 1)
    expect(a).not.toBe(b)
    expect(a).toBe('SIM-DC/UPS-B/ONBATT@2026-09-21T14:18:20+00:00')
  })

  it('falls back to the place in the list when there is no start', () => {
    expect(episodeKey({ point: 'P' }, 0)).not.toBe(episodeKey({ point: 'P' }, 1))
  })
})

