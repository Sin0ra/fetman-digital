import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const websiteHtml = readFileSync(resolve(process.cwd(), '../index.html'), 'utf8')
const portfolioScript = readFileSync(resolve(process.cwd(), '../public-portfolio.js'), 'utf8')

function prepareWebsite(apiBase = 'https://api.example.test') {
  const parsed = new DOMParser().parseFromString(websiteHtml, 'text/html')
  const portfolio = parsed.querySelector('#portfolio')
  if (!portfolio) throw new Error('The website portfolio section is missing.')
  document.head.innerHTML = `<meta name="design-api-base" content="${apiBase}">`
  document.body.innerHTML = portfolio.outerHTML
  return document.querySelector('#portfolio .row') as HTMLElement
}

function runScript(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  window.fetch = fetchMock as typeof fetch
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  window.eval(portfolioScript)
}

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('public portfolio integration', () => {
  it('updates seeded cards, adds published content, and removes only managed unpublished cards', async () => {
    const user = userEvent.setup()
    const grid = prepareWebsite()
    const originalKeys = [...grid.querySelectorAll<HTMLElement>('[data-cms-key]')]
      .map((card) => card.dataset.cmsKey as string)
    const existing = grid.querySelector<HTMLElement>('[data-cms-key="legacy-logo-sino-sma"]')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        complete: true,
        managedLegacyKeys: originalKeys,
        retiredLegacyKeys: originalKeys.filter((key) => key !== 'legacy-logo-sino-sma'),
        projects: [
          {
            id: 1,
            type: 'portfolio',
            title: 'Reviewed logo update',
            description: 'Approved description',
            alt_text: 'Logo Design',
            asset_id: 42,
            category: 'logo',
            tags: ['identity'],
            source_key: 'legacy-logo-sino-sma',
            legacy_image_url: null,
          },
          {
            id: 12,
            type: 'portfolio',
            title: 'New portfolio item',
            description: 'New approved work',
            alt_text: 'New artwork',
            asset_id: null,
            category: 'branding',
            tags: [],
            source_key: null,
            legacy_image_url: 'new-work.png',
            featured: true,
          },
        ],
      }),
    })

    runScript(fetchMock)

    await vi.waitFor(() => expect(existing?.querySelector('.card-title')?.textContent).toBe('Reviewed logo update'))
    expect(existing?.querySelector('img')?.alt).toBe('Reviewed logo update')
    expect(grid.querySelectorAll('.portfolio-item')).toHaveLength(2)
    expect(grid.textContent).toContain('New portfolio item')
    expect(grid.querySelector('[data-cms-key="content-12"]')?.classList.contains('is-featured')).toBe(true)
    expect(grid.querySelector('[data-cms-key="content-12"] .portfolio-category')?.textContent).toBe('Branding')
    expect(grid.querySelector('[data-cms-key="legacy-logo-totana"]')).toBeNull()
    expect(document.querySelector('#portfolio-source-status')?.getAttribute('data-source')).toBe('live')
    expect(document.querySelector('#portfolio-source-status')?.textContent).toContain('Live published portfolio loaded')

    document.querySelector<HTMLButtonElement>('.filter-btn[data-filter="branding"]')?.click()
    expect(grid.querySelectorAll('.portfolio-item:not([hidden])')).toHaveLength(1)
    expect(grid.querySelector('.portfolio-item:not([hidden]) .card-title')?.textContent).toBe('New portfolio item')
    expect(document.querySelector('.filter-btn[data-filter="branding"]')?.getAttribute('aria-pressed')).toBe('true')
    const logoFilter = document.querySelector<HTMLButtonElement>('.filter-btn[data-filter="logo"]')
    logoFilter?.focus()
    await user.keyboard('{Enter}')
    expect(grid.querySelectorAll('.portfolio-item:not([hidden])')).toHaveLength(1)
    expect(grid.querySelector('.portfolio-item:not([hidden]) .card-title')?.textContent).toBe('Reviewed logo update')
    expect(document.activeElement).toBe(logoFilter)
    const allFilter = document.querySelector<HTMLButtonElement>('.filter-btn[data-filter="all"]')
    allFilter?.focus()
    await user.keyboard('{Enter}')
    expect(grid.querySelectorAll('.portfolio-item:not([hidden])')).toHaveLength(2)

    runScript(fetchMock)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(grid.querySelectorAll('.portfolio-item')).toHaveLength(2)
  })

  it('retains all static cards when the API response is incomplete', async () => {
    const grid = prepareWebsite()
    const initialCards = [...grid.querySelectorAll('.portfolio-item')]
    const initialTitle = grid.querySelector('.card-title')?.textContent
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        complete: true,
        managedLegacyKeys: ['legacy-logo-sino-sma'],
        retiredLegacyKeys: ['legacy-logo-totana'],
        projects: [],
      }),
    })

    runScript(fetchMock)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(grid.querySelectorAll('.portfolio-item')).toHaveLength(initialCards.length)
    expect(grid.querySelector('.card-title')?.textContent).toBe(initialTitle)
    expect(grid.querySelector('[data-cms-key="legacy-logo-sino-sma"] .portfolio-category')?.textContent).toBe('Logo design')

    document.querySelector<HTMLButtonElement>('.filter-btn[data-filter="logo"]')?.click()
    expect(grid.querySelectorAll('.portfolio-item:not([hidden])')).toHaveLength(3)
    document.querySelector<HTMLButtonElement>('.filter-btn[data-filter="all"]')?.click()
    expect(grid.querySelectorAll('.portfolio-item:not([hidden])')).toHaveLength(initialCards.length)
  })

  it('does not request a non-HTTPS external API origin', async () => {
    const grid = prepareWebsite()
    const initialCards = grid.querySelectorAll('.portfolio-item').length
    document.querySelector<HTMLMetaElement>('meta[name="design-api-base"]')!.content = 'http://api.example.test'
    const fetchMock = vi.fn()

    runScript(fetchMock)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(grid.querySelectorAll('.portfolio-item')).toHaveLength(initialCards)
  })

  it('retains static content when the API is unavailable', async () => {
    const grid = prepareWebsite()
    const initialCards = grid.querySelectorAll('.portfolio-item').length
    const fetchMock = vi.fn().mockRejectedValue(new Error('network unavailable'))

    runScript(fetchMock)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(grid.querySelectorAll('.portfolio-item')).toHaveLength(initialCards)
    expect(document.querySelector('#portfolio-source-status')?.getAttribute('data-source')).toBe('fallback')
    expect(document.querySelector('#portfolio-source-status')?.textContent).toContain('Live portfolio unavailable')
  })

  it('uses the local backend origin when no API origin is configured', async () => {
    prepareWebsite('')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        complete: true,
        managedLegacyKeys: [],
        retiredLegacyKeys: [],
        projects: [],
      }),
    })

    runScript(fetchMock)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(document.querySelector('#portfolio-source-status')?.getAttribute('data-source')).toBe('fallback'),
    )
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:3000/api/public/design-portfolio')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store' })
    expect(document.querySelector('#portfolio-source-status')?.textContent).toContain('No published CMS projects')
  })
})
