import { displayText } from '../lib/displayText'
import React, { useEffect, useState } from 'react'
import { Wifi, Database, User, Cpu } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { api } from '../services/api'
import { API_URL, WS_URL } from '../services/endpoints'
import { getOperator, setOperator } from '../lib/operator'
import { PriorityBadge } from '../components/Badges'

function Rows({ rows }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>)}
    </dl>
  )
}

export default function SettingsPage() {
  const { system, demo } = useFeed()
  const [cfg, setCfg] = useState(null)
  const [name, setName] = useState(getOperator)
  const [saved, setSaved] = useState(false)

  useEffect(() => { api.getConfig().then(setCfg).catch(() => {}) }, [])

  const save = (e) => {
    e.preventDefault()
    setOperator(name.trim() || '演示用户')
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>系统设置</h2>
          <p>数据来源、连接状态与告警配置</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card">
          <div className="card-head"><h3><Cpu size={14} /> 数据来源</h3></div>
          <Rows rows={[
            ['运行模式', system?.simulated ? '模拟器（演示）' : 'Modbus TCP'],
            ['扫描周期', `${cfg?.poll_interval_s ?? demo?.poll_interval_s ?? '--'} 秒`],
            ['历史记录间隔', `${cfg?.history_interval_s ?? '--'} 秒`],
            ['在线设备', `${system?.meters_online ?? '--'} / ${system?.meter_count ?? '--'}`],
            ['版本', cfg?.version ?? demo?.version ?? '--'],
          ]} />
          <p className="muted small">
            后端可通过 Modbus TCP 读取已配置的电表。接入时需设置 DATA_SOURCE=modbus，并提供寄存器映射表。
          </p>
        </div>

        <div className="card">
          <div className="card-head"><h3><Wifi size={14} /> 连接</h3></div>
          <Rows rows={[
            ['接口地址', API_URL || window.location.origin],
            ['WebSocket', WS_URL],
          ]} />
        </div>

        <div className="card">
          <div className="card-head"><h3><User size={14} /> 操作人</h3></div>
          <form className="operator-form" onSubmit={save}>
            <label htmlFor="op-name" className="muted small">确认或暂搁告警时记入日志的姓名</label>
            <div className="operator-row">
              <input id="op-name" type="text" value={name} maxLength={40} onChange={e => setName(e.target.value)} />
              <button className="btn btn-primary btn-sm" type="submit">{saved ? '已保存' : '保存'}</button>
            </div>
          </form>
        </div>

        <div className="card">
          <div className="card-head"><h3><Database size={14} /> 数据保留</h3></div>
          <Rows rows={[
            ['历史读数', `${cfg?.retention_days ?? '--'} 天`],
            ['告警日志', `${cfg?.retention_days ?? '--'} 天`],
            ['暂搁上限', `${cfg?.shelve_max_min ?? '--'} min`],
            ['数据库', 'SQLite'],
          ]} />
        </div>

        <div className="card span-2">
          <div className="card-head"><h3>告警优先级</h3></div>
          <p className="muted small">优先级取决于异常的可能影响和可用于处置的时间。</p>
          <dl className="kv">
            {cfg && Object.entries(cfg.priorities).map(([p, info]) => (
              <div key={p}><dt><PriorityBadge priority={Number(p)} /></dt><dd>{displayText(info.response)}</dd></div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}
