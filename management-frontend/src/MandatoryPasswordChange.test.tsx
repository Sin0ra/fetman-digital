import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MandatoryPasswordChange from './MandatoryPasswordChange'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('mandatory password change screen', () => {
  it('shows the secure-account instructions, password requirements, and logout only', () => {
    render(
      <MandatoryPasswordChange
        email="staff@example.test"
        onLogout={vi.fn()}
        loggingOut={false}
        onChanged={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Secure your account' })).not.toBeNull()
    expect(screen.getByText(
      'Your account administrator issued a temporary password. Please choose your own password to continue.',
    )).not.toBeNull()
    expect(screen.getByLabelText('New password')).not.toBeNull()
    expect(screen.getByLabelText('Confirm new password')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Show passwords' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Save new password' })).not.toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('link', { name: /user management/i })).toBeNull()
  })

  it('shows a clear inline mismatch without submitting a request', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <MandatoryPasswordChange
        email="staff@example.test"
        onLogout={vi.fn()}
        loggingOut={false}
        onChanged={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('New password'), 'first-preferred-password')
    await user.type(screen.getByLabelText('Confirm new password'), 'other-preferred-password')
    await user.click(screen.getByRole('button', { name: 'Save new password' }))

    expect(screen.getByRole('alert').textContent).toBe('The new passwords do not match.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits only the selected password, then confirms success before continuing', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-test-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Password changed.' }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <MandatoryPasswordChange
        email="staff@example.test"
        onLogout={vi.fn()}
        loggingOut={false}
        onChanged={onChanged}
      />,
    )

    const password = 'my-own-preferred-password'
    await user.type(screen.getByLabelText('New password'), password)
    await user.type(screen.getByLabelText('Confirm new password'), password)
    await user.click(screen.getByRole('button', { name: 'Save new password' }))
    const requestOptions = fetchMock.mock.calls[1][1] as RequestInit
    const submitted = JSON.parse(String(requestOptions.body)) as Record<string, string>

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(submitted).toEqual({
      newPassword: password,
      passwordConfirmation: password,
    })
    expect('currentPassword' in submitted).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Your account is secure' })).not.toBeNull()
    expect(screen.queryByDisplayValue(password)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})
