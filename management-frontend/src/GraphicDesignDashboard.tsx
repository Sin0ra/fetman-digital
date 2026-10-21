import { useEffect, useState, type FormEvent } from 'react'
import fetmanLogo from '../../fetman digital 2023 black.png'
import Dialog, { type DialogVariant } from './Dialog'
import PasswordChange from './PasswordChange'

type TaskStatus = 'Pending' | 'In Progress' | 'In Review' | 'Completed'

type Task = {
  id: number
  title: string
  description: string
  deadline: string | null
  status: TaskStatus
}

type TaskUpdate = {
  id: number
  status: TaskStatus | null
  note: string
  created_at?: string
}

type Asset = {
  id: number
  task_id: number | null
  original_name: string
  media_type: string
  byte_size: number
  previewUrl?: string
}

type DesignContent = {
  id: number
  type: 'banner' | 'portfolio' | 'visual'
  title: string
  description: string
  alt_text: string
  asset_id: number | null
  category: string
  tags: string[] | string
  display_order: number
  publication_status: 'draft' | 'published'
  source_key: string | null
  legacy_image_url: string | null
}

type ContentForm = {
  type: DesignContent['type']
  title: string
  description: string
  altText: string
  assetId: string
  category: string
  tags: string
  displayOrder: string
}

type DialogState = {
  variant: DialogVariant
  title: string
  description: string
  confirmLabel?: string
  onConfirm?: () => void | Promise<void>
}

const statuses: TaskStatus[] = ['Pending', 'In Progress', 'In Review', 'Completed']
const emptyContentForm: ContentForm = {
  type: 'portfolio',
  title: '',
  description: '',
  altText: '',
  assetId: '',
  category: 'logo',
  tags: '',
  displayOrder: '0',
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
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.')
  return result as T
}

