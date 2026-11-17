import { displayText } from '../lib/displayText'
import React, { useEffect, useRef, useState } from 'react'
import { X, FlaskConical, Play } from 'lucide-react'
import { useFeed } from '../services/LiveFeed'
import { api } from '../services/api'
import StateLegend from './StateLegend'

export function ScenarioButtons({ onDone }) {
  const { demo, system } = useFeed()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const running = system?.scenario

  if (!demo?.events_enabled) {
    return <p className="muted">服务端已关闭模拟事件功能。</p>
  }

  const fire = async (name) => {
    setBusy(name)
    setError(null)
    try {
      await api.triggerEvent(name)
      onDone?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="scenario-list">
      {running && (
        <div className="scenario-running">
          <span className="pulse-dot" /> {displayText(running.label)} 进行中
        </div>
      )}
      {demo.scenarios.map(s => (
        <button key={s.name} className="scenario-btn" disabled={!!running || !!busy} onClick={() => fire(s.name)}>
          <Play size={14} />
          <span>
            <strong>{displayText(s.label)}</strong>
            <small>{displayText(s.description)}</small>
          </span>
        </button>
      ))}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

export default function AboutPanel({ open, onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    closeRef.current?.focus()
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title"
        onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="about-title">演示说明</h2>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="sim-notice">
            <FlaskConical size={18} />
            <div>
              <strong>实时演示使用模拟数据。</strong> Python 模拟器模拟小型数据中心，默认每两秒更新一次。
            </div>
          </div>

          <section>
            <h3>模拟站设备</h3>
            <p>
              模拟站总负荷约 450 kW，采用双路冗余供电。480 V 市电和 750 kW 备用发电机经自动转换开关接入主配电柜。A、B 两路 400 kVA UPS 各带两台 150 kVA 配电单元，输出 208 V。制冷设备由独立配电柜供电，模型计入变压器和 UPS 损耗。
            </p>
          </section>

          <section>
            <h3>模拟事件</h3>
            <p className="muted">
              事件会每隔几分钟自动触发，也可选择下列场景观察告警变化。
            </p>
            <ScenarioButtons onDone={onClose} />
          </section>

          <section>
            <h3>ISA 18.2 告警管理</h3>
            <p>
              每条告警包含优先级、影响和处置建议。阈值死区和延时可减少重复告警。操作员可填写原因后限时暂搁；满足抑制规则时系统自动抑制告警，例如发电机停机时的低频告警。每次状态变化均记入日志。
            </p>
            <StateLegend compact />
          </section>

          <section>
            <h3>现场设备接入</h3>
            <p>
              读取 Modbus TCP 仪表时，需设置 <code>DATA_SOURCE=modbus</code> 并配置寄存器映射，历史数据和告警沿用相同的处理流程。
            </p>
          </section>

          <section>
            <h3>技术栈</h3>
            <p>后端使用 Python、FastAPI 和 SQLite，前端使用 React 与 Vite，通过 WebSocket 接收实时数据。</p>
          </section>
        </div>
      </div>
    </div>
  )
}
