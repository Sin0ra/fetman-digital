import { useEffect, useState, type FormEvent } from 'react'
import Dialog, { type DialogVariant } from './Dialog'

type ManagementUser = {
  id: string
  email: string
  role: 'Developer' | 'Graphic Design'
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

type UserForm = {
  email: string
  role: ManagementUser['role']
  isActive: boolean
  password: string
  passwordConfirmation: string
}

type DialogState = {
  variant: DialogVariant
  title: string
  description: string
  confirmLabel?: string
  onConfirm?: () => void | Promise<void>
  isResetForm?: boolean
}

const emptyForm: UserForm = {
  email: '',
  role: 'Graphic Design',
  isActive: true,
  password: '',
  passwordConfirmation: '',
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
  const result = (await response.json().catch(() => ({}))) as {
    error?: string
  }
  if (!response.ok) {
    throw new Error(result.error || 'The request could not be completed.')
  }
  return result as T
}

async function mutate<T>(path: string, method: string, body: unknown): Promise<T> {
  const tokenResponse = await requestJson('/api/auth/csrf')
  const { csrfToken } = await responseData<{ csrfToken: string }>(tokenResponse)
  const response = await requestJson(path, {
    method,
    headers: { 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return responseData<T>(response)
}

function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagementUser[]>([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<ManagementUser | null>(null)
  const [form, setForm] = useState<UserForm>(emptyForm)
  const [error, setError] = useState('')
  const [resetError, setResetError] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [resetUser, setResetUser] = useState<ManagementUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirmation, setResetConfirmation] = useState('')
  const [showResetPassword, setShowResetPassword] = useState(false)

  useEffect(() => {
    let cancelled = false
    const parameters = new URLSearchParams()
    if (search.trim()) parameters.set('search', search.trim())
    if (roleFilter !== 'all') parameters.set('role', roleFilter)
    if (statusFilter !== 'all') parameters.set('status', statusFilter)

    void requestJson(`/api/developer/users?${parameters.toString()}`)
      .then((response) => responseData<{ users: ManagementUser[] }>(response))
      .then((result) => {
        if (!cancelled) setUsers(result.users)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Unable to load users.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [search, roleFilter, statusFilter, refreshKey])

  function beginCreate() {
    setEditingUser(null)
    setForm(emptyForm)
    setError('')
    setFormOpen(true)
  }

  function beginEdit(user: ManagementUser) {
    setEditingUser(user)
    setForm({
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      password: '',
      passwordConfirmation: '',
    })
    setError('')
    setFormOpen(true)
  }

  async function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (!editingUser && form.password !== form.passwordConfirmation) {
      setError('The initial passwords do not match.')
      return
    }
    if (
      editingUser &&
      (editingUser.role !== form.role || editingUser.isActive !== form.isActive)
    ) {
      setDialog({
        variant: 'confirm',
        title: 'Save account changes?',
        description: `Apply the role or account-status changes for ${editingUser.email}?`,
        confirmLabel: 'Save changes',
        onConfirm: () => void saveUser(),
      })
      return
    }
    await saveUser()
  }

  async function saveUser() {
    setSaving(true)
    try {
      if (editingUser) {
        await mutate<{ user: ManagementUser }>(
          `/api/developer/users/${editingUser.id}`,
          'PUT',
          {
            email: form.email,
            role: form.role,
            isActive: form.isActive,
          },
        )
      } else {
        await mutate<{ user: ManagementUser }>('/api/developer/users', 'POST', {
          email: form.email,
          role: form.role,
          isActive: form.isActive,
          password: form.password,
        })
      }
      setForm(emptyForm)
      setEditingUser(null)
      setFormOpen(false)
      setLoading(true)
      setError('')
      setRefreshKey((value) => value + 1)
      setDialog({
        variant: 'success',
        title: editingUser ? 'User changes saved' : 'User created',
        description: editingUser
          ? 'The account details were updated.'
          : 'The account was created. Communicate its initial password separately through an approved secure channel.',
      })
    } catch (reason) {
      setDialog({
        variant: 'error',
        title: editingUser ? 'Changes not saved' : 'User not created',
        description: reason instanceof Error ? reason.message : 'Unable to save this user.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(user: ManagementUser) {
    const action = user.isActive ? 'deactivate' : 'activate'
    setDialog({
      variant: user.isActive ? 'destructive' : 'confirm',
      title: `${user.isActive ? 'Deactivate' : 'Reactivate'} this account?`,
      description: `Are you sure you want to ${action} ${user.email}?`,
      confirmLabel: user.isActive ? 'Deactivate' : 'Reactivate',
      onConfirm: () => void updateStatus(user),
    })
  }

  async function updateStatus(user: ManagementUser) {
    setError('')
    setSaving(true)
    try {
      await mutate<{ user: ManagementUser }>(
        `/api/developer/users/${user.id}`,
        'PUT',
        {
          email: user.email,
          role: user.role,
          isActive: !user.isActive,
        },
      )
      setLoading(true)
      setError('')
      setRefreshKey((value) => value + 1)
      setDialog({
        variant: 'success',
        title: 'Account status updated',
        description: `${user.email} has been ${user.isActive ? 'deactivated' : 'reactivated'}.`,
      })
    } catch (reason) {
      setDialog({
        variant: 'error',
        title: 'Account status not updated',
        description: reason instanceof Error ? reason.message : 'Unable to update account status.',
      })
    } finally {
      setSaving(false)
    }
  }

  function beginReset(user: ManagementUser) {
    setError('')
    setResetError('')
    setResetUser(null)
    setResetPassword('')
    setResetConfirmation('')
    setShowResetPassword(false)
    setDialog({
      variant: 'destructive',
      title: 'Reset this user’s password?',
      description: `You will set a new temporary password for ${user.email}. The user’s role and account status will not change.`,
      confirmLabel: 'Continue to reset form',
      onConfirm: () => {
        setResetUser(user)
        setDialog({
          variant: 'confirm',
          title: 'Set a temporary password',
          description: 'The password will not be shown again after the reset.',
          confirmLabel: 'Review reset',
          isResetForm: true,
          onConfirm: submitReset,
        })
      },
    })
  }

  function submitReset() {
    if (resetPassword.length < 15 || resetPassword.length > 128) {
      setResetError('Use a password between 15 and 128 characters.')
      return
    }
    if (resetPassword !== resetConfirmation) {
      setResetError('The new passwords do not match.')
      return
    }
    if (!resetUser) return
    setResetError('')
    setDialog({
      variant: 'destructive',
      title: 'Confirm password reset',
      description: `Reset the password for ${resetUser.email}? You must communicate the temporary password separately through an approved secure channel.`,
      confirmLabel: 'Reset password',
      onConfirm: () => void performReset(),
    })
  }

  async function performReset() {
    if (!resetUser) return
    const user = resetUser
    const newPassword = resetPassword
    setResetPassword('')
    setResetConfirmation('')
    setResetError('')
    setResetUser(null)
    setSaving(true)
    try {
      await mutate<{ message: string }>(
        `/api/developer/users/${user.id}/password`,
        'POST',
        { newPassword, passwordConfirmation: newPassword },
      )
      setDialog({
        variant: 'success',
        title: 'Password reset',
        description: `The password for ${user.email} was reset. Communicate it separately through an approved secure channel. The password will not be shown again.`,
      })
    } catch (reason) {
      setDialog({
        variant: 'error',
        title: 'Password not reset',
        description: reason instanceof Error ? reason.message : 'Unable to reset this password.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-content user-management" aria-labelledby="user-management-title">
      <p className="eyebrow">Developer workspace</p>
      <div className="page-heading">
        <div>
          <h1 id="user-management-title">User management</h1>
          <p className="dashboard-intro">Manage application access, supported roles, and account status.</p>
        </div>
        <button className="button button-primary" type="button" onClick={beginCreate}>
          Add User
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {formOpen && (
        <form className="workspace-form user-form" onSubmit={submitUser}>
          <div className="section-heading">
            <h2>{editingUser ? 'Edit user' : 'Add user'}</h2>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setFormOpen(false)
                setEditingUser(null)
                setForm(emptyForm)
              }}
            >
              Cancel
            </button>
          </div>
          <label htmlFor="user-email">
            Email address
            <input
              id="user-email"
              type="email"
              autoComplete="off"
              maxLength={254}
              required
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label htmlFor="user-role">
            Role
            <select
              id="user-role"
              value={form.role}
              onChange={(event) =>
                setForm({ ...form, role: event.target.value as ManagementUser['role'] })
              }
            >
              <option value="Developer">Developer</option>
              <option value="Graphic Design">Graphic Design</option>
            </select>
          </label>
          {!editingUser && (
            <>
              <label htmlFor="user-password">
                Initial password
                <input
                  id="user-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={15}
                  maxLength={128}
                  required
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </label>
              <label htmlFor="user-password-confirmation">
                Confirm initial password
                <input
                  id="user-password-confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={15}
                  maxLength={128}
                  required
                  value={form.passwordConfirmation}
                  onChange={(event) =>
                    setForm({ ...form, passwordConfirmation: event.target.value })
                  }
                />
              </label>
              <p className="field-note">
                Choose a unique password and deliver it separately using an approved secure channel.
                The application does not email credentials or provide password reset invitations.
              </p>
            </>
          )}
          <label className="checkbox-label" htmlFor="user-active">
            <input
              id="user-active"
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            Account is active
          </label>
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : editingUser ? 'Save changes' : 'Create user'}
          </button>
        </form>
      )}

      <div className="user-filters" aria-label="Filter users">
        <label htmlFor="user-search">
          Search email
          <input
            id="user-search"
            type="search"
            value={search}
            onChange={(event) => {
              setLoading(true)
              setError('')
              setSearch(event.target.value)
            }}
            placeholder="Search by email address"
          />
        </label>
        <label htmlFor="role-filter">
          Role
          <select id="role-filter" value={roleFilter} onChange={(event) => {
            setLoading(true)
            setError('')
            setRoleFilter(event.target.value)
          }}>
            <option value="all">All roles</option>
            <option value="Developer">Developer</option>
            <option value="Graphic Design">Graphic Design</option>
          </select>
        </label>
        <label htmlFor="status-filter">
          Account status
          <select id="status-filter" value={statusFilter} onChange={(event) => {
            setLoading(true)
            setError('')
            setStatusFilter(event.target.value)
          }}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="empty-state" role="status">Loading users…</p>
      ) : error && users.length === 0 ? null : users.length === 0 ? (
        <p className="empty-state">No users match these filters.</p>
      ) : (
        <div className="user-table-wrap">
          <table className="user-table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td data-label="Email">{user.email}</td>
                  <td data-label="Role">{user.role}</td>
                  <td data-label="Status">
                    <span className={`account-status ${user.isActive ? 'is-active' : 'is-inactive'}`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td data-label="Actions">
                    <div className="dashboard-actions">
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={saving}
                        onClick={() => beginEdit(user)}
                      >
                        Edit
                      </button>
                      <button
                        className={`button ${user.isActive ? 'button-danger' : 'button-secondary'}`}
                        type="button"
                        disabled={saving}
                        onClick={() => void toggleStatus(user)}
                      >
                        {user.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      {user.id !== currentUserId && (
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={saving}
                          onClick={() => beginReset(user)}
                        >
                          Reset password
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="field-note">Available roles are determined by the current backend: Developer and Graphic Design.</p>
      <Dialog
        open={dialog !== null}
        variant={dialog?.variant ?? 'info'}
        title={dialog?.title ?? ''}
        description={dialog?.description ?? ''}
        confirmLabel={dialog?.confirmLabel}
        confirmForm={dialog?.isResetForm ? 'reset-password-form' : undefined}
        busy={saving}
        onConfirm={dialog?.onConfirm}
        onCancel={() => {
          setDialog(null)
          if (dialog?.isResetForm) {
            setResetUser(null)
            setResetPassword('')
            setResetConfirmation('')
            setResetError('')
          }
        }}
      >
        {dialog?.isResetForm && resetUser && (
          <form
            id="reset-password-form"
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault()
              submitReset()
            }}
          >
            <label htmlFor="reset-new-password">New password</label>
            <input
              id="reset-new-password"
              data-dialog-initial-focus
              type={showResetPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              required
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
            />
            <label htmlFor="reset-password-confirmation">Confirm new password</label>
            <input
              id="reset-password-confirmation"
              type={showResetPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              required
              value={resetConfirmation}
              onChange={(event) => setResetConfirmation(event.target.value)}
            />
            <button
              className="text-button password-toggle"
              type="button"
              aria-pressed={showResetPassword}
              onClick={() => setShowResetPassword((shown) => !shown)}
            >
              {showResetPassword ? 'Hide passwords' : 'Show passwords'}
            </button>
            <p className="field-note">
              Use 15–128 characters. Communicate this temporary password separately through an
              approved secure channel. It will not be emailed or displayed again.
            </p>
            {resetError && <p className="form-error" role="alert">{resetError}</p>}
          </form>
        )}
      </Dialog>
    </section>
  )
}

export default UserManagement
