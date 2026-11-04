import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const websiteHtml = readFileSync(resolve(process.cwd(), '../index.html'), 'utf8')
const portfolioScript = readFileSync(resolve(process.cwd(), '../public-portfolio.js'), 'utf8')

function prepareWebsite() {
  const parsed = new DOMParser().parseFromString(websiteHtml, 'text/html')
  document.body.innerHTML = parsed.querySelector('#portfolio')?.outerHTML || ''
  return document.querySelector('#portfolio .portfolio-collection .row') as HTMLElement
}

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('public portfolio integration', () => {
  it('loads only complete published project records and keeps same-origin requests', async () => {
    const grid = prepareWebsite()
    const initial = grid.querySelectorAll('.portfolio-item').length
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [
      { title: 'Published example', category: 'Business Website', description: 'A published project.', projectUrl: 'https://example.test', imageUrl: 'preview.webp' },
      { title: 'Incomplete project', category: 'Business Website' },
    ] }) })
    vi.stubGlobal('fetch', fetchMock)
    window.eval(portfolioScript)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/public/portfolio', expect.anything()))
    await vi.waitFor(() => expect(grid.textContent).toContain('Published example'))
    expect(grid.textContent).not.toContain('Incomplete project')
    expect(grid.querySelectorAll('.portfolio-item')).toHaveLength(initial + 1)
  })

  it('retains static cards when the public API is unavailable', async () => {
    const grid = prepareWebsite()
    const initial = grid.querySelectorAll('.portfolio-item').length
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    window.eval(portfolioScript)
    await vi.waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce())
    expect(grid.querySelectorAll('.portfolio-item')).toHaveLength(initial)
  })
})
