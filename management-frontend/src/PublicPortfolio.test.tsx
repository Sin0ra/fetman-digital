import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'

const websiteHtml = readFileSync(resolve(process.cwd(), '../index.html'), 'utf8')
const portfolioScript = readFileSync(resolve(process.cwd(), '../public-portfolio.js'), 'utf8')

function prepareWebsite() {
  const parsed = new DOMParser().parseFromString(websiteHtml, 'text/html')
  const portfolio = parsed.querySelector('#portfolio')
  const managedPortfolios = parsed.querySelector('#managed-portfolios')
  const itDivision = parsed.querySelector('#it-division')
  document.body.innerHTML = `${portfolio?.outerHTML || ''}${managedPortfolios?.outerHTML || ''}${itDivision?.outerHTML || ''}`
  return document.querySelector('#portfolio .portfolio-collection .row') as HTMLElement
}

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('public portfolio integration', () => {
  it('provides a visible, accessible search field and filters cards while typing and clearing', async () => {
    const grid = prepareWebsite()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'Nakoba project', department: null, category: 'Website', description: 'A website.', projectUrl: 'https://example.test/nakoba' },
      { title: 'Brand project', department: null, category: 'Branding', description: 'A brand.', projectUrl: 'https://example.test/brand' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)
    window.eval(portfolioScript)
    await vi.waitFor(() => expect(grid.textContent).toContain('Nakoba project'))

    const search = document.querySelector('#search-bar') as HTMLInputElement
    expect(search.placeholder).toBe('Search published projects...')
    expect(document.querySelector('.portfolio-search-field .bi-search')).not.toBeNull()
    expect(websiteHtml).toContain('background: #fff;')
    await userEvent.type(search, 'Nakoba')
    expect(grid.querySelector('[hidden]')?.textContent).toContain('Brand project')
    await userEvent.clear(search)
    expect(grid.querySelectorAll('[hidden]')).toHaveLength(0)
  })

  it('keeps the requested light and dark section text palettes explicit', () => {
    expect(websiteHtml).toContain('#portfolio .portfolio-intro')
    expect(websiteHtml).toContain('color: rgba(255, 255, 255, .82)')
    expect(websiteHtml).toContain('.it-division .section-heading h2')
    expect(websiteHtml).toContain('color: var(--ink)')
  })

  it('does not include public artwork placeholders in the managed portfolio markup', () => {
    expect(websiteHtml).not.toContain('Artwork slot')
    expect(websiteHtml).not.toContain('View slot details')
    expect(websiteHtml).toContain('data-portfolio-department="Graphic Design"')
    expect(websiteHtml).toContain('data-portfolio-department="IT"')
  })

  it('hides empty managed department sections when no projects are published', async () => {
    prepareWebsite()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    window.eval(portfolioScript)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    expect(document.querySelector('#graphic-design-portfolio')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('#it-portfolio')?.hasAttribute('hidden')).toBe(true)
  })

  it('does not show fallback or demonstration cards when the public API is unavailable', async () => {
    const legacyGrid = prepareWebsite()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    window.eval(portfolioScript)

    await vi.waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce())
    expect(legacyGrid.querySelectorAll('.portfolio-item')).toHaveLength(0)
    expect(document.querySelector('#legacy-portfolio')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('#graphic-design-portfolio')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('#it-portfolio')?.hasAttribute('hidden')).toBe(true)
  })

  it('loads only complete published project records and keeps same-origin requests', async () => {
    const grid = prepareWebsite()
    const initial = grid.querySelectorAll('.portfolio-item').length
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'Published example', department: null, category: 'Business Website', description: 'A published project.', projectUrl: 'https://example.test', imageUrl: '/preview.webp' },
      { title: 'Incomplete project', category: 'Business Website' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)
    window.eval(portfolioScript)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/public/portfolio', expect.anything()))
    await vi.waitFor(() => expect(grid.textContent).toContain('Published example'))
    expect(grid.textContent).not.toContain('Incomplete project')
    expect(grid.querySelectorAll('.portfolio-item')).toHaveLength(initial + 1)
  })

  it('renders a published project without an image instead of dropping it', async () => {
    prepareWebsite()
    const grid = document.querySelector('[data-portfolio-department="IT"]') as HTMLElement
    const initial = grid.querySelectorAll('.portfolio-item').length
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [{
      title: 'Image-free published project',
      department: 'IT',
      category: 'Web application',
      description: 'A published project without an image asset.',
      projectUrl: 'https://example.test/image-free',
    }] }) })
    vi.stubGlobal('fetch', fetchMock)

    window.eval(portfolioScript)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/public/portfolio', expect.anything()))
    await vi.waitFor(() => expect(grid.textContent).toContain('Image-free published project'))
    expect(grid.querySelector('.portfolio-image-placeholder')).toBeNull()
    expect(grid.querySelector('img')).toBeNull()
    expect(grid.querySelectorAll('.portfolio-item')).toHaveLength(initial + 1)
  })

  it('renders a published project without a URL without creating a broken link', async () => {
    prepareWebsite()
    const grid = document.querySelector('[data-portfolio-department="Graphic Design"]') as HTMLElement
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [{
      title: 'URL-free published project',
      department: 'Graphic Design',
      category: 'Logo & Brand Identity',
      description: 'A published project presented without an external URL.',
      imageUrl: null,
      projectUrl: '',
    }] }) })
    vi.stubGlobal('fetch', fetchMock)

    window.eval(portfolioScript)
    await vi.waitFor(() => expect(grid.textContent).toContain('URL-free published project'))
    expect(grid.querySelector('a[href=""]')).toBeNull()
    expect(grid.querySelector('.portfolio-link-muted')?.textContent).toContain('Published project')
  })

  it('places published projects in their department grids and keeps legacy projects in the existing grid', async () => {
    const legacyGrid = prepareWebsite()
    const designGrid = document.querySelector('[data-portfolio-department="Graphic Design"]') as HTMLElement
    const itGrid = document.querySelector('[data-portfolio-department="IT"]') as HTMLElement
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'Design project', department: 'Graphic Design', category: 'Branding', description: 'Design work.', projectUrl: 'https://example.test/design' },
      { title: 'IT project', department: 'IT', category: 'Web application', description: 'IT work.', projectUrl: 'https://example.test/it' },
      { title: 'Legacy project', department: null, category: 'Existing', description: 'Unclassified work.', projectUrl: 'https://example.test/legacy' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    window.eval(portfolioScript)
    await vi.waitFor(() => expect(designGrid.textContent).toContain('Design project'))
    expect(designGrid.textContent).not.toContain('IT project')
    expect(itGrid.textContent).toContain('IT project')
    expect(itGrid.textContent).not.toContain('Design project')
    expect(legacyGrid.textContent).toContain('Legacy project')
  })

  it('rejects malformed records and does not assign unknown departments to a public section', async () => {
    const legacyGrid = prepareWebsite()
    const designGrid = document.querySelector('[data-portfolio-department="Graphic Design"]') as HTMLElement
    const itGrid = document.querySelector('[data-portfolio-department="IT"]') as HTMLElement
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'Unknown department project', department: 'Other', category: 'Invalid' },
      { title: 'Missing category', department: 'IT' },
      { title: 'Invalid URL', department: 'Graphic Design', category: 'Branding', projectUrl: 'javascript:alert(1)' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)

    window.eval(portfolioScript)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    expect(legacyGrid.textContent).not.toContain('Unknown department project')
    expect(designGrid.textContent).not.toContain('Invalid URL')
    expect(itGrid.textContent).not.toContain('Missing category')
  })

  it('presents Graphic Design projects one at a time with an indicator', async () => {
    prepareWebsite()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'First design project', department: 'Graphic Design', category: 'Branding', description: 'First project.', projectUrl: 'https://example.test/first' },
      { title: 'Second design project', department: 'Graphic Design', category: 'Campaign', description: 'Second project.', projectUrl: 'https://example.test/second' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)

    window.eval(portfolioScript)
    const designCollection = document.querySelector('#graphic-design-portfolio') as HTMLElement
    await vi.waitFor(() => expect(designCollection.textContent).toContain('First design project'))

    expect(designCollection.querySelectorAll('.portfolio-item.is-active')).toHaveLength(1)
    expect(designCollection.querySelector('.graphic-carousel-controls')).toBeNull()
    expect(designCollection.querySelectorAll('button')).toHaveLength(0)
    expect(designCollection.querySelector('.graphic-carousel-status')?.textContent).toBe('1 / 2')
  })

  it('keeps a single Graphic Design project visible without navigation controls', async () => {
    prepareWebsite()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'Only design project', department: 'Graphic Design', category: 'Branding', description: 'A single project.', projectUrl: '' },
    ] }) }))

    window.eval(portfolioScript)
    const designCollection = document.querySelector('#graphic-design-portfolio') as HTMLElement
    await vi.waitFor(() => expect(designCollection.textContent).toContain('Only design project'))

    expect(designCollection.querySelector('.graphic-carousel-status')?.textContent).toBe('1 / 1')
    expect(designCollection.querySelectorAll('.portfolio-item.is-active')).toHaveLength(1)
    expect(designCollection.querySelectorAll('button')).toHaveLength(0)
  })

  it('loops Graphic Design slides every five seconds and defines a compact contained image frame', async () => {
    expect(websiteHtml).toContain('height: min(380px, 42vw)')
    expect(websiteHtml).toContain('height: min(240px, 68vw)')
    expect(websiteHtml).toContain('object-fit: contain')
    expect(websiteHtml).toContain('object-position: center')
    expect(websiteHtml).toContain('.graphic-design-carousel .managed-project-grid .portfolio-image-link::after')

    prepareWebsite()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'First design project', department: 'Graphic Design', category: 'Branding', description: 'First project.', projectUrl: '' },
      { title: 'Second design project', department: 'Graphic Design', category: 'Campaign', description: 'Second project.', projectUrl: '' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    window.eval(portfolioScript)
    const designCollection = document.querySelector('#graphic-design-portfolio') as HTMLElement
    await vi.waitFor(() => expect(designCollection.querySelector('.graphic-carousel-status')?.textContent).toBe('1 / 2'))
    vi.advanceTimersByTime(5000)

    expect(designCollection.querySelector('.graphic-carousel-status')?.textContent).toBe('2 / 2')
    expect(designCollection.querySelectorAll('.portfolio-item.is-active')).toHaveLength(1)
  })

  it('fully hides a Graphic Design slide before popping in the next one', async () => {
    prepareWebsite()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'First design project', department: 'Graphic Design', category: 'Branding', description: 'First project.', projectUrl: '' },
      { title: 'Second design project', department: 'Graphic Design', category: 'Campaign', description: 'Second project.', projectUrl: '' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    window.eval(portfolioScript)
    const designCollection = document.querySelector('#graphic-design-portfolio') as HTMLElement
    await vi.waitFor(() => expect(designCollection.querySelectorAll('.portfolio-item.is-active')).toHaveLength(1))
    vi.advanceTimersByTime(4500)
    expect(designCollection.querySelectorAll('.portfolio-item.is-active')).toHaveLength(0)
    vi.advanceTimersByTime(500)
    expect(designCollection.querySelectorAll('.portfolio-item.is-active')).toHaveLength(1)
    expect(designCollection.textContent).toContain('2 / 2')
  })

  it('rotates the three website demos with exact names and links and excludes PVL', async () => {
    prepareWebsite()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [] }) }))
    vi.useFakeTimers()
    window.eval(portfolioScript)
    const stage = document.querySelector('[data-website-showcase]') as HTMLElement
    expect(stage.textContent).toContain('Nakoba Services')
    expect(stage.querySelector('a')?.getAttribute('href')).toBe('https://nakobaservices.netlify.app/')
    expect(document.body.textContent).not.toContain('PVL')
    vi.advanceTimersByTime(6000)
    expect(stage.textContent).toContain('DRV Dental Centre')
    expect(stage.querySelector('a')?.getAttribute('href')).toBe('https://drvvdentacentre.netlify.app/')
  })

  it('does not autoplay Graphic Design or website demos when reduced motion is preferred', async () => {
    prepareWebsite()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'First design project', department: 'Graphic Design', category: 'Branding', description: 'First project.', projectUrl: '' },
      { title: 'Second design project', department: 'Graphic Design', category: 'Campaign', description: 'Second project.', projectUrl: '' },
    ] }) }))
    vi.useFakeTimers()
    window.eval(portfolioScript)
    await vi.waitFor(() => expect(document.querySelector('#graphic-design-portfolio')?.textContent).toContain('First design project'))
    vi.advanceTimersByTime(12000)
    expect(document.querySelector('.graphic-carousel-status')?.textContent).toBe('1 / 2')
    expect(document.querySelector('[data-website-showcase]')?.textContent).toContain('Nakoba Services')
  })
})
