import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DeveloperPortal from './DeveloperPortal'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentElement ? document.body : null
    },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const diagnostics = {
  status: 'healthy',
  backend: 'healthy',
  database: 'healthy',
  environment: 'development',
  uptimeSeconds: 7200,
  checkedAt: '2026-10-23T07:00:00.000Z',
}

function response(data: unknown, status = 200, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    headers: { get: (key: string) => key.toLowerCase() === 'content-type' ? contentType : null },
  } as Response
}

function renderPortal(
  path: '/developer' | '/developer/users' | '/developer/maintenance',
  onNavigate = vi.fn(),
) {
  render(
    <DeveloperPortal
      path={path}
      email="developer@example.test"
      currentUserId="1"
      onNavigate={onNavigate}
      onLogout={vi.fn()}
      onSessionExpired={vi.fn()}
      loggingOut={false}
      logoutError=""
    />,
  )
  return onNavigate
}

describe('Developer portal', () => {
  it('shows authenticated live metrics and navigates to Maintenance', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/developer/maintenance-mode') {
        return response({ maintenanceMode: false, version: 0, updatedAt: '2026-10-23T07:00:00.000Z' })
      }
      if (url === '/api/developer/overview') {
        return response({
          metrics: {
            totalPortfolioProjects: 12,
            publishedProjects: 10,
            draftProjects: 2,
            designAssets: 8,
            pendingTasks: 3,
          },
          recentChanges: [{
            action: 'updated',
            title: 'Current project',
            createdAt: '2026-10-23T07:00:00.000Z',
          }],
        })
      }
      if (url === '/api/developer/diagnostics') return response(diagnostics)
      if (url === '/api/public/design-portfolio') {
        return response({ complete: true, projects: [{ id: 1, type: 'portfolio', title: 'Current project', source_key: null, asset_id: null }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer', onNavigate)

    expect(await screen.findByText('12')).not.toBeNull()
    expect(screen.getByText('10')).not.toBeNull()
    expect(screen.getByText('Current project')).not.toBeNull()
    await waitFor(() => expect(screen.getByText('All checked services healthy')).not.toBeNull())
    const maintenanceButton = screen.getByRole('button', { name: 'Maintenance' })
    expect(maintenanceButton.getAttribute('aria-current')).toBeNull()
    await user.click(maintenanceButton)
    expect(onNavigate).toHaveBeenCalledWith('/developer/maintenance')
  })

  it('runs read-only maintenance checks and marks the active route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/developer/maintenance-mode') {
        return response({ maintenanceMode: false, version: 0, updatedAt: '2026-10-23T07:00:00.000Z' })
      }
      if (url === '/api/developer/diagnostics') return response(diagnostics)
      if (url === '/api/public/design-portfolio') {
        return response({ complete: true, projects: [{ id: 1, type: 'portfolio', title: 'Published work', source_key: null, asset_id: 24 }] })
      }
      if (url === '/api/public/design-assets/24' && init?.method === 'HEAD') {
        return response(null, 200, 'image/webp')
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')

    expect(await screen.findByRole('heading', { name: 'Maintenance' })).not.toBeNull()
    expect(await screen.findByText('Healthy')).not.toBeNull()
    expect(await screen.findByText('Image endpoint returned image/webp for “Published work”.')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Maintenance' }).getAttribute('aria-current')).toBe('page')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'HEAD')).toBe(true)
  })

  it('reports backend failures as unavailable without inventing a healthy database state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/developer/diagnostics') {
        throw new TypeError('Network unavailable')
      }
      if (String(input) === '/api/developer/maintenance-mode') {
        return response({ maintenanceMode: false, version: 0, updatedAt: '2026-10-23T07:00:00.000Z' })
      }
      if (String(input) === '/api/public/design-portfolio') {
        return response({ complete: false, projects: [] })
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')

    expect(await screen.findByRole('heading', { name: 'Unavailable' })).not.toBeNull()
    expect(await screen.findByText('Database status is unknown because the backend check failed.')).not.toBeNull()
    expect(await screen.findAllByText('Portfolio response is incomplete.')).toHaveLength(2)
  })

  it('supports keyboard dismissal of the responsive navigation', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/developer/maintenance-mode') {
        return response({ maintenanceMode: false, version: 0, updatedAt: '2026-10-23T07:00:00.000Z' })
      }
      if (String(input) === '/api/developer/diagnostics') return response(diagnostics)
      if (String(input) === '/api/public/design-portfolio') return response({ complete: true, projects: [] })
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')

    const menuButton = screen.getByRole('button', { name: 'Open navigation menu' })
    await user.click(menuButton)
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Open navigation menu' }).getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open navigation menu' }))
  })

  it('opens a branded enable confirmation and saves maintenance mode with CSRF', async () => {
    const user = userEvent.setup()
    const persisted = { maintenanceMode: false, version: 0, updatedAt: '2026-10-23T07:00:00.000Z' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/developer/maintenance-mode' && !init?.method) {
        return response(persisted)
      }
      if (url === '/api/auth/csrf') return response({ csrfToken: 'maintenance-csrf-token' })
      if (url === '/api/developer/maintenance-mode' && init?.method === 'PUT') {
        expect(init.headers).toMatchObject({ 'X-CSRF-Token': 'maintenance-csrf-token' })
        expect(JSON.parse(String(init.body))).toEqual({ maintenanceMode: true, version: 0 })
        persisted.maintenanceMode = true
        persisted.version += 1
        return response(persisted)
      }
      if (url === '/api/developer/diagnostics') return response(diagnostics)
      if (url === '/api/public/design-portfolio') return response({ complete: true, projects: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')

    expect(await screen.findByRole('heading', { name: 'Maintenance Mode: OFF' })).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Turn maintenance mode ON' }))
    const dialog = screen.getByRole('dialog', { name: 'Enable Maintenance Mode?' })
    expect(dialog.textContent).toContain('Public visitors will temporarily see the maintenance page.')
    expect(dialog.textContent).toContain('unavailable for normal browsing')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Enable Maintenance' }))
    expect(await screen.findByRole('heading', { name: 'Maintenance Mode: ON' })).not.toBeNull()
    expect((await screen.findByRole('status')).textContent).toContain('Maintenance Mode is now ON.')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Turn maintenance mode OFF' }))

    const getMaintenanceRequests = () => fetchMock.mock.calls.filter(([url, init]) =>
      url === '/api/developer/maintenance-mode' && !init?.method,
    )
    const requestsBeforeRefresh = getMaintenanceRequests().length
    await user.click(screen.getByRole('button', { name: 'Refresh saved state' }))
    expect(await screen.findByRole('heading', { name: 'Maintenance Mode: ON' })).not.toBeNull()
    await waitFor(() => expect(getMaintenanceRequests()).toHaveLength(requestsBeforeRefresh + 1))
    const maintenanceRequests = fetchMock.mock.calls.filter(([url]) => url === '/api/developer/maintenance-mode')
    expect(maintenanceRequests.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
  })

  it('confirms disabling maintenance with the matching action and persists OFF', async () => {
    const user = userEvent.setup()
    const persisted = { maintenanceMode: true, version: 1, updatedAt: '2026-10-23T07:00:00.000Z' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/developer/maintenance-mode' && !init?.method) return response(persisted)
      if (url === '/api/auth/csrf') return response({ csrfToken: 'maintenance-csrf-token' })
      if (url === '/api/developer/maintenance-mode' && init?.method === 'PUT') {
        expect(JSON.parse(String(init.body))).toEqual({ maintenanceMode: false, version: 1 })
        persisted.maintenanceMode = false
        persisted.version += 1
        return response(persisted)
      }
      if (url === '/api/developer/diagnostics') return response(diagnostics)
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')
    const trigger = await screen.findByRole('button', { name: 'Turn maintenance mode OFF' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Disable Maintenance Mode?' })
    expect(dialog.textContent).toContain('normal public website will become accessible again')
    expect(screen.getByRole('button', { name: 'Keep Maintenance On' })).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Keep Maintenance On' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(persisted).toMatchObject({ maintenanceMode: true, version: 1 })
    expect(fetchMock.mock.calls.some(([url, init]) =>
      url === '/api/developer/maintenance-mode' && init?.method === 'PUT',
    )).toBe(false)

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Disable Maintenance' }))

    expect(await screen.findByRole('heading', { name: 'Maintenance Mode: OFF' })).not.toBeNull()
    expect((await screen.findByRole('status')).textContent).toContain('Maintenance Mode is now OFF.')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      url === '/api/developer/maintenance-mode' && init?.method === 'PUT',
    )).toHaveLength(1)
  })

  it.each(['escape', 'backdrop', 'cancel button'] as const)('cancels an enable confirmation through %s without changing saved state', async (interaction) => {
    const user = userEvent.setup()
    const persisted = { maintenanceMode: false, version: 0, updatedAt: '2026-10-23T07:00:00.000Z' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/developer/maintenance-mode' && !init?.method) return response(persisted)
      if (url === '/api/developer/diagnostics') return response(diagnostics)
      if (url === '/api/public/design-portfolio') return response({ complete: true, projects: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')
    const trigger = await screen.findByRole('button', { name: 'Turn maintenance mode ON' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Enable Maintenance Mode?' })
    if (interaction === 'escape') {
      fireEvent.keyDown(dialog, { key: 'Escape' })
    } else if (interaction === 'backdrop') {
      fireEvent.click(dialog)
    } else {
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
    }

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(persisted).toMatchObject({ maintenanceMode: false, version: 0 })
    expect(fetchMock.mock.calls.some(([url, init]) =>
      url === '/api/developer/maintenance-mode' && init?.method === 'PUT',
    )).toBe(false)
  })

  it('keeps the dialog open and prevents dismissal or duplicate saves while saving', async () => {
    const user = userEvent.setup()
    let resolveUpdate: ((value: Response) => void) | undefined
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (url === '/api/developer/maintenance-mode' && !init?.method) {
        return Promise.resolve(response({ maintenanceMode: false, version: 0, updatedAt: '2026-10-23T07:00:00.000Z' }))
      }
      if (url === '/api/auth/csrf') return Promise.resolve(response({ csrfToken: 'maintenance-csrf-token' }))
      if (url === '/api/developer/maintenance-mode' && init?.method === 'PUT') {
        return new Promise((resolve) => { resolveUpdate = resolve })
      }
      if (url === '/api/developer/diagnostics') return Promise.resolve(response(diagnostics))
      if (url === '/api/public/design-portfolio') return Promise.resolve(response({ complete: true, projects: [] }))
      return Promise.reject(new Error(`Unexpected request: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')
    await user.click(await screen.findByRole('button', { name: 'Turn maintenance mode ON' }))
    const dialog = screen.getByRole('dialog', { name: 'Enable Maintenance Mode?' })
    await user.click(screen.getByRole('button', { name: 'Enable Maintenance' }))

    expect(await screen.findByRole('button', { name: 'Please wait…' })).not.toBeNull()
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
    fireEvent.click(dialog)
    expect(screen.getByRole('dialog', { name: 'Enable Maintenance Mode?' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      url === '/api/developer/maintenance-mode' && init?.method === 'PUT',
    )).toHaveLength(1)

    resolveUpdate?.(response({ maintenanceMode: true, version: 1, updatedAt: '2026-10-23T07:01:00.000Z' }))
    expect(await screen.findByRole('heading', { name: 'Maintenance Mode: ON' })).not.toBeNull()
    expect(await screen.findByRole('status')).not.toBeNull()
  })

  it('reports server errors when maintenance mode cannot be loaded', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/developer/maintenance-mode') {
        return response({ error: 'Maintenance mode state is temporarily unavailable.' }, 503)
      }
      if (String(input) === '/api/developer/diagnostics') return response(diagnostics)
      if (String(input) === '/api/public/design-portfolio') return response({ complete: true, projects: [] })
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')

    expect((await screen.findByRole('alert')).textContent).toContain('Maintenance mode state is temporarily unavailable.')
    expect(screen.getByRole('heading', { name: 'Maintenance Mode: Unknown' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Maintenance mode unavailable' }).hasAttribute('disabled')).toBe(true)
  })

  it('does not report success when a confirmed update fails', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/developer/maintenance-mode' && !init?.method) {
        return response({ maintenanceMode: false, version: 0, updatedAt: '2026-10-23T07:00:00.000Z' })
      }
      if (url === '/api/auth/csrf') return response({ csrfToken: 'maintenance-csrf-token' })
      if (url === '/api/developer/maintenance-mode' && init?.method === 'PUT') {
        return response({ error: 'Maintenance mode could not be updated. Retry.' }, 503)
      }
      if (url === '/api/developer/diagnostics') return response(diagnostics)
      if (url === '/api/public/design-portfolio') return response({ complete: true, projects: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')

    await user.click(await screen.findByRole('button', { name: 'Turn maintenance mode ON' }))
    await user.click(screen.getByRole('button', { name: 'Enable Maintenance' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Maintenance mode could not be updated.')
    expect(screen.getByRole('heading', { name: 'Maintenance Mode: OFF' })).not.toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Enable Maintenance Mode?' })).not.toBeNull()
  })

  it('treats blocked public checks as not applicable during maintenance mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/developer/maintenance-mode') {
        return response({ maintenanceMode: true, version: 1, updatedAt: '2026-10-23T07:00:00.000Z' })
      }
      if (url === '/api/developer/diagnostics') return response(diagnostics)
      throw new Error(`Unexpected request during maintenance: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPortal('/developer/maintenance')

    expect(await screen.findByRole('heading', { name: 'Maintenance Mode: ON' })).not.toBeNull()
    expect(await screen.findByRole('heading', { name: 'Healthy' })).not.toBeNull()
    expect(await screen.findByText('Not checked because Maintenance Mode is ON; public portfolio access is intentionally blocked.')).not.toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/public/design-portfolio')).toBe(false)
  })
})
