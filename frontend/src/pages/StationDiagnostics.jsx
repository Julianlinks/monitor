import React, { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { API_URL } from '../services/endpoints'

export const diagnosticBase = API_URL + '/api/diagnostics'
const recorder = '电力系统动态记录装置'
const protection = '继电保护及安全自动装置'
const quality = '电能质量监测系统'
const number = value => value == null ? '—' : Number(value.toFixed(3)).toLocaleString('zh-CN', {maximumFractionDigits: 3})
const stamp = t => t == null ? '—' : new Date(t + 8 * 3600000).toISOString().slice(11, 23)

async function read(path, options) {
  const res = await fetch(diagnosticBase + path, options)
  const body = await res.json()
  if (!res.ok) throw Error(typeof body.detail === 'string' ? body.detail : '读取失败，请检查所选批次和文件。')
  return body
}

function Table({ headings, children }) {
  return <div className="table-wrap"><table className="data-table">
    <thead><tr>{headings.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody>
  </table></div>
}

function Protection({ data, onSeek }) {
  return <>
    <h4>动作与反馈</h4>
    {data.actions.length ? <Table headings={['关联组','动作时刻','反馈时刻','实测 / 时限','结论']}>
      {data.actions.map(a => <tr key={a.point + a.ts}><td>{a.group}</td>
        <td><button className="link" onClick={() => onSeek(a.ts)}>{stamp(a.ts)}</button></td>
        <td>{stamp(a.feedback_ts)}</td><td>{a.elapsed_ms ?? '—'} / {a.limit_ms} 毫秒</td><td>{a.result}</td></tr>)}
    </Table> : <p className="muted">截至此时尚未观测到动作变位。</p>}
    <details className="diag-details"><summary>事件顺序记录（{data.sequence.length} 条）</summary>
      <Table headings={['变位时刻','设备','信号','状态']}>
        {data.sequence.map(e => <tr key={e.point + e.ts}><td><button className="link" onClick={() => onSeek(e.ts)}>{stamp(e.ts)}</button></td><td>{e.device}</td><td>{e.role} · {e.point}</td><td>{e.state}</td></tr>)}
      </Table>
    </details>
  </>
}

function Waveform({ dataset, record }) {
  const [channel, setChannel] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({channel, at: record.end, device: record.device})
    setError('')
    read('/' + dataset + '/recordings/' + record.id + '?' + params, {signal: controller.signal})
      .then(body => { if (!controller.signal.aborted) setResult(body) })
      .catch(() => { if (!controller.signal.aborted) setError('无法读取该通道的录波数据。') })
    return () => controller.abort()
  }, [dataset, record.id, record.device, record.end, channel])
  const match = result?.channel === channel && result
  const conf = match && result.channels[channel]
  return <div className="diag-wave">
    <p>{record.device} · {record.samples} 个采样 · 触发 {stamp(record.trigger)} · {record.time_basis}</p>
    {result && <label>录波通道<select value={channel} onChange={e => setChannel(Number(e.target.value))}>
      {result.channels.map((ch,i) => <option key={i} value={i}>{ch.name} · {ch.kind}{ch.unit && '（' + ch.unit + '）'}</option>)}
    </select></label>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {conf && <>
      <p className="muted">最小 {number(result.minimum)} {conf.unit}　最大 {number(result.maximum)} {conf.unit}　触发位置 {number(result.trigger_ms)} 毫秒</p>
      <ResponsiveContainer width="100%" height={215}>
        <LineChart data={result.plot} margin={{right: 26, top: 15, bottom: 12}}>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" />
          <XAxis dataKey="ms" type="number" domain={['dataMin','dataMax']} tickFormatter={number} unit=" ms" />
          <YAxis width={52} domain={['auto','auto']} />
          <Tooltip contentStyle={{background:'var(--bg-card)'}} labelFormatter={v => number(v) + ' 毫秒'} formatter={v => [number(v) + ' ' + conf.unit,conf.name]} />
          <ReferenceLine x={result.trigger_ms} stroke="var(--p2)" label={{value:'触发',fill:'var(--text-primary)'}} />
          <Line type={conf.kind === '开关量' ? 'stepAfter' : 'linear'} dataKey="value" stroke="var(--accent)" dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
      {result.decimated && <p className="muted small">按时间分段保留极值绘图。</p>}
    </>}
  </div>
}

function Records({ dataset, files, points, refresh }) {
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const devices = [...new Set(points.map(p => p.device))]
  const key = f => f.device + ':' + f.id
  const record = files.find(f => key(f) === selected) || files[0]
  async function upload(e) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true); setMessage('')
    try {
      const file = await read('/' + dataset + '/recordings', {method:'POST',body:form})
      setSelected(key(file)); setMessage('录波已保存，回放到 ' + stamp(file.end) + ' 后可查看。'); refresh()
    } catch (err) { setMessage(err.message) } finally { setBusy(false) }
  }
  return <>
    <div className="card-head wrap"><h4>故障录波</h4><span className="muted small">截至当前时刻已完成 {files.length} 份</span></div>
    {record ? <>
      <label>录波文件<select value={key(record)} onChange={e => setSelected(e.target.value)}>
        {files.map(f => <option key={key(f)} value={key(f)}>{f.device} · {f.filename} · {stamp(f.start)}</option>)}
      </select></label>
      <Waveform key={key(record)} dataset={dataset} record={record} />
    </> : <p className="muted">当前时刻尚无已完成的录波。</p>}
    {devices.length > 0 && <details className="replay-import diag-details"><summary>导入 COMTRADE 录波</summary>
      <form onSubmit={upload}>
        <label>动态记录装置<select name="device">{devices.map(d => <option key={d}>{d}</option>)}</select></label>
        <label>配置文件（CFG）<input required type="file" name="config" accept=".cfg" /></label>
        <label>数据文件（DAT）<input required type="file" name="data" accept=".dat" /></label>
        <button className="btn btn-primary" disabled={busy}>校验并保存录波</button>
      </form>
      <a href={diagnosticBase + '/templates/cfg'} download>下载示例 CFG</a> · <a href={diagnosticBase + '/templates/dat'} download>下载示例 DAT</a>
    </details>}
    {message && <p role="status">{message}</p>}
  </>
}

