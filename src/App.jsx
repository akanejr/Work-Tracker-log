import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabase'

const STORAGE_KEY = 'work_tracker_v1'
const START_KEY = 'work_tracker_start_v1'

function formatDateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function isWeekendDay(dateObj) {
  const day = dateObj.getDay()
  return day === 0 || day === 6
}
function formatNaira(n) {
  return `₦${Number(n).toLocaleString('en-NG')}`
}
function getMonthName(monthIndex, short = false) {
  const names = short
    ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    : ['January','February','March','April','May','June','July','August','September','October','November','December']
  return names[monthIndex]
}
function monthKey(year, month) {
  return `${year}-${String(month+1).padStart(2,'0')}`
}
function parseMonthKey(key) {
  const [y,m] = key.split('-').map(Number)
  return { year: y, month: m-1 }
}

export default function App() {
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [view, setView] = useState('month')
  const [attendance, setAttendance] = useState({})
  const [settings, setSettings] = useState({ dailyRate: 16000, weekendMultiplier: 2 })
  const [startMonthKey, setStartMonthKey] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [rateInput, setRateInput] = useState('16000')
  const [loaded, setLoaded] = useState(false)

  // Cloud / Auth
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState('signin')
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '' })
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [syncStatus, setSyncStatus] = useState('idle')
  const [cloudError, setCloudError] = useState('')
  const syncTimeoutRef = useRef(null)
  const hasPushedInitialLocalRef = useRef(false)

  const [profileName, setProfileName] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('work_tracker_theme') || 'light' } catch { return 'light' }
  })

  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotBusy, setForgotBusy] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')

  // Overtime edit menu
  const [editingKey, setEditingKey] = useState(null)
  const [editingDate, setEditingDate] = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('work_tracker_theme', theme) } catch {}
  }, [theme])

  const [realCurrentDate, setRealCurrentDate] = useState(() => new Date())
  useEffect(() => {
    const updateReal = () => setRealCurrentDate(new Date())
    const onVis = () => { if (document.visibilityState === 'visible') updateReal() }
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(updateReal, 60*1000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(iv) }
  }, [])

  // Load local
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      let loadedAttendance = {}
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.attendance) {
          loadedAttendance = parsed.attendance
          setAttendance(parsed.attendance)
        }
        if (parsed.settings) {
          setSettings({ dailyRate: parsed.settings.dailyRate ?? 16000, weekendMultiplier: parsed.settings.weekendMultiplier ?? 2 })
          setRateInput(String(parsed.settings.dailyRate ?? 16000))
          if (parsed.settings.startMonthKey) {
            setStartMonthKey(parsed.settings.startMonthKey)
            localStorage.setItem(START_KEY, parsed.settings.startMonthKey)
          }
        }
      }
      const startRaw = localStorage.getItem(START_KEY)
      if (startRaw) {
        setStartMonthKey(startRaw)
      } else {
        let startKey
        const keys = Object.keys(loadedAttendance)
        if (keys.length > 0) {
          const monthKeys = keys.map(k => k.slice(0,7)).sort()
          startKey = monthKeys[0]
        } else {
          const now = new Date()
          startKey = monthKey(now.getFullYear(), now.getMonth())
        }
        localStorage.setItem(START_KEY, startKey)
        setStartMonthKey(startKey)
      }
    } catch {}
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ attendance, settings }))
      if (startMonthKey) localStorage.setItem(START_KEY, startMonthKey)
    } catch {}
  }, [attendance, settings, startMonthKey, loaded])

  // Auth init
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) { setAuthLoading(false); return }
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null
      setUser(u)
      if (u) setProfileName(u.user_metadata?.full_name || '')
      setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { setShowRecovery(true); setShowAuth(false) }
      const u = session?.user ?? null
      setUser(u)
      if (u) setProfileName(u.user_metadata?.full_name || '')
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // Fetch cloud
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    if (!user) { setSyncStatus('idle'); return }
    const fetchCloud = async () => {
      setSyncStatus('syncing'); setCloudError('')
      try {
        const { data, error } = await supabase.from('user_data').select('attendance, settings').eq('user_id', user.id).single()
        if (error && error.code !== 'PGRST116') throw error
        if (data) {
          const cloudAttendance = data.attendance || {}
          const cloudSettings = data.settings || { dailyRate: 16000, weekendMultiplier: 2 }
          if (cloudSettings.startMonthKey && !startMonthKey) setStartMonthKey(cloudSettings.startMonthKey)
          const mergedAttendance = { ...cloudAttendance }
          let hasOfflineNew = false
          for (const k in attendance) { if (!mergedAttendance[k]) { mergedAttendance[k] = attendance[k]; hasOfflineNew = true } }
          setAttendance(mergedAttendance)
          const mergedSettings = { ...cloudSettings }
          if (startMonthKey && !mergedSettings.startMonthKey) mergedSettings.startMonthKey = startMonthKey
          if (mergedSettings.startMonthKey) setStartMonthKey(mergedSettings.startMonthKey)
          setSettings({ dailyRate: mergedSettings.dailyRate ?? 16000, weekendMultiplier: mergedSettings.weekendMultiplier ?? 2 })
          setRateInput(String(mergedSettings.dailyRate ?? 16000))
          if (hasOfflineNew) {
            await supabase.from('user_data').upsert({
              user_id: user.id,
              attendance: mergedAttendance,
              settings: { ...mergedSettings, startMonthKey: mergedSettings.startMonthKey || startMonthKey },
              updated_at: new Date().toISOString(),
            })
          }
        } else {
          const settingsToSave = { ...settings, startMonthKey: startMonthKey || monthKey(new Date().getFullYear(), new Date().getMonth()) }
          await supabase.from('user_data').upsert({ user_id: user.id, attendance, settings: settingsToSave, updated_at: new Date().toISOString() })
          if (!startMonthKey) setStartMonthKey(settingsToSave.startMonthKey)
        }
        setSyncStatus('synced'); setTimeout(()=>setSyncStatus('idle'),2000)
      } catch (e) { setCloudError(e.message || 'Failed to load cloud data'); setSyncStatus('error') }
    }
    fetchCloud()
  }, [user])

  useEffect(() => {
    if (!loaded) return
    if (!isSupabaseConfigured || !supabase) return
    if (!user) return
    if (!hasPushedInitialLocalRef.current) { hasPushedInitialLocalRef.current = true; return }
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    setSyncStatus('syncing')
    syncTimeoutRef.current = setTimeout(async () => {
      try {
        const settingsToSave = { ...settings, startMonthKey }
        const { error } = await supabase.from('user_data').upsert({ user_id: user.id, attendance, settings: settingsToSave, updated_at: new Date().toISOString() })
        if (error) throw error
        setSyncStatus('synced'); setTimeout(()=>setSyncStatus('idle'),2000)
      } catch (e) { setCloudError(e.message || 'Sync failed'); setSyncStatus('error') }
    }, 800)
    return () => { if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current) }
  }, [attendance, settings, startMonthKey, user, loaded])

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const realYear = realCurrentDate.getFullYear()
  const realMonth = realCurrentDate.getMonth()

  function getMonthStatus(y, m) {
    if (!startMonthKey) return 'active'
    const { year: sY, month: sM } = parseMonthKey(startMonthKey)
    const startTotal = sY*12 + sM
    const viewTotal = y*12 + m
    const realTotal = realYear*12 + realMonth
    if (viewTotal < startTotal) return 'before_start'
    if (viewTotal < realTotal) return 'locked'
    if (viewTotal === realTotal) return 'active'
    return 'future'
  }

  const monthStatus = getMonthStatus(year, month)
  const isEditable = monthStatus === 'active'

  const calendarData = useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const jsFirstDay = firstDay.getDay()
    const mondayOffset = (jsFirstDay + 6) % 7
    const cells = []
    for (let i = 0; i < mondayOffset; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
    const remaining = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7)
    for (let i = 0; i < remaining; i++) cells.push(null)
    return { cells, daysInMonth }
  }, [year, month])

  const monthlyStats = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
    let total = 0, days = 0, weekendDays = 0, regularDays = 0, overtimeDays = 0
    for (const key in attendance) {
      if (key.startsWith(prefix)) {
        const rec = attendance[key]
        total += rec.amount
        days += 1
        if (rec.isWeekend) weekendDays += 1
        else if (rec.isOvertime) overtimeDays += 1
        else regularDays += 1
      }
    }
    return { total, days, weekendDays, regularDays, overtimeDays }
  }, [attendance, year, month])

  const yearlyStats = useMemo(() => {
    const prefix = `${year}-`
    let total = 0, days = 0, weekendDays = 0, overtimeDays = 0
    const monthly = Array.from({ length: 12 }, (_, m) => ({ month: m, total: 0, days: 0, status: getMonthStatus(year, m) }))
    for (const key in attendance) {
      if (key.startsWith(prefix)) {
        const rec = attendance[key]
        const m = parseInt(key.slice(5, 7), 10) - 1
        if (m >=0 && m <12) { monthly[m].total += rec.amount; monthly[m].days += 1 }
        total += rec.amount; days += 1
        if (rec.isWeekend) weekendDays += 1
        else if (rec.isOvertime) overtimeDays += 1
      }
    }
    return { total, days, weekendDays, overtimeDays, monthly }
  }, [attendance, year, realYear, realMonth, startMonthKey])

  const todayKey = formatDateKey(new Date())

  function handleCellClick(dateObj) {
    if (!dateObj) return
    if (!isEditable) return
    const key = formatDateKey(dateObj)
    const record = attendance[key]
    const isWeekend = isWeekendDay(dateObj)

    if (isWeekend) {
      // Weekend: toggle as before, no overtime
      setAttendance(prev => {
        const next = { ...prev }
        if (next[key]) delete next[key]
        else {
          const amount = settings.dailyRate * settings.weekendMultiplier
          next[key] = { date: key, amount, isWeekend: true, isOvertime: false, rate: settings.dailyRate, multiplier: settings.weekendMultiplier }
        }
        return next
      })
    } else {
      // Weekday
      if (!record) {
        // Mark as regular OK
        setAttendance(prev => ({
          ...prev,
          [key]: { date: key, amount: settings.dailyRate, isWeekend: false, isOvertime: false, rate: settings.dailyRate, multiplier: 1 }
        }))
      } else {
        // Already worked weekday -> open edit menu
        setEditingKey(key)
        setEditingDate(dateObj)
      }
    }
  }

  function handleEditButtonClick(e, dateObj) {
    e.stopPropagation()
    if (!isEditable) return
    const key = formatDateKey(dateObj)
    setEditingKey(key)
    setEditingDate(dateObj)
  }

  function handleOvertimeAction(action) {
    if (!editingKey) return
    const key = editingKey
    if (action === 'remove') {
      setAttendance(prev => { const next = { ...prev }; delete next[key]; return next })
    } else if (action === 'regular') {
      setAttendance(prev => {
        const rec = prev[key]
        if (!rec) return prev
        return { ...prev, [key]: { ...rec, isOvertime: false, isWeekend: false, amount: rec.rate, multiplier: 1 } }
      })
    } else if (action === 'overtime') {
      setAttendance(prev => {
        const rec = prev[key]
        if (!rec) return prev
        const mult = settings.weekendMultiplier // same as weekend per requirement
        return { ...prev, [key]: { ...rec, isOvertime: true, isWeekend: false, amount: rec.rate * mult, multiplier: mult } }
      })
    }
    setEditingKey(null)
    setEditingDate(null)
  }

  function goPrevMonth(){
    const newDate = new Date(year, month-1,1)
    if (startMonthKey) {
      const { year: sY, month: sM } = parseMonthKey(startMonthKey)
      if (newDate.getFullYear()*12 + newDate.getMonth() < sY*12 + sM) return
    }
    setCurrentDate(newDate)
  }
  function goNextMonth(){ setCurrentDate(new Date(year, month+1,1)) }
  function goPrevYear(){
    const newYear = year - 1
    if (startMonthKey && newYear < parseMonthKey(startMonthKey).year) return
    setCurrentDate(new Date(newYear, month,1))
  }
  function goNextYear(){ setCurrentDate(new Date(year+1, month,1)) }
  function openMonth(mIdx){
    if (startMonthKey) {
      const { year: sY, month: sM } = parseMonthKey(startMonthKey)
      if (year === sY && mIdx < sM) return
      if (year < sY) return
    }
    setCurrentDate(new Date(year, mIdx,1)); setView('month')
  }
  function goToCurrentMonth(){ setCurrentDate(new Date(realYear, realMonth, 1)); setView('month') }

  function handleSaveRate(){
    const cleaned = rateInput.replace(/[^0-9]/g,'')
    const num = parseInt(cleaned,10)
    if(!num || num<=0) return
    setSettings(s=>({...s, dailyRate:num}))
    setRateInput(String(num))
    setShowSettings(false)
  }

  async function handleSaveProfileName(){
    if (!supabase || !user) return
    if (!profileName.trim()) return
    setProfileSaving(true)
    try {
      const { data, error } = await supabase.auth.updateUser({ data: { full_name: profileName.trim() } })
      if (error) throw error
      if (data.user) setUser(data.user)
    } catch (e) { setCloudError(e.message) } finally { setProfileSaving(false) }
  }

  async function handleAuthSubmit(e){
    e.preventDefault()
    if(!supabase) return
    setAuthBusy(true); setAuthError('')
    try{
      if(authMode==='signup'){
        const { data, error } = await supabase.auth.signUp({
          email: authForm.email, password: authForm.password,
          options: { data: { full_name: authForm.name.trim() || authForm.email.split('@')[0] } }
        })
        if(error) throw error
        if(data.user) {
          setUser(data.user)
          setProfileName(data.user.user_metadata?.full_name || authForm.name)
          setShowAuth(false)
          setAuthForm({email:'',password:'', name:''})
          if (!startMonthKey) setStartMonthKey(monthKey(new Date().getFullYear(), new Date().getMonth()))
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password })
        if(error) throw error
        setUser(data.user)
        setProfileName(data.user.user_metadata?.full_name || '')
        setShowAuth(false)
        setAuthForm({email:'',password:'', name:''})
      }
    } catch(err){ setAuthError(err.message || 'Authentication failed') } finally{ setAuthBusy(false) }
  }

  async function handleLogout(){
    if(!supabase) return
    await supabase.auth.signOut()
    setUser(null)
    setSyncStatus('idle')
    hasPushedInitialLocalRef.current = false
  }

  async function handleForgotPassword(e){
    e.preventDefault()
    if(!supabase) return
    setForgotBusy(true); setAuthError('')
    try{
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, { redirectTo: window.location.origin })
      if(error) throw error
      setForgotSent(true)
    } catch(err){ setAuthError(err.message || 'Failed to send reset email') } finally{ setForgotBusy(false) }
  }

  async function handleRecoverySubmit(e){
    e.preventDefault()
    if(!supabase) return
    setRecoveryBusy(true); setRecoveryError('')
    try{
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if(error) throw error
      setShowRecovery(false); setNewPassword('')
    } catch(err){ setRecoveryError(err.message || 'Failed to update password') } finally{ setRecoveryBusy(false) }
  }

  const displayName = user?.user_metadata?.full_name || profileName || user?.email?.split('@')[0] || ''

  const statusConfig = {
    active: { label: 'Active', desc: 'Editable', icon: '●', color: '#22c55e' },
    locked: { label: 'Locked', desc: 'Read only — Final', icon: '🔒', color: '#a1a1aa' },
    future: { label: 'Upcoming', desc: 'Not yet active', icon: '⏳', color: '#94a3b8' },
    before_start: { label: 'Before start', desc: 'Tracking started later', icon: '—', color: '#cbd5e1' },
  }

  const editingRecord = editingKey ? attendance[editingKey] : null

  return (
    <div className="app-root">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');`}</style>

      <div className="phone-frame">
        <header className="header">
          <div className="header-left">
            <div className="logo-dot" />
            <span className="brand">WORK LOG</span>
            {isSupabaseConfigured && syncStatus!=='idle' && (
              <span className={`sync-badge ${syncStatus}`}>{syncStatus==='syncing'?'syncing…':syncStatus==='synced'?'synced ✓':'error'}</span>
            )}
          </div>
          <div className="header-right" style={{display:'flex', gap:8, alignItems:'center'}}>
            {isSupabaseConfigured ? (
              authLoading ? (
                <div className="icon-btn" style={{pointerEvents:'none', opacity:0.6}}><span className="spin" /></div>
              ) : user ? (
                <>
                  <div className="user-chip" title={`${displayName} — ${user.email}`}>
                    <span className="user-dot" />
                    <span className="user-email">{displayName}</span>
                  </div>
                  <button className="icon-btn" onClick={handleLogout} aria-label="Logout" title="Logout">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  </button>
                </>
              ) : (
                <button className="btn-cloud" onClick={()=>{setShowAuth(true); setAuthMode('signin')}}>Sign in</button>
              )
            ) : null}
            <button className="theme-toggle" onClick={()=>setTheme(theme==='light'?'dark':'light')} aria-label="Toggle theme" title={`Switch to ${theme==='light'?'dark':'light'} mode`}>
              {theme==='light' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3a6 6 0 0 0 9 9c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9Z"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
              )}
            </button>
            <button className="icon-btn" onClick={()=>setShowSettings(true)} aria-label="Settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 9 15a1.65 1.65 0 0 0-1.51-1H7a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 13 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 23 9a1.65 1.65 0 0 0-1.51 1H21a2 2 0 0 1 0 4h.09a1.65 1.65 0 0 0 1.51 1Z"/></svg>
            </button>
          </div>
        </header>

        {!isSupabaseConfigured && (
          <div className="config-banner">
            <span>Cloud sync not configured.</span>
            <a href="#" onClick={(e)=>{e.preventDefault(); setShowSettings(true)}}>Setup →</a>
          </div>
        )}

        {cloudError && (
          <div className="error-banner">
            <span>{cloudError}</span>
            <button onClick={()=>setCloudError('')}>×</button>
          </div>
        )}

        {user && displayName && (
          <div className="welcome-banner">
            <div className="welcome-avatar">{displayName.charAt(0).toUpperCase()}</div>
            <div className="welcome-text">
              <span className="welcome-name">Hi, {displayName}</span>
              <span className="welcome-sub">{user.email} · {startMonthKey ? `Started ${startMonthKey}` : ''}</span>
            </div>
          </div>
        )}

        <div className="seg-wrap">
          <div className="segmented">
            <button className={view==='month'?'active':''} onClick={()=>setView('month')}>Month</button>
            <button className={view==='year'?'active':''} onClick={()=>setView('year')}>Year</button>
          </div>
        </div>

        {view==='month' ? (
          <>
            <div className="month-nav">
              <button className="nav-btn" onClick={goPrevMonth} disabled={(() => {
                if (!startMonthKey) return false
                const { year: sY, month: sM } = parseMonthKey(startMonthKey)
                return (year*12 + month) -1 < sY*12 + sM
              })()} style={{opacity: (() => {
                if (!startMonthKey) return 1
                const { year: sY, month: sM } = parseMonthKey(startMonthKey)
                return (year*12 + month) -1 < sY*12 + sM ? 0.3 : 1
              })()}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 18-6-6 6-6"/></svg></button>
              <div className="month-title">
                <span className="month-name">{getMonthName(month)}</span>
                <span className="year-name" style={{display:'flex', gap:6, alignItems:'center'}}>
                  {year}
                  <span className={`status-dot ${monthStatus}`} title={statusConfig[monthStatus]?.label} />
                  {startMonthKey && monthKey(year, month)===startMonthKey && <span style={{fontSize:'9px', background:'#1a1a1a', border:'1px solid #2a2a2a', padding:'1px 5px', borderRadius:4, marginLeft:4, color:'#f8fafc'}}>START</span>}
                </span>
              </div>
              <button className="nav-btn" onClick={goNextMonth}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 18 6-6-6-6"/></svg></button>
            </div>

            <div className={`month-status-banner ${monthStatus}`}>
              <div className="msb-left">
                <span className="msb-icon">{statusConfig[monthStatus]?.icon}</span>
                <span className="msb-label">{statusConfig[monthStatus]?.label}</span>
                <span className="msb-desc">· {statusConfig[monthStatus]?.desc}</span>
              </div>
              {monthStatus!=='active' && (
                <button className="msb-action" onClick={goToCurrentMonth}>Go to current</button>
              )}
            </div>

            {monthStatus==='locked' && monthlyStats.days>0 && (
              <div className="final-salary-banner">
                <div className="fsb-label">Final salary for {getMonthName(month)} {year}</div>
                <div className="fsb-amount">{formatNaira(monthlyStats.total)}</div>
                <div className="fsb-details">{monthlyStats.days} days · {monthlyStats.regularDays} regular · {monthlyStats.weekendDays} weekend · {monthlyStats.overtimeDays} OT · Locked</div>
              </div>
            )}

            {monthStatus==='future' && (
              <div className="info-banner">This month hasn't started yet. Opens on {getMonthName(month)} {year}. You can view it but not edit.</div>
            )}

            {monthStatus==='before_start' && (
              <div className="info-banner">Tracking started in {startMonthKey ? (()=>{const {year, month}=parseMonthKey(startMonthKey); return `${getMonthName(month)} ${year}`})() : 'current month'}. No records before that.</div>
            )}

            <div className="weekdays">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((w,idx)=><div key={w} className={idx>=5?'weekend-label':''}>{w}</div>)}
            </div>

            <div className={`calendar-grid ${!isEditable ? 'locked-grid' : ''}`}>
              {calendarData.cells.map((dateObj,i)=>{
                if(!dateObj) return <div key={'empty-'+i} className="cell empty" />
                const key=formatDateKey(dateObj)
                const record=attendance[key]
                const isToday=key===todayKey
                const isWeekend=isWeekendDay(dateObj)
                const worked=!!record
                const isOvertime = record?.isOvertime
                return (
                  <button key={key} className={`cell ${worked?'worked':''} ${isWeekend?'is-weekend':''} ${isToday?'is-today':''} ${!isEditable?'locked-cell':''} ${isOvertime?'is-overtime':''}`} onClick={()=>handleCellClick(dateObj)} disabled={!isEditable && !worked}>
                    <span className="date-num">{dateObj.getDate()}</span>
                    {worked && (
                      <span className={`stamp ${record.isWeekend ? 'stamp-2x' : record.isOvertime ? 'stamp-ot' : 'stamp-ok'}`}>
                        {record.isWeekend ? '2×' : record.isOvertime ? 'OT' : 'OK'}
                      </span>
                    )}
                    {isToday && !worked && <span className="today-dot" />}
                    {!isEditable && worked && <span className="locked-overlay">🔒</span>}
                    {worked && !isWeekend && isEditable && (
                      <span className="edit-corner" onClick={(e)=>handleEditButtonClick(e, dateObj)} title="Edit to overtime">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="summary-card">
              <div className="summary-top">
                <div className="summary-amount">
                  {formatNaira(monthlyStats.total)}
                  {monthStatus==='locked' && <span className="final-badge">FINAL</span>}
                  {monthStatus==='active' && <span className="active-badge">IN PROGRESS</span>}
                </div>
                <div className="summary-sub">
                  {displayName ? `${displayName} · ` : ''}{monthlyStats.days} day{monthlyStats.days!==1?'s':''} {monthStatus==='locked' ? 'worked · Locked' : monthStatus==='active' ? 'worked · Editable' : 'worked'} {isSupabaseConfigured && user && <span className="cloud-hint">· cloud synced</span>}
                </div>
              </div>
              <div className="summary-divider" />
              <div className="summary-rows">
                <div className="summary-row"><span>Regular <span className="mini-stamp ok">OK</span></span><span className="mono">{monthlyStats.regularDays} × {formatNaira(settings.dailyRate)}</span></div>
                <div className="summary-row"><span>Weekend <span className="mini-stamp x2">2×</span></span><span className="mono">{monthlyStats.weekendDays} × {formatNaira(settings.dailyRate*settings.weekendMultiplier)}</span></div>
                <div className="summary-row"><span>Overtime <span className="mini-stamp ot">OT 2×</span></span><span className="mono">{monthlyStats.overtimeDays} × {formatNaira(settings.dailyRate*settings.weekendMultiplier)}</span></div>
                <div className="summary-row" style={{marginTop:4, paddingTop:10, borderTop:'1px dashed var(--border)'}}><span><strong>Monthly {monthStatus==='locked'?'Final Salary':'Total'}</strong></span><span className="mono" style={{fontWeight:800, color:'var(--text)', fontSize:'14px'}}>{formatNaira(monthlyStats.total)}</span></div>
              </div>
              {isEditable && (
                <div className="empty-hint">
                  {monthlyStats.days===0 ? 'Tap a weekday to log OK. Tap edit icon (top-right) to switch to OT 2×. Weekends auto 2×.' : 'Tap a worked weekday to edit to OT. Weekends tap to remove. Current month editable.'}
                </div>
              )}
              {!isEditable && <div className="empty-hint locked-hint">{monthStatus==='locked' ? '🔒 This month is locked and read-only. Final salary preserved including OT.' : monthStatus==='future' ? '⏳ Future month — not yet active.' : 'Tracking started later.'}</div>}
            </div>
          </>
        ) : (
          <>
            <div className="month-nav">
              <button className="nav-btn" onClick={goPrevYear} disabled={(() => {
                if (!startMonthKey) return false
                return (year - 1) < parseMonthKey(startMonthKey).year
              })()} style={{opacity: (() => {
                if (!startMonthKey) return 1
                return (year - 1) < parseMonthKey(startMonthKey).year ? 0.3 : 1
              })()}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 18-6-6 6-6"/></svg></button>
              <div className="month-title"><span className="month-name">{year}</span><span className="year-name">Year view · {year===realYear ? 'Current year' : year < realYear ? 'Historical' : 'Future'} {startMonthKey && year===parseMonthKey(startMonthKey).year ? `· Started ${getMonthName(parseMonthKey(startMonthKey).month)}` : ''}</span></div>
              <button className="nav-btn" onClick={goNextYear}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 18 6-6-6-6"/></svg></button>
            </div>

            <div className="year-totals">
              <div className="yt-main">
                <div className="yt-amount">{formatNaira(yearlyStats.total)}</div>
                <div className="yt-label">
                  {year===realYear ? `Total earned this year` : year < realYear ? `Total earned in ${year} — Final` : `Future year`}
                  {displayName ? ` · ${displayName}` : ''} · {yearlyStats.days} days ({yearlyStats.regularDays} regular, {yearlyStats.weekendDays} weekend, {yearlyStats.overtimeDays} OT)
                </div>
                {year===realYear && (
                  <div className="yt-sub">
                    {yearlyStats.monthly.filter(m=>m.status==='locked').length} locked · {yearlyStats.monthly.filter(m=>m.status==='active').length} active · {yearlyStats.monthly.filter(m=>m.status==='future').length} upcoming
                  </div>
                )}
              </div>
              <div className="yt-grid">
                <div className="yt-item"><div className="yt-num mono">{yearlyStats.days}</div><div className="yt-cap">Days worked</div></div>
                <div className="yt-item"><div className="yt-num mono">{yearlyStats.overtimeDays}</div><div className="yt-cap">OT days</div></div>
                <div className="yt-item"><div className="yt-num mono">{yearlyStats.weekendDays}</div><div className="yt-cap">Weekend</div></div>
              </div>

              <div className="annual-breakdown">
                <div className="ab-title">
                  {(() => {
                    if (!startMonthKey) return `Monthly breakdown — ${year}`
                    const { year: sY, month: sM } = parseMonthKey(startMonthKey)
                    if (year < sY) return `No breakdown — started ${getMonthName(sM)} ${sY}`
                    if (year === sY) return `Breakdown — ${getMonthName(sM)} to Dec ${year}`
                    return `Breakdown — ${year}`
                  })()}
                </div>
                {(() => {
                  if (!startMonthKey) return yearlyStats.monthly
                  const { year: sY, month: sM } = parseMonthKey(startMonthKey)
                  if (year < sY) return []
                  if (year === sY) return yearlyStats.monthly.filter(m=>m.month >= sM)
                  return yearlyStats.monthly
                })().map(m=>{
                  return (
                    <div key={m.month} className={`ab-row ${m.status}`}>
                      <span className="ab-month">{getMonthName(m.month, true)}</span>
                      <span className={`ab-status ${m.status}`}>{m.status==='locked'?'🔒':m.status==='active'?'●':m.status==='future'?'⏳':'—'}</span>
                      <span className="ab-days mono">{m.days>0?`${m.days}d`:'—'}</span>
                      <span className="ab-amount mono">{m.total>0?formatNaira(m.total):'₦0'}</span>
                    </div>
                  )
                })}
                {(() => {
                  if (!startMonthKey) return true
                  return year >= parseMonthKey(startMonthKey).year
                })() && (
                  <div className="ab-total">
                    <span>Total {year} {startMonthKey && year===parseMonthKey(startMonthKey).year ? `(from ${getMonthName(parseMonthKey(startMonthKey).month)})` : ''}</span>
                    <span className="mono">{formatNaira(yearlyStats.total)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="months-list">
              {(() => {
                if (!startMonthKey) return null
                const { year: sY, month: sM } = parseMonthKey(startMonthKey)
                if (year < sY) return <div className="info-banner">Tracking started in {getMonthName(sM)} {sY}. No records before that.</div>
                return null
              })()}
              <div className="ml-header">
                {(() => {
                  if (!startMonthKey) return 'Tap month to view — locked read-only, weekdays editable via edit icon for OT'
                  const { year: sY, month: sM } = parseMonthKey(startMonthKey)
                  if (year < sY) return `No months before ${getMonthName(sM)} ${sY}`
                  if (year === sY) return `From ${getMonthName(sM)} ${sY} onward — tap month, edit weekdays to OT via corner icon`
                  return 'Tap month to view — weekdays have edit icon for OT 2×'
                })()}
              </div>
              {yearlyStats.monthly
                .filter(m => {
                  if (!startMonthKey) return true
                  const { year: sY, month: sM } = parseMonthKey(startMonthKey)
                  if (year < sY) return false
                  if (year === sY && m.month < sM) return false
                  return true
                })
                .map(m=>(
                <button key={m.month} className={`month-row ${m.status}`} onClick={()=>openMonth(m.month)}>
                  <div className="mr-left">
                    <span className="mr-name">{getMonthName(m.month,true)}</span>
                    <span className={`mr-status ${m.status}`}>{m.status==='locked'?'🔒':m.status==='active'?'●':m.status==='future'?'⏳':'—'}</span>
                    <span className="mr-days mono">{m.days>0?`${m.days}d`:'—'}</span>
                  </div>
                  <div className="mr-right">
                    <span className="mr-amount mono">{m.total>0?formatNaira(m.total):'₦0'}</span>
                    {m.status==='locked' && <span className="mr-final">FINAL</span>}
                    {m.status==='active' && <span className="mr-active">ACTIVE</span>}
                    <span className="mr-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 18 6-6-6-6"/></svg></span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="footer">
          <span className="footer-dot" /> {displayName ? `${displayName} · ` : ''}{settings.dailyRate.toLocaleString('en-NG')} / day · {settings.weekendMultiplier}× weekend/OT {monthStatus==='locked'?'· 🔒 locked':monthStatus==='active'?'· ● active':''} {isSupabaseConfigured && user ? '· ☁ synced' : '· local'} {startMonthKey ? `· Started ${startMonthKey}` : ''}
        </div>
      </div>

      {/* Overtime Edit Menu */}
      {editingKey && (
        <div className="modal-overlay" onClick={()=>{setEditingKey(null); setEditingDate(null)}}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:360}}>
            <div className="modal-header">
              <span>Edit {editingDate ? `${getMonthName(editingDate.getMonth())} ${editingDate.getDate()}, ${editingDate.getFullYear()}` : editingKey}</span>
              <button className="icon-btn small" onClick={()=>{setEditingKey(null); setEditingDate(null)}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="modal-body">
              {editingRecord && (
                <>
                  <div className="info-box" style={{marginTop:0}}>
                    <div className="info-row"><span>Current</span><span className="mono" style={{fontWeight:700}}>{editingRecord.isOvertime ? 'OT 2×' : editingRecord.isWeekend ? 'Weekend 2×' : 'Regular OK'} · {formatNaira(editingRecord.amount)}</span></div>
                    <div className="info-row sub"><span>Date</span><span className="mono">{editingRecord.date} · {editingRecord.isWeekend ? 'Weekend' : editingRecord.isOvertime ? 'Overtime' : 'Weekday'}</span></div>
                  </div>

                  <div style={{marginTop:16, display:'flex', flexDirection:'column', gap:10}}>
                    <button className={`ot-option ${!editingRecord.isWeekend && !editingRecord.isOvertime ? 'selected' : ''}`} onClick={()=>handleOvertimeAction('regular')}>
                      <span className="ot-opt-left"><span className="mini-stamp ok">OK</span> Regular</span>
                      <span className="mono">{formatNaira(editingRecord.rate)}</span>
                    </button>
                    <button className={`ot-option ${editingRecord.isOvertime ? 'selected' : ''}`} onClick={()=>handleOvertimeAction('overtime')}>
                      <span className="ot-opt-left"><span className="mini-stamp ot">OT</span> Overtime 2×</span>
                      <span className="mono">{formatNaira(editingRecord.rate * settings.weekendMultiplier)}</span>
                    </button>
                    <button className="ot-option danger" onClick={()=>handleOvertimeAction('remove')}>
                      <span className="ot-opt-left">🗑 Remove entry</span>
                      <span className="mono">Delete</span>
                    </button>
                  </div>

                  <p className="field-hint" style={{marginTop:14}}>Overtime uses same 2× multiplier as weekend. Weekends remain 2× and can't be edited to OT (as requested). Amount always calculated from rate.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="modal-overlay" onClick={()=>setShowSettings(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><span>Settings</span><button className="icon-btn small" onClick={()=>setShowSettings(false)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
            <div className="modal-body">
              {user && (
                <>
                  <label className="field-label">Display name</label>
                  <div className="field-wrap" style={{marginBottom:8}}>
                    <input className="field-input" value={profileName} onChange={e=>setProfileName(e.target.value)} placeholder="Your name" />
                  </div>
                  <button className="btn-secondary" style={{width:'100%', height:40, marginBottom:16}} onClick={handleSaveProfileName} disabled={profileSaving || !profileName.trim()}>
                    {profileSaving ? 'Saving…' : 'Save name'}
                  </button>
                </>
              )}

              <label className="field-label">Daily rate (₦)</label>
              <div className="field-wrap"><span className="field-prefix">₦</span><input className="field-input mono" value={rateInput} onChange={e=>setRateInput(e.target.value.replace(/[^0-9,]/g,''))} inputMode="numeric" placeholder="16000" /></div>
              <p className="field-hint">Changing rate affects new entries only. Locked months never affected. Overtime = rate × 2.</p>

              <div className="info-box">
                <div className="info-row"><span>Regular (OK)</span><span className="mono">{formatNaira(settings.dailyRate)}</span></div>
                <div className="info-row"><span>Weekend (2×)</span><span className="mono">{formatNaira(settings.dailyRate*settings.weekendMultiplier)}</span></div>
                <div className="info-row"><span>Overtime (OT 2×)</span><span className="mono">{formatNaira(settings.dailyRate*settings.weekendMultiplier)}</span></div>
                <div className="info-row sub"><span>Weekdays: tap OK then edit icon to OT · Weekends auto 2×, no OT</span></div>
              </div>

              <div className="info-box" style={{marginTop:12}}>
                <div className="info-row"><span>Current month</span><span className="mono">{getMonthName(realMonth)} {realYear} · Active</span></div>
                <div className="info-row"><span>Tracking started</span><span className="mono">{startMonthKey || '—'}</span></div>
              </div>

              <div className="info-box" style={{marginTop:12}}>
                <div className="info-row"><span>Cloud sync</span><span className="mono" style={{color: isSupabaseConfigured ? '#22c55e' : '#ef4444'}}>{isSupabaseConfigured ? (user ? `${displayName || 'Signed in'} · ${user.email}` : 'ready — sign in') : 'not configured'}</span></div>
              </div>

              <div className="modal-actions">
                <button className="btn-secondary" onClick={()=>setShowSettings(false)}>Cancel</button>
                <button className="btn-primary" onClick={handleSaveRate}>Save rate</button>
              </div>

              <div className="storage-info">
                {isSupabaseConfigured && user ? `Hybrid for ${displayName || user.email}. Started ${startMonthKey}.` : `Started ${startMonthKey}. Local.`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {showAuth && (
        <div className="modal-overlay" onClick={()=>{setShowAuth(false); setShowForgot(false); setForgotSent(false)}}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span>{showForgot ? 'Reset password' : authMode==='signin' ? 'Sign in' : 'Create account'}</span>
              <button className="icon-btn small" onClick={()=>{setShowAuth(false); setShowForgot(false); setForgotSent(false)}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="modal-body">
              {!showForgot ? (
                <form onSubmit={handleAuthSubmit}>
                  {authMode==='signup' && (
                    <>
                      <label className="field-label">Full name</label>
                      <div className="field-wrap" style={{marginBottom:12}}>
                        <input className="field-input" type="text" required value={authForm.name} onChange={e=>setAuthForm({...authForm, name:e.target.value})} placeholder="e.g. John Doe" />
                      </div>
                    </>
                  )}
                  <label className="field-label">Email</label>
                  <div className="field-wrap" style={{marginBottom:12}}>
                    <input className="field-input" type="email" required value={authForm.email} onChange={e=>setAuthForm({...authForm, email:e.target.value})} placeholder="you@example.com" />
                  </div>
                  <label className="field-label">Password</label>
                  <div className="field-wrap">
                    <input className="field-input" type="password" required minLength={6} value={authForm.password} onChange={e=>setAuthForm({...authForm, password:e.target.value})} placeholder="••••••••" />
                  </div>
                  {authMode==='signin' && (
                    <button type="button" className="link-btn" onClick={()=>{setShowForgot(true); setForgotEmail(authForm.email); setForgotSent(false); setAuthError('')}}>
                      Forgot password?
                    </button>
                  )}
                  {authError && <div className="auth-error">{authError}</div>}
                  <div className="modal-actions" style={{marginTop:18}}>
                    <button type="button" className="btn-secondary" onClick={()=>setAuthMode(authMode==='signin'?'signup':'signin')}>
                      {authMode==='signin' ? 'Need account? Sign up' : 'Have account? Sign in'}
                    </button>
                    <button type="submit" className="btn-primary" disabled={authBusy}>
                      {authBusy ? 'Please wait…' : authMode==='signin' ? 'Sign in' : 'Sign up'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleForgotPassword}>
                  <label className="field-label">Reset password</label>
                  <p className="field-hint" style={{marginBottom:12}}>Enter your email and we'll send you a password reset link. Check spam too.</p>
                  <div className="field-wrap" style={{marginBottom:12}}>
                    <input className="field-input" type="email" required value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  {forgotSent ? (
                    <div className="success-banner">✅ Reset link sent! Check email, click link to set new password.</div>
                  ) : (
                    authError && <div className="auth-error">{authError}</div>
                  )}
                  <div className="modal-actions" style={{marginTop:18}}>
                    <button type="button" className="btn-secondary" onClick={()=>setShowForgot(false)}>Back to sign in</button>
                    <button type="submit" className="btn-primary" disabled={forgotBusy || forgotSent}>
                      {forgotBusy ? 'Sending…' : forgotSent ? 'Sent ✓' : 'Send reset link'}
                    </button>
                  </div>
                </form>
              )}
              <div className="storage-info" style={{marginTop:12}}>
                Hybrid offline-first: data cached locally, synced to cloud when signed in.
              </div>
            </div>
          </div>
        </div>
      )}

      {showRecovery && (
        <div className="modal-overlay" onClick={()=>setShowRecovery(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <span>Set new password</span>
              <button className="icon-btn small" onClick={()=>setShowRecovery(false)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleRecoverySubmit}>
                <label className="field-label">New password</label>
                <div className="field-wrap" style={{marginBottom:12}}>
                  <input className="field-input" type="password" required minLength={6} value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <p className="field-hint">Must be at least 6 characters.</p>
                {recoveryError && <div className="auth-error">{recoveryError}</div>}
                <div className="modal-actions" style={{marginTop:18}}>
                  <button type="button" className="btn-secondary" onClick={()=>setShowRecovery(false)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={recoveryBusy}>
                    {recoveryBusy ? 'Saving…' : 'Save new password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
