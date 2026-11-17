import { displayText } from './displayText'
// Helpers for the Triage tab. Pure functions, so they test without a browser.

import { clockIn } from './zone'

export const RULES = {
  'E-P1': '趋势支持该原因',
  'E-P2': '尚无已知原因可解释',
  'E-C1': '与上述原因相关',
  'E-D1': '趋势未出现该异常',
}

export function ruleLabel(rule) {
  if (!rule) return '未触发研判规则'
  if (RULES[rule]) return RULES[rule]
  return rule
}

export function writerLabel(writer) {
  if (!writer) return ''
  if (writer.kind === 'haiku') return '由 Claude Haiku 生成'
  if (writer.kind === 'template') return '根据模板生成'
  return `生成方式 ${writer.name}`
}

// The per item label: an item can fall back to the template even when Haiku is on
export function itemWriter(name) {
  if (!name) return ''
  return /haiku/i.test(name) ? 'Claude Haiku' : '本地模板'
}

export function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}

export function seconds(s) {
  if (s == null) return '--'
  if (s < 1) return '单个采样点'
  if (s < 120) return `${Math.round(s)} 秒`
  if (s < 7200) return `${Math.round(s / 60)} 分钟`
  return `${(s / 3600).toFixed(1)} 小时`
}

export function valueText(evidence, v) {
  if (v == null) return '--'
  if (evidence.kind === 'discrete') return v >= evidence.limit ? '告警' : '正常'
  const digits = evidence.units === 'Hz' ? 2 : evidence.units === '' ? 3 : 1
  return `${Number(v).toFixed(digits)}${evidence.units ? ` ${evidence.units}` : ''}`
}

export function limitText(evidence) {
  if (evidence.kind === 'discrete') return '开关量告警'
  const op = evidence.direction === 'HIGH' ? '>' : '<'
  return `阈值 ${op} ${valueText(evidence, evidence.limit)}`
}

// One line on what the trend shows, for under the chart
// A generator frequency dip, measured by the agent from its load step.
// Times are shown in the viewer's zone with the server's labels.
export function dipText(dip, zone = { name: 'UTC', labels: {} }) {
  if (!dip) return null
  if (!dip.measured) {
    const rated = /rated ([\d.]+) Hz/.exec(dip.reason || '')?.[1]
    const why = dip.reason?.startsWith('no transfer') ? `未观察到切至应急电源，且发电机未达到额定 ${rated} Hz`
      : rated ? `启动后未观察到发电机达到额定 ${rated} Hz` : '负载投入后缺少有效频率样本'
    return `无法测量频率暂降，${why}。`
  }
  const at = iso => clockIn(iso, zone.name, zone.labels)
  const step = dip.basis === 'ats_transfer' ? '电源切换' : '首次达到额定频率'
  const head = `负载投入 ${at(dip.step_at)}（${step}），最低 ${dip.worst_hz.toFixed(2)} Hz`
  if (dip.below_nominal_hz <= dip.tolerance_hz)
    return `${head}，与额定 ${dip.nominal_hz} Hz 的偏差始终在 ${dip.tolerance_hz} Hz 以内。`
  const deviation = `，比额定 ${dip.nominal_hz} Hz 低 ${dip.below_nominal_hz.toFixed(2)} Hz`
  return dip.recovered_at
    ? `${head}${deviation}，${at(dip.recovered_at)} 回到 ±${dip.tolerance_hz} Hz 范围，耗时 ${seconds(dip.recovery_s)}。`
    : `${head}${deviation}，截至 ${at(dip.window_end)} 仍未回到 ±${dip.tolerance_hz} Hz 范围。`
}

export function evidenceText(evidence, zone) {
  if (evidence?.dip) return dipText(evidence.dip, zone)
  if (!evidence || !evidence.samples_past_limit) return '趋势样本中未见越限。'
  const count = `${evidence.samples} 个样本中有 ${evidence.samples_past_limit} 个`
  const span = evidence.seconds_past_limit > 0 ? `，持续 ${seconds(evidence.seconds_past_limit)}` : ''
  if (evidence.kind === 'discrete') return `${count}处于告警状态${span}。`
  return `${count}越限（${limitText(evidence)}）${span}，极值 ${valueText(evidence, evidence.worst_value)}。`
}

export function localizedReason(item, zone) {
  const ev = item.evidence
  const equipment = item.point.split('/').at(-2) || item.point
  const subject = `${equipment} · ${displayText(item.label)}`
  if (!ev?.first_past_limit) return `${subject}。依据告警日志排序，缺少对应的越限趋势。`
  const at = t => clockIn(t, zone.name, zone.labels)
  const period = `${at(ev.first_past_limit)} 至 ${at(ev.last_past_limit)}`
  const detail = item.rule === 'E-P2' ? '在该时段尚未发现可解释此异常的上游原因。'
    : item.consequences.length ? `关联 ${item.consequences.length} 条后续告警。` : '该时段未识别到后续关联告警。'
  return `${subject}，趋势在 ${period} 记录到异常。${detail}`
}

