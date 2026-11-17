import React, { useEffect, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { API_URL } from '../services/endpoints'
import StationDiagnostics, { diagnosticBase } from './StationDiagnostics'
import './Replay.css'

const base = `${API_URL}/api/replay`
const date = t => new Date(t + 8 * 3600000).toISOString().slice(0, 23)
const clock = t => t == null ? '—' : date(t).replace('T', ' ').replace(/\.000$/, '')
const time = t => clock(t).split(' ')[1]
const keyOf = event => JSON.stringify([event.point, event.kind, event.start])
const show = (p, v) => v == null ? '—' : p.kind === '开关量' ? (v === 1 ? p.on : p.off) : `${v} ${p.unit}`.trim()

function ruleText(p) {
  if (p.rule === '无') return '仅监测数据质量'
  if (p.rule === '装置故障') return `装置上报 ${p.trigger} 时触发，${p.clear} 时恢复`
  const low = p.rule === '低限'
  return `${low ? '低于' : '高于'} ${p.trigger} ${p.unit} 持续 ${p.delay} 秒触发，${low ? '达到或高于' : '达到或低于'} ${p.clear} ${p.unit} 恢复`
}

async function call(path, options, prefix = base) {
  const res = await fetch(prefix + path, options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : `请求失败（${res.status}）`)
  }
  return res.json()
}

function ImportForm({ busy, onImport, professional }) {
  const templates = professional ? diagnosticBase : base
  return <details className="card replay-import">
    <summary>导入站点 CSV</summary>
    <form onSubmit={e => { e.preventDefault(); onImport(new FormData(e.currentTarget)) }}>
      <label>站点或批次名称<input required name="name" placeholder="例如：一号站 · 交班记录" /></label>
      <label>设备点表<input type="file" required name="points" accept=".csv" /></label>
      <label>历史采样<input type="file" required name="samples" accept=".csv" /></label>
      <button disabled={busy} className="btn btn-primary">校验并导入</button>
    </form>
    <p className="muted small">支持 UTF-8 和 GB18030。时间可含时区，无时区按北京时间。开关量用 0／1，质量填写“有效”或“无效”。规则和单位由点表定义。</p>
    {professional && <p className="muted small">专业点表可填写设备类别、信号角色、关联组。动作时限和指标限值见七类设备模板。</p>}
    <a href={templates + '/templates/points'} download>下载点表示例</a> · <a href={templates + '/templates/samples'} download>下载采样示例</a>
  </details>
}

function PointPanel({ p, frame }) {
  return <section className="card replay-detail">
    <div className="card-head"><h3>{p.device} · {p.name}</h3><span className="muted mono">{p.id}</span></div>
    <dl className="kv">
      <div><dt>当前读数</dt><dd>{show(p, p.value)}</dd></div>
      <div><dt>最后有效采样</dt><dd>{clock(p.last_valid)}</dd></div>
      <div><dt>上送方式</dt><dd>{p.mode}{p.mode === '周期' ? ` · 超过 ${p.timeout} 秒视为断数` : ' · 状态变化时上送'}</dd></div>
      <div><dt>判断规则</dt><dd>{ruleText(p)}</dd></div>
    </dl>
    {frame.history.some(row => row.value != null) ?
      <ResponsiveContainer width="100%" height={195}>
        <LineChart data={frame.history} margin={{ right: 20, top: 16, bottom: 8 }}>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" />
          <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} tickFormatter={time} minTickGap={35} />
          <YAxis domain={['auto', 'auto']} width={48} />
          <Tooltip contentStyle={{background: 'var(--bg-card)'}} labelFormatter={clock} formatter={v => [show(p, v), p.name]} />
          {p.rule !== '无' && <ReferenceLine y={p.trigger} stroke="var(--p2)" strokeDasharray="4 4" />}
          <Line type={p.kind === '开关量' ? 'stepAfter' : 'linear'} dataKey="value" name={p.name}
            stroke="var(--accent)" dot={{r: 2}} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer> : <p className="muted">截至此时还没有有效采样。</p>}
    {frame.truncated && <p className="muted small">显示最近 600 个原始采样，间断处留空。</p>}
  </section>
}

