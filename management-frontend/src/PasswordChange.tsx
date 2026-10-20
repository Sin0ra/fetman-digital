import { useState, type FormEvent } from 'react'
import Dialog, { type DialogVariant } from './Dialog'

type DialogState = {
  variant: DialogVariant
  title: string
  description: string
  confirmLabel?: string
  onConfirm?: () => void | Promise<void>
}

async function requestJson(path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
}

async function responseData<T>(response: Response): Promise<T> {
  const result = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.')
  return result as T
}

function PasswordChange() {
  const [open, setOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)

  function closeForm() {
    if (busy) return
    setOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmation('')
    setError('')
    setShowPasswords(false)
  }

  function submitChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (newPassword !== confirmation) {
      setError('The new passwords do not match.')
      return
    }
    setDialog({
      variant: 'confirm',
      title: 'Change your password?',
      description: 'Your other active sessions will be signed out.',
      confirmLabel: 'Change password',
      onConfirm: () => void changePassword(),
    })
    setOpen(false)
    setShowPasswords(false)
  }

  async function changePassword() {
    const payload = { currentPassword, newPassword, passwordConfirmation: confirmation }
    setCurrentPassword('')
    setNewPassword('')
    setConfirmation('')
    setBusy(true)

    try {
      const tokenResponse = await requestJson('/api/auth/csrf')
      const { csrfToken } = await responseData<{ csrfToken: string }>(tokenResponse)
      const response = await requestJson('/api/auth/change-password', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(payload),
      })
      await responseData<{ message: string }>(response)
      setOpen(false)
      setDialog({
        variant: 'success',
        title: 'Password changed',
        description: 'Your password was updated. Other active sessions have been signed out.',
      })
    } catch (reason) {
      setDialog({
        variant: 'error',
        title: 'Password not changed',
        description: reason instanceof Error ? reason.message : 'Unable to change your password.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="button button-secondary" type="button" onClick={() => setOpen(true)}>
        Change password
      </button>
      <Dialog
        open={open}
        variant="confirm"
        title="Change password"
        description="Enter your current password and choose a new password of at least 15 characters."
        confirmLabel="Continue"
        confirmForm="password-change-form"
        busy={busy}
        onConfirm={() => undefined}
        onCancel={closeForm}
      >
        <form id="password-change-form" className="dialog-form" onSubmit={submitChange}>
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            data-dialog-initial-focus
            type={showPasswords ? 'text' : 'password'}
            autoComplete="current-password"
            maxLength={128}
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <label htmlFor="new-password-confirmation">Confirm new password</label>
          <input
            id="new-password-confirmation"
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <button
            className="text-button password-toggle"
            type="button"
            aria-pressed={showPasswords}
            onClick={() => setShowPasswords((shown) => !shown)}
          >
            {showPasswords ? 'Hide passwords' : 'Show passwords'}
          </button>
          <p className="field-note">Use a unique password with at least 15 characters.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      </Dialog>
      <Dialog
        open={dialog !== null}
        variant={dialog?.variant ?? 'info'}
        title={dialog?.title ?? ''}
        description={dialog?.description ?? ''}
        confirmLabel={dialog?.confirmLabel}
        busy={busy}
        onConfirm={dialog?.onConfirm}
        onCancel={() => {
          setDialog(null)
          if (dialog?.variant === 'confirm') setOpen(true)
        }}
      />
    </>
  )
}

export default PasswordChange