export function localizedStep(item) {
  const match = /^[A-Za-z]+ ([^:]+): (.+)$/.exec(item.next_step || '')
  if (match && displayText(match[2]) !== match[2]) return `${match[1]}：${displayText(match[2])}`
  if (/[\u4e00-\u9fff]/.test(item.next_step || '')) return item.next_step
  return `核对 ${item.point} 的现场读数、事件记录和对应趋势。`
}

export function localizedFinding(reason) {
  const count = /none of the (\d+) trend samples/.exec(reason || '')?.[1]
  if (count) return `日志记录了告警，事发前后 ${count} 个趋势样本均未越限。`
  if (/unknown|not mapped|unmapped|unsupported/i.test(reason || '')) return '当前规则无法识别该测点或信号，需要人工核实。'
  if (/trend|samples?|series/i.test(reason || '')) return '趋势依据不足，需要核实采样记录。'
  return '现有记录未能形成确定的诊断结论，请复核该测点。'
}


export function reduction(counts) {
  if (!counts) return null
  const flood = counts.journal_entries ?? counts.alarm_events
  const items = counts.ranked_items
  return { flood, items, ratio: items ? flood / items : null }
}

// What the flood was made of, in the journal's own terms
export function floodParts(counts) {
  const alarms = counts.alarms_annunciated ?? 0
  const returns = Math.max((counts.alarm_transitions ?? counts.alarm_events ?? 0) - alarms, 0)
  const records = counts.operator_records ?? 0
  return `${alarms} 条告警、${returns} 条恢复、${records} 条确认和抑制记录`
}

// Geometry for the evidence chart: a line, the alarm limit, and the stretch
// the point spent past it. Returns null when there is nothing to draw.
export function chartGeometry(evidence, width, height, pad = { left: 6, right: 6, top: 8, bottom: 8 }) {
  const pts = (evidence?.trend || []).map(([t, v]) => [new Date(t).getTime(), v])
  if (pts.length < 2) return null
  const t0 = pts[0][0]
  const t1 = pts[pts.length - 1][0]
  const values = pts.map(p => p[1]).concat([evidence.limit])
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (evidence.kind === 'discrete') { lo = 0; hi = 1 }
  const room = (hi - lo) * 0.12 || 1
  lo -= room
  hi += room
  const x = t => pad.left + ((t - t0) / (t1 - t0 || 1)) * (width - pad.left - pad.right)
  const y = v => pad.top + (1 - (v - lo) / (hi - lo)) * (height - pad.top - pad.bottom)
  const step = evidence.kind === 'discrete'
  let path = ''
  pts.forEach(([t, v], i) => {
    if (i === 0) path += `M${x(t).toFixed(1)},${y(v).toFixed(1)}`
    else if (step) path += `H${x(t).toFixed(1)}V${y(v).toFixed(1)}`
    else path += `L${x(t).toFixed(1)},${y(v).toFixed(1)}`
  })
  let shade = null
  if (evidence.first_past_limit && evidence.last_past_limit) {
    const a = x(new Date(evidence.first_past_limit).getTime())
    const b = x(new Date(evidence.last_past_limit).getTime())
    shade = { x: a, width: Math.max(b - a, 2) }
  }
  return { path, limitY: y(evidence.limit), shade, t0, t1 }
}

// Decide when to offer the button: an event just finished and the
// operator has not triaged it yet.
export function eventFinished(previous, current) {
  return !!(previous && !current)
}

// How the agent's writer is graded, from its eval suite (GET /api/triage/grading)
export const GRADERS = {
  grounding: '证据一致性',
  root_cause: '主要原因',
  escalation: '告警升级',
  uncertainty: '不确定性',
  next_step: '建议核对事项',
  format: '格式',
}

export function graderTitle(name) {
  return GRADERS[name] || capitalize((name || '').replace(/_/g, ' '))
}

export function passRate(rate) {
  if (rate == null) return '--'
  const pct = rate * 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

// A React key for one entry. Since agent 0.3.1 one point can have two
// episodes, each its own card, so a point alone is not unique: an entry with
// a start time is keyed by point and start, and one without (the nuisance
// and unresolved lists carry none) by point and its place in the list.
export function episodeKey(entry, index) {
  return entry.start ? `${entry.point}@${entry.start}` : `${entry.point}#${index}`
}
