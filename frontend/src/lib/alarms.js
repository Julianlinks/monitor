export const PRIORITY = {
  1: { label: '紧急', cls: 'p1' },
  2: { label: '高', cls: 'p2' },
  3: { label: '中', cls: 'p3' },
  4: { label: '低', cls: 'p4' },
}

// ISA 18.2 alarm states
export const STATES = {
  NORMAL:     { label: '正常', short: '正常', help: '运行正常。' },
  UNACK:      { label: '待确认', short: '待确认', help: '异常已发生，告警闪烁直至操作员确认。' },
  ACKED:      { label: '已确认', short: '已确认', help: '操作员已确认，异常仍在持续。' },
  RTN_UNACK:  { label: '已恢复待确认', short: '已恢复待确认', help: '设备先于操作员确认恢复正常，该事件仍待确认。' },
  SHELVED:    { label: '已暂搁', short: '已暂搁', help: '操作员已限时暂搁此告警，原因已记入日志。' },
  SUPPRESSED: { label: '按规则抑制', short: '已抑制', help: '根据设备工况自动抑制，例如发电机停机时的低频告警。' },
}

export const EVENT_LABELS = {
  ALARM: '告警',
  ACK: '已确认',
  RTN: '恢复正常',
  SHELVE: '已暂搁',
  UNSHELVE: '已解除暂搁',
  SUPPRESS: '已抑制',
  UNSUPPRESS: '已解除抑制',
}

export const ANNUNCIATED = ['UNACK', 'ACKED', 'RTN_UNACK']
export const NEEDS_ACK = ['UNACK', 'RTN_UNACK']
