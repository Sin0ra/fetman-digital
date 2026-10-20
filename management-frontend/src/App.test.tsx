import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('restricted authenticated routing', () => {
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
})
