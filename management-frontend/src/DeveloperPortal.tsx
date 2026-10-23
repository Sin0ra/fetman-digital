import { useCallback, useEffect, useRef, useState } from 'react'
import fetmanLogo from '../../fetman digital 2023 black.png'
import Dialog from './Dialog'
import PasswordChange from './PasswordChange'
import UserManagement from './UserManagement'

type DeveloperRoute = '/developer' | '/developer/users' | '/developer/maintenance'
type CheckState = 'pass' | 'fail' | 'skipped' | 'pending'
type MetricKey =
  | 'totalPortfolioProjects'
  | 'publishedProjects'
  | 'draftProjects'
  | 'designAssets'
  | 'pendingTasks'

type Overview = {
  metrics: Record<MetricKey, number>
  recentChanges: { action: string; title: string; createdAt: string }[]
}

type Check = {
  id: string
  label: string
  state: CheckState
  detail: string
}

type Diagnostics = {
  status: 'healthy' | 'degraded' | 'unavailable'
  environment: string | null
  uptimeSeconds: number | null
  checkedAt: string
  checks: Check[]
}

type MaintenanceSetting = {
  maintenanceMode: boolean
  version: number
  updatedAt: string
}

type DeveloperPortalProps = {
  path: DeveloperRoute
  email: string
  currentUserId: string
  onNavigate: (path: DeveloperRoute) => void
  onLogout: () => void
  onSessionExpired: () => void
  loggingOut: boolean
  logoutError: string
}

type ApiError = Error & { status?: number; data?: unknown }

const navigation: { path: DeveloperRoute; label: string; icon: string }[] = [
  { path: '/developer', label: 'Overview', icon: 'O' },
  { path: '/developer/maintenance', label: 'Maintenance', icon: 'M' },
  { path: '/developer/users', label: 'User management', icon: 'U' },
]

const metricCards: { key: MetricKey; label: string; detail: string }[] = [
  { key: 'totalPortfolioProjects', label: 'Portfolio projects', detail: 'All active portfolio records' },
  { key: 'publishedProjects', label: 'Published', detail: 'Visible on the public website' },
  { key: 'draftProjects', label: 'Drafts', detail: 'Not visible to public visitors' },
  { key: 'designAssets', label: 'Design assets', detail: 'Stored asset records' },
  { key: 'pendingTasks', label: 'Pending tasks', detail: 'Awaiting work in the design team' },
]

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<{ response: Response; data: T }> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...init.headers },
    })
  } catch {
    throw new Error('The management API could not be reached. Check that the backend is running and retry.')
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    const error = new Error(response.ok ? 'The service returned an invalid response.' : `The request failed (HTTP ${response.status}).`) as ApiError
    error.status = response.status
    throw error
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `The request failed (HTTP ${response.status}).`
    const error = new Error(message) as ApiError
    error.status = response.status
    error.data = data
    throw error
  }
  return { response, data: data as T }
}

function isMaintenanceSetting(value: unknown): value is MaintenanceSetting {
  if (!value || typeof value !== 'object') return false
  const setting = value as MaintenanceSetting
  return typeof setting.maintenanceMode === 'boolean' &&
    Number.isSafeInteger(setting.version) &&
    setting.version >= 0 &&
    typeof setting.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(setting.updatedAt))
}