export default function Replay({ professional = false }) {
  const pendingScroll = useRef(false)
  const [sets, setSets] = useState([])
  const [dataset, setDataset] = useState(null)
  const [at, setAt] = useState(0)
  const [point, setPoint] = useState('')
  const [result, setResult] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [device, setDevice] = useState('')
  const [status, setStatus] = useState('')
  const [focus, setFocus] = useState('')
  const [eventFrom, setEventFrom] = useState('')
  const [eventUntil, setEventUntil] = useState('')

  function choose(ds, cursor = ds.start) {
    setPlaying(false); setDataset(ds); setAt(cursor); setPoint(''); setResult(null)
    setDevice(''); setStatus(''); setFocus(''); setEventFrom(''); setEventUntil(''); setError('')
  }
  useEffect(() => {
    let current = true
    call('/datasets').then(list => {
      if (current) { setSets(list); if (list.length) choose(list[0]) }
    }).catch(() => { if (current) setError('无法读取本地批次，请检查后端连接。') })
    return () => { current = false }
  }, [])
  async function load(form) {
    setBusy(true); setPlaying(false); setError(''); setNotice('')
    try {
      const ds = await call(form ? '/datasets' : '/sample', { method: 'POST', body: form || undefined }, professional && !form ? diagnosticBase : base)
      setSets(list => [ds, ...list.filter(item => item.id !== ds.id)])
      choose(ds, professional && !form ? Math.min(ds.end,ds.start + 23000) : ds.start)
      setNotice(`${ds.existing ? '已打开原有批次' : '导入成功'}。共 ${ds.point_count} 个测点、${ds.sample_count} 条采样，合并 ${ds.duplicates} 条重复记录。`)
    } catch (err) { setError(err instanceof TypeError ? '无法连接本地导入服务。' : err.message) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!dataset) return
    const controller = new AbortController()
    const query = new URLSearchParams({ at, point })
    call(`/datasets/${dataset.id}/snapshot?${query}`, { signal: controller.signal }).then(frame => {
      if (!controller.signal.aborted) setResult({ id: dataset.id, frame })
    }).catch(err => { if (!controller.signal.aborted) { setError(err instanceof TypeError ? '无法读取回放数据，请检查本地服务。' : err.message); setPlaying(false) } })
    return () => controller.abort()
  }, [dataset, at, point])
  const frame = result?.id === dataset?.id && result?.frame.at === at &&
    (!point || point === result.frame.point) ? result?.frame : null
  useEffect(() => {
    if (!playing || !frame) return
    if (at >= dataset.end) { setPlaying(false); return }
    const timer = setTimeout(() => setAt(Math.min(dataset.end, at + 1000 * speed)), 1000)
    return () => clearTimeout(timer)
  }, [playing, at, speed, dataset, frame])
  function seek(t) {
    setPlaying(false); setAt(Math.min(dataset.end, Math.max(dataset.start, t)))
  }
  function play() {
    if (!playing && at >= dataset.end) setAt(dataset.start)
    setPlaying(!playing)
  }
  const points = frame?.points || []
  const byId = Object.fromEntries(points.map(p => [p.id, p]))
  const selected = byId[frame?.point]
  useEffect(() => {
    if (pendingScroll.current && selected?.id === point) {
      pendingScroll.current = false
      document.querySelector('.replay-detail')?.scrollIntoView({block:'center'})
    }
  }, [selected, point])
  function inspect(id) {
    setPlaying(false)
    if (id === selected?.id) document.querySelector('.replay-detail')?.scrollIntoView({block:'center'})
    else { pendingScroll.current = true; setPoint(id) }
  }
  const from = eventFrom ? Date.parse(eventFrom + '+08:00') : -Infinity
  const until = eventUntil ? Date.parse(eventUntil + '+08:00') : Infinity
  const visibleEvents = (frame?.events || []).filter(e => (!device || byId[e.point].device === device)
    && e.start >= from && e.start <= until
    && (!status || (status === '进行中' ? e.end == null : e.end != null)))
  const event = visibleEvents.find(e => keyOf(e) === focus)

  return <div className="page replay">
    <div className="page-header"><div><h2>{professional ? '单站电气设备诊断' : '单站离线回放'}</h2><p>按采样时间查看设备、告警和判断依据。所有时间均为北京时间。</p></div>
      <button className="btn btn-primary" disabled={busy} onClick={() => load(null)}>{professional ? '打开七类设备样例' : '打开模拟样例'}</button>
    </div>
    <ImportForm busy={busy} onImport={load} professional={professional} />
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status" className="muted">{notice}</p>}
    {!dataset ? <p className="card empty-state">{professional ? '打开七类设备样例，或导入站点点表和采样记录。' : '打开站用直流电源模拟样例，或导入现场点表和采样记录。'}</p> : <>
      <section className="card replay-control">
        <div className="control-row">
          <label>数据批次<select aria-label="数据批次" value={dataset.id} onChange={e => {choose(sets.find(s => s.id === e.target.value)); setNotice('')}}>{sets.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
          <label>速度<select aria-label="速度" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[1,2,4,8].map(n => <option key={n} value={n}>{n} 倍</option>)}</select></label>
          <button className="btn btn-primary" onClick={play} disabled={dataset.start === dataset.end}>{playing ? '暂停' : at === dataset.end ? '从头播放' : '播放'}</button>
          <label>跳至时刻<input type="datetime-local" step="0.001" min={date(dataset.start)} max={date(dataset.end)} value={date(at)}
            onChange={e => { const v = Date.parse(e.target.value + '+08:00'); if (Number.isFinite(v)) seek(v) }} /></label>
        </div>
        <input type="range" aria-label="回放进度" min={dataset.start} max={dataset.end} step="1" value={at} onChange={e => seek(Number(e.target.value))} />
        <div className="replay-range"><span>{clock(dataset.start)}</span><strong>{clock(at)}</strong><span>{clock(dataset.end)}</span></div>
      </section>
      {professional && <StationDiagnostics key={dataset.id} dataset={dataset} at={at} onPoint={inspect} onSeek={seek} />}
      {!frame ? <p className="muted" role="status">正在读取该时刻的数据…</p> : <>
        {!professional && <section className="card"><div className="card-head"><h3>设备与测点</h3><span className="muted small">选择测点查看趋势</span></div>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>设备</th><th>测点</th><th>当前值</th><th>数据质量</th><th>设备告警</th></tr></thead><tbody>
            {points.map(p => <tr key={p.id}><td>{p.device}</td><td><button className="link" onClick={() => setPoint(p.id)}>{p.name}</button></td><td>{show(p,p.value)}</td><td>{p.quality}</td><td>{p.active ? '告警中' : '无已触发告警'}</td></tr>)}
          </tbody></table></div>
        </section>}
        {selected && <PointPanel p={selected} frame={frame} />}
        <section className="card"><div className="card-head wrap"><h3>截至回放时刻的告警</h3><div className="control-row">
          <select aria-label="按设备筛选" value={device} onChange={e=>setDevice(e.target.value)}><option value="">全部设备</option>{[...new Set(points.map(p=>p.device))].map(n=><option key={n}>{n}</option>)}</select>
          <select aria-label="按状态筛选" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option><option>进行中</option><option>已恢复</option></select>
        </div></div>
        <details className="replay-filter"><summary>按发生时间筛选</summary><div className="control-row">
          <label>开始时间<input type="datetime-local" step="1" value={eventFrom} onChange={e => setEventFrom(e.target.value)} /></label>
          <label>结束时间<input type="datetime-local" step="1" value={eventUntil} onChange={e => setEventUntil(e.target.value)} /></label>
          <button className="btn btn-sm btn-ghost" onClick={() => { setEventFrom(''); setEventUntil('') }}>清除时间筛选</button>
        </div>{from > until && <p className="form-error">结束时间应晚于开始时间。</p>}</details>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>发生时间</th><th>设备与测点</th><th>判断</th><th>恢复时间</th></tr></thead><tbody>
          {visibleEvents.map(e => <tr key={keyOf(e)}><td>{clock(e.start)}</td><td>{byId[e.point].device} · {byId[e.point].name}</td><td><button className="link" onClick={()=>{setFocus(keyOf(e));setPoint(e.point);setPlaying(false)}}>{e.kind}</button></td><td>{e.end == null ? '进行中' : clock(e.end)}</td></tr>)}
          {!visibleEvents.length && <tr><td colSpan="4">截至此时没有符合筛选条件的告警。</td></tr>}
        </tbody></table></div>
        {event && <div className="replay-evidence"><h4>{byId[event.point].name} · 判断依据</h4><p>{event.detail}。{event.kind !== '数据质量' && ruleText(byId[event.point])}</p>
          <p>首次观测 {clock(event.first_seen)}　触发 {clock(event.start)}　触发值 {show(byId[event.point],event.trigger_value)}</p>
          <p>恢复 {clock(event.end)}　恢复值 {show(byId[event.point],event.recovered_value)}　规则版本 {dataset.rule_version}</p>
          <button className="btn btn-sm btn-ghost" onClick={()=>seek(event.start)}>定位到触发时刻</button>
        </div>}
        </section>
      </>}
    </>}
  </div>
}
