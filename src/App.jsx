import { useEffect, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
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

function formatDate(value) {
  return value ? new Date(value).toLocaleString('en-KE') : 'Date unavailable'
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
  { label: 'Features', icon: 'F' },
]

const learningNavigation = [
  { label: 'How it works', icon: 'i' },
  { label: 'Trust', icon: 'T' },
  { label: 'Legal', icon: 'L' },
]

const accountNavigation = [
  { label: 'Dashboard', icon: 'D' },
  { label: 'Wallet', icon: 'W' },
  { label: 'Streaks', icon: '7' },
  { label: 'Referral', icon: 'R' },
]

const memberPages = new Set(['Tasks', 'Wallet', 'Streaks', 'Referral', 'Dashboard', 'Admin', 'Poster', 'Post a task'])

const howSteps = [
  { title: 'Create your account', text: 'Sign up quickly with your phone number, profile basics, and KYC-friendly verification.' },
  { title: 'Complete trusted tasks', text: 'Take surveys, social tasks, app trials, and offer missions with transparent reward values.' },
  { title: 'Submit proof securely', text: 'Use live-photo validation and admin review to prevent fake or duplicate submissions.' },
  { title: 'Withdraw in your preferred method', text: 'Request a manual payout to M-Pesa, PayPal, USDT, Till, or a bank account.' },
]

const featureCards = [
  { title: 'Survey & offer wall', text: 'High-quality daily tasks with clear payouts and category filtering.', tag: 'Fast earnings' },
  { title: 'Referral machine', text: 'Tier-based commissions and referral dashboards for stable user growth.', tag: 'Growth loop' },
  { title: 'Streak boosters', text: 'Daily rewards, milestones, and seasonal bonuses to improve retention.', tag: 'Retention' },
  { title: 'Wallet transparency', text: 'Track pending, approved, rejected, and withdrawn balances in real time.', tag: 'Trust' },
  { title: 'Fraud shield', text: 'Camera-only proof capture, IP/device checks, and admin review queue.', tag: 'Security' },
  { title: 'Admin control center', text: 'Approve payouts, manage campaigns, detect abuse, and monitor analytics.', tag: 'Operations' },
]

const legalItems = [
  'Transparent earning rules and eligibility criteria',
  'Privacy-first data handling for KYC and payouts',
  'Anti-fraud activity detection and payout review rules',
  'Bonus, referral, and withdrawal terms for all users',
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
      return localStorage.getItem('hustle254-theme') === 'light' ? 'light' : 'dark'
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
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('hustle254-session') || 'null')
    } catch {
      return null
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
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
  const dailyStreak = dailyStreakRecord?.userId === session?.user?.id ? dailyStreakRecord.streak : null
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
      .then(({ taskPosts: pendingPosts }) => {
        setTaskPosts(pendingPosts)
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
    setTaskPosts((currentPosts) => currentPosts.filter((post) => post.id !== id))
    if (status === 'approved') {
      const { tasks: publishedTasks } = await apiRequest('/tasks')
      setTasks(publishedTasks.map(normalizeTask))
    }
    return result
  }

  function handleAuthenticated(nextSession) {
    localStorage.setItem('hustle254-session', JSON.stringify(nextSession))
    setSession(nextSession)
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
          />
        )
      case 'Tasks':
        return <TasksPage tasks={tasks} selectedTask={selectedTask} setSelectedTask={setSelectedTaskId} loading={tasksLoading} error={tasksError} session={session} />
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
          />
        )
      case 'Trust':
        return <TrustPage />
      case 'Legal':
        return <LegalPage />
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
                {item.label}
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

          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-pressed={theme === 'light'}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            <span className="theme-toggle-icon" aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
            <span className="theme-toggle-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            <span className="theme-toggle-track" aria-hidden="true"><span /></span>
          </button>

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

        <main>{renderPage()}</main>

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
          </div>
          <div className="footer-links">
            <button type="button" onClick={() => setCurrentPage('Home')}>Home</button>
            <button type="button" onClick={() => setCurrentPage('Trust')}>Trust</button>
            <button type="button" onClick={() => setCurrentPage('Legal')}>Legal</button>
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
          <div className="welcome-kicker"><span /> Made for earners in Kenya</div>
          <h1>Your time has value. <em>Earn on your terms.</em></h1>
          <p>Find paid surveys, social campaigns and simple online tasks. Do the work, submit proof, and track every reward in one place.</p>
          <div className="welcome-actions">
            {session ? (
              <button type="button" className="btn welcome-primary" onClick={() => setCurrentPage(session.user.role === 'poster' ? 'Poster' : primaryDestination)}>
                {session.user.role === 'admin' ? 'Open admin dashboard' : session.user.role === 'poster' ? 'Open poster account' : 'Go to your dashboard'} <span aria-hidden="true">→</span>
              </button>
            ) : (
              <button type="button" className="btn welcome-primary" onClick={() => setCurrentPage('Sign up')}>Create your free account <span aria-hidden="true">→</span></button>
            )}
            <button type="button" className="welcome-secondary" onClick={() => setCurrentPage('Tasks')}>Explore available tasks</button>
            {!session && <button type="button" className="welcome-secondary" onClick={() => setCurrentPage('Poster signup')}>Register as a poster</button>}
          </div>
          <div className="welcome-note"><span aria-hidden="true">✓</span> Clear task rules. No fee to join.</div>
          <div className="welcome-payments">
            <span>Withdraw with</span>
            <strong>M-Pesa</strong>
            <strong>PayPal</strong>
            <strong>Till</strong>
            <strong>Bank</strong>
            <strong>USDT</strong>
          </div>
        </div>

        <div className="welcome-visual" aria-label="A person working online from their phone">
          <img src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=85" alt="Person using a laptop to work online" fetchPriority="high" />
          <div className="visual-tint" />
          <div className="visual-caption"><span>YOUR NEXT TASK</span><strong>Start with what fits your day.</strong></div>
          <div className="visual-reward">
            <span className="reward-icon" aria-hidden="true">K</span>
            <div><small>Rewards are shown upfront</small><strong>Know what a task pays</strong></div>
            <span className="reward-arrow" aria-hidden="true">↗</span>
          </div>
        </div>
      </section>

      <section className="home-opportunities" aria-labelledby="opportunities-title">
        <div className="home-section-intro">
          <span className="home-overline">A better way to earn online</span>
          <h2 id="opportunities-title">Choose your next move.</h2>
        </div>
        <div className="opportunity-list">
          <button type="button" className="opportunity-row" onClick={() => setCurrentPage('Tasks')}>
            <span className="opportunity-number">01</span><span className="opportunity-copy"><strong>Surveys &amp; offers</strong><small>Share your opinion or try a new service</small></span><span className="opportunity-arrow" aria-hidden="true">↗</span>
          </button>
          <button type="button" className="opportunity-row" onClick={() => setCurrentPage('Tasks')}>
            <span className="opportunity-number">02</span><span className="opportunity-copy"><strong>Social campaigns</strong><small>Complete simple tasks for participating brands</small></span><span className="opportunity-arrow" aria-hidden="true">↗</span>
          </button>
          <button type="button" className="opportunity-row" onClick={() => setCurrentPage('Referral')}>
            <span className="opportunity-number">03</span><span className="opportunity-copy"><strong>Referral rewards</strong><small>Invite friends and follow your referral progress</small></span><span className="opportunity-arrow" aria-hidden="true">↗</span>
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
          <p>{selectedTask.description}</p>

          <div className="task-meta-box">
            <span>Duration: {selectedTask.duration}</span>
            <span>Risk: {selectedTask.risk}</span>
            <span>Proof: live camera capture</span>
            {selectedTask.participant_limit && <span>Available spots: {selectedTask.participant_limit}</span>}
            {selectedTask.due_date && <span>Due: {new Date(selectedTask.due_date).toLocaleDateString('en-KE')}</span>}
          </div>

          {selectedTask.task_url && (
            <a className="task-external-link" href={selectedTask.task_url} target="_blank" rel="noreferrer">
              Open campaign instructions <span aria-hidden="true">↗</span>
            </a>
          )}

          <form className="proof-form" onSubmit={submitProof}>
            <div className="warning-banner">
              Choose or capture a proof image. Uploaded image files are limited to 3 MB.
            </div>

            <label>
              Proof instructions
              <textarea readOnly value={selectedTask.proof_requirements || 'Take one clear live photo showing the task completion clearly. Keep the image in the current session and make sure the task is visible in the frame.'} />
            </label>

            <label>
              Notes for the reviewer
              <textarea name="notes" maxLength="2000" placeholder="Add any task completion details the reviewer needs." />
            </label>
            <label>
              Proof image (optional)
              <input name="proofImage" type="file" accept="image/*" capture="environment" />
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
            <p>{submittedPost.title} is pending approval. It will appear in Tasks after an admin approves it.</p>
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
              <input name="payoutKes" type="number" min="10" max="100000" step="1" value={payout} onChange={(event) => setPayout(event.target.value)} required />
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
          <p className="budget-disclaimer">Submitting a post does not collect or hold funds. An admin must verify the reward budget before approval.</p>
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
            <div className="history-row"><strong>Account status</strong><span>{data?.account.status || 'Active'}</span></div>
          </div>
        </section>

        <section className="panel poster-billing-panel">
          <h2>Balance and billing</h2>
          <p className="status-badge">Manual payment review</p>
          <p>Your current available balance is shown in Wallet. Deposits are added after an admin verifies your transaction reference; withdrawals are also reviewed and processed manually.</p>
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
        subtitle="Transactions are recorded against your wallet. Deposits and withdrawals are manually reviewed by an administrator."
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
            ['Available', dashboard?.wallet ? formatKes(dashboard.wallet.balance_kes) : 'Not recorded', 'Ready to withdraw', 'available'],
            ['Deposits pending', transactionSummary ? formatKes(transactionSummary.pending_deposits_kes) : '—', 'Awaiting verification', 'pending'],
            ['Deposits approved', transactionSummary ? formatKes(transactionSummary.approved_deposits_kes) : '—', 'Verified funds received', 'approved'],
            ['Deposits rejected', transactionSummary ? formatKes(transactionSummary.rejected_deposits_kes) : '—', 'Not credited to balance', 'rejected'],
            ['Withdrawals pending', transactionSummary ? formatKes(transactionSummary.pending_withdrawals_kes) : '—', 'Reserved for review', 'pending'],
            ['Withdrawals rejected', transactionSummary ? formatKes(transactionSummary.rejected_withdrawals_kes) : '—', 'Returned to available', 'rejected'],
            ['Total withdrawn', dashboard?.wallet ? formatKes(dashboard.wallet.withdrawn_kes) : transactionSummary ? formatKes(transactionSummary.withdrawn_kes) : '—', 'Manually settled payouts', 'withdrawn'],
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
            ? <p>Use the official payment details below, then submit the exact transfer reference and KSh-equivalent amount. Funds are added only after admin verification.</p>
            : <p>Choose a withdrawal method and destination. The amount is reserved while your request is reviewed. Rejected requests return to your available balance.</p>}
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
            Amount (KSh)
            <input type="number" min="1" max="10000000" step="0.01" inputMode="decimal" value={amountKes} onChange={(event) => setAmountKes(event.target.value)} required />
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
            <p className="wallet-form-note wallet-form-wide">Your available balance decreases when you submit. After the admin manually sends the payout, approval settles it; rejection returns the reserved amount.</p>
          </>}
          <button type="submit" className="btn btn-primary wallet-form-wide" disabled={submitting}>
            {submitting ? 'Submitting…' : mode === 'deposit' ? 'Submit deposit for verification' : 'Send withdrawal request to admin'}
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
                <strong>{item.transaction_type === 'deposit' ? 'Deposit' : 'Withdrawal'} · {item.transaction_type === 'deposit' ? '+' : '-'}{formatKes(item.amount_kes)}</strong>
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

  useEffect(() => {
    apiRequest('/user/referrals', { token: session.token })
      .then(setData)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false))
  }, [session.token])

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Referral system"
        title="Review your referral records."
        subtitle="Referral accounts and commissions appear here only after they are recorded for your account."
      />

      <div className="referral-grid">
        <div className="panel referral-panel">
          <label>Your referral code</label>
          <div className="copy-box">{data?.referralCode || (loading ? 'Loading…' : 'Not set')}</div>
          <p>Share this code with a new user. Referral registration and rewards are shown only when they are recorded in your account.</p>
        </div>

        <div className="panel referral-panel">
          <h3>Recorded referrals ({data?.referrals?.length ?? 0})</h3>
          {data?.referrals?.map((referral) => (
            <div key={referral.id} className="tier-row">
              <div>
                <strong>{referral.full_name}</strong>
                <small>{referral.status} · {formatDate(referral.created_at)}</small>
              </div>
              <span>{formatKes(referral.commission_kes)}</span>
            </div>
          ))}
          {error && <div className="form-error" role="alert">{error}</div>}
          {!loading && !error && data?.referrals?.length === 0 && <p>No referrals are recorded for this account.</p>}
        </div>
      </div>
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