export default function StationDiagnostics({ dataset, at, onPoint, onSeek }) {
  const [selected, setSelected] = useState('高压设备')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    read('/' + dataset.id + '?at=' + at, {signal:controller.signal})
      .then(value => { if (!controller.signal.aborted) setResult(value) })
      .catch(() => { if (!controller.signal.aborted) setError('无法读取本时刻的专业诊断。') })
    return () => controller.abort()
  },[dataset.id, at, revision])
  const data = result?.at === at && result?.dataset === dataset.id ? result : null
  const category = result?.categories.find(c => c.name === selected) || result?.categories[0]
  function report() {
    const blob = new Blob([JSON.stringify({批次:dataset.name,北京时间:new Date(at + 8 * 3600000).toISOString().slice(0,23),...data},null,2)],{type:'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = '单站诊断-' + at + '.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url),1000)
  }
  function evidence(ids) {
    return <div className="diag-links">{ids.map(id => <button key={id} className="link" onClick={() => onPoint(id)}>{category.points.find(p => p.id === id)?.name || id}</button>)}</div>
  }
  return <section className="card diag-station">
    <div className="card-head wrap"><h3>专业诊断</h3><button className="btn btn-ghost btn-sm" disabled={!data} onClick={report}>导出本时刻诊断</button></div>
    <div className="diag-tabs" role="group" aria-label="设备类别">
      {(result?.dataset === dataset.id ? result.categories : []).map(c => <button key={c.name} aria-pressed={selected === c.name} onClick={() => setSelected(c.name)}>{c.name}</button>)}
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {!data && <p className="muted">正在读取专业诊断…</p>}
    {category && <div hidden={!data}>
      <div className="diag-summary"><strong>{category.name}</strong><span>{category.devices} 台设备</span><span>{category.points.length} 个测点</span><span>告警中 {category.active}</span><span>质量待核实 {category.unknown}</span></div>
      {category.findings.map(f => <div key={f.group + f.title} className="replay-evidence"><h4>{f.title}</h4><p>{f.group} · 同组信号同时满足点表条件</p>{evidence(f.points)}</div>)}
      {category.name === protection && <Protection data={result} onSeek={onSeek} />}
      {category.name === recorder && <Records dataset={dataset.id} files={result.recordings} points={category.points} refresh={() => setRevision(v => v + 1)} />}
      {category.name === quality && <div className="diag-metrics">{category.metrics.map(m => <article key={m.point}>
        <h4>{m.name}</h4><strong>{number(m.value)} {m.unit}</strong><p>{m.group} · {m.method}</p>{evidence(m.inputs)}
      </article>)}</div>}
      {category.name === quality && result.voltage_excursions.length > 0 && <>
        <h4>电压越低限记录</h4>
        <Table headings={['首次越限','恢复','观测跨度','最低有效值','数据连续性']}>
          {result.voltage_excursions.map(e => <tr key={e.point + e.start}>
            <td><button className="link" onClick={() => onSeek(e.first)}>{stamp(e.first)} · {e.point}</button></td>
            <td>{e.end == null ? '进行中' : stamp(e.end)}</td><td>{e.elapsed_ms} 毫秒</td>
            <td>{number(e.minimum)} {e.unit}</td><td>{e.has_gap ? '期间存在数据缺口' : '未见断数'}</td>
          </tr>)}
        </Table>
      </>}
      {category.points.length ? <Table headings={['设备','测点 / 趋势','当前值','质量','告警状态']}>
        {category.points.map(p => <tr key={p.id}><td>{p.device}</td><td><button className="link" onClick={() => onPoint(p.id)}>{p.name}</button></td>
          <td>{p.value == null ? '—' : p.kind === '开关量' ? (p.value ? p.on : p.off) : number(p.value) + ' ' + p.unit}</td><td>{p.quality}</td><td>{p.active ? '告警中' : '无已触发告警'}</td></tr>)}
      </Table> : <p className="muted">本批次未配置此类设备测点。</p>}
    </div>}
  </section>
}
