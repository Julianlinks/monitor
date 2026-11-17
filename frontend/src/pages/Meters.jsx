import { displayText } from '../lib/displayText'
import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useFeed } from '../services/LiveFeed'
import { alarmsByMeter } from '../services/feed'
import { api } from '../services/api'
import { PriorityBadge, StateBadge } from '../components/Badges'
import { ANNUNCIATED } from '../lib/alarms'
import { num } from '../lib/format'

const PERIODS = ['1h', '24h', '7d']
const TREND_FIELDS = {
  power_kw: { label: '有功功率', unit: 'kW' },
  load_pct: { label: '负载率', unit: '%' },
  voltage: { label: '电压', unit: 'V' },
  current: { label: '电流', unit: 'A' },
  power_factor: { label: '功率因数', unit: '' },
  frequency: { label: '频率', unit: 'Hz' },
}

function Gauge({ value, min, max, warn, crit, low = false, label, unit, digits = 1 }) {
  const v = value ?? min
  const pct = Math.min(1, Math.max(0, (v - min) / (max - min)))
  const size = 120
  const r = 46
  const cx = size / 2
  const cy = size / 2 + 6
  const start = -210
  const sweep = 240
  const pt = (deg, rad) => [cx + rad * Math.cos((deg * Math.PI) / 180), cy + rad * Math.sin((deg * Math.PI) / 180)]
  const arc = (a0, a1) => {
    const [x0, y0] = pt(a0, r)
    const [x1, y1] = pt(a1, r)
    return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0},1 ${x1},${y1}`
  }
  const abnormal = value != null && (low ? value <= crit : value >= crit)
  const caution = value != null && !abnormal && (low ? value <= warn : value >= warn)
  const cls = abnormal ? 'g-crit' : caution ? 'g-warn' : 'g-ok'
  return (
    <div className="gauge">
      <svg viewBox={`0 0 ${size} ${size - 10}`} className={`gauge-svg ${cls}`}>
        <path d={arc(start, start + sweep)} className="gauge-track" />
        {pct > 0.002 && <path d={arc(start, start + sweep * pct)} className="gauge-fill" />}
        <text x={cx} y={cy + 4} textAnchor="middle" className="gauge-value">{num(value, digits)}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" className="gauge-unit">{unit}</text>
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  )
}

export default function Meters() {
  const { meters, meterById, readings, alarms } = useFeed()
  const [params, setParams] = useSearchParams()
  const selectedId = meterById[params.get('id')] ? params.get('id') : meters[0]?.id
  const meter = meterById[selectedId]
  const r = readings[selectedId] || {}
  const [period, setPeriod] = useState('1h')
  const [field, setField] = useState('power_kw')
  const [history, setHistory] = useState([])
  const byMeter = useMemo(() => alarmsByMeter(alarms), [alarms])
  const meterAlarms = alarms.filter(a => a.meter_id === selectedId && ANNUNCIATED.includes(a.state))

  useEffect(() => {
    if (!selectedId) return undefined
    let cancelled = false
    api.getMeterHistory(selectedId, period)
      .then(rows => { if (!cancelled) setHistory(rows) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedId, period])

  if (!meter) return null
  const nomV = meter.nominal_voltage
  const tf = TREND_FIELDS[field]
  const tickFmt = t => new Date(t * 1000).toLocaleTimeString('zh-CN', period === '7d'
    ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

  return (
    <div className="page meters-layout">
      <aside className="meter-list">
        <label className="meter-select-label" htmlFor="meter-select">设备</label>
        <select id="meter-select" className="meter-select" value={selectedId} onChange={e => setParams({ id: e.target.value })}>
          {meters.map(m => <option key={m.id} value={m.id}>{displayText(m.name)}</option>)}
        </select>
        <div className="meter-buttons">
          {meters.map(m => {
            const a = byMeter[m.id]
            return (
              <button key={m.id} className={`meter-btn${m.id === selectedId ? ' active' : ''}`} onClick={() => setParams({ id: m.id })}>
                <span className={`status-dot ${a ? `p${a.priority}` : (readings[m.id]?.voltage ?? 0) < 1 ? 'off' : 'ok'}`} />
                <span className="meter-btn-name">{displayText(m.name)}</span>
                <span className="mono muted small">{m.id}</span>
              </button>
            )
          })}
        </div>
      </aside>

      <div className="meter-detail">
        <div className="page-header">
          <div>
            <h2>{displayText(meter.name)} <span className="mono muted">{meter.id}</span></h2>
            <p>{displayText(meter.description)}</p>
          </div>
          <span className="status-chip">{displayText(r.status) || '--'}</span>
        </div>

        <div className="card gauges">
          <Gauge label="电压" unit="V" value={r.voltage} min={nomV * 0.8} max={nomV * 1.2} warn={nomV * 1.05} crit={nomV * 1.1} digits={1} />
          <Gauge label="负载率" unit="% 额定值" value={r.load_pct} min={0} max={100} warn={80} crit={90} digits={1} />
          <Gauge label="功率因数" unit="" value={r.power_factor} min={0.6} max={1} warn={0.88} crit={0.85} low digits={3} />
          <Gauge label="频率" unit="Hz" value={r.frequency} min={58} max={62} warn={60.3} crit={60.5} digits={2} />
        </div>

        <div className="kpi-grid">
          {[
            ['有功功率', num(r.power_kw), 'kW'],
            ['电流', num(r.current), 'A'],
            ['需量（15 分钟）', num(r.demand_kw), 'kW'],
            ['累计电量', r.energy_kwh != null ? Math.round(r.energy_kwh).toLocaleString('zh-CN') : '--', 'kWh'],
            ...(meter.type === 'ups' ? [
              ['电池电量', num(r.battery_soc), '%'],
              ['剩余续航', num(r.battery_runtime_min, 0), 'min'],
            ] : []),
            ...(meter.type === 'ats' ? [['开关位置', r.position === 'GENERATOR' ? '应急电源' : '正常', '']] : []),
            ...(meter.type === 'generator' ? [['发动机状态', r.gen_state ? displayText(r.gen_state[0] + r.gen_state.slice(1).toLowerCase()) : '--', '']] : []),
          ].map(([label, value, unit]) => (
            <div key={label} className="stat-card">
              <div className="stat-card-label">{label}</div>
              <div className="stat-card-value small-value">{value}{unit && <span className="stat-card-unit">{unit}</span>}</div>
            </div>
          ))}
        </div>

        {meterAlarms.length > 0 && (
          <div className="card">
            <div className="card-head"><h3>此设备的告警</h3></div>
            <ul className="mini-alarms">
              {meterAlarms.map(a => (
                <li key={a.tag} className={`p${a.priority}`}>
                  <PriorityBadge priority={a.priority} compact />
                  <div className="mini-alarm-text">{displayText(a.message)}</div>
                  <StateBadge state={a.state} priority={a.priority} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card">
          <div className="card-head wrap">
            <h3>历史趋势</h3>
            <div className="trend-controls">
              <select value={field} onChange={e => setField(e.target.value)} aria-label="趋势参数">
                {Object.entries(TREND_FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <div className="seg">
                {PERIODS.map(p => (
                  <button key={p} className={`seg-btn${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>{displayText(p)}</button>
                ))}
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={history} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="epoch" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tickFmt}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} minTickGap={40} />
              <YAxis domain={['auto', 'auto']} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
              <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8 }}
                labelFormatter={t => new Date(t * 1000).toLocaleString('zh-CN')} formatter={v => [`${v} ${tf.unit}`, tf.label]} />
              {field === 'load_pct' && <ReferenceLine y={80} stroke="var(--p3)" strokeDasharray="4 4" />}
              <Line type="monotone" dataKey={field} stroke="var(--accent)" dot={false} strokeWidth={1.6} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
