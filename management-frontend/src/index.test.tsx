import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('homepage Read More disclosure', () => {
  it('keeps the expanded state synchronized with the disclosure content', () => {
    const html = readFileSync(resolve(process.cwd(), '..', 'index.html'), 'utf8')
    const page = new DOMParser().parseFromString(html, 'text/html')
    const button = page.getElementById('read-more-btn')
    const content = page.getElementById('more-text')
    const toggleScript = Array.from(page.querySelectorAll('script'))
      .map((script) => script.textContent ?? '')
      .find((script) => script.includes('function toggleText()'))

    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(button?.getAttribute('aria-controls')).toBe('more-text')
    expect(content?.style.display).toBe('none')
    expect(toggleScript).toBeDefined()
    if (!button || !content || !toggleScript) throw new Error('Read More disclosure markup or script is missing.')

    const toggleText = new Function('document', `${toggleScript}\nreturn toggleText`)(page) as () => void

    toggleText()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.textContent).toBe('Read Less')
    expect(content.style.display).toBe('block')

    toggleText()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).toBe('Read More')
    expect(content.style.display).toBe('none')
  })
})
