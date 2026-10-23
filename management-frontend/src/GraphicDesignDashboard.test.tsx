import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GraphicDesignDashboard from './GraphicDesignDashboard'

const item = {
  id: 14,
  type: 'portfolio' as const,
  title: 'Campaign artwork',
  description: 'A launch project',
  alt_text: 'Campaign graphic',
  asset_id: null,
  category: 'branding',
  tags: ['launch'],
  display_order: 10,
  publication_status: 'draft' as 'draft' | 'published',
  source_key: null,
  legacy_image_url: null,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

describe('Graphic Design dashboard publishing controls', () => {
  it('shows project counts and requires confirmation before publishing', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() { this.setAttribute('open', '') },
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value() { this.removeAttribute('open') },
    })
    let published = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/graphic-design/tasks') {
        return response({ tasks: [] })
      }
      if (path === '/api/graphic-design/assets') {
        return response({ assets: [] })
      }
      if (path === '/api/graphic-design/content') {
        return response({ content: [{ ...item, publication_status: published ? 'published' : 'draft' }] })
      }
      if (path === '/api/auth/csrf') {
        return response({ csrfToken: 'test-csrf-token' })
      }
      if (path === `/api/graphic-design/content/${item.id}/publish` && init?.method === 'POST') {
        published = true
        return response({ content: { ...item, publication_status: 'published' } })
      }
      if (path === `/api/graphic-design/content/${item.id}/unpublish` && init?.method === 'POST') {
        published = false
        return response({ content: { ...item, publication_status: 'draft' } })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<GraphicDesignDashboard email="designer@example.test" onLogout={() => undefined} onSessionExpired={() => undefined} loggingOut={false} logoutError="" />)

    await screen.findByText('Workspace overview')
    fireEvent.click(screen.getByRole('button', { name: 'Portfolio' }))
    await screen.findByRole('heading', { level: 1, name: 'Portfolio' })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(screen.getByText('Publish “Campaign artwork” to the public website?')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalledWith(`/api/graphic-design/content/${item.id}/publish`, expect.anything())

    fireEvent.click(screen.getByRole('button', { name: 'Publish content' }))

    await waitFor(() => expect(published).toBe(true))
    expect(await screen.findByRole('button', { name: 'Unpublish' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove draft' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Content published to the public website.')

    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }))
    expect(screen.getByText('Remove “Campaign artwork” from the public website? Its saved content and revision history will remain.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish content' }))

    await waitFor(() => expect(published).toBe(false))
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove draft' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Content unpublished.')
  })

  it('keeps tasks, assets and settings in their own sections and creates a portfolio draft', async () => {
    let content = [item]
    const task = { id: 3, title: 'Homepage banner', description: 'Prepare launch artwork', deadline: null, status: 'Pending' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/graphic-design/tasks') return response({ tasks: [task] })
      if (path === '/api/graphic-design/assets') return response({ assets: [] })
      if (path === '/api/auth/csrf') return response({ csrfToken: 'test-csrf-token' })
      if (path === '/api/graphic-design/content' && init?.method === 'POST') {
        content = [...content, {
          ...item,
          id: 15,
          title: 'New identity project',
          publication_status: 'draft',
        }]
        return response({ content: content.at(-1) })
      }
      if (path === '/api/graphic-design/content') return response({ content })
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<GraphicDesignDashboard email="designer@example.test" onLogout={() => undefined} onSessionExpired={() => undefined} loggingOut={false} logoutError="" />)

    await screen.findByText('Workspace overview')
    expect(screen.getByText('Portfolio projects').parentElement?.textContent).toContain('1')
    const menuButton = screen.getByRole('button', { name: 'Open navigation menu' })
    fireEvent.click(menuButton)
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBe(document.activeElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')
    expect(menuButton).toBe(document.activeElement)

    fireEvent.click(screen.getByRole('button', { name: 'Design Tasks' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Create a design task' })).toBeTruthy()
    expect(screen.getByText('Homepage banner')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Design Assets' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Design Assets' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Add an image' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Password' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Portfolio' }))
    fireEvent.click(screen.getByRole('button', { name: /New Project/ }))
    fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'New identity project' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByText('New identity project')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Draft created.')
  })

  it('expires the session once when workspace loading receives unauthorized responses', async () => {
    const onSessionExpired = vi.fn()
    const fetchMock = vi.fn(async () => response({ error: 'Session expired' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <GraphicDesignDashboard
        email="designer@example.test"
        onLogout={() => undefined}
        onSessionExpired={onSessionExpired}
        loggingOut={false}
        logoutError=""
      />,
    )

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('expires the session on an unauthorized mutation without showing a generic error', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() { this.setAttribute('open', '') },
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value() { this.removeAttribute('open') },
    })
    const onSessionExpired = vi.fn()
    const publishPath = `/api/graphic-design/content/${item.id}/publish`
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/graphic-design/tasks') return response({ tasks: [] })
      if (path === '/api/graphic-design/assets') return response({ assets: [] })
      if (path === '/api/graphic-design/content') return response({ content: [item] })
      if (path === '/api/auth/csrf') return response({ csrfToken: 'test-csrf-token' })
      if (path === publishPath) return response({ error: 'Session expired' }, 401)
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <GraphicDesignDashboard
        email="designer@example.test"
        onLogout={() => undefined}
        onSessionExpired={onSessionExpired}
        loggingOut={false}
        logoutError=""
      />,
    )

    await screen.findByText('Workspace overview')
    fireEvent.click(screen.getByRole('button', { name: 'Portfolio' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish content' }))

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === publishPath)).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

function response(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}