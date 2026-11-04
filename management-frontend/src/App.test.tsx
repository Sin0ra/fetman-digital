import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('single-owner developer portal', () => {
  it('shows login when the server reports no authenticated owner session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/auth/me' ? response({}, 401) : response({ error: 'Unexpected request' }, 500)))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
  })

  it('loads the owner portal section from a direct URL and navigates with same-origin requests', async () => {
    window.history.replaceState({}, '', '/developer/maintenance')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/developer/maintenance') return response({ maintenanceMode: false })
      return response({}, 200)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Maintenance' })).toBeTruthy()
    expect(window.location.pathname).toBe('/developer/maintenance')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Overview' }))
    expect(window.location.pathname).toBe('/developer')
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/developer/overview', expect.anything()))
  })

  it('logs out by calling the server before returning to login', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/auth/csrf') return response({ csrfToken: 'test-token' })
      if (path === '/api/auth/logout') return response({ ok: true })
      return response({ projects: 0, published: 0, media: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/auth/logout')).toBe(true)
  })
})
