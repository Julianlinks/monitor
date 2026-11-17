import { displayText } from '../lib/displayText'
import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Clock, HelpCircle } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { api } from '../services/api'
import { PriorityBadge, StateBadge } from '../components/Badges'
import StateLegend from '../components/StateLegend'
import { ANNUNCIATED, NEEDS_ACK, EVENT_LABELS, PRIORITY, STATES } from '../lib/alarms'
import { alarmValue, setpointText, dateTimeOf, ago, until, timeOf } from '../lib/format'
import { getOperator } from '../lib/operator'

const SHELVE_OPTIONS = [5, 15, 60]
const TABS = [
  { key: 'active', label: '告警列表' },
  { key: 'shelved', label: '已暂搁' },
  { key: 'suppressed', label: '已抑制' },
  { key: 'history', label: '告警日志' },
  { key: 'database', label: '告警规则库' },
]

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function ShelveForm({ alarm, onDone, onCancel }) {
  const [minutes, setMinutes] = useState(15)
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.shelve(alarm.tag, minutes, reason || '演示操作暂搁', getOperator())
      onDone()
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <form className="shelve-form" onSubmit={submit}>
      <div className="shelve-label">暂搁时长</div>
      <div className="seg">
        {SHELVE_OPTIONS.map(m => (
          <button type="button" key={m} className={`seg-btn${minutes === m ? ' active' : ''}`} onClick={() => setMinutes(m)}>
            {m} 分钟
          </button>
        ))}
      </div>
      <input type="text" placeholder="暂搁原因（将记入日志）" value={reason} maxLength={200}
        onChange={e => setReason(e.target.value)} aria-label="暂搁原因" />
      <div className="shelve-actions">
        <button type="submit" className="btn btn-sm btn-primary">暂搁</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>取消</button>
      </div>
      {error && <p className="form-error">{error}</p>}
      <p className="muted small">暂搁有时限，到期后告警将自动返回列表。</p>
    </form>
  )
}

function AlarmRow({ alarm, now }) {
  const [open, setOpen] = useState(false)
  const [shelving, setShelving] = useState(false)
  const [error, setError] = useState(null)
  const needsAck = NEEDS_ACK.includes(alarm.state)

  const act = useCallback(async (fn) => {
    setError(null)
    try { await fn() } catch (e) { setError(e.message) }
  }, [])

  return (
    <div className={`alarm-row p${alarm.priority} state-${alarm.state.toLowerCase()}`}>
      <div className="alarm-main">
        <button className="alarm-expand" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="详情">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="alarm-cell alarm-time">
          <span className="mono">{timeOf(alarm.activated_at || alarm.shelved_at)}</span>
          <span className="muted small">{ago(alarm.activated_at || alarm.shelved_at, now)}</span>
        </div>
        <div className="alarm-cell alarm-desc">
          <div className="alarm-msg">{displayText(alarm.message)}</div>
          <div className="muted small"><span className="mono">{alarm.tag}</span>, {displayText(alarm.meter_name)}</div>
          {alarm.state === 'SUPPRESSED' && <div className="muted small">{displayText(alarm.suppress_reason)}</div>}
        </div>
        <div className="alarm-cell alarm-val">
          <span className="mono">{alarmValue(alarm)}</span>
          <span className="muted small">{alarm.kind === 'DISCRETE' ? '开关量信号' : `阈值 ${setpointText(alarm)}`}</span>
        </div>
        <div className="alarm-cell alarm-prio"><PriorityBadge priority={alarm.priority} /></div>
        <div className="alarm-cell alarm-state"><StateBadge state={alarm.state} priority={alarm.priority} /></div>
        <div className="alarm-cell alarm-actions">
          {needsAck && (
            <button className="btn btn-sm btn-ack" onClick={() => act(() => api.acknowledge(alarm.tag, getOperator()))}>
              确认告警
            </button>
          )}
          {ANNUNCIATED.includes(alarm.state) && (
            <button className="btn btn-sm btn-ghost" onClick={() => setShelving(s => !s)}>暂搁</button>
          )}
          {alarm.state === 'SHELVED' && (
            <>
              <span className="muted small"><Clock size={12} /> {until(alarm.shelved_until, now)} 后到期</span>
              <button className="btn btn-sm btn-ghost" onClick={() => act(() => api.unshelve(alarm.tag, getOperator()))}>
                解除暂搁
              </button>
            </>
          )}
        </div>
      </div>
      {shelving && (
        <ShelveForm alarm={alarm} onDone={() => setShelving(false)} onCancel={() => setShelving(false)} />
      )}
      {error && <p className="form-error">{error}</p>}
      {open && (
        <dl className="alarm-details">
          <div><dt>可能影响</dt><dd>{displayText(alarm.consequence)}</dd></div>
          <div><dt>处置建议</dt><dd>{displayText(alarm.response)}</dd></div>
          <div><dt>触发值</dt><dd className="mono">{alarmValue(alarm, alarm.alarm_value)}</dd></div>
          <div><dt>当前值</dt><dd className="mono">{alarmValue(alarm)}</dd></div>
          {alarm.ack_at && <div><dt>已确认</dt><dd>{dateTimeOf(alarm.ack_at)} 操作人 {displayText(alarm.ack_by)}</dd></div>}
          {alarm.rtn_at && <div><dt>已恢复正常</dt><dd>{dateTimeOf(alarm.rtn_at)}</dd></div>}
          {alarm.shelve_reason && <div><dt>已暂搁</dt><dd>{alarm.shelve_reason}，操作人 {displayText(alarm.shelved_by)}，截止 {timeOf(alarm.shelved_until)}</dd></div>}
          {alarm.suppress_reason && <div><dt>抑制条件</dt><dd>{displayText(alarm.suppress_reason)}</dd></div>}
        </dl>
      )}
    </div>
  )
}

