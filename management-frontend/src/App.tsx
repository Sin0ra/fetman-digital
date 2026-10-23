import { useEffect, useState, type FormEvent } from 'react'
import './App.css'
import MandatoryPasswordChange from './MandatoryPasswordChange'
import GraphicDesignDashboard from './GraphicDesignDashboard'
import DeveloperPortal from './DeveloperPortal'
import fetmanLogo from '../../fetman digital 2023 black.png'

type User = {
  id: string
  email: string
  role: string
  passwordChangeRequired: boolean
}

const developerPaths = ['/developer', '/developer/users', '/developer/maintenance']

async function requestJson(path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
}

function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [checkingSession, setCheckingSession] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [pageError, setPageError] = useState('')
  const [loginError, setLoginError] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  function navigate(nextPath: string, replace = false) {
    if (replace) {
      window.history.replaceState({}, '', nextPath)
    } else {
      window.history.pushState({}, '', nextPath)
    }
    setPath(nextPath)
  }

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function verifySession() {
      setCheckingSession(true)
      setPageError('')

      try {
        const response = await requestJson('/api/auth/me')
        if (response.status === 401) {
          if (!cancelled) {
            setUser(null)
            if (path !== '/login') navigate('/login', true)
          }
          return
        }
        if (!response.ok) throw new Error('Session verification failed')

        const result = (await response.json()) as { user: User }
        if (cancelled) return
        setUser(result.user)

        if (result.user.passwordChangeRequired) {
          if (path !== '/set-password') navigate('/set-password', true)
          return
        }
        if (result.user.role === 'Graphic Design') {
          if (path !== '/graphic-design') navigate('/graphic-design', true)
          return
        }
        if (result.user.role !== 'Developer') {
          setPageError('Your account does not have access to a management workspace.')
          if (path !== '/login') navigate('/login', true)
          return
        }

        if (!developerPaths.includes(path)) {
          navigate('/developer', true)
          return
        }
        if (result.user.role !== 'Developer') {
          setPageError('Your account does not have Developer dashboard access.')
          return
        }

        const dashboardResponse = await requestJson('/api/developer/dashboard')
        if (dashboardResponse.status === 403) {
          setPageError('Your account does not have Developer dashboard access.')
          return
        }
        if (!dashboardResponse.ok) throw new Error('Dashboard verification failed')
      } catch {
        if (!cancelled) {
          setPageError('The management service is unavailable. Please try again shortly.')
          if (path !== '/login') navigate('/login', true)
        }
      } finally {
        if (!cancelled) setCheckingSession(false)
      }
    }

    void verifySession()
    return () => {
      cancelled = true
    }
  }, [path])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginError('')
    setSubmitting(true)

    try {
      const tokenResponse = await requestJson('/api/auth/csrf')
      if (!tokenResponse.ok) throw new Error('Token request failed')
      const { csrfToken } = (await tokenResponse.json()) as { csrfToken: string }
      const response = await requestJson('/api/auth/login', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ email, password }),
      })

      if (response.status === 401) {
        setLoginError('The email or password is incorrect.')
        return
      }
      if (response.status === 429) {
        setLoginError('Too many attempts. Please wait before trying again.')
        return
      }
      if (!response.ok) throw new Error('Login failed')

      const result = (await response.json()) as { user: User }
      setUser(result.user)
      setPassword('')
      navigate(
        result.user.passwordChangeRequired
          ? '/set-password'
          : result.user.role === 'Graphic Design'
            ? '/graphic-design'
            : '/developer',
      )
    } catch {
      setLoginError('Unable to sign in right now. Please try again shortly.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    setLogoutError('')
    setLoggingOut(true)

    try {
      const tokenResponse = await requestJson('/api/auth/csrf')
      if (!tokenResponse.ok) throw new Error('Token request failed')
      const { csrfToken } = (await tokenResponse.json()) as { csrfToken: string }
      const response = await requestJson('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      })
      if (!response.ok) throw new Error('Logout failed')

      setUser(null)
      setPassword('')
      navigate('/login', true)
    } catch {
      setLogoutError('Unable to log out right now. Please try again.')
    } finally {
      setLoggingOut(false)
    }
  }

  if (checkingSession) {
    return (
      <main className="loading-screen" role="status">
        <span className="brand-mark" aria-hidden="true">F</span>
        <p>Checking your secure session…</p>
      </main>
    )
  }

  if (path === '/set-password' && user?.passwordChangeRequired) {
    return (
      <MandatoryPasswordChange
        email={user.email}
        onLogout={handleLogout}
        loggingOut={loggingOut}
        onChanged={() => {
          setUser({ ...user, passwordChangeRequired: false })
          navigate(user.role === 'Graphic Design' ? '/graphic-design' : '/developer', true)
        }}
      />
    )
  }

  if (path === '/graphic-design' && user?.role === 'Graphic Design') {
    return (
      <GraphicDesignDashboard
        email={user.email}
        onLogout={handleLogout}
        onSessionExpired={() => {
          setUser(null)
          navigate('/login', true)
        }}
        loggingOut={loggingOut}
        logoutError={logoutError}
      />
    )
  }

  if (developerPaths.includes(path) && user?.role === 'Developer') {
    return (
      <DeveloperPortal
        path={path as '/developer' | '/developer/users' | '/developer/maintenance'}
        email={user.email}
        currentUserId={user.id}
        onNavigate={(nextPath) => navigate(nextPath)}
        onLogout={handleLogout}
        onSessionExpired={() => {
          setUser(null)
          navigate('/login', true)
        }}
        loggingOut={loggingOut}
        logoutError={logoutError}
      />
    )
  }

  if (path === '/developer' && user && user.role !== 'Developer') {
    return (
      <main className="login-layout">
        <BrandHeader />
        <section className="login-card" aria-labelledby="denied-title">
          <p className="eyebrow">Access restricted</p>
          <h1 id="denied-title">Developer access required</h1>
          <p className="login-description">{pageError}</p>
          <button className="button button-primary full-width" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? 'Signing out…' : 'Log out'}
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="login-layout">
      <BrandHeader />
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">Private management portal</p>
        <h1 id="login-title">Welcome back.</h1>
        <p className="login-description">Sign in to your Fetman Digital workspace.</p>

        <form className="login-form" onSubmit={handleLogin}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <label htmlFor="password">Password</label>
          <div className="password-field">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              className="visibility-button"
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          {loginError && <p className="form-error" role="alert">{loginError}</p>}
          {pageError && <p className="form-error" role="alert">{pageError}</p>}
          <button className="button button-primary full-width" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in securely'}
          </button>
        </form>
        <p className="security-note">
          Protected by secure server-side authentication. Your password is never stored in this browser.
        </p>
      </section>
      <footer>Fetman Digital <span aria-hidden="true">·</span> Internal tools</footer>
    </main>
  )
}

function BrandHeader() {
  return (
    <header className="login-header">
      <a className="brand" href="/login" aria-label="Fetman Digital management login">
        <img className="brand-logo" src={fetmanLogo} alt="" />
        <span>
          <strong>Fetman Digital</strong>
          <span className="brand-caption">Management platform</span>
        </span>
      </a>
      <span className="stage">Staff sign in</span>
    </header>
  )
}

export default App
