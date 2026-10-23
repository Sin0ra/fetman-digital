import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('restricted authenticated routing', () => {
  it('returns an expired Graphic Design session to the login screen', async () => {
    window.history.replaceState({}, '', '/graphic-design')
    let sessionChecks = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/auth/me') {
        sessionChecks += 1
        if (sessionChecks === 1) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              user: {
                id: '42',
                email: 'designer@example.test',
                role: 'Graphic Design',
                passwordChangeRequired: false,
              },
            }),
          } as Response
        }
        return { status: 401, ok: false, json: async () => ({}) } as Response
      }
      if (url.startsWith('/api/graphic-design/')) {
        return { status: 401, ok: false, json: async () => ({ error: 'Session expired' }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).not.toBeNull()
    expect(window.location.pathname).toBe('/login')
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/graphic-design/tasks')).toBe(true)
  })

  it('redirects a direct dashboard URL to the password-change screen without loading workspace data', async () => {
    window.history.replaceState({}, '', '/developer/users')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/me') {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            user: {
              id: '27',
              email: 'staff@example.test',
              role: 'Developer',
              passwordChangeRequired: true,
            },
          }),
        } as Response
      }
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Secure your account' })).not.toBeNull()
    })
    expect(window.location.pathname).toBe('/set-password')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes('/api/developer/dashboard') ||
      String(input).includes('/api/developer/users') ||
      String(input).includes('/api/graphic-design/'),
    )).toBe(false)
  })

  it('restores the authenticated Maintenance page on a direct route load', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/developer/maintenance')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/auth/me') {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            user: {
              id: '1',
              email: 'developer@example.test',
              role: 'Developer',
              passwordChangeRequired: false,
            },
          }),
        } as Response
      }
      if (url === '/api/developer/dashboard') {
        return { status: 200, ok: true, json: async () => ({ status: 'authenticated' }) } as Response
      }
      if (url === '/api/developer/diagnostics') {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            status: 'healthy',
            backend: 'healthy',
            database: 'healthy',
            environment: 'test',
            uptimeSeconds: 60,
            checkedAt: '2026-10-23T07:00:00.000Z',
          }),
        } as Response
      }
      if (url === '/api/developer/maintenance-mode') {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            maintenanceMode: false,
            version: 0,
            updatedAt: '2026-10-23T07:00:00.000Z',
          }),
        } as Response
      }
      if (url === '/api/developer/overview') {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            metrics: {
              totalPortfolioProjects: 12,
              publishedProjects: 12,
              draftProjects: 0,
              designAssets: 1,
              pendingTasks: 0,
            },
            recentChanges: [],
          }),
        } as Response
      }
      if (url === '/api/public/design-portfolio') {
        return { status: 200, ok: true, json: async () => ({ complete: true, projects: [] }) } as Response
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Maintenance' })).not.toBeNull()
    expect(await screen.findByRole('heading', { name: 'Healthy' })).not.toBeNull()
    expect(window.location.pathname).toBe('/developer/maintenance')
    expect(screen.getByRole('button', { name: 'Maintenance' }).getAttribute('aria-current')).toBe('page')
    await user.click(screen.getByRole('button', { name: 'Overview' }))
    expect(await screen.findByRole('heading', { name: 'System overview' })).not.toBeNull()
    expect(window.location.pathname).toBe('/developer')
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
  })
})