function AlarmList({ alarms, empty, now }) {
  if (alarms.length === 0) return <div className="empty-state"><p>{empty}</p></div>
  return (
    <div className="alarm-list">
      <div className="alarm-list-head">
        <span /><span>时间</span><span>告警</span><span>数值</span><span>优先级</span><span>状态</span><span>操作</span>
      </div>
      {alarms.map(a => <AlarmRow key={a.tag} alarm={a} now={now} />)}
    </div>
  )
}

function Journal({ refreshKey }) {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('ALL')
  useEffect(() => {
    let cancelled = false
    api.getAlarmHistory(300).then(r => { if (!cancelled) setRows(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [refreshKey])

  if (!rows) return <div className="empty-state"><p>正在加载日志…</p></div>
  const shown = filter === 'ALL' ? rows : rows.filter(r => r.event === filter)
  return (
    <>
      <div className="seg journal-filter">
        {['ALL', 'ALARM', 'ACK', 'RTN', 'SHELVE', 'SUPPRESS'].map(f => (
          <button key={f} className={`seg-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'ALL' ? '全部' : EVENT_LABELS[f]}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>时间</th><th>事件</th><th>告警</th><th>优先级</th><th>数值</th><th>变更后状态</th><th>操作人</th></tr>
          </thead>
          <tbody>
            {shown.map(e => (
              <tr key={e.id} className={`ev-${e.event.toLowerCase()}`}>
                <td className="mono nowrap">{dateTimeOf(e.timestamp)}</td>
                <td><span className={`ev-tag ev-${e.event.toLowerCase()}`}>{EVENT_LABELS[e.event] || e.event}</span></td>
                <td>
                  <div>{displayText(e.message)}</div>
                  <div className="muted small mono">{e.tag}{e.note ? `, ${displayText(e.note)}` : ''}</div>
                </td>
                <td><PriorityBadge priority={e.priority} compact /></td>
                <td className="mono nowrap">{e.value == null ? '--' : alarmValue({ unit: e.unit, kind: e.unit === '' && e.setpoint === 1 ? 'DISCRETE' : 'HI' }, e.value)}</td>
                <td className="nowrap">{STATES[e.state]?.short || e.state}</td>
                <td className="nowrap muted">{displayText(e.operator)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7} className="empty-cell">暂无日志</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

function AlarmDatabase() {
  const [defs, setDefs] = useState(null)
  useEffect(() => { api.getAlarmDefs().then(setDefs).catch(() => {}) }, [])
  if (!defs) return <div className="empty-state"><p>正在加载告警规则…</p></div>
  return (
    <>
      <p className="muted db-intro">
        每条告警规则记录触发条件、可能影响、响应优先级和处置建议。死区和延时可减少信号在阈值附近波动造成的重复告警。
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>位号</th><th>告警</th><th>阈值</th><th>死区</th><th>触发／恢复延时</th><th>优先级</th><th>处置建议</th></tr>
          </thead>
          <tbody>
            {defs.map(d => (
              <tr key={d.tag}>
                <td className="mono nowrap">{d.tag}</td>
                <td>
                  <div>{displayText(d.message)}</div>
                  {d.suppression && <div className="muted small">抑制条件 {displayText(d.suppression)}</div>}
                </td>
                <td className="mono nowrap">{setpointText(d)}</td>
                <td className="mono nowrap">{d.kind === 'DISCRETE' ? '--' : `${d.deadband} ${d.unit}`}</td>
                <td className="mono nowrap">{d.on_delay} / {d.off_delay} 个采样周期</td>
                <td><PriorityBadge priority={d.priority} /></td>
                <td className="small">{displayText(d.response)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function Alarms() {
  const { alarms, summary } = useFeed()
  const [tab, setTab] = useState('active')
  const [showHelp, setShowHelp] = useState(false)
  const now = useNow()

  const active = alarms.filter(a => ANNUNCIATED.includes(a.state))
  const shelved = alarms.filter(a => a.state === 'SHELVED')
  const suppressed = alarms.filter(a => a.state === 'SUPPRESSED')
  const counts = { active: active.length, shelved: shelved.length, suppressed: suppressed.length }
  const unackedActive = active.filter(a => NEEDS_ACK.includes(a.state))

  const ackAll = async () => {
    for (const a of unackedActive) {
      try { await api.acknowledge(a.tag, getOperator()) } catch { /* already handled */ }
    }
  }

  const rateTone = { Acceptable: '', Manageable: 'p3', 'Above target': 'p2', Flood: 'p1' }[summary?.rate_status] || ''

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>告警</h2>
          <p>按 ANSI/ISA-18.2 管理告警</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowHelp(s => !s)}>
          <HelpCircle size={14} /> {showHelp ? '收起' : '告警状态说明'}
        </button>
      </div>

      {showHelp && <div className="card help-card"><StateLegend /></div>}

      <div className="kpi-grid kpi-alarms">
        <div className={`stat-card${summary?.unacknowledged ? ` tone-p${summary.highest_unacked?.priority}` : ''}`}>
          <div className="stat-card-label">待确认</div>
          <div className="stat-card-value">{summary?.unacknowledged ?? 0}</div>
          <div className="stat-card-sub">{summary?.rtn_unack ?? 0} 条已恢复</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">各优先级告警数量</div>
          <div className="prio-counts">
            {Object.entries(PRIORITY).map(([p, info]) => (
              <div key={p} className={`prio-count ${info.cls}${summary?.by_priority?.[p] ? ' on' : ''}`}>
                <span className="mono">{summary?.by_priority?.[p] ?? 0}</span>
                <small>{info.label}</small>
              </div>
            ))}
          </div>
        </div>
        <div className={`stat-card${rateTone ? ` tone-${rateTone}` : ''}`}>
          <div className="stat-card-label">近 10 分钟告警数</div>
          <div className="stat-card-value">{summary?.alarm_rate_10min ?? 0}</div>
          <div className="stat-card-sub">{displayText(summary?.rate_status)} （演示目标约 1 条，达到 10 条标记为告警洪泛）</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">暂搁和抑制</div>
          <div className="stat-card-value">{(summary?.shelved ?? 0) + (summary?.suppressed ?? 0)}</div>
          <div className="stat-card-sub">{summary?.shelved ?? 0} 条暂搁， {summary?.suppressed ?? 0} 条按规则抑制</div>
        </div>
      </div>

      <div className="card">
        <div className="tab-bar" role="tablist">
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key}
              className={`tab-btn${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}{counts[t.key] != null && <span className="tab-count">{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        {tab === 'active' && (
          <>
            {unackedActive.length > 1 && (
              <div className="list-toolbar">
                <button className="btn btn-sm btn-ack" onClick={ackAll}>全部确认 {unackedActive.length}</button>
              </div>
            )}
            <AlarmList alarms={active} now={now}
              empty="暂无告警。可在“演示说明”中触发事件，查看告警的发生、确认和恢复。" />
          </>
        )}
        {tab === 'shelved' && <AlarmList alarms={shelved} now={now} empty="暂无暂搁告警。" />}
        {tab === 'suppressed' && (
          <AlarmList alarms={suppressed} now={now}
            empty="当前没有被抑制的告警。" />
        )}
        {tab === 'history' && <Journal refreshKey={`${summary?.alarm_rate_10min}-${alarms.length}-${summary?.unacknowledged}`} />}
        {tab === 'database' && <AlarmDatabase />}
      </div>
    </div>
  )
}
