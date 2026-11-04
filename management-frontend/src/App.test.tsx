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

  it('keeps Graphic Design and IT portfolio sections separate', async () => {
    window.history.replaceState({}, '', '/developer/portfolio/graphic-design')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path.includes('/api/developer/portfolio?department=Graphic%20Design')) return response({ projects: [] })
      if (path === '/api/developer/media') return response({ media: [] })
      return response({ projects: [], media: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Graphic Design portfolio' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Graphic Design portfolio' }).getAttribute('aria-current')).toBe('page')
    await userEvent.setup().click(screen.getByRole('button', { name: 'IT portfolio' }))
    expect(await screen.findByRole('heading', { name: 'IT portfolio' })).toBeTruthy()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('department=IT'))).toBe(true)
  })

  it('keeps the existing editable homepage content fields available', async () => {
    const content = {
      heroTitle: 'Hero', heroDescription: 'Hero description', aboutTitle: 'About', aboutDescription: 'About description',
      services: ['One', 'Two', 'Three', 'Four', 'Five'], primaryCta: 'Explore', secondaryCta: 'Start',
      contactEmail: 'info@example.test', contactWhatsapp: '+27 71 000 0000',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/developer/content') return response({ content })
      return response({})
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState({}, '', '/developer/content')
    render(<App />)

    expect(await screen.findByDisplayValue('Hero')).toBeTruthy()
    expect(screen.getByDisplayValue('One')).toBeTruthy()
    expect(screen.getByDisplayValue('Explore')).toBeTruthy()
    expect(screen.getByDisplayValue('info@example.test')).toBeTruthy()
  })

  it('shows legacy details and confirms a department-only classification', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/developer/portfolio?department=unclassified') return response({ projects: [{ id: '7', department: null, title: 'Legacy project', description: 'Existing description', category: 'Branding', imageAssetId: null, imageUrl: null, projectUrl: 'https://example.test/legacy', published: true, displayOrder: 1 }] })
      if (path === '/api/developer/media') return response({ media: [] })
      if (path === '/api/developer/portfolio/7/department' && init?.method === 'PATCH') return response({ id: '7', department: 'Graphic Design' })
      return response({})
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    window.history.replaceState({}, '', '/developer/portfolio/unclassified')
    render(<App />)

    expect(await screen.findByText('Legacy project')).toBeTruthy()
    expect(screen.getByText('Existing description')).toBeTruthy()
    await userEvent.setup().selectOptions(screen.getByLabelText('Department for Legacy project'), 'Graphic Design')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm classification' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/developer/portfolio/7/department', expect.objectContaining({ method: 'PATCH' })))
  })
})
