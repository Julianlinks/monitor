import React, { useEffect, useState } from 'react'
import { Zap, Check, Loader2, RotateCcw } from 'lucide-react'

const EXPECTED_S = 50
const SLOW_S = 90

function Step({ done, active, children }) {
  return (
    <li className={`wake-step${done ? ' done' : ''}${active ? ' active' : ''}`}>
      <span className="wake-step-icon">
        {done ? <Check size={14} /> : active ? <Loader2 size={14} className="spin" /> : null}
      </span>
      {children}
    </li>
  )
}

export default function WakeScreen({ serverAwake, startedAt, retry }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const quick = elapsed < 4 && !serverAwake
  const slow = elapsed >= SLOW_S && !serverAwake
  const pct = serverAwake ? 92 : Math.min(88, (elapsed / EXPECTED_S) * 88)

  const title = quick
    ? '正在连接监视系统'
    : serverAwake
      ? '服务器已就绪，正在连接实时数据'
      : '正在连接演示服务器'

  return (
    <div className="wake-screen" role="status" aria-live="polite">
      <div className="wake-card">
        <div className="wake-brand">
          <Zap size={22} /> <span>电气监视</span>
        </div>
        <h1>{title}</h1>

        {!quick && (
          <p className="wake-text">
            首次打开时，后端会初始化模拟设备及历史数据。连接建立后，页面将持续更新。
          </p>
        )}

        <div className="wake-progress" aria-hidden="true">
          <div className="wake-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="wake-elapsed mono">{elapsed} 秒</div>

        <ol className="wake-steps">
          <Step done={serverAwake} active={!serverAwake}>连接服务器</Step>
          <Step done={serverAwake} active={false}>启动模拟器并生成 24 小时历史数据</Step>
          <Step done={false} active={serverAwake}>建立实时数据连接</Step>
        </ol>

        {slow && (
          <div className="wake-slow">
            <p>连接时间较长，请检查本地后端服务是否启动。</p>
            <button className="btn btn-primary" onClick={retry}>
              <RotateCcw size={14} /> 重新连接
            </button>
          </div>
        )}

        <div className="wake-preview">
          <div className="wake-preview-title">演示内容</div>
          <ul>
            <li>双路冗余供电，包括市电、发电机、转换开关、主配电柜、UPS、配电单元和制冷设备</li>
            <li>单线图展示停电时供电路径的变化</li>
            <li>告警管理包括确认、暂搁、恢复和事件日志</li>
            <li>可手动触发电压暂降、市电中断等场景</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
