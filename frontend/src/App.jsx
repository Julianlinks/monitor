import React, { Suspense, lazy, useCallback, useState } from 'react'
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, GitBranch, Gauge, Bell, ListOrdered, TrendingUp, Settings, Zap, Info, FlaskConical, History } from 'lucide-react'
import { LiveFeedProvider, useFeed } from './services/LiveFeed'
import WakeScreen from './components/WakeScreen'
import AboutPanel from './components/AboutPanel'
import AlarmBanner from './components/AlarmBanner'
import Dashboard from './pages/Dashboard'
import OneLineDiagram from './pages/OneLineDiagram'
import Alarms from './pages/Alarms'
import SettingsPage from './pages/SettingsPage'
import './App.css'

// Chart heavy pages load on demand to keep the first load small
const Replay = lazy(() => import('./pages/Replay'))
const Meters = lazy(() => import('./pages/Meters'))
const Trending = lazy(() => import('./pages/Trending'))
const Triage = lazy(() => import('./pages/Triage'))

const NAV = [
  { to: '/',         icon: LayoutDashboard, label: '总览' },
  { to: '/replay', icon: History, label: '离线回放' },
  { to: '/one-line', icon: GitBranch,       label: '电气单线图' },
  { to: '/meters',   icon: Gauge,           label: '设备仪表' },
  { to: '/alarms',   icon: Bell,            label: '告警', alarms: true },
  { to: '/triage',   icon: ListOrdered,     label: '告警研判' },
  { to: '/trending', icon: TrendingUp,      label: '趋势' },
  { to: '/settings', icon: Settings,        label: '系统设置' },
]

function ConnectionPill({ phase }) {
  const live = phase === 'live'
  return (
    <div className={`conn-pill ${live ? 'live' : 'down'}`} title={live ? '正在接收实时数据' : '正在重新连接服务器'}>
      <span className="conn-dot" />
      <span>{live ? '已连接' : '重新连接中'}</span>
    </div>
  )
}

function Shell() {
  const feed = useFeed()
  const replay = useLocation().pathname === '/replay'
  const [aboutOpen, setAboutOpen] = useState(false)
  const openAbout = useCallback(() => setAboutOpen(true), [])
  const closeAbout = useCallback(() => setAboutOpen(false), [])

  if (!feed.hasData && !replay) {
    return <WakeScreen serverAwake={feed.serverAwake} startedAt={feed.startedAt} retry={feed.retry} />
  }

  const unacked = feed.summary?.unacknowledged ?? 0
  const topPriority = feed.summary?.highest_unacked?.priority

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Zap size={20} className="brand-icon" />
          <span className="brand-text">电气监视</span>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {NAV.map(({ to, icon: Icon, label, alarms }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon size={18} />
              <span className="nav-label">{label}</span>
              {!replay && alarms && unacked > 0 && <span className={`nav-badge p${topPriority}`}>{unacked}</span>}
            </NavLink>
          ))}
        </nav>
        <button className="sidebar-about" onClick={openAbout}>
          <Info size={16} /> <span className="nav-label">演示说明</span>
        </button>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <Zap size={18} className="brand-icon mobile-only" />
            <h1 className="topbar-title">电气设备诊断监视</h1>
          </div>
          <div className="topbar-right">
            {!replay && feed.system?.simulated && (
              <button className="sim-pill" onClick={openAbout} title="当前展示模拟数据，点击查看详情。">
                <FlaskConical size={13} /> <span>模拟数据</span>
              </button>
            )}
            {replay ? <span className="sim-pill">离线回放</span> : <ConnectionPill phase={feed.phase} />}
            <button className="icon-btn" onClick={openAbout} aria-label="演示说明"><Info size={18} /></button>
          </div>
        </header>

        {!replay && <AlarmBanner />}

        <main className={`page-content${replay || feed.phase === 'live' ? '' : ' stale'}`}>
          <Suspense fallback={<div className="page-loading">正在加载…</div>}>
            <Routes>
              <Route path="/" element={<Dashboard onAbout={openAbout} />} />
              <Route path="/replay" element={<Replay />} />
              <Route path="/one-line" element={<OneLineDiagram />} />
              <Route path="/meters" element={<Meters />} />
              <Route path="/alarms" element={<Alarms />} />
              <Route path="/triage" element={<Triage />} />
              <Route path="/trending" element={<Trending />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="主导航">
        {NAV.map(({ to, icon: Icon, label, alarms }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `bottom-item${isActive ? ' active' : ''}`}>
            <span className="bottom-icon">
              <Icon size={19} />
              {!replay && alarms && unacked > 0 && <span className={`nav-badge p${topPriority}`}>{unacked}</span>}
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <AboutPanel open={aboutOpen} onClose={closeAbout} />
    </div>
  )
}

// Hash based routing (/#/alarms) so any page can be refreshed or deep linked
// on a static host without a server side rewrite rule.
export default function App() {
  return (
    <HashRouter>
      <LiveFeedProvider>
        <Shell />
      </LiveFeedProvider>
    </HashRouter>
  )
}
