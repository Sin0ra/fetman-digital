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
  const artworkModal = parsed.querySelector('[data-graphic-artwork-modal]')
  const itDivision = parsed.querySelector('#it-division')
  document.body.innerHTML = `${portfolio?.outerHTML || ''}${managedPortfolios?.outerHTML || ''}${artworkModal?.outerHTML || ''}${itDivision?.outerHTML || ''}`
  return document.querySelector('#portfolio .portfolio-collection .row') as HTMLElement
}

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('public portfolio integration', () => {
  it('starts the public portfolio directly with portfolio content and no global search', () => {
    prepareWebsite()
    expect(websiteHtml).not.toContain('Digital portfolio')
    expect(websiteHtml).not.toContain('Published work with a clear point of view.')
    expect(websiteHtml).not.toContain('Published portfolio projects from the Fetman Digital management dashboard.')
    expect(document.querySelector('#search-bar')).toBeNull()
    expect(document.querySelector('.portfolio-search-field')).toBeNull()
    expect(document.querySelector('#graphic-design-portfolio')).not.toBeNull()
  })

  it('keeps the requested light and dark section text palettes explicit', () => {
    expect(websiteHtml).toContain('color: rgba(255, 255, 255, .82)')
    expect(websiteHtml).toContain('.it-division .section-heading h2')
    expect(websiteHtml).toContain('color: var(--ink)')
  })

  it('uses uniform responsive card frames and removes masonry measurements', () => {
    expect(websiteHtml).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(websiteHtml).not.toContain('grid-auto-rows')
    expect(portfolioScript).not.toContain('gridRowEnd')
    expect(portfolioScript).not.toContain('ResizeObserver')
    expect(websiteHtml).toContain('object-fit: contain')
    expect(websiteHtml).toContain('height: clamp(240px, 22vw, 280px)')
    expect(websiteHtml).toContain('transition: opacity .45s ease, transform .45s')
    expect(websiteHtml).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(websiteHtml).toContain('grid-template-columns: 1fr')
  })

  it('uses only genuine additional images for Graphic Design card autoplay', async () => {
    prepareWebsite()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'Multi-image artwork', department: 'Graphic Design', category: 'Branding', description: 'A real set.', images: ['/one.webp', '/two.webp'], projectUrl: '' },
      { title: 'Single-image artwork', department: 'Graphic Design', category: 'Logos', description: 'One image.', imageUrl: '/single.webp', projectUrl: '' },
    ] }) }))

    window.eval(portfolioScript)
    const designGrid = document.querySelector('[data-portfolio-department="Graphic Design"]') as HTMLElement
    await vi.waitFor(() => expect(designGrid.querySelectorAll('.portfolio-item')).toHaveLength(2))
    expect(designGrid.querySelectorAll('.portfolio-item')[0].querySelectorAll('img')).toHaveLength(2)
    expect(designGrid.querySelectorAll('.portfolio-item')[1].querySelectorAll('img')).toHaveLength(1)
    expect(portfolioScript).toContain('2500')
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

    expect(document.querySelector('#graphic-design-portfolio')?.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('.graphic-design-empty-state')).not.toBeNull()
    expect(document.querySelector('#it-portfolio')?.hasAttribute('hidden')).toBe(true)
  })

  it('does not show fallback or demonstration cards when the public API is unavailable', async () => {
    const legacyGrid = prepareWebsite()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    window.eval(portfolioScript)

    await vi.waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce())
    expect(legacyGrid.querySelectorAll('.portfolio-item')).toHaveLength(0)
    expect(document.querySelector('#legacy-portfolio')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('#graphic-design-portfolio')?.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('.graphic-design-empty-state')).not.toBeNull()
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

  it('renders a filterable Graphic Design gallery with canonical categories', async () => {
    prepareWebsite()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'First design project', department: 'Graphic Design', category: 'Branding', description: 'First project.', projectUrl: 'https://example.test/first' },
      { title: 'Second design project', department: 'Graphic Design', category: 'Campaign', description: 'Second project.', projectUrl: 'https://example.test/second' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)

    window.eval(portfolioScript)
    const designCollection = document.querySelector('#graphic-design-portfolio') as HTMLElement
    await vi.waitFor(() => expect(designCollection.textContent).toContain('First design project'))

    expect(designCollection.querySelectorAll('.portfolio-item')).toHaveLength(2)
    expect(designCollection.querySelector('[data-graphic-filter="branding"]')).not.toBeNull()
    expect(designCollection.querySelector('[data-graphic-filter="campaigns"]')).not.toBeNull()
    await userEvent.click(designCollection.querySelector('[data-graphic-filter="campaigns"]') as HTMLElement)
    expect(designCollection.querySelector('.portfolio-item:not([hidden])')?.textContent).toContain('Second design project')
    expect(designCollection.querySelector('.portfolio-item:not([hidden])')?.textContent).not.toContain('First design project')
  })

  it('renders untitled Graphic Design artwork without a blank heading', async () => {
    prepareWebsite()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: null, department: 'Graphic Design', category: 'Branding', description: 'A single project.', imageUrl: '/artwork.webp', projectUrl: '' },
    ] }) }))

    window.eval(portfolioScript)
    const designCollection = document.querySelector('#graphic-design-portfolio') as HTMLElement
    await vi.waitFor(() => expect(designCollection.textContent).toContain('A single project.'))

    expect(designCollection.querySelector('.card-title')).toBeNull()
    expect(designCollection.querySelector('img')?.getAttribute('alt')).toContain('Branding artwork')
  })

  it('opens and closes artwork in an enlarged view without changing the URL', async () => {
    expect(websiteHtml).toContain('data-graphic-artwork-modal')
    expect(websiteHtml).toContain('object-fit: contain')

    prepareWebsite()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'First design project', department: 'Graphic Design', category: 'Branding', description: 'First project.', imageUrl: '/first.webp', projectUrl: '' },
      { title: 'Second design project', department: 'Graphic Design', category: 'Campaign', description: 'Second project.', imageUrl: '/second.webp', projectUrl: '' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)
    window.eval(portfolioScript)
    const designCollection = document.querySelector('#graphic-design-portfolio') as HTMLElement
    await vi.waitFor(() => expect(designCollection.textContent).toContain('First design project'))
    await userEvent.click(designCollection.querySelector('.portfolio-image-link') as HTMLElement)
    expect(document.querySelector('[data-graphic-artwork-modal]')?.hasAttribute('hidden')).toBe(false)
    expect(window.location.href).not.toContain('#graphic-artwork')
    await userEvent.click(document.querySelector('[data-graphic-artwork-close]') as HTMLElement)
    expect(document.querySelector('[data-graphic-artwork-modal]')?.hasAttribute('hidden')).toBe(true)
  })
})
