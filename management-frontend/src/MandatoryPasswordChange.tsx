import { useState, type FormEvent } from 'react'
import fetmanLogo from '../../fetman digital 2023 black.png'
import Dialog from './Dialog'

type Props = {
  email: string
  onLogout: () => void
  loggingOut: boolean
  onChanged: () => void
}

function MandatoryPasswordChange({ email, onLogout, loggingOut, onChanged }: Props) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successOpen, setSuccessOpen] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (newPassword !== confirmation) {
      setError('The new passwords do not match.')
      return
    }

    setSaving(true)
    const password = newPassword
    setNewPassword('')
    setConfirmation('')
    try {
      const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'include' })
      const csrfResult = (await csrfResponse.json().catch(() => ({}))) as {
        csrfToken?: string
        error?: string
      }
      if (!csrfResponse.ok || !csrfResult.csrfToken) {
        throw new Error(csrfResult.error || 'Unable to prepare a secure request.')
      }

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfResult.csrfToken,
        },
        body: JSON.stringify({
          newPassword: password,
          passwordConfirmation: password,
        }),
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(result.error || 'Unable to change your password.')
      }
      setSuccessOpen(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change your password.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="login-layout">
      <header className="login-header">
        <a className="brand" href="/set-password" aria-label="Fetman Digital management portal">
          <img className="brand-logo" src={fetmanLogo} alt="" />
          <span>
            <strong>Fetman Digital</strong>
            <span className="brand-caption">Management platform</span>
          </span>
        </a>
        <button
          className="button button-secondary"
          type="button"
          onClick={onLogout}
          disabled={loggingOut || saving}
        >
          {loggingOut ? 'Signing out…' : 'Log out'}
        </button>
      </header>
      <section className="mandatory-password-card" aria-labelledby="mandatory-password-title">
        <p className="eyebrow">Secure sign-in · {email}</p>
        <h1 id="mandatory-password-title">Secure your account</h1>
        <p className="login-description">
          Your account administrator issued a temporary password. Please choose your own password
          to continue.
        </p>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="mandatory-new-password">New password</label>
          <input
            id="mandatory-new-password"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            disabled={saving}
          />
          <label htmlFor="mandatory-password-confirmation">Confirm new password</label>
          <input
            id="mandatory-password-confirmation"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={saving}
          />
          <button
            className="text-button password-toggle"
            type="button"
            aria-pressed={showPasswords}
            onClick={() => setShowPasswords((shown) => !shown)}
            disabled={saving}
          >
            {showPasswords ? 'Hide passwords' : 'Show passwords'}
          </button>
          <p className="field-note">
            Choose a unique password of 15–128 characters. Your temporary password cannot be reused.
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary full-width" type="submit" disabled={saving}>
            {saving ? 'Saving password…' : 'Save new password'}
          </button>
        </form>
      </section>
      <footer>Fetman Digital <span aria-hidden="true">·</span> Internal tools</footer>
      <Dialog
        open={successOpen}
        variant="success"
        title="Your account is secure"
        description="Your new password has been saved. You can now continue to your workspace."
        onCancel={onChanged}
      />
    </main>
  )
}

export default MandatoryPasswordChange
