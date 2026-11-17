import React from 'react'
import { STATES } from '../lib/alarms'
import { StateBadge } from './Badges'

// The ISA 18.2 alarm state model, in a form a visitor can follow
export default function StateLegend({ compact = false }) {
  return (
    <div className="state-legend">
      <div className="state-flow" aria-label="告警状态变化">
        <div className="flow-row">
          <span className="flow-node">正常</span>
          <span className="flow-arrow">触发<span>&rarr;</span></span>
          <span className="flow-node unack">待确认</span>
          <span className="flow-arrow">确认<span>&rarr;</span></span>
          <span className="flow-node acked">已确认</span>
          <span className="flow-arrow">恢复<span>&rarr;</span></span>
          <span className="flow-node">正常</span>
        </div>
        <div className="flow-row">
          <span className="flow-node unack">待确认</span>
          <span className="flow-arrow">恢复<span>&rarr;</span></span>
          <span className="flow-node rtn">已恢复待确认</span>
          <span className="flow-arrow">确认<span>&rarr;</span></span>
          <span className="flow-node">正常</span>
        </div>
      </div>
      {!compact && (
        <dl className="state-list">
          {['UNACK', 'ACKED', 'RTN_UNACK', 'SHELVED', 'SUPPRESSED'].map(s => (
            <div key={s} className="state-list-row">
              <dt><StateBadge state={s} priority={s === 'SHELVED' || s === 'SUPPRESSED' ? 4 : 2} /></dt>
              <dd>{STATES[s].help}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