function AdminPage({ session, onAuthenticated, onVerifyAdminPassword, taskPosts, error, onModerateTaskPost, initialSection = 'Overview' }) {
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
          <span className="review-count">{taskPosts.length} pending</span>
        </div>
        {taskPosts.length === 0 ? (
          <p className="empty-review">No task posts are waiting for approval.</p>
        ) : (
          <div className="task-post-review-list">
            {taskPosts.map((post) => (
              <article className="task-post-review-card" key={post.id}>
                <div className="review-post-main">
                  <span className="task-tag">{post.category}</span>
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
                    <button type="button" className="btn btn-primary" disabled={workingId === post.id} onClick={() => reviewPost(post.id, 'approved')}>
                      {workingId === post.id ? 'Saving…' : 'Approve & publish'}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={workingId === post.id} onClick={() => reviewPost(post.id, 'rejected')}>Reject</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="review-disclaimer">Approval publishes a post, but does not collect or reserve funds. Verify off-platform funding before publishing.</p>
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

function TrustPage() {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Trust & safety"
        title="Security designed to protect both users and the platform."
        subtitle="Hustle254 is built to outperform the common weaknesses of older reward sites by focusing on fraud prevention, transparent rules, and operator oversight."
      />

      <div className="trust-grid">
        <div className="panel">
          <h3>Fraud prevention layer</h3>
          <ul className="check-list compact">
            {trustChecks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h3>Platform rules</h3>
          <ul className="check-list compact">
            <li>Users must complete tasks in good faith</li>
            <li>Duplicate or abusive tasks are rejected</li>
            <li>Bonuses are tied to qualification rules</li>
            <li>Payout reviews reduce scam risk</li>
            <li>Support and disputes are trackable</li>
          </ul>
        </div>
      </div>
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
        {(isPosterLogin || isPosterSignup) && <p className="auth-intro">Poster accounts use separate login details and can publish tasks, submit deposits for manual review, and track withdrawals.</p>}

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
              <input name="referralCode" type="text" placeholder="HUSTLE254" />
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

function LegalPage() {
  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Legal & compliance"
        title="Clear rules, transparent terms, and compliance-first operations."
        subtitle="A legitimate money platform must protect users and the business with clear, published guidance and fair payout rules."
      />

      <div className="panel legal-panel">
        <h3>Included essentials</h3>
        <ul className="check-list compact">
          {legalItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default App
