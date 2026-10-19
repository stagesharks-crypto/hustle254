import { useEffect, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
const USD_TO_KES = 128
const MINIMUM_WITHDRAWAL_KES = USD_TO_KES
const depositPaymentDetails = [
  { method: 'M-Pesa direct', detail: 'Send to 0740582544.' },
  { method: 'M-Pesa Till', detail: 'Send to Till 4962757.' },
  { method: 'PayPal', detail: 'Send to shadrackechesa40@gmail.com.' },
  { method: 'USDT BEP20', detail: 'Send to 0x9e48fb73a5e51469897faabe06900202d9921913. Use the BEP20 network only.' },
]
const walletMethodLabels = {
  mpesa: 'M-Pesa',
  mpesa_till: 'M-Pesa Till',
  paypal: 'PayPal',
  usdt_bep20: 'USDT BEP20',
  crypto: 'Cryptocurrency',
  till: 'Till',
  bank: 'Bank transfer',
}
const withdrawalMethods = [
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'crypto', label: 'Cryptocurrency (USDT BEP20)' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'till', label: 'Till' },
  { value: 'bank', label: 'Bank transfer' },
]

function isValidEmailAddress(value) {
  if (typeof value !== 'string' || value.length > 254) return false
  const parts = value.trim().split('@')
  if (parts.length !== 2) return false

  const [localPart, domain] = parts
  if (
    localPart.length > 64
    || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(localPart)
  ) return false

  const labels = domain.split('.')
  return labels.length >= 2 && labels.every((label) => (
    label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  ))
}

async function apiRequest(path, options = {}) {
  const { token, ...requestOptions } = options
  const response = await fetch(`${API_BASE_URL}/api${path}`, {
    ...requestOptions,
    headers: {
      ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...requestOptions.headers,
    },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(result.message || 'Request failed. Please try again.')
    error.code = result.code
    error.email = result.email
    error.resendAfterSeconds = result.resendAfterSeconds
    throw error
  }
  return result
}

function normalizeTask(task) {
  const riskLevel = task.risk || task.risk_level || 'low'
  return {
    ...task,
    id: String(task.id),
    amount: task.amount || `KSh ${Number(task.payout_kes).toLocaleString('en-KE')}`,
    duration: task.duration || (task.duration_minutes ? `${task.duration_minutes} min` : 'Flexible'),
    risk: riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1),
  }
}

function formatKes(value) {
  return `KSh ${Number(value || 0).toLocaleString('en-KE')}`
}

function formatKesWithUsd(value) {
  const amount = Number(value || 0)
  return `${formatKes(amount)} ($${(amount / USD_TO_KES).toFixed(2)})`
}

function getWithdrawalFeeKes(amountKes) {
  const amount = Number(amountKes)
  if (!Number.isFinite(amount) || amount < MINIMUM_WITHDRAWAL_KES) return 0
  if (amount <= USD_TO_KES * 3) return 10
  if (amount <= USD_TO_KES * 7) return 15
  return 25
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('en-KE') : 'Date unavailable'
}

function getTokenClaims(token) {
  try {
    const encodedPayload = token.split('.')[1]
    if (!encodedPayload) return null
    const base64Payload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const paddedPayload = base64Payload.padEnd(Math.ceil(base64Payload.length / 4) * 4, '=')
    return JSON.parse(atob(paddedPayload))
  } catch {
    return null
  }
}

function getNairobiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`
}

function getNextNairobiMidnightTimestamp(now = new Date()) {
  const today = getNairobiDateKey(now)
  let low = now.getTime()
  let high = low + 36 * 60 * 60 * 1000

  while (getNairobiDateKey(new Date(high)) === today) {
    high += 12 * 60 * 60 * 1000
  }

  while (high - low > 1000) {
    const midpoint = Math.floor((low + high) / 2)
    if (getNairobiDateKey(new Date(midpoint)) === today) low = midpoint
    else high = midpoint
  }

  return high
}

function getUserInitials(name, fallback = 'User') {
  const source = String(name || fallback || 'User').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

const publicNavigation = [
  { label: 'Home', icon: 'H' },
  { label: 'Tasks', icon: 'T' },
  { label: 'Surveys', icon: 'S' },
  { label: 'Features', icon: 'F' },
]

const learningNavigation = [
  { label: 'About', icon: 'A' },
  { label: 'Contact', icon: '@' },
  { label: 'Learn & policies', icon: 'i' },
]

const accountNavigation = [
  { label: 'Dashboard', icon: 'D' },
  { label: 'Wallet', icon: 'W' },
  { label: 'Streaks', icon: '7' },
  { label: 'Referral', icon: 'R', title: 'Refer & Earn' },
]

const memberPages = new Set(['Tasks', 'Wallet', 'Streaks', 'Referral', 'Dashboard', 'Admin', 'Poster', 'Post a task'])

const howSteps = [
  { title: 'Create your account', text: 'Sign up quickly with your phone number, profile basics, and KYC-friendly verification.' },
  { title: 'Complete trusted tasks', text: 'Take surveys, social tasks, app trials, and offer missions with transparent reward values.' },
  { title: 'Submit proof securely', text: 'Use the requested proof method and allow time for eligibility and quality checks.' },
  { title: 'Withdraw in your preferred method', text: 'Submit a payout request to M-Pesa, PayPal, USDT, Till, or a bank account.' },
]

const featureCards = [
  { title: 'Survey & offer wall', text: 'High-quality daily tasks with clear payouts and category filtering.', tag: 'Fast earnings' },
  { title: 'Referral & affiliation', text: 'Earn KSh 5 for an admin-verified tasker referral or KSh 30 for an approved, funded poster referral.', tag: 'Growth loop' },
  { title: 'Streak boosters', text: 'Daily rewards, milestones, and seasonal bonuses to improve retention.', tag: 'Retention' },
  { title: 'Wallet transparency', text: 'Track pending, approved, rejected, and withdrawn balances in real time.', tag: 'Trust' },
  { title: 'Fraud shield', text: 'Camera-only proof capture, IP/device checks, and a consistent review process.', tag: 'Security' },
  { title: 'Admin control center', text: 'Approve payouts, manage campaigns, detect abuse, and monitor analytics.', tag: 'Operations' },
]

const trustChecks = [
  'Gallery upload disabled for proof tasks',
  'Live camera capture required for submission verification',
  'IP/device fingerprinting to detect duplicate abuse',
  'Admin review queue for every payout approval',
  'KYC for high-value payout requests',
  'Rate limits and abuse flags for suspicious behavior',
]

function App() {
  const [currentPage, setCurrentPageState] = useState('Home')
  const [theme, setTheme] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('hustle254-theme')
      return ['dark', 'light', 'kenya'].includes(savedTheme) ? savedTheme : 'dark'
    } catch {
      return 'dark'
    }
  })
  const pageHistory = useRef(['Home'])
  const [canGoBack, setCanGoBack] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [profileTab, setProfileTab] = useState('overview')
  const [passwordNotice, setPasswordNotice] = useState('')
  const [verificationContext, setVerificationContext] = useState({ email: '', message: '', devVerificationCode: '', resendAfterSeconds: 0 })
  const [tasks, setTasks] = useState([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasksError, setTasksError] = useState('')
  const [taskPosts, setTaskPosts] = useState([])
  const [taskPostError, setTaskPostError] = useState('')
  const [dailyStreakRecord, setDailyStreakRecord] = useState(null)
  const [streakError, setStreakError] = useState('')
  const [streakRefreshVersion, setStreakRefreshVersion] = useState(0)
  const [sessionNotice, setSessionNotice] = useState('')
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('hustle254-session') || 'null')
    } catch {
      return null
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
    try {
      localStorage.setItem('hustle254-theme', theme)
    } catch {
      // The selected theme still applies for this session if storage is unavailable.
    }
  }, [theme])

  function setCurrentPage(page, { replace = false } = {}) {
    const history = pageHistory.current
    if (replace) {
      history[history.length - 1] = page
    } else if (history[history.length - 1] !== page) {
      history.push(page)
    }
    setCanGoBack(history.length > 1)
    setCurrentPageState(page)
  }

  function setNavigationRoot(page) {
    pageHistory.current = [page]
    setCanGoBack(false)
    setCurrentPageState(page)
    setIsMenuOpen(false)
  }

  function handleVerificationRequested(email, result = {}) {
    setVerificationContext({
      email,
      message: result.message || 'Enter the code sent to your email to activate your account.',
      devVerificationCode: result.devVerificationCode || '',
      resendAfterSeconds: Number(result.resendAfterSeconds || 0),
    })
    setCurrentPage('Verify email')
  }

  function goBack() {
    if (pageHistory.current.length <= 1) {
      setNavigationRoot('Home')
      return
    }
    pageHistory.current.pop()
    const previousPage = pageHistory.current[pageHistory.current.length - 1] || 'Home'
    setCanGoBack(pageHistory.current.length > 1)
    setCurrentPageState(previousPage)
    setIsMenuOpen(false)
  }

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || tasks[0] || null
  const hasStreakAccess = Boolean(session?.token && ['user', 'poster'].includes(session.user?.role))
  const dailyStreak = dailyStreakRecord && dailyStreakRecord.userId === session?.user?.id
    ? dailyStreakRecord.streak
    : null
  const streakLoading = hasStreakAccess && !dailyStreak && !streakError

  useEffect(() => {
    if (!hasStreakAccess) return undefined

    let active = true
    apiRequest('/user/streak/check-in', { method: 'POST', token: session.token })
      .then(({ streak }) => {
        if (active) {
          setDailyStreakRecord({ userId: session.user.id, streak })
          setStreakError('')
        }
      })
      .catch((requestError) => {
        if (active) setStreakError(requestError.message)
      })
    return () => { active = false }
  }, [hasStreakAccess, session?.token, session?.user?.id, streakRefreshVersion])

  useEffect(() => {
    if (!session?.token) return undefined

    const claims = getTokenClaims(session.token)
    const role = session.user?.role
    const isDailySession = ['user', 'poster'].includes(role)
    const now = new Date()
    let expiresAt = claims?.exp ? Number(claims.exp) * 1000 : now.getTime()

    if (isDailySession) {
      const issuedDate = claims?.iat ? getNairobiDateKey(new Date(Number(claims.iat) * 1000)) : ''
      if (issuedDate !== getNairobiDateKey(now)) expiresAt = now.getTime()
      expiresAt = Math.min(expiresAt, getNextNairobiMidnightTimestamp(now))
    }

    let timer
    const expireSession = () => {
      const remaining = expiresAt - Date.now()
      if (remaining > 0) {
        timer = window.setTimeout(expireSession, remaining + 250)
        return
      }
      localStorage.removeItem('hustle254-session')
      setSession(null)
      setDailyStreakRecord(null)
      setStreakError('')
      setProfileMenuOpen(false)
      setProfileModalOpen(false)
      setSessionNotice(isDailySession
        ? 'Your daily sign-in ended at midnight. Log in again to record today’s streak check-in.'
        : 'Your session has expired. Please log in again.')
      setNavigationRoot('Login')
    }

    timer = window.setTimeout(expireSession, Math.max(0, expiresAt - Date.now()) + 250)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && Date.now() >= expiresAt) expireSession()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [session?.token, session?.user?.role])

  useEffect(() => {
    const resetToken = new URLSearchParams(window.location.search).get('reset')
    if (resetToken) {
      setCurrentPage('Reset password')
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.delete('reset')
      window.history.replaceState({}, '', nextUrl)
    }
  }, [])

  useEffect(() => {
    apiRequest('/tasks')
      .then(({ tasks: publishedTasks }) => {
        const loadedTasks = publishedTasks.map(normalizeTask)
        setTasks(loadedTasks)
        setSelectedTaskId((currentId) => loadedTasks.some((task) => task.id === currentId) ? currentId : loadedTasks[0]?.id || '')
        setTasksError('')
      })
      .catch((error) => setTasksError(error.message))
      .finally(() => setTasksLoading(false))
  }, [])

  useEffect(() => {
    if (currentPage !== 'Admin' || !session?.adminToken) return
    apiRequest('/admin/task-posts', { token: session.adminToken })
      .then(({ taskPosts: posts }) => {
        setTaskPosts(posts)
        setTaskPostError('')
      })
      .catch((error) => setTaskPostError(error.message))
  }, [currentPage, session])

  async function createTaskPost(values) {
    return apiRequest('/task-posts', {
      method: 'POST',
      token: session?.token,
      body: JSON.stringify(values),
    })
  }

  async function moderateTaskPost(id, status) {
    const result = await apiRequest(`/admin/task-posts/${id}/status`, {
      method: 'PATCH',
      token: session?.adminToken,
      body: JSON.stringify({ status }),
    })
    setTaskPosts((currentPosts) => currentPosts.map((post) => (
      post.id === id
        ? { ...post, status, reviewed_at: new Date().toISOString() }
        : post
    )))
    if (status === 'approved') {
      const { tasks: publishedTasks } = await apiRequest('/tasks')
      setTasks(publishedTasks.map(normalizeTask))
    }
    return result
  }

  async function deleteTaskPost(id) {
    await apiRequest(`/admin/task-posts/${id}`, {
      method: 'DELETE',
      token: session?.adminToken,
    })
    setTaskPosts((currentPosts) => currentPosts.filter((post) => post.id !== id))
    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== String(id)))
  }

  function handleAuthenticated(nextSession) {
    localStorage.setItem('hustle254-session', JSON.stringify(nextSession))
    setSession(nextSession)
    setSessionNotice('')
    setDailyStreakRecord(null)
    setStreakError('')
    setStreakRefreshVersion((version) => version + 1)
    const landingPage = nextSession.user.role === 'admin'
      ? 'Admin'
      : nextSession.user.role === 'poster'
        ? 'Poster'
        : 'Dashboard'
    setNavigationRoot(landingPage)
  }

  function handleAdminAuthenticated(nextSession) {
    localStorage.setItem('hustle254-session', JSON.stringify(nextSession))
    setSession(nextSession)
    setNavigationRoot('Admin')
  }

  async function handleAdminPassword(password) {
    const result = await apiRequest('/admin/access', {
      method: 'POST',
      token: session?.token,
      body: JSON.stringify({ password }),
    })
    const nextSession = { ...session, adminToken: result.adminToken }
    localStorage.setItem('hustle254-session', JSON.stringify(nextSession))
    setSession(nextSession)
  }

  function updateSessionUser(updater) {
    setSession((currentSession) => {
      if (!currentSession) return currentSession
      const nextSession = {
        ...currentSession,
        user: {
          ...currentSession.user,
          ...(typeof updater === 'function' ? updater(currentSession.user) : updater),
        },
      }
      localStorage.setItem('hustle254-session', JSON.stringify(nextSession))
      return nextSession
    })
  }

  function handleSignOut() {
    localStorage.removeItem('hustle254-session')
    setSession(null)
    setDailyStreakRecord(null)
    setStreakError('')
    setProfileMenuOpen(false)
    setProfileModalOpen(false)
    setNavigationRoot('Home')
  }

  function handleProfilePhotoUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      updateSessionUser((currentUser) => ({ ...currentUser, avatar: String(reader.result) }))
      setProfileTab('photo')
      setPasswordNotice('')
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  function handleRemoveProfilePhoto() {
    updateSessionUser((currentUser) => ({ ...currentUser, avatar: '' }))
  }

  function handlePasswordUpdate(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const currentPassword = String(formData.get('currentPassword') || '').trim()
    const newPassword = String(formData.get('newPassword') || '')
    const confirmPassword = String(formData.get('confirmPassword') || '')
    const savedPassword = session?.user?.password || ''

    if (savedPassword && currentPassword !== savedPassword) {
      setPasswordNotice('Your current password does not match the saved value on this device.')
      return
    }

    if (newPassword.length < 8) {
      setPasswordNotice('New password must be at least 8 characters long.')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordNotice('The new passwords do not match.')
      return
    }

    updateSessionUser((currentUser) => ({
      ...currentUser,
      password: newPassword,
      passwordUpdatedAt: new Date().toISOString(),
    }))
    setPasswordNotice('Password updated locally for this account.')
    event.currentTarget.reset()
  }

  const effectivePage = session && ['Login', 'Poster login', 'Sign up', 'Poster signup'].includes(currentPage) ? 'Dashboard' : currentPage
  const profileUser = session?.user || null
  const profileName = profileUser?.full_name || profileUser?.fullName || profileUser?.email || 'Profile'
  const profileInitials = getUserInitials(profileName, profileUser?.email || 'User')

  const renderPage = () => {
    if (!session && memberPages.has(effectivePage) && effectivePage !== 'Admin') {
      return <SignInRequiredPage setCurrentPage={setCurrentPage} />
    }

    switch (effectivePage) {
      case 'How it works':
        return <HowItWorksPage />
      case 'Features':
        return <FeaturesPage setCurrentPage={setCurrentPage} session={session} />
      case 'Wallet transparency':
        return (
          <AdminPage
            initialSection="Wallet transparency"
            session={session}
            onAuthenticated={handleAdminAuthenticated}
            onVerifyAdminPassword={handleAdminPassword}
            taskPosts={taskPosts}
            error={taskPostError}
            onModerateTaskPost={moderateTaskPost}
            onDeleteTaskPost={deleteTaskPost}
          />
        )
      case 'Tasks':
        return <TasksPage tasks={tasks} selectedTask={selectedTask} setSelectedTask={setSelectedTaskId} loading={tasksLoading} error={tasksError} session={session} />
      case 'Surveys':
        return session && ['user', 'poster'].includes(session.user.role)
          ? <SurveyPage session={session} setCurrentPage={setCurrentPage} />
          : <SignInRequiredPage setCurrentPage={setCurrentPage} />
      case 'Post a task':
        return session?.user?.role === 'poster'
          ? <PostTaskPage onSubmit={createTaskPost} user={session.user} />
          : <SignInRequiredPage setCurrentPage={setCurrentPage} />
      case 'Poster':
        return session?.user?.role === 'poster'
          ? <PosterPage session={session} setCurrentPage={setCurrentPage} />
          : <SignInRequiredPage setCurrentPage={setCurrentPage} />
      case 'Wallet':
        return <WalletPage session={session} streakDate={dailyStreak?.lastLoginDate} />
      case 'Streaks':
        return session && ['user', 'poster'].includes(session.user.role)
          ? <StreakPage streak={dailyStreak} loading={streakLoading} error={streakError} onRetry={() => setStreakRefreshVersion((version) => version + 1)} setCurrentPage={setCurrentPage} />
          : <SignInRequiredPage setCurrentPage={setCurrentPage} />
      case 'Referral':
        return <ReferralPage session={session} />
      case 'Dashboard':
        return <DashboardPage session={session} streakDate={dailyStreak?.lastLoginDate} onOpenProfile={() => { setProfileModalOpen(true); setProfileTab('overview') }} />
      case 'Admin':
        return (
          <AdminPage
            session={session}
            setCurrentPage={setCurrentPage}
            onAuthenticated={handleAdminAuthenticated}
            onVerifyAdminPassword={handleAdminPassword}
            taskPosts={taskPosts}
            error={taskPostError}
            onModerateTaskPost={moderateTaskPost}
            onDeleteTaskPost={deleteTaskPost}
          />
        )
      case 'Trust':
        return <LearnPage setCurrentPage={setCurrentPage} />
      case 'How it works':
      case 'Learn & policies':
        return <LearnPage setCurrentPage={setCurrentPage} />
      case 'About':
        return <AboutPage setCurrentPage={setCurrentPage} />
      case 'Contact':
        return <ContactPage />
      case 'Terms':
        return <TermsPage />
      case 'Privacy':
        return <PrivacyPage />
      case 'Earning rules':
        return <EarningRulesPage setCurrentPage={setCurrentPage} />
      case 'Legal':
        return <LearnPage setCurrentPage={setCurrentPage} />
      case 'Forgot password':
        return <ForgotPasswordPage onBack={() => setCurrentPage('Login')} />
      case 'Reset password':
        return <ResetPasswordPage onBack={() => setCurrentPage('Login')} onAuthenticated={handleAuthenticated} />
      case 'Verify email':
        return <VerifyEmailPage context={verificationContext} onAuthenticated={handleAuthenticated} onBack={() => setCurrentPage('Login')} />
      case 'Login':
      case 'Poster login':
      case 'Sign up':
      case 'Poster signup':
        return <AuthPage type={effectivePage === 'Poster login' ? 'posterLogin' : effectivePage === 'Login' ? 'login' : effectivePage === 'Poster signup' ? 'posterSignup' : 'signup'} onChangeType={(page) => setCurrentPage(page, { replace: true })} onAuthenticated={handleAuthenticated} onVerificationRequested={handleVerificationRequested} />
      case 'Home':
      default:
        return <HomePage setCurrentPage={setCurrentPage} session={session} />
    }
  }

  return (
    <div className={session ? 'app-shell has-session' : 'app-shell guest-shell'}>
      {session && <aside className={isMenuOpen ? 'side-menu open' : 'side-menu'} aria-label="Main menu">
        <div className="brand-wrap">
          <div className="brand-mark">H</div>
          <div>
            <div className="brand-name">Hustle254</div>
            <div className="brand-tag">Kenya rewards platform</div>
          </div>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <span className="side-nav-label">Explore</span>
          {publicNavigation.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => { setCurrentPage(item.label); setIsMenuOpen(false) }}
              className={currentPage === item.label ? 'side-nav-link active' : 'side-nav-link'}
            >
              <span className="side-nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <span className="side-nav-label account-label">How it works</span>
          {learningNavigation.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => { setCurrentPage(item.label); setIsMenuOpen(false) }}
              className={currentPage === item.label ? 'side-nav-link active' : 'side-nav-link'}
            >
              <span className="side-nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
          {session.user.role === 'poster' && <>
            <span className="side-nav-label account-label">Poster account</span>
            {[
              { label: 'Poster', icon: 'P', title: 'Poster account' },
              { label: 'Wallet', icon: 'W', title: 'Wallet' },
              { label: 'Streaks', icon: '7', title: 'Daily streak' },
              { label: 'Referral', icon: 'R', title: 'Refer & Earn' },
              { label: 'Post a task', icon: '+', title: 'Post a task' },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => { setCurrentPage(item.label); setIsMenuOpen(false) }}
                className={currentPage === item.label ? 'side-nav-link active' : 'side-nav-link'}
              >
                <span className="side-nav-icon" aria-hidden="true">{item.icon}</span>
                {item.title}
              </button>
            ))}
          </>}
          {(session.user.role === 'user' || session.user.role === 'admin') && <>
            <span className="side-nav-label account-label">Your account</span>
            {(session.user.role === 'user'
              ? accountNavigation
              : [{ label: 'Admin', icon: 'A' }]
            ).map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => { setCurrentPage(item.label); setIsMenuOpen(false) }}
                className={currentPage === item.label ? 'side-nav-link active' : 'side-nav-link'}
              >
                <span className="side-nav-icon" aria-hidden="true">{item.icon}</span>
                {item.title || item.label}
              </button>
            ))}
          </>}
        </nav>

        <div className="side-menu-footer">
          {session.user.role === 'poster' ? <>
            <p>For task posters</p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => { setCurrentPage('Post a task'); setIsMenuOpen(false) }}>Post a task</button>
          </> : session.user.role === 'user' ? <>
            <p>Want to publish tasks?</p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => { setCurrentPage('Poster signup'); setIsMenuOpen(false) }}>Register as a poster</button>
          </> : <>
            <p>Admin tools and account overview</p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => { setCurrentPage('Admin'); setIsMenuOpen(false) }}>Open admin dashboard</button>
          </>}
        </div>
      </aside>}

      {session && isMenuOpen && <button type="button" className="menu-backdrop" aria-label="Close navigation menu" onClick={() => setIsMenuOpen(false)} />}

      <div className="app-content">
        <header className={session ? 'topbar' : 'topbar guest-topbar'}>
          {(effectivePage !== 'Home' || canGoBack) && (
            <button type="button" className="topbar-back" onClick={goBack} aria-label="Go back to the previous page">
              <span aria-hidden="true">←</span> {canGoBack ? 'Back' : 'Home'}
            </button>
          )}
          {session && <button type="button" className="menu-toggle" aria-label="Open navigation menu" aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen(!isMenuOpen)}>
            <span /><span /><span />
          </button>}
          <div className="topbar-context">{effectivePage === 'Login' || effectivePage === 'Sign up' ? 'Your account' : effectivePage}</div>

          <div className="theme-picker" role="group" aria-label="Color theme">
            <button
              type="button"
              className={theme === 'dark' ? 'theme-option active' : 'theme-option'}
              onClick={() => setTheme('dark')}
              aria-label="Use Dark theme"
              aria-pressed={theme === 'dark'}
              title="Dark theme"
            >
              <span aria-hidden="true">☾</span><span className="theme-option-label">Dark</span>
            </button>
            <button
              type="button"
              className={theme === 'light' ? 'theme-option active' : 'theme-option'}
              onClick={() => setTheme('light')}
              aria-label="Use Light theme"
              aria-pressed={theme === 'light'}
              title="Light theme"
            >
              <span aria-hidden="true">☼</span><span className="theme-option-label">Light</span>
            </button>
            <button
              type="button"
              className={theme === 'kenya' ? 'theme-option active' : 'theme-option'}
              onClick={() => setTheme('kenya')}
              aria-label="Use Made in Kenya theme"
              aria-pressed={theme === 'kenya'}
              title="Made in Kenya theme"
            >
              <span className="theme-option-flag" aria-hidden="true"><i /><i /><i /></span>
              <span className="theme-option-label">Kenya</span>
            </button>
          </div>

          {session ? (
            <div className="topbar-profile-wrap">
              <button type="button" className="topbar-profile" onClick={() => setProfileMenuOpen((open) => !open)} aria-expanded={profileMenuOpen} aria-label="Open profile menu">
                <span className="profile-avatar" aria-hidden="true">
                  {profileUser?.avatar ? <img src={profileUser.avatar} alt="Profile" /> : <span>{profileInitials}</span>}
                </span>
                <span className="profile-account-copy">
                  <strong>{profileName}</strong>
                  <small>Profile</small>
                </span>
                <span className="profile-caret" aria-hidden="true">▾</span>
              </button>

              {profileMenuOpen && (
                <div className="profile-menu-popover" role="menu" aria-label="Account actions">
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); setProfileModalOpen(true); setProfileTab('overview') }} className="profile-menu-item">View profile</button>
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); setProfileModalOpen(true); setProfileTab('security') }} className="profile-menu-item">Change password</button>
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); setProfileModalOpen(true); setProfileTab('photo') }} className="profile-menu-item">Profile photo</button>
                  <button type="button" role="menuitem" onClick={handleSignOut} className="profile-menu-item profile-menu-danger">Log out</button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="topbar-account" onClick={() => setCurrentPage('Login')}>
              Log in <span aria-hidden="true">/</span> Sign up
            </button>
          )}
        </header>

        <main>
          {!session && sessionNotice && <div className="submission-success" role="status">{sessionNotice}</div>}
          {renderPage()}
        </main>

        {session && (
          <ProfileModal
            session={session}
            open={profileModalOpen}
            onClose={() => setProfileModalOpen(false)}
            activeTab={profileTab}
            setActiveTab={setProfileTab}
            onPhotoUpload={handleProfilePhotoUpload}
            onRemovePhoto={handleRemoveProfilePhoto}
            onPasswordSubmit={handlePasswordUpdate}
            passwordNotice={passwordNotice}
            setPasswordNotice={setPasswordNotice}
          />
        )}

        <footer className="site-footer">
          <div>
            <div className="brand-name">Hustle254</div>
            <p>Earn, verify, and withdraw with confidence.</p>
            <p className="footer-contact">Questions? <a href="mailto:hustleworld254@gmail.com">hustleworld254@gmail.com</a></p>
          </div>
          <div className="footer-links">
            <button type="button" onClick={() => setCurrentPage('Home')}>Home</button>
            <button type="button" onClick={() => setCurrentPage('About')}>About</button>
            <button type="button" onClick={() => setCurrentPage('Contact')}>Contact</button>
            <button type="button" onClick={() => setCurrentPage('Learn & policies')}>Learn &amp; policies</button>
            <button type="button" onClick={() => setCurrentPage('Admin')}>Admin portal</button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <section className="page-top">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions && <div className="page-actions">{actions}</div>}
    </section>
  )
}

function SignInRequiredPage({ setCurrentPage }) {
  return (
    <div className="page-wrap auth-wrap">
      <div className="panel auth-panel">
        <div className="eyebrow">Members area</div>
        <h2>Sign in to continue.</h2>
        <p className="auth-intro">Create an account or sign in to browse tasks, post work, and manage your earnings.</p>
        <div className="auth-required-actions">
          <button type="button" className="btn btn-primary" onClick={() => setCurrentPage('Sign up')}>Create account</button>
          <button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Login')}>Log in</button>
        </div>
      </div>
    </div>
  )
}

function HomePage({ setCurrentPage, session }) {
  const primaryDestination = session?.user?.role === 'admin' ? 'Admin' : 'Dashboard'

  return (
    <div className="home-page">
      <section className="welcome-hero">
        <div className="welcome-copy">
          <div className="welcome-kicker"><span /> Kenya’s home for online rewards</div>
          <h1>Turn your <em>everyday</em> into earning days.</h1>
          <p>Discover real tasks, build your daily streak, and see every wallet update in one secure place. Your next opportunity is closer than you think.</p>
          <div className="welcome-actions">
            {session ? (
              <button type="button" className="btn welcome-primary" onClick={() => setCurrentPage(session.user.role === 'poster' ? 'Poster' : primaryDestination)}>
                {session.user.role === 'admin' ? 'Open admin dashboard' : session.user.role === 'poster' ? 'Open poster studio' : 'Go to your dashboard'} <span aria-hidden="true">→</span>
              </button>
            ) : (
              <button type="button" className="btn welcome-primary" onClick={() => setCurrentPage('Sign up')}>Start earning today <span aria-hidden="true">→</span></button>
            )}
            <button type="button" className="welcome-secondary" onClick={() => setCurrentPage('Tasks')}>Explore opportunities <span aria-hidden="true">↗</span></button>
          </div>
          <div className="welcome-proof-points">
            <span><i aria-hidden="true">✓</i> Clear rewards</span>
            <span><i aria-hidden="true">✓</i> Proof-based reviews</span>
            <span><i aria-hidden="true">✓</i> Wallet transparency</span>
          </div>
          <div className="welcome-payments">
            <span>Flexible withdrawals</span>
            <strong>M-Pesa</strong><b>·</b><strong>PayPal</strong><b>·</b><strong>Bank</strong><b>·</b><strong>USDT</strong>
          </div>
        </div>

        <div className="welcome-visual" aria-label="Illustration of a transparent rewards wallet">
          <div className="hero-glow hero-glow-one" />
          <div className="hero-glow hero-glow-two" />
          <div className="hero-grid" />
          <div className="hero-orbit hero-orbit-one" />
          <div className="hero-orbit hero-orbit-two" />
          <div className="hero-coin hero-coin-back" aria-hidden="true"><span>K</span></div>
          <div className="hero-coin hero-coin-front" aria-hidden="true"><span>K</span></div>
          <div className="hero-wallet-card">
            <div className="hero-wallet-topline"><span className="hero-wallet-mark">H</span><span>HUSTLE WALLET</span><span className="hero-wallet-dots">•••</span></div>
            <div className="hero-wallet-label">YOUR EARNINGS, MADE CLEAR</div>
            <div className="hero-wallet-balance">KSh <strong>••••</strong></div>
            <div className="hero-wallet-divider" />
            <div className="hero-wallet-footer"><span><i /> Secure &amp; transparent</span><span>254</span></div>
          </div>
          <div className="hero-float-card hero-float-task">
            <span className="hero-float-icon">↗</span>
            <span><small>NEW OPPORTUNITY</small><strong>Ready when you are</strong></span>
          </div>
          <div className="hero-float-card hero-float-streak">
            <span className="hero-streak-icon">✦</span>
            <span><small>DAILY STREAK</small><strong>One day at a time</strong></span>
            <span className="hero-streak-dots"><i /><i /><i /><i /><i /><i /><i /></span>
          </div>
          <div className="hero-visual-caption"><span>YOUR NEXT MOVE</span><strong>Make today count.</strong></div>
        </div>
      </section>

      <section className="home-opportunities" aria-labelledby="opportunities-title">
        <div className="home-section-intro">
          <span className="home-overline">A platform that moves with you</span>
          <h2 id="opportunities-title">One account.<br /><em>More ways forward.</em></h2>
          <p>Built for the people doing the work—and the people creating it.</p>
        </div>
        <div className="opportunity-list">
          <button type="button" className="opportunity-row" onClick={() => setCurrentPage('Tasks')}>
            <span className="opportunity-number">01</span><span className="opportunity-icon opportunity-icon-tasks" aria-hidden="true">↗</span><span className="opportunity-copy"><strong>Find work that fits your day</strong><small>Browse tasks with clear instructions and visible rewards.</small><span className="opportunity-link">Explore tasks <i aria-hidden="true">→</i></span></span><span className="opportunity-arrow" aria-hidden="true">↗</span>
          </button>
          <button type="button" className="opportunity-row" onClick={() => setCurrentPage(session?.user?.role === 'poster' ? 'Post a task' : session ? 'Wallet' : 'Poster signup')}>
            <span className="opportunity-number">02</span><span className="opportunity-icon opportunity-icon-poster" aria-hidden="true">＋</span><span className="opportunity-copy"><strong>Bring your next campaign to life</strong><small>Connect your brand with a community ready to participate.</small><span className="opportunity-link">{session?.user?.role === 'poster' ? 'Post a task' : 'For businesses'} <i aria-hidden="true">→</i></span></span><span className="opportunity-arrow" aria-hidden="true">↗</span>
          </button>
          <button type="button" className="opportunity-row" onClick={() => setCurrentPage(session ? 'Streaks' : 'Sign up')}>
            <span className="opportunity-number">03</span><span className="opportunity-icon opportunity-icon-streak" aria-hidden="true">✦</span><span className="opportunity-copy"><strong>Build a rhythm. Earn a bonus.</strong><small>Show up daily and track your seven-day streak.</small><span className="opportunity-link">{session ? 'View your streak' : 'Get started'} <i aria-hidden="true">→</i></span></span><span className="opportunity-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
      </section>

      <section className="home-how">
        <div><span className="home-overline">Simple from day one</span><h2>Do the task.<br />Show your work.<br /><em>Get rewarded.</em></h2></div>
        <div className="home-how-steps">
          <div><span>01</span><p>Pick a task with clear steps and a visible reward.</p></div>
          <div><span>02</span><p>Complete it and submit the requested proof.</p></div>
          <div><span>03</span><p>Track review status and available payout options.</p></div>
          <button type="button" className="home-how-link" onClick={() => setCurrentPage('How it works')}>See how Hustle254 works <span aria-hidden="true">→</span></button>
        </div>
      </section>
    </div>
  )
}

function HowItWorksPage() {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="How it works"
        title="A clean, secure earning journey from signup to payout."
        subtitle="Each step is designed to improve trust, reduce fraud, and make the earning experience feel more premium and transparent."
      />

      <div className="steps-grid">
        {howSteps.map((step, index) => (
          <div key={step.title} className="step-card panel">
            <div className="step-number">0{index + 1}</div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function FeaturesPage({ setCurrentPage, session }) {
  function openWallet() {
    setCurrentPage(session?.user?.role === 'admin' ? 'Wallet transparency' : 'Wallet')
  }

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Features"
        title="Everything a modern earning platform needs to win trust and keep users active."
        subtitle="We combine fintech-level polish with operational controls that help reduce fraud and improve retention."
      />

      <div className="feature-grid feature-grid-large">
        {featureCards.map((feature) => (
          feature.title === 'Wallet transparency' ? (
            <button
              key={feature.title}
              type="button"
              className="feature-card feature-card-action panel"
              onClick={openWallet}
              aria-label={session?.user?.role === 'admin' ? 'Open admin wallet transparency' : 'Open wallet'}
            >
              <span className="tag">{feature.tag}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              <span className="feature-card-link">Open wallet <span aria-hidden="true">→</span></span>
            </button>
          ) : feature.title === 'Streak boosters' ? (
            <button
              key={feature.title}
              type="button"
              className="feature-card feature-card-action panel"
              onClick={() => setCurrentPage(session?.user?.role === 'admin' ? 'Admin' : 'Streaks')}
              aria-label="Open daily login streak rewards"
            >
              <span className="tag">{feature.tag}</span>
              <h3>{feature.title}</h3>
              <p>Log in daily to build your streak. Earn $0.023 (KSh 2.94) for every seven consecutive days.</p>
              <span className="feature-card-link">View your streak <span aria-hidden="true">→</span></span>
            </button>
          ) : feature.title === 'Survey & offer wall' ? (
            <button
              key={feature.title}
              type="button"
              className="feature-card feature-card-action panel"
              onClick={() => setCurrentPage('Surveys')}
            >
              <span className="tag">{feature.tag}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              <span className="feature-card-link">Explore surveys <span aria-hidden="true">→</span></span>
            </button>
          ) : (
            <article key={feature.title} className="feature-card panel">
              <span className="tag">{feature.tag}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              {feature.title === 'Admin control center' && session?.user?.role === 'admin' && (
                <button type="button" className="btn btn-secondary feature-action" onClick={() => setCurrentPage('Admin')}>
                  Open admin dashboard
                </button>
              )}
            </article>
          )
        ))}
      </div>
    </div>
  )
}

function SurveyPage({ session, setCurrentPage }) {
  const [surveyConfig, setSurveyConfig] = useState(null)
  const [loading, setLoading] = useState(Boolean(session?.token))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session?.token) {
      setSurveyConfig(null)
      setLoading(false)
      return undefined
    }

    let active = true
    setLoading(true)
    apiRequest('/surveys/config', { token: session.token })
      .then((config) => { if (active) setSurveyConfig(config) })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session?.token])

  return (
    <div className="page-wrap survey-page">
      <PageHeader
        eyebrow="Hustle254 surveys"
        title="Share your perspective. Find surveys that fit."
        subtitle="Survey availability and eligibility vary by location, profile, and current research demand. Available surveys and rewards are supplied by our survey partner."
        actions={!session && <button type="button" className="btn btn-primary" onClick={() => setCurrentPage('Login')}>Sign in to explore surveys</button>}
      />

      <section className="survey-provider-panel panel" aria-label="Survey opportunities">
        <div className="survey-provider-heading">
          <div>
            <span className="tag">Survey partner</span>
            <h2>Available surveys</h2>
            <p>Answer honestly and review each survey’s screening and reward details before you begin.</p>
          </div>
          <span className="survey-status">{loading ? 'Connecting…' : surveyConfig?.available ? 'Partner available' : 'Setup in progress'}</span>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}
        {loading && <p className="survey-empty-state">Connecting securely to the survey partner…</p>}
        {!session && !loading && <div className="survey-empty-state"><p>Sign in to access surveys linked securely to your account.</p><button type="button" className="btn btn-primary" onClick={() => setCurrentPage('Login')}>Sign in</button></div>}
        {session && !loading && surveyConfig?.available && surveyConfig.iframeUrl && (
          <iframe
            className="survey-iframe"
            title="Hustle254 survey opportunities"
            src={surveyConfig.iframeUrl}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="clipboard-write"
          />
        )}
        {session && !loading && !surveyConfig?.available && (
          <div className="survey-empty-state">
            <span className="survey-empty-icon" aria-hidden="true">✦</span>
            <h3>Survey access is being prepared</h3>
            <p>Survey availability depends on our partner setup and your eligibility. Your Hustle254 account is ready; partner surveys will appear here once the integration is configured.</p>
          </div>
        )}
      </section>

      <div className="survey-notices">
        <section className="panel info-panel">
          <span className="tag">Before you start</span>
          <h3>Screening is part of the survey process</h3>
          <p>Some surveys may disqualify participants after screening if their profile does not match the research requirements. This is decided by the survey provider; qualifying and completing the survey is required for any eligible reward.</p>
        </section>
        <section className="panel info-panel">
          <span className="tag">Need a hand?</span>
          <h3>Know the rules and get support</h3>
          <p>Review our earning and reward rules before participating. If a completed survey or reward appears missing, contact support with your account email and survey reference—never share your password or verification code.</p>
          <div className="survey-page-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Earning rules')}>Earning &amp; reward rules</button>
            <button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Contact')}>Contact support</button>
          </div>
        </section>
      </div>
    </div>
  )
}

function StreakPage({ streak, loading, error, onRetry, setCurrentPage }) {
  const currentDays = Math.min(Number(streak?.currentDays || 0), 7)
  const nextRewardInDays = Number(streak?.nextRewardInDays ?? 7)
  const recentRewards = streak?.rewards || []

  return (
    <div className="page-wrap streak-page">
      <PageHeader
        eyebrow="Daily streak"
        title="Show up every day. Build your streak."
        subtitle="Your consecutive login days are counted automatically in East Africa Time. Miss a calendar day and your streak starts over on your next login."
      />

      {error && <div className="form-error" role="alert">{error}<button type="button" className="streak-retry" onClick={onRetry}>Try again</button></div>}
      {loading && <p>Checking your daily streak…</p>}

      <section className="streak-hero panel" aria-live="polite">
        <div className="streak-hero-copy">
          <span className="streak-kicker"><span aria-hidden="true">✦</span> YOUR DAILY MOMENTUM</span>
          <strong className="streak-count">{currentDays}<small>/7</small></strong>
          <h2>{streak?.rewardEarnedToday ? 'Seven days. Reward unlocked!' : `${currentDays} ${currentDays === 1 ? 'day' : 'days'} in a row`}</h2>
          <p>{streak?.rewardEarnedToday
            ? 'Your seven-day bonus has been added to your wallet. Come back tomorrow to start another streak.'
            : `Log in each day to keep your streak. ${nextRewardInDays} ${nextRewardInDays === 1 ? 'more day' : 'more days'} until your next bonus.`}</p>
          <div className="streak-prize">
            <span>7-day reward</span>
            <strong>$0.023 <small>({streak ? `KSh ${Number(streak.rewardKes).toFixed(2)}` : 'KSh 2.94'})</small></strong>
            <small>Automatically credited to your wallet</small>
          </div>
        </div>
        <div className="streak-visual" aria-hidden="true"><span>✦</span><small>KEEP<br />GOING</small></div>
      </section>

      <section className="streak-progress-section">
        <div className="streak-section-heading">
          <div><span className="eyebrow">ONE DAY AT A TIME</span><h2>Your seven-day path</h2></div>
          <span className="streak-reset-note">New day at midnight · East Africa Time</span>
        </div>
        <div className="streak-day-grid" aria-label={`${currentDays} of 7 consecutive login days completed`}>
          {Array.from({ length: 7 }, (_, index) => {
            const day = index + 1
            const completed = day <= currentDays
            const rewardDay = day === 7
            return (
              <article className={`streak-day-card${completed ? ' completed' : ''}${rewardDay ? ' reward-day' : ''}`} key={day}>
                <span>{rewardDay ? 'BONUS' : `DAY ${day}`}</span>
                <strong aria-label={completed ? `Day ${day} completed` : `Day ${day} not completed`}>{completed ? '✓' : String(day).padStart(2, '0')}</strong>
                <small>{rewardDay ? '$0.023 reward' : completed ? 'Checked in' : 'Log in to unlock'}</small>
              </article>
            )
          })}
        </div>
        {streak?.rewardEarnedToday && <div className="submission-success streak-earned" role="status">Your streak bonus is in your wallet: $0.023 (KSh {Number(streak.rewardKes).toFixed(2)}).</div>}
      </section>

      <section className="panel streak-history-panel">
        <div className="streak-section-heading">
          <div><span className="eyebrow">YOUR REWARDS</span><h2>Bonus history</h2></div>
          <div className="streak-lifetime-total"><strong>{streak?.totalRewards ?? '—'}</strong><small>bonuses earned · KSh {Number(streak?.totalRewardsKes || 0).toFixed(2)} total</small></div>
        </div>
        <p className="streak-history-summary">
          Best recorded streak: {streak?.longestStreak ?? '—'} days · Saved check-ins: {streak?.totalCheckIns ?? '—'}
        </p>
        {recentRewards.length > 0 ? (
          <div className="streak-reward-list">
            {recentRewards.map((reward) => (
              <article className="streak-reward-row" key={reward.id || `${reward.streak_day}-${reward.created_at}`}>
                <span className="streak-reward-icon" aria-hidden="true">✓</span>
                <div><strong>7-day login bonus</strong><small>{reward.streak_day || formatDate(reward.created_at)}</small></div>
                <strong>$0.023 <small>(KSh {Number(reward.amount_kes).toFixed(2)})</small></strong>
              </article>
            ))}
          </div>
        ) : (
          <p className="streak-empty">{loading ? 'Loading reward history…' : 'Your first seven-day bonus will appear here. Log in tomorrow to keep building your streak.'}</p>
        )}
        <button type="button" className="btn btn-secondary streak-wallet-link" onClick={() => setCurrentPage('Wallet')}>Open wallet <span aria-hidden="true">→</span></button>
      </section>
    </div>
  )
}

function TasksPage({ tasks, selectedTask, setSelectedTask, loading, error, session }) {
  const [submittingProof, setSubmittingProof] = useState(false)
  const [proofError, setProofError] = useState('')
  const [proofSuccess, setProofSuccess] = useState('')
  const proofRequirements = selectedTask?.proof_requirements || ''
  const requiresProofImage = /\b(screenshot|screen shot|photo|image)\b/i.test(proofRequirements)
  const usesUsdtPayout = /\bUSDT\b/i.test(selectedTask?.description || '') && /\bBEP20\b/i.test(selectedTask?.description || '')
  const taskDescription = (selectedTask?.description || '')
    .replace(/\s*your reward is granted automatically after proof is submitted\.?/i, ' Your reward is credited after your proof is reviewed and approved.')
    .replace(/task payments? is in usdt\s*\(bep20\)\.?/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const campaignUrl = selectedTask?.task_url?.replace(
    /^https:\/\/t\.me\/huste254\/?$/i,
    'https://t.me/hustle254'
  )

  async function submitProof(event) {
    event.preventDefault()
    if (!session?.token || !selectedTask) return
    setSubmittingProof(true)
    setProofError('')
    setProofSuccess('')
    try {
      const form = event.currentTarget
      const formData = new FormData(form)
      const image = formData.get('proofImage')
      let imageUrl = ''
      if (requiresProofImage && (!(image instanceof File) || image.size === 0)) {
        throw new Error('Upload the image requested in the proof instructions.')
      }
      if (image instanceof File && image.size > 0) {
        if (!image.type.startsWith('image/')) throw new Error('Choose an image file for your proof.')
        if (image.size > 3 * 1024 * 1024) throw new Error('Proof images must be 3 MB or smaller.')
        imageUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(new Error('The proof image could not be read. Please try another image.'))
          reader.readAsDataURL(image)
        })
      }
      const proofType = imageUrl ? 'camera_capture' : 'notes'
      const result = await apiRequest(`/tasks/${encodeURIComponent(selectedTask.id)}/submit`, {
        method: 'POST',
        token: session.token,
        body: JSON.stringify({
          notes: String(formData.get('notes') || ''),
          proofType,
          proof_type: proofType,
          imageUrl,
          image_data_url: imageUrl,
          imageDataUrl: imageUrl,
        }),
      })
      setProofSuccess(result.message)
      form.reset()
    } catch (submitError) {
      setProofError(submitError.message)
    } finally {
      setSubmittingProof(false)
    }
  }

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Task catalog"
        title="Find tasks that match your time, effort, and payout goals."
        subtitle="Every task is tracked by category, risk, and payout value, with proof validation included in the task flow."
      />

      <div className="task-layout">
        <aside className="panel task-list-panel">
          <div className="toolbar compact-toolbar">
            <button type="button" className="pill active">All</button>
            <button type="button" className="pill">Surveys</button>
            <button type="button" className="pill">Social</button>
          </div>

          {error && <div className="form-error" role="alert">{error}</div>}
          {loading && <p>Loading tasks…</p>}
          {!loading && !error && tasks.length === 0 && <p>No active tasks are currently available.</p>}
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={selectedTask.id === task.id ? 'task-select-card active' : 'task-select-card'}
              onClick={() => setSelectedTask(task.id)}
            >
              <div className="task-headline">
                <span className="task-tag">{task.category}</span>
                <strong>{task.amount}</strong>
              </div>
              <h3>{task.title}</h3>
              <small className="task-list-facts">
                {task.duration} • {task.risk} risk
                {task.participant_limit ? ` • ${task.participant_limit} spots` : ''}
              </small>
            </button>
          ))}
        </aside>

        {selectedTask ? <div className="panel task-detail-panel">
          <div className="task-headline">
            <span className="task-tag">{selectedTask.category}</span>
            <strong className="task-amount">{selectedTask.amount}</strong>
          </div>

          <h2>{selectedTask.title}</h2>
          <p>{taskDescription}</p>

          <div className="task-meta-box">
            <span>Reward: {selectedTask.amount}</span>
            {usesUsdtPayout && <span>Payout: USDT (BEP20), converted from the KSh reward at payout</span>}
            <span>Approval: proof reviewed before reward credit</span>
            <span>Duration: {selectedTask.duration}</span>
            <span>Risk: {selectedTask.risk}</span>
            <span>Proof: {requiresProofImage ? 'image upload required' : 'follow the instructions below'}</span>
            {selectedTask.participant_limit && <span>Available spots: {selectedTask.participant_limit}</span>}
            {selectedTask.due_date && <span>Due: {new Date(selectedTask.due_date).toLocaleDateString('en-KE')}</span>}
          </div>

          {campaignUrl && (
            <a className="task-external-link" href={campaignUrl} target="_blank" rel="noreferrer">
              Open campaign instructions <span aria-hidden="true">↗</span>
            </a>
          )}

          <form className="proof-form" onSubmit={submitProof}>
            <div className="warning-banner">
              {requiresProofImage
                ? 'Upload the image requested in the proof instructions. Image files are limited to 3 MB.'
                : 'Upload an image if the proof instructions require one. Image files are limited to 3 MB.'}
            </div>

            <label>
              Proof instructions
              <textarea readOnly value={proofRequirements || 'Follow the task instructions and provide clear evidence of completion.'} />
            </label>

            <label>
              Notes for the reviewer
              <textarea name="notes" maxLength="2000" placeholder="Add any task completion details the reviewer needs." />
            </label>
            <label>
              Proof image {requiresProofImage ? '(required)' : '(optional)'}
              <input name="proofImage" type="file" accept="image/*" required={requiresProofImage} />
            </label>

            {proofError && <div className="form-error" role="alert">{proofError}</div>}
            {proofSuccess && <div className="submission-success" role="status">{proofSuccess}</div>}
            <div className="proof-actions">
              <button type="submit" className="btn btn-primary" disabled={submittingProof}>{submittingProof ? 'Submitting…' : 'Submit proof for review'}</button>
            </div>
          </form>
        </div> : (
          <div className="panel task-detail-panel">
            <h2>{error ? 'Tasks are unavailable.' : 'No task selected.'}</h2>
            <p>{error ? 'The task catalog could not be loaded. Please try again later.' : 'Active tasks will appear here when they are available.'}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function PostTaskPage({ onSubmit }) {
  const [participants, setParticipants] = useState(10)
  const [payout, setPayout] = useState(100)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submittedPost, setSubmittedPost] = useState(null)
  const [minDueDate] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10))
  const totalBudget = Number(participants || 0) * Number(payout || 0)

  async function handleSubmit(event) {
    event.preventDefault()
    const form = event.currentTarget
    setSubmitting(true)
    setError('')
    try {
      const formData = Object.fromEntries(new FormData(form))
      const result = await onSubmit({
        ...formData,
        participantLimit: Number(formData.participantLimit),
        payoutKes: Number(formData.payoutKes),
      })
      setSubmittedPost(result.taskPost)
      form.reset()
      setParticipants(10)
      setPayout(100)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="For businesses and creators"
        title="Post work. Reach real people."
        subtitle="Set the reward, choose how many people you need, and tell them exactly what to do. Every post is reviewed before it goes live."
      />

      {submittedPost && (
        <div className="submission-success" role="status">
          <span className="success-mark" aria-hidden="true">✓</span>
          <div>
            <strong>Request sent for review</strong>
            <p>{submittedPost.title} is pending review. It will appear in Tasks after approval.</p>
          </div>
        </div>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="post-task-layout">
        <form className="panel post-task-form" onSubmit={handleSubmit}>
          <div className="form-section-heading"><span>01</span><div><h2>Describe the work</h2><p>Give participants clear expectations and a reliable way to complete it.</p></div></div>
          <div className="post-form-grid">
            <label>
              Poster account
              <input value="Your registered poster name and email are used." readOnly />
            </label>
            <label className="form-field-wide">
              Task title <span>*</span>
              <input name="title" type="text" maxLength="120" placeholder="What should a participant do?" required />
            </label>
            <label>
              Category <span>*</span>
              <select name="category" defaultValue="Survey" required>
                <option>Survey</option>
                <option>Social</option>
                <option>Content</option>
                <option>App install</option>
                <option>Website testing</option>
                <option>Research</option>
                <option>Other</option>
              </select>
            </label>
            <label className="form-field-wide">
              Task description <span>*</span>
              <textarea name="description" maxLength="2000" placeholder="Describe the work, eligibility, and any conditions participants should know." required />
            </label>
            <label className="form-field-wide">
              Task link <small>Optional</small>
              <input name="taskUrl" type="url" maxLength="1000" placeholder="https://your-site.co.ke/campaign" />
            </label>
            <label className="form-field-wide">
              Proof participants must submit <span>*</span>
              <textarea name="proofRequirements" maxLength="1500" placeholder="Example: take a live photo of the confirmation screen and include the displayed reference code." required />
            </label>
          </div>

          <div className="form-section-heading form-section-spaced"><span>02</span><div><h2>Set the reward and deadline</h2><p>The total reward budget is calculated from your participant limit.</p></div></div>
          <div className="post-form-grid post-budget-fields">
            <label>
              Number of participants <span>*</span>
              <input name="participantLimit" type="number" min="1" max="10000" value={participants} onChange={(event) => setParticipants(event.target.value)} required />
            </label>
            <label>
              Reward per completed task (KSh) <span>*</span>
              <input name="payoutKes" type="number" min="1" max="100000" step="1" value={payout} onChange={(event) => setPayout(event.target.value)} required />
            </label>
            <label>
              Complete by <span>*</span>
              <input name="dueDate" type="date" min={minDueDate} required />
            </label>
          </div>

          <label className="budget-confirmation">
            <input type="checkbox" required />
            <span>I understand this post is reviewed before publishing, and the reward budget must be verified before approval.</span>
          </label>
          <div className="post-form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Sending for review…' : 'Submit for approval'}
            </button>
            <small>No charge is taken through this form.</small>
          </div>
        </form>

        <aside className="post-budget-summary">
          <div className="budget-summary-label">ESTIMATED REWARD BUDGET</div>
          <strong>KSh {totalBudget.toLocaleString('en-KE')}</strong>
          <div className="budget-equation">{Number(participants || 0).toLocaleString('en-KE')} participants × KSh {Number(payout || 0).toLocaleString('en-KE')}</div>
          <div className="budget-rule" />
          <h3>Before it goes live</h3>
          <ol>
            <li>Our team checks your instructions, link, and budget.</li>
            <li>Approved posts appear in the Tasks catalog.</li>
            <li>Participants submit proof through the task page.</li>
          </ol>
          <p className="budget-disclaimer">Submitting a post does not collect or hold funds. The reward budget must be verified before the task is approved.</p>
        </aside>
      </div>
    </div>
  )
}

function PosterPage({ session, setCurrentPage }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadAttempt, setReloadAttempt] = useState(0)

  useEffect(() => {
    let active = true
    apiRequest('/poster/dashboard', { token: session.token })
      .then((result) => {
        if (!result.account || !Array.isArray(result.posts) || !result.totals) {
          throw new Error('The poster dashboard returned incomplete account data. Please try again.')
        }
        if (active) setData(result)
      })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session.token, reloadAttempt])

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Poster account"
        title="Manage your account and track every task post."
        subtitle="See review decisions, participant activity, and requested budgets tied to your poster account."
        actions={<button type="button" className="btn btn-primary" onClick={() => setCurrentPage('Post a task')}>Post a task</button>}
      />

      {loading && <p>Loading your poster account…</p>}
      {error && (
        <div className="form-error" role="alert">
          {error}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={() => {
              setLoading(true)
              setError('')
              setReloadAttempt((attempt) => attempt + 1)
            }}
          >
            Try again
          </button>
        </div>
      )}

      <div className="stats-grid">
        {[
          ['All posts', data?.totals.posts],
          ['Pending review', data?.totals.pending_review],
          ['Approved', data?.totals.approved],
          ['Rejected', data?.totals.rejected],
          ['Estimated requested budget', data ? formatKes(data.totals.estimated_requested_budget_kes) : '—'],
        ].map(([label, value]) => (
          <div className="stat-card panel" key={label}>
            <label>{label}</label>
            <strong>{value ?? '—'}</strong>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="panel poster-account-panel">
          <h2>Account details</h2>
          <div className="history-list">
            <div className="history-row"><strong>Name</strong><span>{data?.account.full_name || session.user.full_name}</span></div>
            <div className="history-row"><strong>Email</strong><span>{data?.account.email || session.user.email}</span></div>
            <div className="history-row"><strong>Phone</strong><span>{data?.account.phone || session.user.phone || 'Not provided'}</span></div>
            <div className="history-row"><strong>External account ID</strong><span>{data?.account.external_user_id || session.user.external_user_id || session.user.id}</span></div>
            <div className="history-row"><strong>Account status</strong><span>{data?.account.status || 'Active'}</span></div>
          </div>
        </section>

        <section className="panel poster-billing-panel">
          <h2>Balance and billing</h2>
          <p className="status-badge">Manual payment review</p>
          <p>Your current available balance is shown in Wallet. Deposit references are verified before funds are added; withdrawal requests are reviewed before completion.</p>
          <p>Task post budget estimates do not automatically reserve funds or escrow rewards.</p>
          <button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Wallet')}>Open poster wallet</button>
        </section>
      </div>

      <section className="panel poster-post-list">
        <div className="review-section-heading">
          <div><span className="home-overline">Your activity</span><h2>Task posts</h2></div>
          <span className="review-count">{data?.totals.posts ?? 0} total</span>
        </div>
        {data?.posts?.map((post) => (
          <article className="poster-post-row" key={post.id}>
            <div>
              <span className={`status-badge status-${post.status}`}>{post.status.replace('_', ' ')}</span>
              <h3>{post.title}</h3>
              <p>{post.category} · Created {formatDate(post.created_at)}</p>
            </div>
            <div className="poster-post-metrics">
              <span>{post.submissions_count ?? 0} submissions</span>
              <span>{post.pending_count ?? 0} pending review</span>
              <span>{post.approved_count ?? 0} approved</span>
              <span>{post.rejected_count ?? 0} rejected</span>
              <strong>Requested budget: {formatKes(post.total_budget_kes)}</strong>
            </div>
          </article>
        ))}
        {!loading && !error && data?.posts?.length === 0 && <p className="empty-review">You haven’t submitted any task posts yet.</p>}
      </section>
    </div>
  )
}

function WalletPage({ session, streakDate }) {
  const [dashboard, setDashboard] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [transactionSummary, setTransactionSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState(session.user.role === 'poster' ? 'deposit' : 'withdraw')
  const [paymentMethod, setPaymentMethod] = useState('mpesa')
  const [amountKes, setAmountKes] = useState('')
  const [destination, setDestination] = useState('')
  const [transactionReference, setTransactionReference] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')
  const isPoster = session.user.role === 'poster'

  useEffect(() => {
    let active = true
    async function refreshWallet() {
      try {
        const [walletData, transactionData] = await Promise.all([
          apiRequest('/user/dashboard', { token: session.token }),
          apiRequest('/wallet/transactions', { token: session.token }),
        ])
        if (!active) return
        setDashboard(walletData)
        setTransactions(transactionData.transactions)
        setTransactionSummary(transactionData.summary)
        setError('')
      } catch (requestError) {
        if (active) setError(requestError.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    refreshWallet()
    const refreshTimer = window.setInterval(refreshWallet, 15000)
    return () => { active = false; window.clearInterval(refreshTimer) }
  }, [session.token, streakDate])

  async function submitWalletRequest(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const deposit = mode === 'deposit'
      const result = await apiRequest(deposit ? '/wallet/deposits' : '/wallet/withdrawals', {
        method: 'POST',
        token: session.token,
        body: JSON.stringify(deposit
          ? { amountKes: Number(amountKes), paymentMethod, transactionReference }
          : { amountKes: Number(amountKes), paymentMethod, destination }),
      })
      setSuccess(result.message)
      setAmountKes('')
      setDestination('')
      setTransactionReference('')
      const [walletData, transactionData] = await Promise.all([
        apiRequest('/user/dashboard', { token: session.token }),
        apiRequest('/wallet/transactions', { token: session.token }),
      ])
      setDashboard(walletData)
      setTransactions(transactionData.transactions)
      setTransactionSummary(transactionData.summary)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const destinationLabel = {
    mpesa: 'M-Pesa phone number',
    crypto: 'USDT BEP20 wallet address',
    paypal: 'PayPal email address',
    till: 'Till number and business details',
    bank: 'Bank name, account name, and account number',
  }[paymentMethod]

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Wallet"
        title={isPoster ? 'Deposit funds and manage your poster balance.' : 'Withdraw your available balance.'}
        subtitle="Your wallet history records deposits, rewards, and withdrawal requests, with clear status and eligible available balance."
      />

      {error && <div className="form-error" role="alert">{error}</div>}
      {success && <div className="submission-success" role="status">{success}</div>}
      {loading && <p>Loading wallet from your account…</p>}
      <section className="wallet-transparency" aria-label="Wallet balance transparency">
        <div className="wallet-transparency-heading">
          <div><span className="wallet-live-indicator" /> Live wallet ledger</div>
          <small>Balances refresh automatically every 15 seconds</small>
        </div>
        <div className="wallet-balance-grid">
          {[
            ['Available', dashboard?.wallet ? formatKesWithUsd(dashboard.wallet.balance_kes) : 'Not recorded', 'Confirmed and eligible funds', 'available'],
            ['Deposits pending', transactionSummary ? formatKesWithUsd(transactionSummary.pending_deposits_kes) : '—', 'Awaiting verification', 'pending'],
            ['Deposits approved', transactionSummary ? formatKesWithUsd(transactionSummary.approved_deposits_kes) : '—', 'Verified funds received', 'approved'],
            ['Deposits rejected', transactionSummary ? formatKesWithUsd(transactionSummary.rejected_deposits_kes) : '—', 'Not credited to balance', 'rejected'],
            ['Withdrawals pending', transactionSummary ? formatKesWithUsd(transactionSummary.pending_withdrawals_kes) : '—', 'Reserved for review', 'pending'],
            ['Withdrawals rejected', transactionSummary ? formatKesWithUsd(transactionSummary.rejected_withdrawals_kes) : '—', 'Returned to available', 'rejected'],
            ['Total withdrawn', dashboard?.wallet ? formatKesWithUsd(dashboard.wallet.withdrawn_kes) : transactionSummary ? formatKesWithUsd(transactionSummary.withdrawn_kes) : '—', 'Net paid after fees', 'withdrawn'],
          ].map(([label, value, detail, kind]) => (
            <article className={`wallet-balance-card wallet-balance-${kind}`} key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{detail}</small>
            </article>
          ))}
        </div>
      </section>

      <div className="wallet-grid wallet-payment-grid">
        <div className="panel payout-methods">
          <h3>{isPoster ? 'Poster deposits' : 'Wallet controls'}</h3>
          {isPoster
            ? <p>Use the official payment details below, then submit the exact transfer reference and KSh amount. Funds are added only after the reference is verified.</p>
            :             <p>Choose a withdrawal method and destination. Only confirmed, eligible funds can be requested. The amount is reserved while your request is reviewed; declined requests return to your available balance.</p>}
          {isPoster && <div className="deposit-instructions">
            {depositPaymentDetails.map((item) => (
              <div className="method-row" key={item.method}>
                <div><strong>{item.method}</strong><small>{item.detail}</small></div>
              </div>
            ))}
          </div>}
        </div>
      </div>

      <section className="panel wallet-action-panel">
        <div className="wallet-action-tabs" role="tablist" aria-label="Wallet actions">
          {isPoster && <button type="button" role="tab" aria-selected={mode === 'deposit'} className={mode === 'deposit' ? 'admin-section-tab active' : 'admin-section-tab'} onClick={() => { setMode('deposit'); setSuccess(''); setError('') }}>Deposit funds</button>}
          <button type="button" role="tab" aria-selected={mode === 'withdraw'} className={mode === 'withdraw' ? 'admin-section-tab active' : 'admin-section-tab'} onClick={() => { setMode('withdraw'); setSuccess(''); setError('') }}>Withdraw</button>
        </div>
        <form className="wallet-transaction-form" onSubmit={submitWalletRequest}>
          <label>
            {mode === 'deposit' ? 'Amount (KSh)' : 'Withdrawal amount (KSh)'}
            <input type="number" min={mode === 'withdraw' ? MINIMUM_WITHDRAWAL_KES : '1'} max="10000000" step="0.01" inputMode="decimal" value={amountKes} onChange={(event) => setAmountKes(event.target.value)} required />
          </label>
          {mode === 'deposit' ? <>
            <label>
              Send using
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                <option value="mpesa">M-Pesa direct</option>
                <option value="mpesa_till">M-Pesa Till</option>
                <option value="paypal">PayPal</option>
                <option value="usdt_bep20">USDT BEP20</option>
              </select>
            </label>
            <label className="wallet-form-wide">
              Transfer transaction code / blockchain hash
              <input value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} minLength="3" maxLength="160" required placeholder="Enter the exact reference from your transfer" />
            </label>
            <p className="wallet-form-note wallet-form-wide">Submitting the code creates a pending review request. Do not send funds to any address other than the details shown above.</p>
          </> : <>
            <label>
              Withdraw to
              <select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setDestination('') }}>
                {withdrawalMethods.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="wallet-form-wide">
              {destinationLabel}
              <input value={destination} onChange={(event) => setDestination(event.target.value)} maxLength="300" required placeholder="Enter the destination details for your payout" />
            </label>
            <div className="withdrawal-fee-note wallet-form-wide">
              <strong>Minimum request: {formatKesWithUsd(MINIMUM_WITHDRAWAL_KES)}</strong>
              <p>Service and risk costs: KSh 10 for KSh 128–384 ($1.00–$3.00); KSh 15 above KSh 384 through KSh 896 ($3.01–$7.00); KSh 25 above KSh 896 (over $7.00).</p>
              {Number(amountKes) >= MINIMUM_WITHDRAWAL_KES && <p>Request: {formatKesWithUsd(amountKes)} · Fee: {formatKes(getWithdrawalFeeKes(amountKes))} · Estimated payout: {formatKesWithUsd(Number(amountKes) - getWithdrawalFeeKes(amountKes))}</p>}
              <p>Only confirmed, eligible wallet funds are accepted. Your request stays visible in transaction history; the available amount is reserved while it is being processed.</p>
            </div>
          </>}
          <button type="submit" className="btn btn-primary wallet-form-wide" disabled={submitting}>
            {submitting ? 'Submitting…' : mode === 'deposit' ? 'Submit deposit for verification' : 'Submit withdrawal request'}
          </button>
        </form>
      </section>

      <section className="panel wallet-transactions-panel">
        <div className="wallet-history-heading">
          <div><h3>Wallet transaction history</h3><p>Every request stays visible with its latest review status.</p></div>
          <span>{transactions.length} recent {transactions.length === 1 ? 'record' : 'records'}</span>
        </div>
        <div className="history-list">
          {transactions.map((item) => (
            <article key={item.id} className="wallet-ledger-row">
              <div className="wallet-ledger-main">
                <strong>{item.transaction_type === 'deposit'
                  ? `Deposit · +${formatKesWithUsd(item.amount_kes)}`
                  : ['task_reward', 'streak_reward', 'survey_reward', 'referral_reward'].includes(item.transaction_type)
                    ? `${({ task_reward: 'Task reward', streak_reward: 'Streak reward', survey_reward: 'Survey reward', referral_reward: 'Referral reward' })[item.transaction_type]} · +${formatKesWithUsd(item.amount_kes)}`
                    : `Withdrawal · -${formatKesWithUsd(item.amount_kes)}${Number(item.fee_amount_kes) ? ` · Fee ${formatKes(item.fee_amount_kes)}` : ''}`}</strong>
                <small>{walletMethodLabels[item.payment_method] || item.description || 'Wallet activity'}{item.transaction_reference ? ` · Reference ${item.transaction_reference}` : ''}</small>
                <small>{formatDate(item.created_at)}{item.reviewed_at ? ` · Reviewed ${formatDate(item.reviewed_at)}` : ''}</small>
              </div>
              <span className={`status-badge status-${item.status}`}>{item.status.replace('_', ' ')}</span>
            </article>
          ))}
          {!loading && !error && transactions.length === 0 && <p>No wallet transactions have been recorded yet.</p>}
        </div>
      </section>
    </div>
  )
}

function ReferralPage({ session }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    apiRequest('/user/referrals', { token: session.token })
      .then(setData)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false))
  }, [session.token])

  const referralLink = data?.referralCode
    ? `${window.location.origin}/?ref=${encodeURIComponent(data.referralCode)}`
    : ''

  async function copyReferralLink() {
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
    } catch (copyError) {
      setError(`Could not copy the referral link. Copy it from the field instead. ${copyError.message}`)
    }
  }

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Referral & affiliation"
        title="Invite taskers and posters. Earn when they succeed."
        subtitle="Share your link or code. Referral attribution is locked when a new account registers and is recorded after their email is verified."
      />

      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="stats-grid referral-earnings-grid">
        <div className="stat-card panel">
          <label>Earned and credited</label>
          <strong>{data ? formatKes(data.summary?.paidKes) : '—'}</strong>
        </div>
        <div className="stat-card panel">
          <label>Possible rewards pending</label>
          <strong>{data ? formatKes(data.summary?.pendingKes) : '—'}</strong>
        </div>
        <div className="stat-card panel">
          <label>Verified referrals</label>
          <strong>{data?.referrals?.length ?? (loading ? '—' : 0)}</strong>
        </div>
      </div>

      <div className="referral-grid">
        <div className="panel referral-panel">
          <h2>Share your invite</h2>
          <label htmlFor="referral-code">Your referral code</label>
          <input id="referral-code" className="copy-box" readOnly value={data?.referralCode || (loading ? 'Loading…' : '')} />
          <label htmlFor="referral-link">Your personal invite link</label>
          <input id="referral-link" className="copy-box" readOnly value={referralLink} />
          <button type="button" className="btn btn-primary" disabled={!referralLink} onClick={copyReferralLink}>
            {copied ? 'Link copied' : 'Copy invite link'}
          </button>
          <p>Referral codes are optional at registration. A new person can open this link and the code will be filled in for them.</p>
        </div>

        <div className="panel referral-panel">
          <h2>How you earn</h2>
          <div className="tier-row">
            <div><strong>Tasker referral</strong><small>One-time reward after their task submission is approved by an admin.</small></div>
            <span>{formatKes(5)}</span>
          </div>
          <div className="tier-row">
            <div><strong>Poster affiliation</strong><small>One-time reward after their first task is approved and admin-verified deposits cover its posted budget.</small></div>
            <span>{formatKes(30)}</span>
          </div>
          <p>Rewards are credited to your available wallet balance after the qualifying event is verified. Only direct referrals qualify; self-referrals and duplicate accounts are not eligible.</p>
        </div>
      </div>

      <section className="panel referral-panel referral-history-panel">
          <h2>Referral activity ({data?.referrals?.length ?? 0})</h2>
          {data?.referrals?.map((referral) => (
            <div key={referral.id} className="tier-row">
              <div>
                <strong>{referral.full_name}</strong>
                <small>{referral.reward_type === 'poster' ? 'Poster affiliation' : 'Tasker referral'} · Verified {formatDate(referral.created_at)}</small>
                <small>{referral.status === 'paid'
                  ? `Admin-verified reward credited${referral.credited_at ? ` · ${formatDate(referral.credited_at)}` : ''}`
                  : referral.reward_type === 'poster'
                    ? 'Waiting for first approved task and verified deposits to cover its budget'
                    : 'Waiting for an admin-approved task completion'}</small>
              </div>
              <span>{formatKes(referral.status === 'paid' ? referral.commission_kes : referral.reward_kes)}</span>
            </div>
          ))}
          {!loading && !error && data?.referrals?.length === 0 && <p>No referrals are recorded for this account.</p>}
      </section>
    </div>
  )
}

function DashboardPage({ session, streakDate, onOpenProfile }) {
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    apiRequest('/user/dashboard', { token: session.token })
      .then(setDashboard)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false))
  }, [session.token, streakDate])

  const stats = dashboard?.stats
  const wallet = dashboard?.wallet
  const userName = session?.user?.full_name || session?.user?.fullName || session?.user?.email || 'Your profile'
  const userInitials = getUserInitials(userName, session?.user?.email || 'User')

  return (
    <div className="page-wrap">
      <div className="profile-summary-card panel">
        <div className="profile-summary-main">
          <div className="profile-avatar-large" aria-hidden="true">
            {session?.user?.avatar ? <img src={session.user.avatar} alt="Profile" /> : <span>{userInitials}</span>}
          </div>
          <div>
            <span className="profile-summary-tag">Your profile</span>
            <h3>{userName}</h3>
            <small>{session?.user?.email || 'No email on file'}</small>
            <small className="profile-external-id">Account ID: {session?.user?.external_user_id || session?.user?.id || 'Loading'}</small>
          </div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onOpenProfile}>Edit profile</button>
      </div>

      <PageHeader
        eyebrow="User dashboard"
        title="Your stored wallet balances and recorded progress."
        subtitle="Balances, submissions, and referrals below come from the records linked to your account."
      />

      {error && <div className="form-error" role="alert">{error}</div>}
      {loading && <p>Loading account progress…</p>}
      <div className="stats-grid">
        <div className="stat-card panel">
          <label>Available balance</label>
          <strong>{wallet ? formatKes(wallet.balance_kes) : 'Not recorded'}</strong>
          <small>Read from your stored wallet</small>
        </div>
        <div className="stat-card panel">
          <label>Tasks approved</label>
          <strong>{stats?.approved_submissions ?? '—'}</strong>
          <small>Based on reviewed submissions</small>
        </div>
        <div className="stat-card panel">
          <label>Tasks awaiting review</label>
          <strong>{stats?.pending_submissions ?? '—'}</strong>
          <small>Current pending submissions</small>
        </div>
        <div className="stat-card panel">
          <label>Referrals</label>
          <strong>{stats?.count ?? '—'}</strong>
          <small>Recorded referrals</small>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="panel">
          <h3>Recent recorded activity</h3>
          <div className="history-list">
            {dashboard?.recentActivity?.map((activity) => (
              <div key={`${activity.activity_type}-${activity.created_at}-${activity.description}`} className="history-row">
                <div>
                  <strong>{activity.activity_type === 'payout'
                    ? `Payout: ${activity.description}`
                    : ['deposit', 'withdrawal'].includes(activity.activity_type)
                      ? `${activity.activity_type === 'deposit' ? 'Deposit' : 'Withdrawal'}: ${activity.description}`
                      : `Task: ${activity.description}`}</strong>
                  <small>{activity.status} · {formatDate(activity.created_at)}</small>
                </div>
                {activity.amount_kes !== null && activity.amount_kes !== undefined && <span>{formatKes(activity.amount_kes)}</span>}
              </div>
            ))}
            {!loading && !error && dashboard?.recentActivity?.length === 0 && <p>No account activity is recorded yet.</p>}
          </div>
        </div>

        <div className="panel">
          <h3>Account totals</h3>
          <div className="history-list">
            <div className="history-row"><strong>Pending / reserved wallet balance</strong><span>{wallet ? formatKes(wallet.pending_kes) : 'Not recorded'}</span></div>
            <div className="history-row"><strong>Withdrawn total</strong><span>{wallet ? formatKes(wallet.withdrawn_kes) : 'Not recorded'}</span></div>
            <div className="history-row"><strong>Rejected submissions</strong><span>{stats?.rejected_submissions ?? '—'}</span></div>
            <div className="history-row"><strong>Recorded referral commissions</strong><span>{stats ? formatKes(stats.commission_kes) : '—'}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProfileModal({ session, open, onClose, activeTab, setActiveTab, onPhotoUpload, onRemovePhoto, onPasswordSubmit, passwordNotice, setPasswordNotice }) {
  if (!open || !session) return null

  const user = session.user || {}
  const profileName = user.full_name || user.fullName || user.email || 'Profile'
  const profileInitials = getUserInitials(profileName, user.email || 'User')

  return (
    <div className="profile-modal-backdrop" onClick={onClose}>
      <div className="profile-modal panel" onClick={(event) => event.stopPropagation()}>
        <div className="profile-modal-header">
          <div>
            <span className="eyebrow">Account profile</span>
            <h3>{profileName}</h3>
          </div>
          <button type="button" className="topbar-back" onClick={onClose}>Close</button>
        </div>

        <div className="profile-modal-shell">
          <aside className="profile-modal-sidebar">
            <div className="profile-avatar-xl" aria-hidden="true">
              {user.avatar ? <img src={user.avatar} alt="Profile" /> : <span>{profileInitials}</span>}
            </div>
            <div className="profile-summary-meta">
              <strong>{profileName}</strong>
              <small>{user.email || 'Email unavailable'}</small>
              <span>{(user.role || 'user').toUpperCase()}</span>
            </div>
            <label className="profile-upload-btn">
              <input type="file" accept="image/*" onChange={onPhotoUpload} />
              Upload photo
            </label>
            {user.avatar && (
              <button type="button" className="btn btn-secondary btn-block" onClick={onRemovePhoto}>Remove photo</button>
            )}
          </aside>

          <section className="profile-modal-content">
            <div className="profile-tab-row" role="tablist" aria-label="Profile settings tabs">
              <button type="button" role="tab" aria-selected={activeTab === 'overview'} className={activeTab === 'overview' ? 'profile-tab active' : 'profile-tab'} onClick={() => { setActiveTab('overview'); setPasswordNotice('') }}>Overview</button>
              <button type="button" role="tab" aria-selected={activeTab === 'security'} className={activeTab === 'security' ? 'profile-tab active' : 'profile-tab'} onClick={() => { setActiveTab('security'); setPasswordNotice('') }}>Security</button>
              <button type="button" role="tab" aria-selected={activeTab === 'photo'} className={activeTab === 'photo' ? 'profile-tab active' : 'profile-tab'} onClick={() => { setActiveTab('photo'); setPasswordNotice('') }}>Photo</button>
            </div>

            {activeTab === 'overview' && (
              <div className="profile-info-grid">
                <div className="info-chip">
                  <label>Name</label>
                  <strong>{profileName}</strong>
                </div>
                <div className="info-chip">
                  <label>Role</label>
                  <strong>{user.role || 'User'}</strong>
                </div>
                <div className="info-chip full-width">
                  <label>Email</label>
                  <strong>{user.email || 'Not set'}</strong>
                </div>
                <div className="info-chip full-width">
                  <label>Phone</label>
                  <strong>{user.phone || 'Not set'}</strong>
                </div>
                <div className="info-chip full-width">
                  <label>Profile status</label>
                  <strong>{user.passwordUpdatedAt ? 'Profile secured' : 'Ready for setup'}</strong>
                </div>
              </div>
            )}

            {activeTab === 'photo' && (
              <div className="profile-photo-panel">
                <div className="profile-photo-preview">
                  {user.avatar ? <img src={user.avatar} alt="Profile preview" /> : <span>{profileInitials}</span>}
                </div>
                <p>Upload a professional headshot or a favorite photo. It will appear across your account and topbar whenever you are signed in.</p>
                <label className="profile-upload-btn large">
                  <input type="file" accept="image/*" onChange={onPhotoUpload} />
                  Choose profile photo
                </label>
                {user.avatar && <button type="button" className="btn btn-secondary" onClick={onRemovePhoto}>Remove current photo</button>}
              </div>
            )}

            {activeTab === 'security' && (
              <form className="profile-password-form" onSubmit={onPasswordSubmit}>
                {passwordNotice && <div className="form-error" role="alert">{passwordNotice}</div>}
                <label>
                  Current password
                  <input name="currentPassword" type="password" autoComplete="current-password" placeholder="Enter current password" />
                </label>
                <label>
                  New password
                  <input name="newPassword" type="password" autoComplete="new-password" placeholder="At least 8 characters" minLength="8" required />
                </label>
                <label>
                  Confirm new password
                  <input name="confirmPassword" type="password" autoComplete="new-password" placeholder="Confirm your new password" minLength="8" required />
                </label>
                <button type="submit" className="btn btn-primary btn-block">Update password</button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function AdminPortalEntry({ onAuthenticated, session }) {
  const [setupAvailable, setSetupAvailable] = useState(false)
  const [setupChecked, setSetupChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    apiRequest('/admin/setup-status')
      .then(({ available }) => {
        if (active) setSetupAvailable(available)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message)
      })
      .finally(() => {
        if (active) setSetupChecked(true)
      })
    return () => { active = false }
  }, [])

  async function register(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setSubmitting(true)
    setError('')
    try {
      const result = await apiRequest('/admin/register', {
        method: 'POST',
        body: JSON.stringify(values),
      })
      onAuthenticated(result)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function signIn(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setSubmitting(true)
    setError('')
    try {
      const result = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: values.email, password: values.adminPassword }),
      })
      if (result.user.role !== 'admin') {
        throw new Error('This email is not the registered admin account.')
      }
      const { adminToken } = await apiRequest('/admin/access', {
        method: 'POST',
        token: result.token,
        body: JSON.stringify({ password: values.adminPassword }),
      })
      onAuthenticated({ ...result, adminToken })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Secure admin portal"
        title="Administrator access."
        subtitle="Only one admin account can be registered. Use the private admin password configured on the API."
      />
      {error && <div className="form-error" role="alert">{error}</div>}
      {!setupChecked && <p>Checking admin setup…</p>}
      {setupChecked && setupAvailable && (
        <form className="panel auth-panel admin-password-gate" onSubmit={register}>
          <div className="eyebrow">One-time setup</div>
          <h2>Register the administrator.</h2>
          <p className="auth-intro">This form is available only until the first admin account is created. The admin password is also the account sign-in password.</p>
          <label>Full name<input name="fullName" autoComplete="name" required maxLength="120" /></label>
          <label>Email address<input name="email" type="email" autoComplete="email" required maxLength="254" /></label>
          <label>Phone number<input name="phone" type="tel" autoComplete="tel" required maxLength="40" /></label>
          <label className="admin-password-label">Admin password<input name="adminPassword" type="password" autoComplete="new-password" required /></label>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Registering…' : 'Register the only admin account'}
          </button>
        </form>
      )}
      {setupChecked && (
        <form className="panel auth-panel admin-password-gate" onSubmit={signIn}>
          <div className="eyebrow">Administrator sign-in</div>
          <h2>Sign in to the admin portal.</h2>
          <p className="auth-intro">Use the email registered for the administrator and the same private admin password.</p>
          <label>Email address<input name="email" type="email" autoComplete="username" required maxLength="254" /></label>
          <label className="admin-password-label">Admin password<input name="adminPassword" type="password" autoComplete="current-password" required /></label>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in as administrator'}
          </button>
          {session && <p className="auth-intro">You are currently signed in to a non-admin account. This will switch to the administrator account after successful sign-in.</p>}
        </form>
      )}
    </div>
  )
}

function AdminAccessGate({ onVerifyAdminPassword }) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function verify(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onVerifyAdminPassword(password)
      setPassword('')
    } catch (verifyError) {
      setError(verifyError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-wrap auth-wrap">
      <form className="panel auth-panel admin-password-gate" onSubmit={verify}>
        <div className="eyebrow">Admin verification</div>
        <h2>Confirm admin access.</h2>
        <p className="auth-intro">Enter the admin password to open protected moderation and payout tools.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <label className="admin-password-label">
          Admin password
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Verifying…' : 'Unlock admin tools'}
        </button>
      </form>
    </div>
  )
}

function AdminPage({ session, onAuthenticated, onVerifyAdminPassword, taskPosts, error, onModerateTaskPost, onDeleteTaskPost, initialSection = 'Overview' }) {
  const [workingId, setWorkingId] = useState('')
  const [actionError, setActionError] = useState('')
  const [overview, setOverview] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [payouts, setPayouts] = useState([])
  const [walletTransactions, setWalletTransactions] = useState([])
  const [walletSummary, setWalletSummary] = useState(null)
  const [users, setUsers] = useState([])
  const [catalog, setCatalog] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [section, setSection] = useState(initialSection)
  const [selectedProof, setSelectedProof] = useState(null)
  const [proofImageError, setProofImageError] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [walletTypeFilter, setWalletTypeFilter] = useState('all')
  const [walletStatusFilter, setWalletStatusFilter] = useState('all')

  useEffect(() => {
    if (!selectedProof) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') setSelectedProof(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedProof])

  useEffect(() => {
    if (!session?.adminToken) return undefined
    let active = true
    Promise.all([
      apiRequest('/admin/overview', { token: session.adminToken }),
      apiRequest('/admin/tasks', { token: session.adminToken }),
      apiRequest('/admin/payouts', { token: session.adminToken }),
      apiRequest('/admin/wallet-transactions', { token: session.adminToken }),
      apiRequest('/admin/users', { token: session.adminToken }),
      apiRequest('/admin/catalog', { token: session.adminToken }),
      apiRequest('/admin/campaigns', { token: session.adminToken }),
    ])
      .then(([nextOverview, taskResult, payoutResult, walletTransactionResult, userResult, catalogResult, campaignResult]) => {
        if (!active) return
        setOverview(nextOverview)
        setSubmissions(taskResult.tasks)
        setPayouts(payoutResult.payouts)
        setWalletTransactions(walletTransactionResult.transactions)
        setWalletSummary(walletTransactionResult.summary)
        setUsers(userResult.users)
        setCatalog(catalogResult.tasks)
        setCampaigns(campaignResult.campaigns)
        setDataError('')
      })
      .catch((requestError) => {
        if (active) setDataError(requestError.message)
      })
      .finally(() => {
        if (active) setDataLoading(false)
      })
    return () => { active = false }
  }, [session?.adminToken, taskPosts.length, refreshVersion])

  useEffect(() => {
    if (!session?.adminToken) return undefined
    const refreshTimer = window.setInterval(() => {
      setRefreshVersion((version) => version + 1)
    }, 15000)
    return () => window.clearInterval(refreshTimer)
  }, [session?.adminToken])

  if (!session || session.user.role !== 'admin') {
    return <AdminPortalEntry onAuthenticated={onAuthenticated} session={session} />
  }

  if (!session.adminToken) return <AdminAccessGate onVerifyAdminPassword={onVerifyAdminPassword} />

  async function runAdminAction(id, request, onSuccess) {
    setWorkingId(id)
    setActionError('')
    try {
      await request()
      onSuccess?.()
      setRefreshVersion((version) => version + 1)
    } catch (requestError) {
      setActionError(requestError.message)
    } finally {
      setWorkingId('')
    }
  }

  async function reviewPost(postId, status) {
    await runAdminAction(postId, () => onModerateTaskPost(postId, status))
  }

  async function deletePost(post) {
    const confirmed = window.confirm(
      `Permanently delete "${post.title}"? Any participant submissions linked to this task will also be deleted.`
    )
    if (!confirmed) return
    await runAdminAction(post.id, () => onDeleteTaskPost(post.id))
  }

  function updateStatus(path, id, status, update) {
    return runAdminAction(
      id,
      () => apiRequest(path, {
        method: 'PATCH',
        token: session.adminToken,
        body: JSON.stringify({ status }),
      }),
      update
    )
  }

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Admin dashboard"
        title="Review operational records from the database."
        subtitle="Counts, task submissions, and payout requests shown here are loaded from stored records."
      />

      {(error || actionError || dataError) && <div className="form-error" role="alert">{actionError || error || dataError}</div>}
      {dataLoading && <p>Loading operational records…</p>}
      <nav className="admin-section-tabs" aria-label="Admin management sections">
        {['Overview', 'Users & posters', 'Task posts', 'Submissions', 'Wallet transparency', 'Wallet deposits', 'Withdrawals', 'Legacy payouts', 'Task catalog', 'Campaigns'].map((item) => (
          <button type="button" key={item} className={section === item ? 'admin-section-tab active' : 'admin-section-tab'} aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>
            {item}
          </button>
        ))}
      </nav>

      <div className="stats-grid">
        {[
          ['Users', overview?.usersTotal, 'Users & posters'],
          ['Posters', overview?.postersTotal, 'Users & posters'],
          ['Deposits to verify', overview?.depositsPending, 'Wallet deposits'],
          ['Withdrawals to process', overview?.withdrawalsPending, 'Withdrawals'],
          ['Legacy pending payouts', overview?.payoutsPending, 'Legacy payouts'],
          ['Submissions awaiting review', overview?.submissionsPending, 'Submissions'],
          ['Task posts awaiting review', overview?.taskPostsPending, 'Task posts'],
          ['Active campaigns', overview?.campaignsActive, 'Campaigns'],
        ].map(([label, value, targetSection]) => (
          <button
            type="button"
            key={label}
            className="stat-card panel admin-stat-link"
            onClick={() => setSection(targetSection)}
            aria-label={`Open ${targetSection} management`}
          >
            <label>{label}</label>
            <strong>{value ?? '—'}</strong>
            <small>Open {targetSection}</small>
          </button>
        ))}
      </div>

      {section === 'Overview' && (
        <div className="panel admin-overview-note">
          <h2>Platform operations</h2>
          <p>Use the sections above to review accounts, see the complete wallet ledger, verify poster deposits, process user and poster withdrawal requests, moderate tasks, and manage campaigns. Withdrawals are transferred manually before the admin settles the request; the website does not send payments.</p>
        </div>
      )}

      {section === 'Wallet transparency' && (
        <section className="wallet-admin-overview">
          <div className="wallet-admin-summary-grid">
            {[
              ['Total received', walletSummary?.total_received_kes, 'Approved deposits'],
              ['Total withdrawn', walletSummary?.wallet_withdrawn_kes, 'Recorded on wallet balances'],
              ['Settled withdrawals', walletSummary?.total_withdrawn_kes, 'Approved request records'],
              ['Available across wallets', walletSummary?.available_balance_kes, 'Ready for withdrawal'],
              ['Reserved for withdrawal', walletSummary?.reserved_balance_kes, 'Pending requests'],
              ['Deposits awaiting review', walletSummary?.pending_deposits_kes, 'Pending verification'],
              ['Withdrawals awaiting review', walletSummary?.pending_withdrawals_kes, 'Pending processing'],
              ['Rejected deposits', walletSummary?.rejected_deposits_kes, 'Never credited'],
              ['Rejected withdrawals', walletSummary?.rejected_withdrawals_kes, 'Returned to users'],
            ].map(([label, amount, detail]) => (
              <article className="wallet-admin-stat panel" key={label}>
                <span>{label}</span>
                <strong>{amount == null ? '—' : formatKes(amount)}</strong>
                <small>{detail}</small>
              </article>
            ))}
          </div>
          <section className="panel admin-data-panel wallet-review-panel">
            <div className="wallet-history-heading">
              <div><h2>Wallet activity</h2><p>Recent transactions across user and poster accounts. Summary totals cover all recorded history.</p></div>
              <span>{walletSummary?.pending_transactions_count ?? 0} pending</span>
            </div>
            <div className="wallet-admin-filters">
              <label>Account activity
                <select value={walletTypeFilter} onChange={(event) => setWalletTypeFilter(event.target.value)}>
                  <option value="all">All activity</option>
                  <option value="deposit">Deposits</option>
                  <option value="withdrawal">Withdrawals</option>
                </select>
              </label>
              <label>Review status
                <select value={walletStatusFilter} onChange={(event) => setWalletStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="pending_review">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
            </div>
            <div className="history-list">
              {walletTransactions
                .filter((transaction) => walletTypeFilter === 'all' || transaction.transaction_type === walletTypeFilter)
                .filter((transaction) => walletStatusFilter === 'all' || transaction.status === walletStatusFilter)
                .map((transaction) => (
                  <article className="wallet-review-row" key={transaction.id}>
                    <div className="wallet-review-details">
                      <div className="wallet-review-heading">
                        <strong>{transaction.user_name || 'Account unavailable'}</strong>
                        <span className={`status-badge status-${transaction.status}`}>{transaction.status.replace('_', ' ')}</span>
                      </div>
                      <small>{transaction.user_email} · {transaction.user_role} · {formatDate(transaction.created_at)}</small>
                      <div className="wallet-review-facts">
                        <span>{transaction.transaction_type === 'deposit' ? 'Received' : 'Withdrawal'} <strong>{formatKes(transaction.amount_kes)}</strong></span>
                        {transaction.transaction_type === 'withdrawal' && Number(transaction.fee_amount_kes) > 0 && (
                          <>
                            <span>Fee <strong>{formatKes(transaction.fee_amount_kes)}</strong></span>
                            <span>Estimated payout <strong>{formatKes(Number(transaction.amount_kes) - Number(transaction.fee_amount_kes))}</strong></span>
                          </>
                        )}
                        <span>Method <strong>{walletMethodLabels[transaction.payment_method] || transaction.payment_method || 'Not recorded'}</strong></span>
                        {transaction.transaction_type === 'deposit'
                          ? <span>Transfer code / hash <strong>{transaction.transaction_reference || 'Not provided'}</strong></span>
                          : <span>Pay to <strong>{transaction.destination || 'Not provided'}</strong></span>}
                      </div>
                      {transaction.reviewed_at && <small>Reviewed {formatDate(transaction.reviewed_at)}</small>}
                    </div>
                    {transaction.status === 'pending_review' && (
                      <div className="review-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={workingId === transaction.id}
                          onClick={() => updateStatus(`/admin/wallet-transactions/${transaction.id}/status`, transaction.id, 'approved')}
                        >{transaction.transaction_type === 'deposit' ? 'Verify & credit' : 'Confirm paid & settle'}</button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={workingId === transaction.id}
                          onClick={() => updateStatus(`/admin/wallet-transactions/${transaction.id}/status`, transaction.id, 'rejected')}
                        >Reject</button>
                      </div>
                    )}
                  </article>
                ))}
              {!dataLoading && !dataError && walletTransactions.filter((transaction) => (
                (walletTypeFilter === 'all' || transaction.transaction_type === walletTypeFilter)
                && (walletStatusFilter === 'all' || transaction.status === walletStatusFilter)
              )).length === 0 && <p>No wallet activity matches these filters.</p>}
            </div>
          </section>
          <p className="review-disclaimer">Totals are calculated from recorded wallet transactions and wallet balances. They do not include task budgets or unrecorded payments. Withdrawals remain manual; approve only after confirming the transfer.</p>
        </section>
      )}

      {section === 'Users & posters' && (
        <section className="panel admin-data-panel">
          <h2>Registered accounts</h2>
          <div className="queue-table admin-record-table">
            <div className="queue-head"><span>Name / role</span><span>Contact</span><span>Wallet</span><span>Activity</span><span>Status</span><span>Action</span></div>
            {users.map((user) => (
              <div className="queue-row" key={user.id}>
                <span><strong>{user.full_name}</strong><small>{user.role} · {user.is_verified ? 'Verified' : 'Not verified'}</small></span>
                <span>{user.email}<small>{user.phone || 'No phone recorded'}</small></span>
                <span>Available: {user.balance_kes == null ? 'Not recorded' : formatKes(user.balance_kes)}<small>Pending: {user.pending_kes == null ? 'Not recorded' : formatKes(user.pending_kes)}</small><small>Withdrawn: {user.withdrawn_kes == null ? 'Not recorded' : formatKes(user.withdrawn_kes)}</small></span>
                <span>{user.posts_count} posts<small>{user.submissions_count} task submissions</small></span>
                <span>{user.status}</span>
                <span>{user.role === 'admin' ? 'Protected admin' : (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={workingId === user.id}
                    onClick={() => updateStatus(
                      `/admin/users/${user.id}/status`,
                      user.id,
                      user.status === 'active' ? 'suspended' : 'active',
                      () => setUsers((current) => current.map((item) => item.id === user.id ? { ...item, status: item.status === 'active' ? 'suspended' : 'active' } : item))
                    )}
                  >{user.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
                )}</span>
              </div>
            ))}
            {!dataLoading && !dataError && users.length === 0 && <p>No user or poster accounts are recorded.</p>}
          </div>
          <p className="review-disclaimer">Account suspension blocks subsequent sign-in and authenticated activity. Wallet amounts are read-only here.</p>
        </section>
      )}

      {section === 'Task posts' && (
      <section className="panel task-post-review">
        <div className="review-section-heading">
          <div><span className="home-overline">Publisher review</span><h2>Submitted task posts</h2></div>
          <span className="review-count">{taskPosts.length} total · {taskPosts.filter((post) => post.status === 'pending_review').length} pending</span>
        </div>
        {taskPosts.length === 0 ? (
          <p className="empty-review">No task posts have been submitted.</p>
        ) : (
          <div className="task-post-review-list">
            {taskPosts.map((post) => (
              <article className="task-post-review-card" key={post.id}>
                <div className="review-post-main">
                  <span className="task-tag">{post.category}</span>
                  <span className={`status-badge status-${post.status}`}>{post.status.replace('_', ' ')}</span>
                  <h3>{post.title}</h3>
                  <p>{post.description}</p>
                  <p className="review-poster">Submitted by {post.poster_name} · {post.poster_email}</p>
                  {post.task_url && <a href={post.task_url} target="_blank" rel="noreferrer">Review task link ↗</a>}
                  <div className="review-proof"><strong>Proof required</strong><span>{post.proof_requirements}</span></div>
                </div>
                <div className="review-post-details">
                  <div><span>Per completion</span><strong>KSh {Number(post.payout_kes).toLocaleString('en-KE')}</strong></div>
                  <div><span>Participants</span><strong>{Number(post.participant_limit).toLocaleString('en-KE')}</strong></div>
                  <div><span>Reward budget</span><strong>KSh {Number(post.total_budget_kes).toLocaleString('en-KE')}</strong></div>
                  <div><span>Due date</span><strong>{new Date(post.due_date).toLocaleDateString('en-KE')}</strong></div>
                  <div className="review-actions">
                    {post.status === 'pending_review' && (
                      <>
                        <button type="button" className="btn btn-primary" disabled={workingId === post.id} onClick={() => reviewPost(post.id, 'approved')}>
                          {workingId === post.id ? 'Saving…' : 'Approve & publish'}
                        </button>
                        <button type="button" className="btn btn-secondary" disabled={workingId === post.id} onClick={() => reviewPost(post.id, 'rejected')}>Reject</button>
                      </>
                    )}
                    <button type="button" className="btn btn-secondary btn-delete" disabled={workingId === post.id} onClick={() => deletePost(post)}>
                      {workingId === post.id ? 'Deleting…' : 'Delete task'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="review-disclaimer">Approval publishes a post, but does not collect or reserve funds. Verify off-platform funding before publishing. Deleting a task permanently removes its linked participant submissions.</p>
      </section>
      )}

      {section === 'Submissions' && (
        <section className="panel admin-data-panel">
          <h2>Participant task submissions</h2>
          <div className="queue-table admin-record-table">
            <div className="queue-head"><span>Participant</span><span>Task</span><span>Reward</span><span>Proof / notes</span><span>Status</span><span>Review</span></div>
            {submissions.map((item) => (
              <div key={item.id} className="queue-row">
                <span>{item.user_name || 'User record unavailable'}<small>{item.user_email}</small></span>
                <span>{item.task_title || 'Task record unavailable'}</span>
                <span>{formatKes(item.amount_kes)}</span>
                <span className="submission-proof-cell">
                  {item.notes && <small>{item.notes}</small>}
                  {item.image_url && (
                    <button
                      type="button"
                      className="submission-proof-link"
                      onClick={() => {
                        setProofImageError(false)
                        setSelectedProof(item)
                      }}
                    >View submitted proof image</button>
                  )}
                  {!item.notes && !item.image_url && <small>{item.proof_type || 'No proof details recorded'}</small>}
                </span>
                <span>{item.status}</span>
                <span>{item.status === 'pending_review' ? <div className="review-actions">
                  <button type="button" className="btn btn-primary" disabled={workingId === item.id} onClick={() => updateStatus(`/admin/tasks/${item.id}/status`, item.id, 'approved')}>Approve</button>
                  <button type="button" className="btn btn-secondary" disabled={workingId === item.id} onClick={() => updateStatus(`/admin/tasks/${item.id}/status`, item.id, 'rejected')}>Reject</button>
                </div> : 'Reviewed'}</span>
              </div>
            ))}
            {!dataLoading && !dataError && submissions.length === 0 && <p>No task submissions are recorded.</p>}
          </div>
          <p className="review-disclaimer">Approving or rejecting a task proof updates its review status only. Task reward funding and automatic wallet credits are not enabled; only verified poster deposits currently add funds.</p>
        </section>
      )}

      {section === 'Legacy payouts' && (
        <section className="panel admin-data-panel">
          <h2>Legacy payout records</h2>
          <div className="history-list">
            {payouts.map((payout) => (
              <div key={payout.id} className="history-row admin-payout-row">
                <div>
                  <strong>{payout.user_name || 'User record unavailable'} · {payout.method} · {formatKes(payout.amount_kes)}</strong>
                  <small>{payout.destination} · {payout.status} · {formatDate(payout.created_at)}</small>
                </div>
              </div>
            ))}
            {!dataLoading && !dataError && payouts.length === 0 && <p>No payout requests are recorded.</p>}
          </div>
          <p className="review-disclaimer">These are records from the retired payout workflow and do not change wallet balances. New requests appear in Withdrawals and reserve funds before review.</p>
        </section>
      )}

      {['Wallet deposits', 'Withdrawals'].includes(section) && (
        <section className="panel admin-data-panel wallet-review-panel">
          <h2>{section === 'Wallet deposits' ? 'Poster deposit verification' : 'Withdrawal requests'}</h2>
          <p className="wallet-review-intro">
            {section === 'Wallet deposits'
              ? 'Match the submitted payment code against the actual payment before approving. Approval credits the poster wallet immediately.'
              : 'Review the destination and process the manual transfer before approving. Approval settles the reserved balance; rejection returns it to available balance.'}
          </p>
          <div className="history-list">
            {walletTransactions
              .filter((transaction) => transaction.transaction_type === (section === 'Wallet deposits' ? 'deposit' : 'withdrawal'))
              .map((transaction) => (
                <article className="wallet-review-row" key={transaction.id}>
                  <div className="wallet-review-details">
                    <div className="wallet-review-heading">
                      <strong>{transaction.user_name || 'Account unavailable'}</strong>
                      <span className={`status-badge status-${transaction.status}`}>{transaction.status.replace('_', ' ')}</span>
                    </div>
                    <small>{transaction.user_email} · {transaction.user_role} · {formatDate(transaction.created_at)}</small>
                    <div className="wallet-review-facts">
                      <span>Amount <strong>{formatKes(transaction.amount_kes)}</strong></span>
                      <span>Method <strong>{walletMethodLabels[transaction.payment_method] || transaction.payment_method || 'Not recorded'}</strong></span>
                      {transaction.transaction_type === 'deposit'
                        ? <span>Transfer code / hash <strong>{transaction.transaction_reference || 'Not provided'}</strong></span>
                        : <span>Pay to <strong>{transaction.destination || 'Not provided'}</strong></span>}
                    </div>
                    {transaction.description && <small>{transaction.description}</small>}
                    {transaction.reviewed_at && <small>Reviewed {formatDate(transaction.reviewed_at)}</small>}
                  </div>
                  {transaction.status === 'pending_review' && (
                    <div className="review-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={workingId === transaction.id}
                        onClick={() => updateStatus(`/admin/wallet-transactions/${transaction.id}/status`, transaction.id, 'approved')}
                      >{section === 'Wallet deposits' ? 'Verify & credit wallet' : 'Confirm paid & settle'}</button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={workingId === transaction.id}
                        onClick={() => updateStatus(`/admin/wallet-transactions/${transaction.id}/status`, transaction.id, 'rejected')}
                      >Reject</button>
                    </div>
                  )}
                </article>
              ))}
            {!dataLoading && !dataError && !walletTransactions.some((transaction) => (
              transaction.transaction_type === (section === 'Wallet deposits' ? 'deposit' : 'withdrawal')
            )) && <p>No {section === 'Wallet deposits' ? 'deposit' : 'withdrawal'} transactions are recorded.</p>}
          </div>
        </section>
      )}

      {section === 'Task catalog' && (
        <section className="panel admin-data-panel">
          <h2>Platform tasks</h2>
          <div className="history-list">
            {catalog.map((task) => (
              <div className="history-row" key={task.id}>
                <div><strong>{task.title}</strong><small>{task.category} · {formatKes(task.payout_kes)} · {task.active ? 'Active' : 'Inactive'}</small></div>
                <button type="button" className="btn btn-secondary" disabled={workingId === task.id} onClick={() => runAdminAction(
                  task.id,
                  () => apiRequest(`/admin/catalog/${task.id}/status`, { method: 'PATCH', token: session.adminToken, body: JSON.stringify({ active: !task.active }) }),
                  () => setCatalog((current) => current.map((item) => item.id === task.id ? { ...item, active: !task.active } : item))
                )}>{task.active ? 'Deactivate' : 'Activate'}</button>
              </div>
            ))}
            {!dataLoading && !dataError && catalog.length === 0 && <p>No platform tasks are configured in the database.</p>}
          </div>
        </section>
      )}

      {section === 'Campaigns' && (
        <section className="panel admin-data-panel">
          <h2>Promotional campaigns</h2>
          <div className="history-list">
            {campaigns.map((campaign) => (
              <div className="history-row" key={campaign.id}>
                <div><strong>{campaign.name}</strong><small>{campaign.kind} · {formatKes(campaign.bonus_kes)} · {campaign.active ? 'Active' : 'Inactive'}</small></div>
                <button type="button" className="btn btn-secondary" disabled={workingId === campaign.id} onClick={() => runAdminAction(
                  campaign.id,
                  () => apiRequest(`/admin/campaigns/${campaign.id}/status`, { method: 'PATCH', token: session.adminToken, body: JSON.stringify({ active: !campaign.active }) }),
                  () => setCampaigns((current) => current.map((item) => item.id === campaign.id ? { ...item, active: !campaign.active } : item))
                )}>{campaign.active ? 'Deactivate' : 'Activate'}</button>
              </div>
            ))}
            {!dataLoading && !dataError && campaigns.length === 0 && <p>No campaigns are recorded in the database.</p>}
          </div>
        </section>
      )}

      {selectedProof && (
        <div className="proof-image-backdrop" onClick={() => setSelectedProof(null)}>
          <section
            className="proof-image-dialog panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proof-image-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="proof-image-header">
              <div>
                <span className="eyebrow">Task submission proof</span>
                <h2 id="proof-image-title">{selectedProof.task_title || 'Submitted proof image'}</h2>
                <p>{selectedProof.user_name || selectedProof.user_email || 'Participant'}</p>
              </div>
              <button type="button" className="topbar-back" onClick={() => setSelectedProof(null)}>Close</button>
            </header>
            {proofImageError
              ? <p className="proof-image-error" role="alert">This proof image could not be loaded. The stored image may be invalid or unavailable.</p>
              : <img
                  className="proof-image-preview"
                  src={selectedProof.image_url}
                  alt={`Proof submitted by ${selectedProof.user_name || 'participant'}`}
                  onError={() => setProofImageError(true)}
                />}
          </section>
        </div>
      )}
    </div>
  )
}

function LearnPage({ setCurrentPage }) {
  return (
    <div className="page-wrap learn-page">
      <PageHeader
        eyebrow="Learn & policies"
        title="Everything you need to know, in one place."
        subtitle="How tasks work, how we protect a fair experience, and the policies behind your account and rewards."
      />

      <section className="learn-section">
        <div className="learn-section-heading"><span className="eyebrow">01 · HOW IT WORKS</span><h2>Clear steps from opportunity to reward.</h2></div>
        <div className="steps-grid learn-steps">
          {howSteps.map((step, index) => (
            <article className="step-card panel" key={step.title}>
              <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="learn-section">
        <div className="learn-section-heading"><span className="eyebrow">02 · TRUST & SAFETY</span><h2>Fair participation and clear records.</h2></div>
        <div className="trust-grid info-grid">
          <section className="panel info-panel"><h3>Protecting the community</h3><ul className="check-list compact">{trustChecks.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="panel info-panel"><h3>What you can expect</h3><ul className="check-list compact"><li>Task instructions and displayed rewards before you start.</li><li>Submissions can be reviewed against the listed requirements.</li><li>Wallet activity and request status remain available in your account.</li><li>Support is available for questions and transaction concerns.</li></ul></section>
        </div>
      </section>

      <section className="learn-section">
        <div className="learn-section-heading"><span className="eyebrow">03 · POLICIES & REWARDS</span><h2>Read the details that matter to you.</h2></div>
        <div className="trust-grid info-grid">
          <section className="panel info-panel"><span className="tag">Participation</span><h3>Earning &amp; reward rules</h3><p>Task eligibility, screening, approval, payout minimums, and fee schedule.</p><button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Earning rules')}>Read earning rules →</button></section>
          <section className="panel info-panel"><span className="tag">Your account</span><h3>Terms &amp; privacy</h3><p>How accounts work and how information is used to provide and protect the service.</p><div className="survey-page-actions"><button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Terms')}>Terms of use</button><button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Privacy')}>Privacy policy</button></div></section>
        </div>
      </section>
    </div>
  )
}

function ForgotPasswordPage({ onBack }) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !isValidEmailAddress(normalizedEmail)) {
      setError('Enter a valid email address to receive the reset link.')
      return
    }

    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      const result = await apiRequest('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail }),
      })
      setSuccess(result.message || 'If an account with that email exists, we sent a reset link.')
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-wrap auth-wrap">
      <div className="panel auth-panel">
        <div className="eyebrow">Account recovery</div>
        <h2>Reset your password</h2>
        <p className="auth-intro">Enter the email address tied to your Hustle254 account. We will send a secure reset link to help you set a new password.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        {success && <div className="submission-success" role="status">{success}</div>}
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Sending reset link…' : 'Send reset link'}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onBack}>
            Back to login
          </button>
        </form>
      </div>
    </div>
  )
}

function ResetPasswordPage({ onBack }) {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('reset') || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()

    const trimmedToken = token.trim()
    if (!trimmedToken) {
      setError('The reset token is missing. Use the link from your email or paste it here.')
      return
    }
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      const result = await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: trimmedToken, password }),
      })
      setSuccess(result.message)
      setPassword('')
      setConfirmPassword('')
      setToken(trimmedToken)
      window.setTimeout(() => onBack(), 1800)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-wrap auth-wrap">
      <div className="panel auth-panel">
        <div className="eyebrow">New password</div>
        <h2>Create a secure password</h2>
        <p className="auth-intro">Use the secure link you received by email, or paste the reset token below.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        {success && <div className="submission-success" role="status">{success}</div>}
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Reset token
            <input
              type="text"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste your secure reset token"
              required
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength="8"
              placeholder="At least 8 characters"
              required
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength="8"
              placeholder="Repeat your new password"
              required
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Updating password…' : 'Update password'}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onBack}>Back to login</button>
        </form>
      </div>
    </div>
  )
}

function VerifyEmailPage({ context, onAuthenticated, onBack }) {
  const email = context.email
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState(context.message)
  const [devCode, setDevCode] = useState(context.devVerificationCode)
  const [resendAfter, setResendAfter] = useState(context.resendAfterSeconds)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (resendAfter <= 0) return undefined
    const timeout = window.setTimeout(() => setResendAfter((remaining) => Math.max(0, remaining - 1)), 1000)
    return () => window.clearTimeout(timeout)
  }, [resendAfter])

  async function verifyEmail(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const result = await apiRequest('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      })
      onAuthenticated({ token: result.token, user: result.user })
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function resendCode() {
    setSubmitting(true)
    setError('')
    try {
      const result = await apiRequest('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setNotice(result.message)
      setDevCode(result.devVerificationCode || '')
      setResendAfter(Number(result.resendAfterSeconds || 0))
    } catch (submitError) {
      setError(submitError.message)
      setResendAfter(Number(submitError.resendAfterSeconds || 0))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-wrap auth-wrap">
      <div className="panel auth-panel">
        <div className="eyebrow">Email verification</div>
        <h2>Confirm it’s really you.</h2>
        <p className="auth-intro">Enter the 6-digit code we sent to your inbox. Your account stays locked until the address is confirmed.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        {notice && <div className="submission-success" role="status">{notice}</div>}
        {devCode && <div className="submission-success" role="status">Development code: <strong>{devCode}</strong></div>}
        <form className="form-grid" onSubmit={verifyEmail}>
          <label>
            Email address
            <input type="email" value={email} readOnly />
          </label>
          <label>
            6-digit code
            <input
              className="verification-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength="6"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              required
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting || code.length !== 6}>
            {submitting ? 'Checking code…' : 'Verify email and continue'}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={resendCode} disabled={submitting || resendAfter > 0}>
            {resendAfter > 0 ? `Resend code in ${resendAfter}s` : 'Resend verification code'}
          </button>
          <button type="button" className="auth-link-btn" onClick={onBack}>Back to login</button>
        </form>
      </div>
    </div>
  )
}

function AuthPage({ type, onChangeType, onAuthenticated, onVerificationRequested }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const isPosterLogin = type === 'posterLogin'
  const isLogin = type === 'login' || isPosterLogin
  const isPosterSignup = type === 'posterSignup'
  const inviteReferralCode = new URLSearchParams(window.location.search).get('ref') || ''

  async function handleAuth(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') || '').trim()
    if (!isLogin && !isValidEmailAddress(email)) {
      setError('Invalid email address. Check the spelling and enter a correctly formatted address.')
      setSubmitting(false)
      return
    }
    const payload = isLogin
      ? {
          identifier: formData.get('identifier'),
          password: formData.get('password'),
          ...(isPosterLogin ? { expectedRole: 'poster' } : {}),
        }
      : {
          fullName: formData.get('fullName'),
          email,
          phone: formData.get('phone'),
          password: formData.get('password'),
          referralCode: formData.get('referralCode'),
        }

    try {
      const result = await apiRequest(
        isLogin ? '/auth/login' : isPosterSignup ? '/auth/poster-signup' : '/auth/signup',
        {
        method: 'POST',
        body: JSON.stringify(payload),
        }
      )
      if (result.verificationRequired) {
        onVerificationRequested(result.email, result)
        return
      }
      onAuthenticated({ token: result.token, user: result.user })
    } catch (authError) {
      if (authError.code === 'EMAIL_NOT_VERIFIED') {
        onVerificationRequested(authError.email || email, authError)
      } else {
        setError(authError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-wrap auth-wrap">
      <div className="panel auth-panel">
        <div className="eyebrow">{isPosterLogin ? 'Poster account' : isLogin ? 'Welcome back' : isPosterSignup ? 'Poster registration' : 'Create account'}</div>
        <h2>{isPosterLogin ? 'Login to your poster account' : isLogin ? 'Login to your account' : isPosterSignup ? 'Register your poster account' : 'Join Hustle254'}</h2>
        <div className={isPosterSignup ? 'auth-tabs poster-auth-tabs' : 'auth-tabs'} role="tablist" aria-label="Account access">
          <button type="button" role="tab" aria-selected={isLogin} className={isLogin ? 'auth-tab active' : 'auth-tab'} onClick={() => onChangeType('Login')}>Log in</button>
          <button type="button" role="tab" aria-selected={type === 'signup'} className={type === 'signup' ? 'auth-tab active' : 'auth-tab'} onClick={() => onChangeType('Sign up')}>Create account</button>
          <button type="button" role="tab" aria-selected={isPosterLogin} className={isPosterLogin ? 'auth-tab active' : 'auth-tab'} onClick={() => onChangeType('Poster login')}>Login as poster</button>
          <button type="button" role="tab" aria-selected={isPosterSignup} className={isPosterSignup ? 'auth-tab active' : 'auth-tab'} onClick={() => onChangeType('Poster signup')}>Register as poster</button>
        </div>
        {(isPosterLogin || isPosterSignup) && <p className="auth-intro">Poster accounts use separate login details and can publish tasks, submit deposits for verification, and track withdrawals.</p>}

        {error && <div className="form-error" role="alert">{error}</div>}
        <form className="form-grid" onSubmit={handleAuth}>
          {!isLogin && (
            <label>
              Full name
              <input name="fullName" type="text" autoComplete="name" placeholder="e.g. Jane Wanjiku" required />
            </label>
          )}
          <label>
            {isLogin ? isPosterLogin ? 'Poster email or phone' : 'Email or phone' : 'Email'}
            <input
              name={isLogin ? 'identifier' : 'email'}
              type={isLogin ? 'text' : 'email'}
              autoComplete={isLogin ? 'username' : 'email'}
              maxLength={isLogin ? undefined : 254}
              placeholder={isLogin ? isPosterLogin ? 'Enter poster email or phone' : 'Enter email or phone' : 'you@example.com'}
              onInvalid={isLogin ? undefined : (event) => event.currentTarget.setCustomValidity('Invalid email address. Check the spelling and enter a correctly formatted address.')}
              onInput={isLogin ? undefined : (event) => event.currentTarget.setCustomValidity('')}
              required
            />
            {!isLogin && <small>We’ll send a one-time code to confirm you can access this inbox.</small>}
          </label>
          {!isLogin && (
            <label>
              Phone number
              <input name="phone" type="tel" autoComplete="tel" placeholder="+254 7XX XXX XXX" required />
            </label>
          )}
          <label>
            Password
            <input name="password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} minLength="8" placeholder="At least 8 characters" required />
          </label>
          {!isLogin && (
            <label>
              Referral code (optional)
              <input name="referralCode" type="text" defaultValue={inviteReferralCode} maxLength="40" placeholder="Leave blank if you don't have one" />
              <small>Optional. If someone invited you, their code may already be filled in.</small>
            </label>
          )}
          {isLogin && (
            <button type="button" className="auth-link-btn" onClick={() => onChangeType('Forgot password')}>
              Forgot password?
            </button>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Please wait…' : isPosterLogin ? 'Login as poster' : isLogin ? 'Login' : isPosterSignup ? 'Create poster account' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}

function AboutPage({ setCurrentPage }) {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="About Hustle254"
        title="Small actions. Clear rewards. Built for everyday hustle."
        subtitle="Hustle254 brings task opportunities, transparent reward information, and account tools together in one place."
        actions={<button type="button" className="btn btn-primary" onClick={() => setCurrentPage('Tasks')}>Explore tasks <span aria-hidden="true">→</span></button>}
      />
      <div className="trust-grid info-grid">
        <section className="panel info-panel">
          <span className="tag">Our purpose</span>
          <h3>Make online opportunities easier to understand.</h3>
          <p>We want people to see what a task asks, what reward is offered, and how review works before they take part. Clear expectations help participants and task posters work with confidence.</p>
        </section>
        <section className="panel info-panel">
          <span className="tag">How we work</span>
          <h3>Clarity before claims.</h3>
          <p>Task completion and payout eligibility depend on the specific task rules and verification. We aim to show progress and wallet activity clearly, and to review submissions fairly.</p>
        </section>
      </div>
      <section className="panel info-panel info-callout">
        <h3>A platform, not a promise of income</h3>
        <p>Opportunities and rewards can change, and earnings are not guaranteed. Read the task requirements and earning rules before you begin.</p>
        <button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Earning rules')}>Read earning rules</button>
      </section>
    </div>
  )
}

function ContactPage() {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Contact Hustle254"
        title="We’re here to help you find the right next step."
        subtitle="Choose the contact method that works for you. Include the email on your account and a short description so we can understand your request."
      />
      <div className="trust-grid info-grid">
        <section className="panel info-panel contact-card">
          <span className="contact-icon" aria-hidden="true">@</span>
          <span className="tag">Email support</span>
          <h3>Send us a message</h3>
          <p>For account, task, wallet, or general enquiries.</p>
          <a className="btn btn-primary" href="mailto:hustleworld254@gmail.com">hustleworld254@gmail.com</a>
        </section>
        <section className="panel info-panel contact-card">
          <span className="contact-icon" aria-hidden="true">☎</span>
          <span className="tag">Call or WhatsApp</span>
          <h3>Talk to our team</h3>
          <p>Call or message us on WhatsApp at <strong>+254 736 677 630</strong>.</p>
          <div className="contact-actions">
            <a className="btn btn-primary" href="https://wa.me/254736677630" target="_blank" rel="noreferrer">Chat on WhatsApp</a>
            <a className="btn btn-secondary" href="tel:+254736677630">Call us</a>
          </div>
        </section>
      </div>
      <section className="panel info-panel">
        <h3>Help us resolve it faster</h3>
        <p>Tell us what happened, when it happened, and the task or transaction reference if you have one. Never send your password, one-time verification code, or full payment-card details.</p>
      </section>
    </div>
  )
}

function TermsPage() {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Terms of use"
        title="A fair, straightforward way to use Hustle254."
        subtitle="These terms explain the basic expectations for accounts, tasks, rewards, and payouts. By using the platform, you agree to follow the rules shown here and on each task."
      />
      <div className="info-document panel">
        <p className="info-updated">Last updated: 15 October 2026</p>
        <section><h3>1. Your account</h3><p>Provide accurate account details, keep your sign-in credentials private, and use your own account. You are responsible for activity carried out through your account. Contact support promptly if you suspect unauthorized access.</p></section>
        <section><h3>2. Tasks and submissions</h3><p>Read the instructions, eligibility criteria, time limits, and displayed reward before starting. Submit genuine, complete work and only the proof requested. A submission may be reviewed and can be declined if it does not meet the stated requirements or cannot be verified.</p></section>
        <section><h3>3. Rewards and wallet</h3><p>Task rewards are subject to completion and verification against the task requirements. A reward is added to your confirmed, eligible wallet balance only after approval. Pending deposits, pending submissions, reserved amounts, and other unconfirmed amounts are not eligible for withdrawal. Wallet activity is recorded in your transaction history.</p></section>
        <section><h3>4. Withdrawal minimum and service fees</h3><p>The minimum withdrawal request is KSh 128 ($1.00), using the platform’s displayed reference rate of KSh 128 per US dollar. A service and risk fee is deducted from the requested amount: KSh 10 for requests from KSh 128 through KSh 384 ($1.00–$3.00); KSh 15 for amounts above KSh 384 through KSh 896 (over $3.00 through $7.00); and KSh 25 for amounts above KSh 896 (over $7.00). The remaining amount is the estimated payout. The fee covers processing, fraud-risk controls, and related operating costs; it is not a tax imposed by a government. The rate and fees will be shown before you submit the request.</p></section>
        <section><h3>5. Referral and affiliation rewards</h3><p>Referral codes are optional at registration. A referrer earns a one-time KSh 5 after a referred tasker completes a task submission approved by an administrator, or KSh 30 after a referred poster’s first task is approved and the poster’s administrator-verified deposits cover that task’s posted budget. The reward is credited to the referrer’s available wallet balance after verification. Only direct referrals qualify; self-referrals, duplicate accounts, and manipulated activity are not eligible. We may withhold or reverse an improperly credited reward after review.</p></section>
        <section><h3>6. Acceptable use</h3><p>Do not submit false proof, interfere with platform security, exploit errors, impersonate others, or use the platform for unlawful activity. We may restrict or suspend an account when reasonably necessary to protect users, task posters, or the platform, and may request additional information to review a case.</p></section>
        <section><h3>7. Availability and changes</h3><p>Task availability, reward amounts, and features may change. Hustle254 does not guarantee a particular volume of tasks, earnings, or payout timing. We will make reasonable efforts to keep the service available and communicate material changes through the platform where appropriate.</p></section>
        <section><h3>8. Questions and disputes</h3><p>Contact us with the account email and relevant task or transaction reference so we can review the issue. These terms should be read together with the Privacy Policy and Earning &amp; Reward Rules.</p></section>
      </div>
    </div>
  )
}

function PrivacyPage() {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Privacy policy"
        title="Your information should have a clear purpose."
        subtitle="This policy describes the account and activity information Hustle254 uses to operate the service, protect accounts, and review rewards."
      />
      <div className="info-document panel">
        <p className="info-updated">Last updated: 15 October 2026</p>
        <section><h3>Information you provide</h3><p>This may include your name, email address, phone number, account credentials (stored in protected form), profile details, task submissions and proof, support messages, and payment references or payout destination details you choose to provide.</p></section>
        <section><h3>Information created when you use the service</h3><p>We process account activity, task and reward status, wallet transactions, and basic technical or security signals where enabled. Essential browser storage is used for session and display preferences. We do not ask you to send passwords or one-time verification codes to support.</p></section>
        <section><h3>How information is used</h3><ul><li>Create and secure accounts.</li><li>Deliver tasks, record submissions, and review reward eligibility.</li><li>Maintain wallet and payout records and investigate disputes.</li><li>Detect abuse, protect the service, and meet applicable legal obligations.</li><li>Respond to support requests and improve platform reliability.</li></ul></section>
        <section><h3>When information is shared</h3><p>Information is shared only as needed to operate the service—for example, with infrastructure and communications providers, with task posters to verify a relevant submission, or with authorities where legally required. We do not sell personal information.</p></section>
        <section><h3>Security and retention</h3><p>We use safeguards intended to protect account and transaction information. No online system can promise absolute security. We retain information for as long as needed for the purposes above, including account support, fraud review, financial records, and legal requirements.</p></section>
        <section><h3>Your choices and requests</h3><p>You may contact us to ask about your information, request correction, or raise a privacy concern. Some records may need to be retained to meet legal, security, or transaction obligations. We will review requests in line with applicable requirements.</p></section>
        <section><h3>Contact</h3><p>For privacy questions, email <a href="mailto:hustleworld254@gmail.com">hustleworld254@gmail.com</a> or call/WhatsApp <a href="tel:+254736677630">+254 736 677 630</a>.</p></section>
      </div>
    </div>
  )
}

function EarningRulesPage({ setCurrentPage }) {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Earning & reward rules"
        title="Know what counts before you start."
        subtitle="Rewards are tied to clearly defined actions and review—not simply to opening an account. Check each task’s own instructions before participating."
      />
      <div className="trust-grid info-grid">
        <section className="panel info-panel"><span className="tag">01 · Choose</span><h3>Check the offer first</h3><p>Review the task description, eligibility, requested proof, deadline, and displayed KSh reward. A task may close or reach its participant limit.</p></section>
        <section className="panel info-panel"><span className="tag">02 · Complete</span><h3>Follow the instructions</h3><p>Complete the required action yourself and provide accurate proof through the method requested. Do not submit altered, recycled, or misleading evidence.</p></section>
        <section className="panel info-panel"><span className="tag">03 · Review</span><h3>Allow time for verification</h3><p>Submissions may remain pending while they are reviewed. Only approved and credited rewards become part of the available wallet balance.</p></section>
        <section className="panel info-panel"><span className="tag">04 · Request</span><h3>Use correct payout details</h3><p>When requesting a withdrawal, choose a supported method, provide accurate destination details, and allow time for review. Never share your password or verification code to receive a payout.</p></section>
      </div>
      <section className="panel info-panel info-callout">
        <h3>Daily login streak bonus</h3>
        <p>Eligible user and poster accounts receive one check-in per calendar day in East Africa Time. Seven consecutive daily check-ins qualify for the displayed $0.023 bonus (KSh 2.94). Repeated check-ins on the same day do not add days; missing a calendar day restarts the consecutive run. Check-ins and reward claims are recorded in the account history.</p>
      </section>
      <section className="panel info-panel">
        <h3>Withdrawals and fee schedule</h3>
        <p>Minimum withdrawal request: {formatKesWithUsd(MINIMUM_WITHDRAWAL_KES)}. A KSh 10 fee applies to KSh 128–384 ($1.00–$3.00); KSh 15 applies above KSh 384 through KSh 896 (over $3.00 through $7.00); KSh 25 applies above KSh 896 (over $7.00). The fee is deducted from the requested amount, so the estimated payout is the request less the applicable fee. Requests may use only confirmed and eligible wallet funds. The KSh 128 per USD figure is a fixed display and fee-band reference, not a live exchange quote.</p>
      </section>
      <section className="panel info-panel">
        <h3>Fair-play rules</h3>
        <ul className="check-list compact">
          <li>One genuine account per person; no duplicate or automated activity.</li>
          <li>Do not manipulate task completion, referrals, proof, or reward systems.</li>
          <li>Rewards depend on each task’s eligibility and verification requirements.</li>
          <li>Suspicious or invalid activity may be held for review and can result in declined rewards or account restrictions.</li>
        </ul>
        <button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Tasks')}>Browse available tasks</button>
      </section>
    </div>
  )
}

function LegalPage({ setCurrentPage }) {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Legal & compliance"
        title="Policies in plain language."
        subtitle="Review the terms, privacy information, and reward rules that explain how Hustle254 works."
      />
      <div className="trust-grid info-grid">
        <section className="panel info-panel"><span className="tag">Using the platform</span><h3>Terms of use</h3><p>Account responsibilities, task submissions, wallet balances, payouts, and acceptable use.</p><button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Terms')}>Read the terms →</button></section>
        <section className="panel info-panel"><span className="tag">Your information</span><h3>Privacy policy</h3><p>What information is used to run accounts, review activity, and protect the service.</p><button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Privacy')}>Read the privacy policy →</button></section>
        <section className="panel info-panel"><span className="tag">Earning transparently</span><h3>Earning &amp; reward rules</h3><p>How tasks, verification, wallet credit, and daily streak bonuses work.</p><button type="button" className="btn btn-secondary" onClick={() => setCurrentPage('Earning rules')}>Read the reward rules →</button></section>
      </div>
    </div>
  )
}

export default App