function isOverview(value: unknown): value is Overview {
  if (!value || typeof value !== 'object') return false
  const result = value as Overview
  return Boolean(
    result.metrics &&
    metricCards.every(({ key }) => Number.isSafeInteger(result.metrics[key]) && result.metrics[key] >= 0) &&
    Array.isArray(result.recentChanges),
  )
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatUptime(seconds: number | null) {
  if (seconds === null) return 'Unavailable'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`]
    .filter(Boolean)
    .join(' ')
}

function DeveloperPortal({
  path,
  email,
  currentUserId,
  onNavigate,
  onLogout,
  onSessionExpired,
  loggingOut,
  logoutError,
}: DeveloperPortalProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState('')
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const navigationRef = useRef<HTMLElement>(null)

  const closeMobileNavigation = useCallback(() => {
    setMobileNavigationOpen(false)
    mobileMenuButtonRef.current?.focus()
  }, [])

  const navigate = useCallback((nextPath: DeveloperRoute) => {
    closeMobileNavigation()
    onNavigate(nextPath)
  }, [closeMobileNavigation, onNavigate])

  const runDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true)
    setDiagnosticsError('')
    const checkedAt = new Date().toISOString()
    const pendingChecks: Check[] = [
      { id: 'backend', label: 'Backend API', state: 'pending', detail: 'Checking authenticated diagnostics endpoint.' },
      { id: 'database', label: 'Database', state: 'pending', detail: 'Read-only server-side connectivity check.' },
      { id: 'portfolio', label: 'Published portfolio', state: 'pending', detail: 'Validating the public API response.' },
      { id: 'assets', label: 'Published asset delivery', state: 'pending', detail: 'Checking a published project asset, when available.' },
    ]
    setDiagnostics({
      status: 'unavailable',
      environment: null,
      uptimeSeconds: null,
      checkedAt,
      checks: pendingChecks,
    })

    const backendPromise = fetchJson<{
      status: string
      backend: string
      database: string
      environment: string
      uptimeSeconds: number
      checkedAt: string
    }>('/api/developer/diagnostics', { method: 'GET' }).then(({ data }) => {
      if (
        !['healthy', 'degraded'].includes(data.status) ||
        !['healthy', 'unavailable'].includes(data.backend) ||
        !['healthy', 'unavailable'].includes(data.database) ||
        typeof data.environment !== 'string' ||
        !Number.isSafeInteger(data.uptimeSeconds) ||
        typeof data.checkedAt !== 'string' ||
        Number.isNaN(Date.parse(data.checkedAt))
      ) throw new Error('The diagnostics response was incomplete.')
      return data
    })

    const maintenanceModePromise = fetchJson<unknown>('/api/developer/maintenance-mode', {
      method: 'GET',
    }).then(({ data }) => {
      if (!isMaintenanceSetting(data)) throw new Error('Maintenance mode state is unavailable.')
      return data
    })

    const validatePortfolio = async () => {
      const response = await fetch('/api/public/design-portfolio', {
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`Portfolio endpoint returned HTTP ${response.status}.`)
      const result = await response.json() as {
        complete?: boolean
        projects?: { id?: number; type?: string; title?: string; source_key?: string | null; asset_id?: number | string | null }[]
      }
      if (result.complete !== true || !Array.isArray(result.projects)) {
        throw new Error('Portfolio response is incomplete.')
      }
      const keys = new Set<string>()
      for (const project of result.projects) {
        if (
          !project ||
          project.type !== 'portfolio' ||
          !Number.isSafeInteger(project.id) ||
          typeof project.title !== 'string'
        ) throw new Error('Portfolio response contains invalid project data.')
        const key = project.source_key || `content-${project.id}`
        if (keys.has(key)) throw new Error('Portfolio response contains duplicate projects.')
        keys.add(key)
      }
      return result.projects
    }
    const portfolioPromise = maintenanceModePromise.then(
      (setting) => setting.maintenanceMode ? null : validatePortfolio(),
      () => validatePortfolio(),
    )

    const [backendResult, portfolioResult, maintenanceModeResult] = await Promise.allSettled([
      backendPromise,
      portfolioPromise,
      maintenanceModePromise,
    ])
    if (
      (backendResult.status === 'rejected' && [401, 403].includes((backendResult.reason as ApiError)?.status ?? 0)) ||
      (maintenanceModeResult.status === 'rejected' && [401, 403].includes((maintenanceModeResult.reason as ApiError)?.status ?? 0))
    ) {
      onSessionExpired()
      setDiagnosticsLoading(false)
      return
    }

    let environment: string | null = null
    let uptimeSeconds: number | null = null
    let backendState: CheckState = 'fail'
    let databaseState: CheckState = 'skipped'
    let backendDetail = 'The authenticated diagnostics endpoint could not be reached.'
    let databaseDetail = 'Database status is unknown because the backend check failed.'
    let timestamp = checkedAt

    if (backendResult.status === 'fulfilled') {
      const result = backendResult.value
      environment = result.environment
      uptimeSeconds = result.uptimeSeconds
      timestamp = result.checkedAt
      backendState = result.backend === 'healthy' ? 'pass' : 'fail'
      backendDetail = result.backend === 'healthy' ? 'The management API responded.' : 'The management API reported an unavailable state.'
      databaseState = result.database === 'healthy' ? 'pass' : 'fail'
      databaseDetail = result.database === 'healthy' ? 'Read-only connectivity check succeeded.' : 'The database did not respond to the read-only check.'
    }

    const maintenanceModeOn =
      maintenanceModeResult.status === 'fulfilled' &&
      maintenanceModeResult.value.maintenanceMode
    let portfolioState: CheckState = maintenanceModeOn ? 'skipped' : 'fail'
    let portfolioDetail = maintenanceModeOn
      ? 'Not checked because Maintenance Mode is ON; public portfolio access is intentionally blocked.'
      : 'The public portfolio endpoint could not be validated.'
    let assetState: CheckState = 'skipped'
    let assetDetail = maintenanceModeOn
      ? 'Not checked while Maintenance Mode is ON; public asset access is intentionally blocked.'
      : 'No published asset is available to check.'

    if (!maintenanceModeOn && portfolioResult.status === 'fulfilled' && portfolioResult.value) {
      const projects = portfolioResult.value
      portfolioState = 'pass'
      portfolioDetail = `${projects.length} published ${projects.length === 1 ? 'project' : 'projects'} returned a complete, duplicate-free response.`
      const projectWithAsset = projects.find((project) => project.asset_id !== null && project.asset_id !== undefined)
      if (projectWithAsset) {
        try {
          const response = await fetch(`/api/public/design-assets/${encodeURIComponent(String(projectWithAsset.asset_id))}`, {
            method: 'HEAD',
            credentials: 'omit',
            cache: 'no-store',
          })
          const mediaType = response.headers.get('content-type') || ''
          assetState = response.ok && mediaType.startsWith('image/') ? 'pass' : 'fail'
          assetDetail = assetState === 'pass'
            ? `Image endpoint returned ${mediaType} for “${projectWithAsset.title}”.`
            : `The image endpoint returned HTTP ${response.status} or an unexpected media type.`
        } catch {
          assetState = 'fail'
          assetDetail = 'The published image endpoint could not be reached.'
        }
      }
    } else if (!maintenanceModeOn && portfolioResult.status === 'rejected') {
      const reason = portfolioResult.reason as Error
      portfolioDetail = reason instanceof Error ? reason.message : portfolioDetail
    }

    const checks: Check[] = [
      { id: 'backend', label: 'Backend API', state: backendState, detail: backendDetail },
      { id: 'database', label: 'Database', state: databaseState, detail: databaseDetail },
      { id: 'portfolio', label: 'Published portfolio', state: portfolioState, detail: portfolioDetail },
      { id: 'assets', label: 'Published asset delivery', state: assetState, detail: assetDetail },
    ]
    const hasFailures = checks.some((check) => check.state === 'fail')
    const status = backendState !== 'pass'
      ? 'unavailable'
      : hasFailures
        ? 'degraded'
        : 'healthy'
    setDiagnostics({
      status,
      environment,
      uptimeSeconds,
      checkedAt: timestamp,
      checks,
    })
    if (hasFailures) {
      setDiagnosticsError('One or more checks failed. Review the results below; no data was changed.')
    }
    setDiagnosticsLoading(false)
  }, [onSessionExpired])

  useEffect(() => {
    if (path === '/developer') {
      let cancelled = false
      void fetchJson<unknown>('/api/developer/overview')
        .then(({ data }) => {
          if (!isOverview(data)) throw new Error('The overview response was incomplete.')
          if (!cancelled) {
            setOverview(data)
            setOverviewError('')
          }
        })
        .catch((error: ApiError) => {
          if (error.status === 401 || error.status === 403) {
            onSessionExpired()
            return
          }
          if (!cancelled) setOverviewError('Live overview data is unavailable. Use Maintenance to check the system.')
        })
      void Promise.resolve().then(runDiagnostics)
      return () => { cancelled = true }
    }
    if (path === '/developer/maintenance') {
      void Promise.resolve().then(runDiagnostics)
    }
  }, [onSessionExpired, path, runDiagnostics])

  useEffect(() => {
    if (!mobileNavigationOpen) return
    navigationRef.current?.querySelector<HTMLButtonElement>('.sidebar-nav button:not(:disabled)')?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMobileNavigation()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeMobileNavigation, mobileNavigationOpen])

  const pageDetails = path === '/developer/maintenance'
    ? { title: 'Maintenance', eyebrow: 'System operations', description: 'Read-only checks for the management API, database connection, published portfolio, and image delivery.' }
    : path === '/developer/users'
      ? { title: 'User management', eyebrow: 'Administration', description: 'Review and manage authorized staff access.' }
      : { title: 'Developer overview', eyebrow: 'Workspace overview', description: 'A live summary of published content, design operations, and recent changes.' }
  const overviewLoading = path === '/developer' && overview === null && !overviewError

  return (
    <div className="portal-layout">
      <aside
        id="developer-navigation"
        ref={navigationRef}
        className={`portal-sidebar${mobileNavigationOpen ? ' portal-sidebar-open' : ''}`}
        aria-label="Developer portal navigation"
      >
        <a className="brand portal-brand" href="/developer" onClick={(event) => { event.preventDefault(); navigate('/developer') }}>
          <img className="brand-logo" src={fetmanLogo} alt="" />
          <span><strong>Fetman Digital</strong><span className="brand-caption">Developer portal</span></span>
        </a>
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="sidebar-nav" aria-label="Developer workspace">
          {navigation.map((item) => (
            <button
              className={`sidebar-link${path === item.path ? ' sidebar-link-active' : ''}`}
              type="button"
              key={item.path}
              aria-current={path === item.path ? 'page' : undefined}
              onClick={() => navigate(item.path)}
            >
              <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <p className="sidebar-label sidebar-label-admin">QUICK LINKS</p>
        <nav className="sidebar-nav" aria-label="Related resources">
          <a className="sidebar-link" href="http://localhost:8080/" target="_blank" rel="noreferrer">
            <span className="sidebar-icon" aria-hidden="true">W</span>Public website
          </a>
        </nav>
        <div className="sidebar-account">
          <span className="account-avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
          <span className="sidebar-account-copy"><strong>{email}</strong><span>Developer</span></span>
        </div>
      </aside>

      {mobileNavigationOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={closeMobileNavigation} />}

      <div className="portal-main">
        <header className="portal-topbar">
          <button
            className="mobile-menu-button"
            type="button"
            ref={mobileMenuButtonRef}
            aria-label={mobileNavigationOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-controls="developer-navigation"
            aria-expanded={mobileNavigationOpen}
            onClick={() => mobileNavigationOpen ? closeMobileNavigation() : setMobileNavigationOpen(true)}
          >
            <span aria-hidden="true">{mobileNavigationOpen ? '×' : '☰'}</span>
          </button>
          <div className="topbar-context"><span className="topbar-kicker">Fetman Digital · Developer portal</span><strong>{pageDetails.title}</strong></div>
          <div className="portal-topbar-actions">
            <span className="topbar-user">{email}</span>
            <PasswordChange />
            <button className="button button-secondary logout-button" onClick={onLogout} disabled={loggingOut}>
              {loggingOut ? 'Signing out…' : 'Log out'}
            </button>
          </div>
        </header>

        <main className="dashboard-content portal-content">
          {logoutError && <p className="form-error" role="alert">{logoutError}</p>}
          {path === '/developer/users' ? (
            <UserManagement currentUserId={currentUserId} />
          ) : path === '/developer/maintenance' ? (
            <MaintenancePage
              diagnostics={diagnostics}
              loading={diagnosticsLoading}
              diagnosticsError={diagnosticsError}
              onRefresh={() => void runDiagnostics()}
              onSessionExpired={onSessionExpired}
            />
          ) : (
            <OverviewPage
              overview={overview}
              loading={overviewLoading}
              error={overviewError}
              diagnostics={diagnostics}
              onNavigate={navigate}
            />
          )}
        </main>
        <footer className="portal-footer">Fetman Digital <span aria-hidden="true">·</span> Internal tools</footer>
      </div>
    </div>
  )
}

function OverviewPage({
  overview,
  loading,
  error,
  diagnostics,
  onNavigate,
}: {
  overview: Overview | null
  loading: boolean
  error: string
  diagnostics: Diagnostics | null
  onNavigate: (path: DeveloperRoute) => void
}) {
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Developer workspace</p>
          <h1>System overview</h1>
          <p className="dashboard-intro">Live application information from the management API and publishing records.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => onNavigate('/developer/maintenance')}>
          Open maintenance
        </button>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="metric-grid developer-metric-grid" aria-label="Live management metrics" aria-busy={loading}>
        {metricCards.map((card) => (
          <article className="metric-card" key={card.key}>
            <span className="status-label">{card.label}</span>
            <strong>{loading ? '—' : overview?.metrics[card.key] ?? 'Unavailable'}</strong>
            <span className="status-detail">{card.detail}</span>
          </article>
        ))}
      </section>

      <div className="overview-lower-grid developer-overview-grid">
        <section className="overview-panel" aria-labelledby="system-summary-heading">
          <div className="panel-heading">
            <div><p className="eyebrow">Live checks</p><h2 id="system-summary-heading">System status</h2></div>
            <button className="text-button" type="button" onClick={() => onNavigate('/developer/maintenance')}>View diagnostics</button>
          </div>
          {diagnostics ? (
            <>
              <p className={`health-summary health-${diagnostics.status}`}>
                <span className="health-marker" aria-hidden="true" />
                {diagnostics.status === 'healthy' ? 'All checked services healthy' : diagnostics.status === 'degraded' ? 'One or more checks need attention' : 'Backend unavailable'}
              </p>
              <p className="status-detail">Last checked {formatTimestamp(diagnostics.checkedAt)}</p>
            </>
          ) : <p className="status-detail">System checks have not completed yet.</p>}
          <button className="button button-secondary" type="button" onClick={() => onNavigate('/developer/users')}>Manage portal users</button>
          <a className="button button-secondary" href="http://localhost:8080/" target="_blank" rel="noreferrer">Open public website</a>
        </section>

        <section className="overview-panel" aria-labelledby="recent-changes-heading">
          <div className="panel-heading">
            <div><p className="eyebrow">Content history</p><h2 id="recent-changes-heading">Recent changes</h2></div>
          </div>
          {loading ? <p className="status-detail">Loading recent changes…</p> : overview?.recentChanges.length ? (
            <ul className="recent-list">
              {overview.recentChanges.map((change, index) => (
                <li key={`${change.action}-${change.title}-${change.createdAt}-${index}`}>
                  <span className="recent-project-icon" aria-hidden="true">C</span>
                  <span className="recent-copy">
                    <strong>{change.title}</strong>
                    <span>{change.action} · {formatTimestamp(change.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="empty-state">{error ? 'Recent changes are unavailable.' : 'No content changes have been recorded yet.'}</p>}
        </section>
      </div>
      <p className="developer-role-note">
        Portfolio editing and asset uploads remain available through the authorized Graphic Design workspace. Developer access does not bypass its role restrictions.
      </p>
    </>
  )
}

function MaintenancePage({
  diagnostics,
  loading,
  diagnosticsError,
  onRefresh,
  onSessionExpired,
}: {
  diagnostics: Diagnostics | null
  loading: boolean
  diagnosticsError: string
  onRefresh: () => void
  onSessionExpired: () => void
}) {
  const status = diagnostics?.status ?? 'not-checked'
  const [setting, setSetting] = useState<MaintenanceSetting | null>(null)
  const [settingLoading, setSettingLoading] = useState(true)
  const [settingSaving, setSettingSaving] = useState(false)
  const [settingError, setSettingError] = useState('')
  const [settingSuccess, setSettingSuccess] = useState('')
  const [confirmationMode, setConfirmationMode] = useState<boolean | null>(null)
  const [confirmationError, setConfirmationError] = useState('')

  const loadSetting = useCallback(async () => {
    setSettingLoading(true)
    setSettingError('')
    try {
      const { data } = await fetchJson<unknown>('/api/developer/maintenance-mode')
      if (!isMaintenanceSetting(data)) throw new Error('The saved maintenance setting was invalid.')
      setSetting(data)
    } catch (error) {
      const apiError = error as ApiError
      if (apiError.status === 401 || apiError.status === 403) {
        onSessionExpired()
        return
      }
      setSettingError(apiError instanceof Error
        ? apiError.message
        : 'The saved maintenance setting could not be loaded.')
    } finally {
      setSettingLoading(false)
    }
  }, [onSessionExpired])

  useEffect(() => {
    void Promise.resolve().then(loadSetting)
  }, [loadSetting])

  const openMaintenanceConfirmation = () => {
    if (!setting || settingSaving) return
    setConfirmationError('')
    setConfirmationMode(!setting.maintenanceMode)
  }

  const saveMaintenanceMode = async () => {
    if (confirmationMode === null || !setting || settingSaving) return
    const maintenanceMode = confirmationMode
    setSettingSaving(true)
    setConfirmationError('')
    setSettingSuccess('')
    try {
      const { data: csrf } = await fetchJson<{ csrfToken?: unknown }>('/api/auth/csrf')
      if (typeof csrf.csrfToken !== 'string' || csrf.csrfToken.length === 0) {
        throw new Error('A secure request token could not be obtained. Refresh and try again.')
      }
      const { data } = await fetchJson<unknown>('/api/developer/maintenance-mode', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf.csrfToken,
        },
        body: JSON.stringify({ maintenanceMode, version: setting.version }),
      })
      if (!isMaintenanceSetting(data)) throw new Error('The saved maintenance response was invalid.')
      if (data.maintenanceMode !== maintenanceMode) {
        throw new Error('The backend did not confirm the requested Maintenance Mode state. Refresh the saved state and retry.')
      }
      setSetting(data)
      setSettingSuccess(`Maintenance Mode is now ${data.maintenanceMode ? 'ON' : 'OFF'}.`)
      setConfirmationMode(null)
    } catch (error) {
      const apiError = error as ApiError
      if (isMaintenanceSetting(apiError.data)) setSetting(apiError.data)
      if (apiError.status === 401 || apiError.status === 403) {
        setConfirmationMode(null)
        onSessionExpired()
        return
      }
      setConfirmationError(apiError instanceof Error
        ? apiError.message
        : 'Maintenance mode could not be changed. Check the connection and retry.')
    } finally {
      setSettingSaving(false)
    }
  }

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">System operations</p>
          <h1>Maintenance</h1>
          <p className="dashboard-intro">Run safe, read-only checks and review current service status. No application data is modified.</p>
        </div>
        <button className="button button-primary" type="button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Checking…' : 'Run checks'}
        </button>
      </header>

      {diagnosticsError && <p className="form-error" role="alert">{diagnosticsError}</p>}
      <section className="maintenance-mode-panel" aria-labelledby="maintenance-mode-heading">
        <div>
          <p className="eyebrow">Public website control</p>
          <h2 id="maintenance-mode-heading">Maintenance Mode: {setting ? (setting.maintenanceMode ? 'ON' : 'OFF') : settingLoading ? 'Loading' : 'Unknown'}</h2>
          <p>{setting
            ? setting.maintenanceMode
              ? 'Visitors are seeing the maintenance page. The Developer Portal remains available.'
              : 'The public website is operating normally.'
            : settingLoading
              ? 'Reading the saved setting from the management API.'
              : 'The saved setting could not be confirmed.'}</p>
          {setting && <p>Last updated {formatTimestamp(setting.updatedAt)}</p>}
        </div>
        <div className="maintenance-mode-controls">
          <button
            className="button button-primary"
            type="button"
            onClick={openMaintenanceConfirmation}
            disabled={!setting || settingLoading || settingSaving}
          >
            {settingSaving
              ? 'Saving…'
              : setting
                ? `Turn maintenance mode ${setting.maintenanceMode ? 'OFF' : 'ON'}`
                : 'Maintenance mode unavailable'}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void loadSetting()}
            disabled={settingLoading || settingSaving}
          >
            {settingLoading ? 'Loading saved state…' : 'Refresh saved state'}
          </button>
        </div>
      </section>
      {settingError && <p className="form-error" role="alert">{settingError}</p>}
      {settingSuccess && <p className="maintenance-mode-success" role="status">{settingSuccess}</p>}
      <Dialog
        open={confirmationMode !== null}
        variant="confirm"
        className={confirmationMode === true ? 'fd-dialog-maintenance-enable' : 'fd-dialog-maintenance-disable'}
        title={confirmationMode ? 'Enable Maintenance Mode?' : 'Disable Maintenance Mode?'}
        description={confirmationMode
          ? 'Public visitors will temporarily see the maintenance page. The public-facing website will be unavailable for normal browsing until Maintenance Mode is turned off.'
          : 'The normal public website will become accessible again, including its published portfolio.'}
        confirmLabel={confirmationMode ? 'Enable Maintenance' : 'Disable Maintenance'}
        cancelLabel={confirmationMode ? 'Cancel' : 'Keep Maintenance On'}
        busy={settingSaving}
        closeOnBackdropClick
        onConfirm={() => void saveMaintenanceMode()}
        onCancel={() => {
          if (!settingSaving) {
            setConfirmationError('')
            setConfirmationMode(null)
          }
        }}
      >
        {confirmationError && <p className="form-error" role="alert">{confirmationError}</p>}
      </Dialog>
      <section className="maintenance-summary" aria-live="polite" aria-busy={loading}>
        <span className={`health-marker health-marker-${status}`} aria-hidden="true" />
        <div>
          <p className="eyebrow">Current result</p>
          <h2>{status === 'not-checked' ? 'Not yet checked' : status === 'healthy' ? 'Healthy' : status === 'degraded' ? 'Degraded' : 'Unavailable'}</h2>
          <p>{diagnostics ? `Last checked ${formatTimestamp(diagnostics.checkedAt)}` : 'Run diagnostics to check the current system state.'}</p>
        </div>
      </section>

      <section className="maintenance-section" aria-labelledby="diagnostic-checks-heading">
        <div className="section-heading page-section-heading">
          <div><p className="eyebrow">Read-only diagnostics</p><h2 id="diagnostic-checks-heading">Service checks</h2></div>
          {diagnostics && <span className="stage">{diagnostics.checks.filter((check) => check.state === 'fail').length} issues</span>}
        </div>
        {diagnostics ? (
          <ul className="diagnostic-list" aria-busy={loading}>
            {diagnostics.checks.map((check) => (
              <li className="diagnostic-row" key={check.id}>
                <span className={`diagnostic-state diagnostic-state-${check.state}`}>{check.state === 'pass' ? 'Pass' : check.state === 'fail' ? 'Fail' : check.state === 'skipped' ? 'Not applicable' : 'Checking'}</span>
                <span className="diagnostic-copy"><strong>{check.label}</strong><span>{check.detail}</span></span>
              </li>
            ))}
          </ul>
        ) : <p className="empty-state">No checks have been run in this session.</p>}
        {diagnostics?.checks.some((check) => check.state === 'fail') && (
          <section className="diagnostic-failures" aria-labelledby="diagnostic-failures-heading">
            <h3 id="diagnostic-failures-heading">Issues from the most recent check</h3>
            <ul>
              {diagnostics.checks.filter((check) => check.state === 'fail').map((check) => (
                <li key={check.id}><strong>{check.label}:</strong> {check.detail}</li>
              ))}
            </ul>
          </section>
        )}
      </section>

      <section className="maintenance-section" aria-labelledby="runtime-heading">
        <div className="section-heading page-section-heading">
          <div><p className="eyebrow">Safe runtime information</p><h2 id="runtime-heading">Application status</h2></div>
        </div>
        <dl className="runtime-grid">
          <div><dt>Environment</dt><dd>{diagnostics?.environment ?? 'Not checked'}</dd></div>
          <div><dt>Backend uptime</dt><dd>{formatUptime(diagnostics?.uptimeSeconds ?? null)}</dd></div>
          <div><dt>Backend API</dt><dd>{diagnostics?.checks.find((check) => check.id === 'backend')?.state === 'pass' ? 'Available' : diagnostics ? 'Unavailable' : 'Not checked'}</dd></div>
          <div><dt>Database</dt><dd>{diagnostics?.checks.find((check) => check.id === 'database')?.state === 'pass' ? 'Connected' : diagnostics?.checks.find((check) => check.id === 'database')?.state === 'fail' ? 'Unavailable' : diagnostics ? 'Not checked' : 'Not checked'}</dd></div>
        </dl>
      </section>

      <section className="maintenance-section" aria-labelledby="links-heading">
        <div className="section-heading page-section-heading">
          <div><p className="eyebrow">Safe actions</p><h2 id="links-heading">Open related sites</h2></div>
        </div>
        <div className="maintenance-actions">
          <a className="button button-secondary" href="http://localhost:8080/" target="_blank" rel="noreferrer">Open public website</a>
          <a className="button button-secondary" href="http://localhost:5173/" target="_blank" rel="noreferrer">Open management dashboard</a>
        </div>
        <p className="settings-description">The portal cannot clear browser, proxy, or static-server caches. After a website deployment, use a hard refresh in the browser if updated static files do not appear. Published portfolio data is fetched without browser caching.</p>
      </section>
    </>
  )
}

export default DeveloperPortal