async function mutate<T>(path: string, method: string, body?: unknown): Promise<T> {
  const tokenResponse = await requestJson('/api/auth/csrf')
  const { csrfToken } = await responseData<{ csrfToken: string }>(tokenResponse)
  const response = await requestJson(path, {
    method,
    headers: { 'X-CSRF-Token': csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (response.status === 204) return undefined as T
  return responseData<T>(response)
}

function GraphicDesignDashboard({
  email,
  onLogout,
  loggingOut,
  logoutError,
}: {
  email: string
  onLogout: () => void
  loggingOut: boolean
  logoutError: string
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [content, setContent] = useState<DesignContent[]>([])
  const [taskUpdates, setTaskUpdates] = useState<Record<number, TaskUpdate[]>>({})
  const [taskNotes, setTaskNotes] = useState<Record<number, string>>({})
  const [visibleUpdates, setVisibleUpdates] = useState<Record<number, boolean>>({})
  const [revisions, setRevisions] = useState<Record<number, unknown[]>>({})
  const [editingContentId, setEditingContentId] = useState<number | null>(null)
  const [contentForm, setContentForm] = useState<ContentForm>(emptyContentForm)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskDeadline, setNewTaskDeadline] = useState('')
  const [uploadTaskId, setUploadTaskId] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)

  async function refreshWorkspace() {
    setLoadingWorkspace(true)
    try {
      const [taskResponse, assetResponse, contentResponse] = await Promise.all([
        requestJson('/api/graphic-design/tasks'),
        requestJson('/api/graphic-design/assets'),
        requestJson('/api/graphic-design/content'),
      ])
      const [taskResult, assetResult, contentResult] = await Promise.all([
        responseData<{ tasks: Task[] }>(taskResponse),
        responseData<{ assets: Asset[] }>(assetResponse),
        responseData<{ content: DesignContent[] }>(contentResponse),
      ])
      setTasks(taskResult.tasks)
      setAssets(assetResult.assets)
      setContent(contentResult.content)
    } finally {
      setLoadingWorkspace(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadWorkspace() {
      try {
        await refreshWorkspace()
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load the workspace.')
      }
    }
    void loadWorkspace()
    return () => {
      cancelled = true
    }
  }, [])

  async function runAction(action: () => Promise<void>, successMessage?: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (successMessage) setNotice(successMessage)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runAction(async () => {
      await mutate('/api/graphic-design/tasks', 'POST', {
        title: newTaskTitle,
        description: newTaskDescription,
        deadline: newTaskDeadline || null,
      })
      setNewTaskTitle('')
      setNewTaskDescription('')
      setNewTaskDeadline('')
      await refreshWorkspace()
    }, 'Task created.')
  }

  async function changeStatus(taskId: number, status: TaskStatus) {
    await runAction(async () => {
      await mutate(`/api/graphic-design/tasks/${taskId}`, 'PATCH', { status })
      await refreshWorkspace()
    }, 'Task status updated.')
  }

  async function submitTaskNote(event: FormEvent<HTMLFormElement>, taskId: number) {
    event.preventDefault()
    const note = taskNotes[taskId]?.trim()
    if (!note) return
    await runAction(async () => {
      await mutate(`/api/graphic-design/tasks/${taskId}/updates`, 'POST', { note })
      setTaskNotes((current) => ({ ...current, [taskId]: '' }))
      await loadTaskUpdates(taskId)
    }, 'Progress note saved.')
  }

  async function loadTaskUpdates(taskId: number) {
    const response = await requestJson(`/api/graphic-design/tasks/${taskId}/updates`)
    const result = await responseData<{ updates: TaskUpdate[] }>(response)
    setTaskUpdates((current) => ({ ...current, [taskId]: result.updates }))
    setVisibleUpdates((current) => ({ ...current, [taskId]: true }))
  }

  async function uploadAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const input = form.elements.namedItem('design-file')
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return
    const file = input.files[0]
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image uploads are limited to 5 MB.')
      return
    }

    await runAction(async () => {
      const tokenResponse = await requestJson('/api/auth/csrf')
      const { csrfToken } = await responseData<{ csrfToken: string }>(tokenResponse)
      const query = uploadTaskId ? `?taskId=${encodeURIComponent(uploadTaskId)}` : ''
      const response = await requestJson(`/api/graphic-design/assets${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-CSRF-Token': csrfToken,
          'X-File-Name': file.name,
        },
        body: file,
      })
      await responseData<{ asset: Asset }>(response)
      form.reset()
      setUploadTaskId('')
      await refreshWorkspace()
    }, 'Image added to your private design assets.')
  }

  async function saveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runAction(async () => {
      const body = {
        type: contentForm.type,
        title: contentForm.title,
        description: contentForm.description,
        altText: contentForm.altText,
        category: contentForm.category,
        tags: contentForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        displayOrder: Number(contentForm.displayOrder),
        ...(editingContentId
          ? contentForm.assetId
            ? { assetId: contentForm.assetId }
            : {}
          : { assetId: contentForm.assetId || null }),
      }
      if (editingContentId) {
        await mutate(`/api/graphic-design/content/${editingContentId}`, 'PATCH', body)
      } else {
        await mutate('/api/graphic-design/content', 'POST', body)
      }
      setEditingContentId(null)
      setContentForm(emptyContentForm)
      await refreshWorkspace()
    }, editingContentId ? 'Content updated and version saved.' : 'Draft created.')
  }

  function editContent(item: DesignContent) {
    setEditingContentId(item.id)
    setContentForm({
      type: item.type,
      title: item.title,
      description: item.description,
      altText: item.alt_text,
      assetId: item.asset_id ? String(item.asset_id) : '',
      category: item.category || 'logo',
      tags: (Array.isArray(item.tags) ? item.tags : []).join(', '),
      displayOrder: String(item.display_order ?? 0),
    })
  }

  async function changePublication(item: DesignContent) {
    await runAction(async () => {
      const action = item.publication_status === 'published' ? 'unpublish' : 'publish'
      await mutate(`/api/graphic-design/content/${item.id}/${action}`, 'POST')
      await refreshWorkspace()
    }, item.publication_status === 'published' ? 'Content unpublished.' : 'Content published to the public website.')
  }

  async function removeContent(item: DesignContent) {
    setDialog({
      variant: 'destructive',
      title: 'Remove this draft?',
      description: `Remove “${item.title}”? Its version history will be retained.`,
      confirmLabel: 'Remove draft',
      onConfirm: () => void performRemoveContent(item),
    })
  }

  async function performRemoveContent(item: DesignContent) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await mutate(`/api/graphic-design/content/${item.id}`, 'DELETE', { confirm: true })
      await refreshWorkspace()
      setDialog({
        variant: 'success',
        title: 'Draft removed',
        description: 'The draft was removed. Its version history is retained.',
      })
    } catch (reason) {
      setDialog({
        variant: 'error',
        title: 'Draft not removed',
        description: reason instanceof Error ? reason.message : 'Unable to remove this draft.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function loadRevisions(contentId: number) {
    await runAction(async () => {
      const response = await requestJson(`/api/graphic-design/content/${contentId}/revisions`)
      const result = await responseData<{ revisions: unknown[] }>(response)
      setRevisions((current) => ({ ...current, [contentId]: result.revisions }))
    })
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <a className="brand" href="/graphic-design" aria-label="Fetman Digital Graphic Design dashboard">
          <img className="brand-logo" src={fetmanLogo} alt="" />
          <span>
            <strong>Fetman Digital</strong>
            <span className="brand-caption">Management platform</span>
          </span>
        </a>
        <div className="dashboard-actions">
          <span className="signed-in-email">{email}</span>
          <PasswordChange />
          <button className="button button-secondary logout-button" onClick={onLogout} disabled={loggingOut}>
            {loggingOut ? 'Signing out…' : 'Log out'}
          </button>
        </div>
      </header>

      <section className="dashboard-content" aria-labelledby="graphic-design-title">
        <p className="eyebrow">Graphic Design workspace</p>
        <h1 id="graphic-design-title">Your creative work, in one place.</h1>
        <p className="dashboard-intro">Manage your assigned work, design assets, and graphic-design content published on the public website.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loadingWorkspace && <p role="status">Loading your design workspace…</p>}
        {notice && <p className="success-message" role="status">{notice}</p>}
        {logoutError && <p className="form-error" role="alert">{logoutError}</p>}

        <section className="workspace-section" aria-labelledby="tasks-title">
          <div className="section-heading">
            <div><p className="eyebrow">Assigned to you</p><h2 id="tasks-title">Design tasks</h2></div>
            <span className="stage">{tasks.length} tasks</span>
          </div>
          <form className="workspace-form task-create-form" onSubmit={createTask}>
            <h3>Create a design task</h3>
            <label>Project title<input required maxLength={160} value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} /></label>
            <label>Description<textarea rows={3} maxLength={5000} value={newTaskDescription} onChange={(event) => setNewTaskDescription(event.target.value)} /></label>
            <label>Deadline<input type="date" value={newTaskDeadline} onChange={(event) => setNewTaskDeadline(event.target.value)} /></label>
            <button className="button button-primary" type="submit" disabled={busy}>Add task</button>
          </form>
          <div className="workspace-grid">
            {tasks.map((task) => (
              <article className="workspace-card" key={task.id}>
                <div className="workspace-card-heading">
                  <div><h3>{task.title}</h3><p className="status-detail">{task.deadline ? `Due ${task.deadline}` : 'No deadline set'}</p></div>
                  <span className={`task-status status-${task.status.toLowerCase().replaceAll(' ', '-')}`}>{task.status}</span>
                </div>
                <p className="workspace-description">{task.description || 'No project description.'}</p>
                <label>Status
                  <select value={task.status} disabled={busy} onChange={(event) => void changeStatus(task.id, event.target.value as TaskStatus)}>
                    {statuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <form className="inline-form" onSubmit={(event) => void submitTaskNote(event, task.id)}>
                  <label>Revision note / progress update
                    <textarea rows={2} maxLength={4000} value={taskNotes[task.id] || ''} onChange={(event) => setTaskNotes((current) => ({ ...current, [task.id]: event.target.value }))} />
                  </label>
                  <button className="button button-secondary" type="submit" disabled={busy}>Save update</button>
                </form>
                <button className="text-button" type="button" onClick={() => void runAction(() => loadTaskUpdates(task.id))}>
                  {visibleUpdates[task.id] ? 'Refresh progress history' : 'View progress history'}
                </button>
                {visibleUpdates[task.id] && <ul className="history-list">{(taskUpdates[task.id] || []).map((update) => <li key={update.id}><strong>{update.status || 'Progress note'}</strong>{update.note && ` — ${update.note}`}</li>)}</ul>}
              </article>
            ))}
            {tasks.length === 0 && <p className="empty-state">No design tasks yet. Create one here to start tracking a project.</p>}
          </div>
        </section>

        <section className="workspace-section" aria-labelledby="assets-title">
          <div className="section-heading">
            <div><p className="eyebrow">Private files</p><h2 id="assets-title">Design assets</h2></div>
            <span className="stage">{assets.length} images</span>
          </div>
          <form className="workspace-form upload-form" onSubmit={uploadAsset}>
            <h3>Add an image</h3>
            <p>JPEG, PNG, and WebP only; maximum 5 MB. Assets stay private until attached to published content.</p>
            <label>Attach to task (optional)
              <select value={uploadTaskId} onChange={(event) => setUploadTaskId(event.target.value)}>
                <option value="">No task</option>
                {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
            </label>
            <label>Image file<input name="design-file" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
            <button className="button button-primary" type="submit" disabled={busy}>Upload image</button>
          </form>
          <div className="asset-grid">
            {assets.map((asset) => (
              <article className="asset-card" key={asset.id}>
                <img src={`/api/graphic-design/assets/${asset.id}/preview`} alt="" loading="lazy" />
                <strong>{asset.original_name}</strong>
                <span>{(asset.byte_size / 1024).toFixed(0)} KB · {asset.media_type}</span>
              </article>
            ))}
            {assets.length === 0 && <p className="empty-state">Uploaded images will appear here for use in design tasks and content drafts.</p>}
          </div>
        </section>

        <section className="workspace-section" aria-labelledby="content-title">
          <div className="section-heading">
            <div><p className="eyebrow">Public website</p><h2 id="content-title">Portfolio content</h2></div>
            <span className="stage">{content.filter((item) => item.publication_status === 'published').length} published · {content.filter((item) => item.publication_status !== 'published').length} drafts</span>
          </div>
          <p className="draft-notice">Save drafts for private review, preview them before publishing, or unpublish them without deleting the saved content. The public site reads published portfolio items from the management API.</p>
          <form className="workspace-form content-form" onSubmit={saveContent}>
            <h3>{editingContentId ? 'Edit content' : 'Create a portfolio draft'}</h3>
            <label>Title<input required maxLength={160} value={contentForm.title} onChange={(event) => setContentForm((current) => ({ ...current, title: event.target.value }))} /></label>
            <label>Description<textarea rows={3} maxLength={5000} value={contentForm.description} onChange={(event) => setContentForm((current) => ({ ...current, description: event.target.value }))} /></label>
            <label>Image alt text<input maxLength={250} value={contentForm.altText} onChange={(event) => setContentForm((current) => ({ ...current, altText: event.target.value }))} /></label>
            <label>Portfolio category<select value={contentForm.category} onChange={(event) => setContentForm((current) => ({ ...current, category: event.target.value }))}>
              <option value="logo">Logo design</option><option value="branding">Branding</option><option value="print">Print</option>
            </select></label>
            <label>Tags, separated by commas<input maxLength={500} value={contentForm.tags} onChange={(event) => setContentForm((current) => ({ ...current, tags: event.target.value }))} /></label>
            <label>Display order<input type="number" min={0} max={100000} value={contentForm.displayOrder} onChange={(event) => setContentForm((current) => ({ ...current, displayOrder: event.target.value }))} /></label>
            <label>Attach an image<select value={contentForm.assetId} onChange={(event) => setContentForm((current) => ({ ...current, assetId: event.target.value }))}>
              <option value="">Keep existing image / no replacement</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.original_name}</option>)}
            </select></label>
            <div className="form-actions">
              <button className="button button-primary" type="submit" disabled={busy}>{editingContentId ? 'Save changes' : 'Save draft'}</button>
              {editingContentId && <button className="button button-secondary" type="button" onClick={() => { setEditingContentId(null); setContentForm(emptyContentForm) }}>Cancel edit</button>}
            </div>
          </form>
          <div className="workspace-grid">
            {content.map((item) => (
              <article className="workspace-card" key={item.id}>
                <span className="stage">{item.type} · {item.publication_status === 'published' ? 'Published' : 'Draft'}</span>
                <h3>{item.title}</h3>
                {item.asset_id && <img className="content-thumbnail" src={`/api/graphic-design/assets/${item.asset_id}/preview`} alt={item.alt_text} loading="lazy" />}
                {!item.asset_id && item.legacy_image_url && <img className="content-thumbnail" src={new URL(item.legacy_image_url, 'https://fetmandigital.com/').href} alt={item.alt_text} loading="lazy" />}
                <p className="workspace-description">{item.description || 'No description.'}</p>
                <div className="form-actions">
                  <a className="button button-secondary" href={`/api/graphic-design/content/${item.id}/preview`} target="_blank" rel="noreferrer">Preview</a>
                  <button className="button button-secondary" type="button" onClick={() => editContent(item)}>Edit</button>
                  <button className="button button-primary" type="button" disabled={busy} onClick={() => void changePublication(item)}>{item.publication_status === 'published' ? 'Unpublish' : 'Publish'}</button>
                  <button className="button button-danger" type="button" disabled={busy} onClick={() => void removeContent(item)}>Remove</button>
                  <button className="text-button" type="button" onClick={() => void loadRevisions(item.id)}>Version history</button>
                </div>
                {revisions[item.id] && <pre className="revision-list">{JSON.stringify(revisions[item.id], null, 2)}</pre>}
              </article>
            ))}
            {content.length === 0 && <p className="empty-state">No website portfolio content yet. Create a draft to get started.</p>}
          </div>
        </section>
      </section>
      <Dialog
        open={dialog !== null}
        variant={dialog?.variant ?? 'info'}
        title={dialog?.title ?? ''}
        description={dialog?.description ?? ''}
        confirmLabel={dialog?.confirmLabel}
        busy={busy}
        onConfirm={dialog?.onConfirm}
        onCancel={() => setDialog(null)}
      />
      <footer>Fetman Digital <span aria-hidden="true">·</span> Internal tools</footer>
    </main>
  )
}

export default GraphicDesignDashboard
