import { displayText } from '../lib/displayText'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, ExternalLink, GraduationCap, ListOrdered, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, exportJournalUrl } from '../services/api'
import { PriorityBadge } from '../components/Badges'
import { clockIn, dateTimeIn, viewerZone, zoneLabel } from '../lib/zone'
import {
  localizedReason, localizedStep, localizedFinding, chartGeometry, episodeKey, evidenceText, floodParts, graderTitle, itemWriter, passRate, reduction,
  ruleLabel, writerLabel,
} from '../lib/triage'

const CHART_W = 320
const CHART_H = 72

export function EvidenceChart({ evidence }) {
  const g = chartGeometry(evidence, CHART_W, CHART_H)
  if (!g) return <div className="tri-chart tri-chart-empty">暂无趋势样本</div>
  return (
    <svg className="tri-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none"
      role="img" aria-label="趋势数据及告警阈值">
      {g.shade && <rect className="tri-past" x={g.shade.x} y="0" width={g.shade.width} height={CHART_H} />}
      <line className="tri-limit" x1="0" x2={CHART_W} y1={g.limitY} y2={g.limitY} vectorEffect="non-scaling-stroke" />
      <path className="tri-line" d={g.path} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Consequences({ items, zone }) {
  const [open, setOpen] = useState(false)
  if (!items.length) {
    return <p className="muted small tri-alone">此时段内未发现相关的后续告警。</p>
  }
  return (
    <div className="tri-cq">
      <button className="tri-cq-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        展开关联的 {items.length} 条后续告警（已按原因归组）
      </button>
      {open && (
        <ul className="tri-cq-list">
          {items.map((c, i) => (
            <li key={episodeKey(c, i)}>
              <div className="tri-cq-head">
                <PriorityBadge priority={c.priority} compact />
                <span className="tri-cq-label">{displayText(c.label)}</span>
                <span className="muted small mono">{clockIn(c.start, zone.name, zone.labels)}</span>
              </div>
              <div className="muted small mono tri-point">{c.point}</div>
              <div className="small tri-cq-why">{evidenceText(c.evidence, zone)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TriageItem({ item, zone }) {
  return (
    <article className={`tri-item p${item.priority}`}>
      <header className="tri-item-head">
        <div className="tri-rank" aria-label={`排名 ${item.rank}`}>{item.rank}</div>
        <div className="tri-title">
          <div className="tri-label">{displayText(item.label)}</div>
          <div className="muted small mono tri-point">{item.point}</div>
          <div className="tri-chips">
            <PriorityBadge priority={item.priority} />
            <span className="tri-chip"><b>{item.rule}</b> {ruleLabel(item.rule)}</span>
            {item.consequences.length > 0 && <span className="tri-chip tri-chip-cause">主要原因</span>}
          </div>
        </div>
      </header>

      <div className="tri-say">
        <p className="tri-say-label">判断依据与影响</p>
        <p>{localizedReason(item, zone)}</p>
      </div>
      <div className="tri-say tri-say-step">
        <p className="tri-say-label">建议核对事项</p>
        <p>{localizedStep(item)}</p>
      </div>

      <figure className="tri-evidence">
        <figcaption className="tri-say-label">趋势依据</figcaption>
        <EvidenceChart evidence={item.evidence} />
        <p className="small muted">{evidenceText(item.evidence, zone)}</p>
      </figure>

      <Consequences items={item.consequences} zone={zone} />

      <footer className="tri-foot">
        <span className={`tri-writer ${/haiku/i.test(item.written_by) ? 'haiku' : 'template'}`}>
          {itemWriter(item.written_by)}
        </span>
        <span className="muted small">{dateTimeIn(item.start, zone.name, zone.labels)}</span>
      </footer>
    </article>
  )
}

// The agent's own eval results for the writer the dashboard runs. Every number
// comes from the pinned agent package through GET /api/triage/grading.
export function GradingPanel({ grading, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen)
  if (!grading) return null
  return (
    <div className="card tri-grading">
      <button className="tri-cq-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <GraduationCap size={15} /> 研判效果评估
      </button>
      {open && (
        <div className="tri-grading-body">
          <p className="muted small">
            使用已知答案的合成案例评估 {displayText(grading.writer)} 生成的结果。通过全部检查的案例数为 {grading.cases_passed} ／ {grading.cases_run} ，评估日期{' '}
            {grading.date}，研判程序版本 {grading.agent_version}。样本均为模拟数据。
          </p>
          <ul className="tri-grades">
            {grading.graders.map(g => (
              <li key={g.name} title={displayText(g.what)}>
                <span className="tri-grade-name">{graderTitle(g.name)}</span>
                <span className="tri-grade-rate mono">{passRate(g.rate)}</span>
                <span className="muted small">{g.passed} ／ {g.applicable}</span>
              </li>
            ))}
          </ul>
          <a className="tri-grading-link small" href={grading.showcase} target="_blank" rel="noreferrer">
            查看各项检查及失败案例 <ExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  )
}

// The zone the agent wrote its text in, with the labels for its offsets
function zoneOf(data) {
  return { name: data.triage.time_zone?.name || data.zone?.name || 'UTC', labels: data.zone?.labels || {} }
}

export function ZoneNote({ zone, at }) {
  if (!zone) return null
  const label = at ? zoneLabel(at, zone.name, zone.labels) : 'UTC'
  return (
    <span className="muted small tri-zone">
      显示时区 {zone.name}{label === zone.name ? '' : ` (${label})`}
    </span>
  )
}

function downloadResult(result) {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '研判原始结果.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function TriageResult({ data }) {
  const result = data.triage
  const zone = zoneOf(data)
  const counts = result.counts
  const r = reduction(counts)
  return (
    <>
      <div className="kpi-grid">
        <div className="stat-card tone-p2">
          <div className="stat-card-label">原始告警记录</div>
          <div className="stat-card-value">{r.flood}</div>
          <div className="stat-card-sub">日志构成 {floodParts(counts)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">研判条目</div>
          <div className="stat-card-value">{r.items}</div>
          <div className="stat-card-sub">
            {counts.consequences_collapsed} 条已归到对应原因下{counts.nuisance ? `, ${counts.nuisance} 条疑似干扰` : ''}{counts.unresolved ? `, ${counts.unresolved} 条待核实` : ''}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">归并比例</div>
          <div className="stat-card-value">{r.ratio ? `${r.ratio.toFixed(0)} 倍` : '--'}</div>
          <div className="stat-card-sub">{r.flood} 条记录归并为 {r.items}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">说明生成方式</div>
          <div className="stat-card-value small-value">{result.writer.kind === 'haiku' ? 'Claude Haiku' : '模板'}</div>
          <div className="stat-card-sub">{writerLabel(result.writer)}。输出均经相同规则检查。</div>
        </div>
      </div>

      {result.items.length === 0 && (
        <div className="card empty-state"><p>此时段内没有需要进一步处理的条目。</p></div>
      )}
      <div className="tri-list">
        {result.items.map((item, i) => <TriageItem key={episodeKey(item, i)} item={item} zone={zone} />)}
      </div>

      {(result.nuisance.length > 0 || result.unresolved.length > 0) && (
        <div className="card">
          <div className="card-head"><h3>其他待核查记录</h3></div>
          <ul className="tri-aside">
            {result.nuisance.map((n, i) => (
              <li key={episodeKey(n, i)}><span className="mono small">{n.point}</span> <span className="muted small">{localizedFinding(n.finding)}</span></li>
            ))}
            {result.unresolved.map((u, i) => (
              <li key={episodeKey(u, i)}><span className="mono small">{u.point}</span> <span className="muted small">{localizedFinding(u.reason)}</span></li>
            ))}
          </ul>
        </div>
      )}

      <button className="btn btn-ghost btn-sm" onClick={() => downloadResult(result)}>下载研判原始结果</button>
      <p className="muted small tri-note">
        <ShieldCheck size={13} /> 研判仅分析此时段内的日志和趋势副本。中文摘要根据规则和原始证据展示。程序版本 {result.agent_version}，耗时{' '}
        {data.elapsed_ms} ms{data.cached ? '（时段未变，使用已保存结果）' : ''}.
      </p>
    </>
  )
}

export default function Triage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [timeZone] = useState(viewerZone)
  const [event, setEvent] = useState(undefined)
  const [zone, setZone] = useState({ name: timeZone, labels: {} })
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [grading, setGrading] = useState(null)
  const autoRan = useRef(false)

  const loadEvent = useCallback(() => {
    api.getTriageEvent(timeZone)
      .then(r => { setEvent(r.event); if (r.zone) setZone(r.zone) })
      .catch(() => setEvent(null))
  }, [timeZone])

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.runTriage({ time_zone: timeZone })
      setData(res)
      setEvent(e => ({ ...(e || {}), ...res.event }))
      if (res.zone) setZone(res.zone)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [timeZone])

  useEffect(() => { loadEvent() }, [loadEvent])
  useEffect(() => { api.getTriageGrading().then(setGrading).catch(() => setGrading(null)) }, [])

  // Arriving from the "Triage this event" button runs straight away
  useEffect(() => {
    if (location.state?.run && !autoRan.current) {
      autoRan.current = true
      navigate(location.pathname, { replace: true, state: null })
      run()
    }
  }, [location.state, location.pathname, navigate, run])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>告警研判</h2>
          <p>分析最近一次事件的告警和趋势，将相关告警归组并按优先级排列。</p>
        </div>
      </div>

      <div className="card tri-controls">
        <div className="tri-event">
          <ListOrdered size={18} className="brand-icon" />
          {event === undefined && <span className="muted">正在查找最近事件…</span>}
          {event === null && <span className="muted">暂无告警事件，可在“演示说明”中触发。</span>}
          {event && (
            <span>
              最近事件的首条告警 <span className="mono">{dateTimeIn(event.first_alarm, zone.name, zone.labels)}</span>
              {event.alarms ? <span className="muted">, {event.alarms} 条告警</span> : null}
              <br /><ZoneNote zone={zone} at={event.first_alarm} />
            </span>
          )}
        </div>
        <div className="tri-actions">
          <button className="btn btn-primary" onClick={run} disabled={busy || !event}>
            {busy ? <RefreshCw size={14} className="spin" /> : data ? <RefreshCw size={14} /> : <Play size={14} />}
            {busy ? '正在研判…' : data ? '重新研判' : '研判此事件'}
          </button>
          {event && (
            <a className="btn btn-ghost" href={exportJournalUrl(event.start, event.end)} download>
              <Download size={14} /> 导出事件日志
            </a>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>

      {data && <TriageResult data={data} />}

      {!data && !busy && (
        <div className="card tri-intro">
          <p>
            市电中断时，UPS 转为电池供电，发电机启动，转换开关切换电源。负载投入时还可能出现频率暂降。本页结合事件前后的告警和趋势，展示可能原因、关联告警及进一步核查事项。
          </p>
          <p className="muted small">
            本机默认根据每条记录的依据生成模板说明。研判只读取数据；模型生成方式需要服务端另外配置。
          </p>
        </div>
      )}

      <GradingPanel grading={grading} />
    </div>
  )
}
