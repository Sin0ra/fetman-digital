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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/developer/portfolio?department=unclassified') return response({ projects: [{ id: '7', department: null, title: 'Legacy project', description: 'Existing description', category: 'Branding', imageAssetId: null, imageUrl: null, projectUrl: 'https://example.test/legacy', published: true, displayOrder: 1 }] })
      if (path === '/api/developer/media') return response({ media: [] })
      if (path === '/api/developer/portfolio/7/department') return response({ id: '7', department: 'Graphic Design' })
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

  it('saves a project without a description or uploaded media', async () => {
    window.history.replaceState({}, '', '/developer/portfolio/graphic-design')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/developer/portfolio?department=Graphic%20Design') return response({ projects: [] })
      if (path === '/api/developer/media') return response({ media: [] })
      if (path === '/api/auth/csrf') return response({ csrfToken: 'test-token' })
      if (path === '/api/developer/portfolio' && init?.method === 'POST') return response({ id: '8' }, 201)
      return response({})
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await screen.findByRole('heading', { name: 'Graphic Design portfolio' })
    await userEvent.setup().type(screen.getByLabelText('Title'), 'Image-free project')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save project' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input) === '/api/developer/portfolio' && init?.method === 'POST')).toBe(true))
    const request = fetchMock.mock.calls.find(([input, init]) => String(input) === '/api/developer/portfolio' && init?.method === 'POST')
    const body = JSON.parse(String(request?.[1]?.body))
    expect(body.description).toBe('')
    expect(body.projectUrl).toBe('')
    expect(body.imageUrl).toBeNull()
    expect(body.imageAssetId).toBeNull()
  })

  it('keeps required fields required while optional portfolio fields remain optional', async () => {
    window.history.replaceState({}, '', '/developer/portfolio/it')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/developer/portfolio?department=IT') return response({ projects: [] })
      if (path === '/api/developer/media') return response({ media: [] })
      return response({})
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await screen.findByRole('heading', { name: 'IT portfolio' })
    expect((screen.getByLabelText('Title') as HTMLInputElement).required).toBe(true)
    expect((screen.getByLabelText('Category') as HTMLInputElement).required).toBe(true)
    expect((screen.getByLabelText('Project URL') as HTMLInputElement).required).toBe(false)
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).required).toBe(false)
    expect(screen.queryByLabelText('Image URL (optional)')).toBeNull()
    expect((screen.getByLabelText('Choose project image') as HTMLInputElement).required).toBe(false)
  })

  it('uploads, previews, replaces and removes a project image', async () => {
    window.history.replaceState({}, '', '/developer/portfolio/graphic-design')
    let uploadCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/developer/portfolio?department=Graphic%20Design') return response({ projects: [] })
      if (path === '/api/developer/media' && init?.method !== 'POST') return response({ media: [] })
      if (path === '/api/auth/csrf') return response({ csrfToken: 'test-token' })
      if (path === '/api/developer/media' && init?.method === 'POST') { uploadCount += 1; const id = uploadCount === 1 ? '21' : '22'; return response({ media: { id, originalName: 'design.webp', byteSize: 128, previewUrl: `/api/developer/media/${id}` } }, 201) }
      if (path === '/api/developer/portfolio' && init?.method === 'POST') return response({ id: '8' }, 201)
      return response({})
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const input = await screen.findByLabelText('Choose project image')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'Uploaded project')
    await user.type(screen.getByLabelText('Category'), 'Branding')
    await user.upload(input, new File(['first'], 'design.png', { type: 'image/png' }))
    expect((await screen.findByAltText('Selected project preview')).getAttribute('src')).toBe('/api/developer/media/21')
    expect(fetchMock.mock.calls.some(([request, init]) => String(request) === '/api/developer/media' && init?.method === 'POST' && init?.headers && (init.headers as Record<string, string>)['X-File-Name'] === 'design.png')).toBe(true)

    await user.upload(input, new File(['second'], 'replacement.webp', { type: 'image/webp' }))
    expect((await screen.findByAltText('Selected project preview')).getAttribute('src')).toBe('/api/developer/media/22')
    await user.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(screen.queryByAltText('Selected project preview')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save project' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([request, init]) => String(request) === '/api/developer/portfolio' && init?.method === 'POST')).toBe(true))
    const request = fetchMock.mock.calls.find(([request, init]) => String(request) === '/api/developer/portfolio' && init?.method === 'POST')
    const body = JSON.parse(String(request?.[1]?.body))
    expect(body.imageAssetId).toBeNull()
    expect(body.imageUrl).toBeNull()
  })

  it('reports invalid, oversized and failed image uploads', async () => {
    window.history.replaceState({}, '', '/developer/portfolio/it')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/developer/portfolio?department=IT') return response({ projects: [] })
      if (path === '/api/developer/media' && init?.method === 'POST') return response({ error: 'The uploaded image is invalid or too large.' }, 415)
      if (path === '/api/developer/media') return response({ media: [] })
      if (path === '/api/auth/csrf') return response({ csrfToken: 'test-token' })
      return response({ error: 'The uploaded image is invalid or too large.' }, 415)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    const input = await screen.findByLabelText('Choose project image')
    const user = userEvent.setup({ applyAccept: false })

    await user.upload(input, new File(['svg'], 'not-image.svg', { type: 'image/svg+xml' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a JPEG, PNG, or WebP image.')
    await user.upload(input, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Image uploads are limited to 5 MB.')
    await user.upload(input, new File(['png'], 'broken.png', { type: 'image/png' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The uploaded image is invalid or too large.')
  })

  it('preserves existing description and images when editing without changing them', async () => {
    window.history.replaceState({}, '', '/developer/portfolio/it')
    const project = { id: '9', department: 'IT', title: 'Existing project', description: 'Keep this description', category: 'Business Website', imageAssetId: '12', imageUrl: 'https://example.test/existing.webp', projectUrl: 'https://example.test/existing', published: true, displayOrder: 2, imagePreviewUrl: 'https://example.test/existing.webp' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/auth/me') return response({ user: { email: 'sinoworkguma@gmail.com' } })
      if (path === '/api/developer/portfolio?department=IT') return response({ projects: [project] })
      if (path === '/api/developer/media') return response({ media: [] })
      if (path === '/api/auth/csrf') return response({ csrfToken: 'test-token' })
      if (path === '/api/developer/portfolio/9' && init?.method === 'PUT') return response({ id: '9' })
      return response({})
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save project' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input) === '/api/developer/portfolio/9' && init?.method === 'PUT')).toBe(true))
    const request = fetchMock.mock.calls.find(([input, init]) => String(input) === '/api/developer/portfolio/9' && init?.method === 'PUT')
    const body = JSON.parse(String(request?.[1]?.body))
    expect(body.department).toBe(project.department)
    expect(body.description).toBe(project.description)
    expect(body.imageUrl).toBe(project.imageUrl)
    expect(body.imageAssetId).toBe(project.imageAssetId)
  })
})
