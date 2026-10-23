import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
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

type DashboardSection = 'dashboard' | 'portfolio' | 'tasks' | 'assets' | 'settings'

const statuses: TaskStatus[] = ['Pending', 'In Progress', 'In Review', 'Completed']
const navigation: { id: DashboardSection; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'D' },
  { id: 'portfolio', label: 'Portfolio', icon: 'P' },
  { id: 'tasks', label: 'Design Tasks', icon: 'T' },
  { id: 'assets', label: 'Design Assets', icon: 'A' },
  { id: 'settings', label: 'Settings', icon: 'S' },
]
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

class SessionExpiredError extends Error {}

async function responseDataForSession<T>(
  response: Response,
  onSessionExpired: () => void,
): Promise<T> {
  if (response.status === 401) {
    onSessionExpired()
    throw new SessionExpiredError()
  }
  return responseData<T>(response)
}

async function mutate<T>(
  path: string,
  method: string,
  body: unknown,
  onSessionExpired: () => void,
): Promise<T> {
  const tokenResponse = await requestJson('/api/auth/csrf')
  const { csrfToken } = await responseDataForSession<{ csrfToken: string }>(tokenResponse, onSessionExpired)
  const response = await requestJson(path, {
    method,
    headers: { 'X-CSRF-Token': csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (response.status === 204) return undefined as T
  return responseDataForSession<T>(response, onSessionExpired)
}

function GraphicDesignDashboard({
  email,
  onLogout,
  onSessionExpired,
  loggingOut,
  logoutError,
}: {
  email: string
  onLogout: () => void
  onSessionExpired: () => void
  loggingOut: boolean
  logoutError: string
}) {
  const [activeSection, setActiveSection] = useState<DashboardSection>('dashboard')
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [content, setContent] = useState<DesignContent[]>([])
  const [contentSearch, setContentSearch] = useState('')
  const [contentFilter, setContentFilter] = useState<'all' | 'published' | 'draft'>('all')
  const [contentCategory, setContentCategory] = useState('all')
  const [taskUpdates, setTaskUpdates] = useState<Record<number, TaskUpdate[]>>({})
  const [taskNotes, setTaskNotes] = useState<Record<number, string>>({})
  const [visibleUpdates, setVisibleUpdates] = useState<Record<number, boolean>>({})
  const [revisions, setRevisions] = useState<Record<number, unknown[]>>({})
  const [editingContentId, setEditingContentId] = useState<number | null>(null)
  const [contentFormOpen, setContentFormOpen] = useState(false)
  const [contentForm, setContentForm] = useState<ContentForm>(emptyContentForm)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskDeadline, setNewTaskDeadline] = useState('')
  const [uploadTaskId, setUploadTaskId] = useState('')
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null)
  const [uploadPreviewName, setUploadPreviewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const sessionExpiredRef = useRef(false)
  const onSessionExpiredRef = useRef(onSessionExpired)
  onSessionExpiredRef.current = onSessionExpired

  const expireSession = useCallback(() => {
    if (sessionExpiredRef.current) return
    sessionExpiredRef.current = true
    onSessionExpiredRef.current()
  }, [])

  function createNewProject() {
    setActiveSection('portfolio')
    setEditingContentId(null)
    setContentForm(emptyContentForm)
    setContentFormOpen(true)
  }

  function navigateTo(section: DashboardSection) {
    setActiveSection(section)
    closeMobileNavigation()
    setError('')
    setNotice('')
  }

  function closeMobileNavigation() {
    setMobileNavigationOpen(false)
    mobileMenuButtonRef.current?.focus()
  }

  useEffect(() => {
    if (!mobileNavigationOpen) return
    navigationRef.current?.querySelector<HTMLButtonElement>('.sidebar-nav button:not(:disabled)')?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMobileNavigation()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobileNavigationOpen])

  useEffect(() => {
    if (!uploadPreviewUrl) return
    return () => URL.revokeObjectURL(uploadPreviewUrl)
  }, [uploadPreviewUrl])

  const refreshWorkspace = useCallback(async () => {
    setLoadingWorkspace(true)
    try {
      const [taskResponse, assetResponse, contentResponse] = await Promise.all([
        requestJson('/api/graphic-design/tasks'),
        requestJson('/api/graphic-design/assets'),
        requestJson('/api/graphic-design/content'),
      ])
      const [taskResult, assetResult, contentResult] = await Promise.all([
        responseDataForSession<{ tasks: Task[] }>(taskResponse, expireSession),
        responseDataForSession<{ assets: Asset[] }>(assetResponse, expireSession),
        responseDataForSession<{ content: DesignContent[] }>(contentResponse, expireSession),
      ])
      setTasks(taskResult.tasks)
      setAssets(assetResult.assets)
      setContent(contentResult.content)
    } finally {
      setLoadingWorkspace(false)
    }
  }, [expireSession])

  useEffect(() => {
    let cancelled = false
    async function loadWorkspace() {
      try {
        await refreshWorkspace()
      } catch (reason) {
        if (!cancelled && !(reason instanceof SessionExpiredError)) {
          setError(reason instanceof Error ? reason.message : 'Unable to load the workspace.')
        }
      }
    }
    void loadWorkspace()
    return () => {
      cancelled = true
    }
  }, [refreshWorkspace])

  async function runAction(action: () => Promise<void>, successMessage?: string) {
    if (sessionExpiredRef.current) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      if (successMessage) setNotice(successMessage)
    } catch (reason) {
      if (!(reason instanceof SessionExpiredError)) {
        setError(reason instanceof Error ? reason.message : 'The request could not be completed.')
      }
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
      }, expireSession)
      setNewTaskTitle('')
      setNewTaskDescription('')
      setNewTaskDeadline('')
      await refreshWorkspace()
    }, 'Task created.')
  }

  async function changeStatus(taskId: number, status: TaskStatus) {
    await runAction(async () => {
      await mutate(`/api/graphic-design/tasks/${taskId}`, 'PATCH', { status }, expireSession)
      await refreshWorkspace()
    }, 'Task status updated.')
  }

  async function submitTaskNote(event: FormEvent<HTMLFormElement>, taskId: number) {
    event.preventDefault()
    const note = taskNotes[taskId]?.trim()
    if (!note) return
    await runAction(async () => {
      await mutate(`/api/graphic-design/tasks/${taskId}/updates`, 'POST', { note }, expireSession)
      setTaskNotes((current) => ({ ...current, [taskId]: '' }))
      await loadTaskUpdates(taskId)
    }, 'Progress note saved.')
  }

  async function loadTaskUpdates(taskId: number) {
    const response = await requestJson(`/api/graphic-design/tasks/${taskId}/updates`)
    const result = await responseDataForSession<{ updates: TaskUpdate[] }>(response, expireSession)
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
      const { csrfToken } = await responseDataForSession<{ csrfToken: string }>(tokenResponse, expireSession)
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
      await responseDataForSession<{ asset: Asset }>(response, expireSession)
      form.reset()
      setUploadPreviewUrl(null)
      setUploadPreviewName('')
      setUploadTaskId('')
      await refreshWorkspace()
    }, 'Image added to your private design assets.')
  }

  async function saveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const tags = contentForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    const displayOrder = Number(contentForm.displayOrder)
    if (tags.length > 12) {
      setError('Use no more than 12 tags.')
      return
    }
    if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 100000) {
      setError('Display order must be a whole number between 0 and 100000.')
      return
    }
    await runAction(async () => {
      const body = {
        type: contentForm.type,
        title: contentForm.title,
        description: contentForm.description,
        altText: contentForm.altText,
        category: contentForm.category,
        tags,
        displayOrder,
        ...(editingContentId
          ? contentForm.assetId
            ? { assetId: contentForm.assetId }
            : {}
          : { assetId: contentForm.assetId || null }),
      }
      if (editingContentId) {
        await mutate(`/api/graphic-design/content/${editingContentId}`, 'PATCH', body, expireSession)
      } else {
        await mutate('/api/graphic-design/content', 'POST', body, expireSession)
      }
      setEditingContentId(null)
      setContentForm(emptyContentForm)
      setContentFormOpen(false)
      await refreshWorkspace()
    }, editingContentId ? 'Content updated and version saved.' : 'Draft created.')
  }

  function editContent(item: DesignContent) {
    setActiveSection('portfolio')
    setContentFormOpen(true)
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

  function changePublication(item: DesignContent) {
    const publishing = item.publication_status !== 'published'
    setDialog({
      variant: 'confirm',
      title: publishing ? 'Publish this content?' : 'Unpublish this content?',
      description: publishing
        ? `Publish “${item.title}” to the public website?`
        : `Remove “${item.title}” from the public website? Its saved content and revision history will remain.`,
      confirmLabel: publishing ? 'Publish content' : 'Unpublish content',
      onConfirm: () => void performPublicationChange(item),
    })
  }

  async function performPublicationChange(item: DesignContent) {
    await runAction(async () => {
      const action = item.publication_status === 'published' ? 'unpublish' : 'publish'
      await mutate(`/api/graphic-design/content/${item.id}/${action}`, 'POST', undefined, expireSession)
      await refreshWorkspace()
      setDialog(null)
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
    if (sessionExpiredRef.current) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await mutate(`/api/graphic-design/content/${item.id}`, 'DELETE', { confirm: true }, expireSession)
      await refreshWorkspace()
      setDialog({
        variant: 'success',
        title: 'Draft removed',
        description: 'The draft was removed. Its version history is retained.',
      })
    } catch (reason) {
      if (!(reason instanceof SessionExpiredError)) {
        setDialog({
          variant: 'error',
          title: 'Draft not removed',
          description: reason instanceof Error ? reason.message : 'Unable to remove this draft.',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  async function loadRevisions(contentId: number) {
    await runAction(async () => {
      const response = await requestJson(`/api/graphic-design/content/${contentId}/revisions`)
      const result = await responseDataForSession<{ revisions: unknown[] }>(response, expireSession)
      setRevisions((current) => ({ ...current, [contentId]: result.revisions }))
    })
  }

  const publishedCount = content.filter((item) => item.publication_status === 'published').length
  const draftCount = content.length - publishedCount
  const filteredContent = content.filter((item) => {
    const matchesFilter = contentFilter === 'all' || item.publication_status === contentFilter
    const matchesCategory = contentCategory === 'all' || item.category === contentCategory
    const query = contentSearch.trim().toLowerCase()
    const itemTags = Array.isArray(item.tags) ? item.tags : []
    const matchesSearch = !query || [item.title, item.description, item.category, ...itemTags]
      .join(' ')
      .toLowerCase()
      .includes(query)
    return matchesFilter && matchesCategory && matchesSearch
  })
  const selectedAsset = assets.find((asset) => String(asset.id) === contentForm.assetId)
  const pageDetails: Record<DashboardSection, { title: string; description: string }> = {
    dashboard: {
      title: 'Your workspace at a glance',
      description: 'A clear overview of your design portfolio, assigned tasks and creative assets.',
    },
    portfolio: {
      title: 'Portfolio',
      description: 'Create, refine and publish approved design work to the public website.',
    },
    tasks: {
      title: 'Design Tasks',
      description: 'Track assigned work, update progress and keep project notes together.',
    },
    assets: {
      title: 'Design Assets',
      description: 'Manage your private image library and attach assets to your work.',
    },
    settings: {
      title: 'Settings',
      description: 'Manage your account security and review your workspace access.',
    },
  }

  return (
    <div className="portal-layout">
      <aside id="graphic-design-navigation" ref={navigationRef} className={`portal-sidebar${mobileNavigationOpen ? ' portal-sidebar-open' : ''}`} aria-label="Management navigation">
        <a className="brand portal-brand" href="/graphic-design" onClick={(event) => { event.preventDefault(); navigateTo('dashboard') }}>
          <img className="brand-logo" src={fetmanLogo} alt="" />
          <span><strong>Fetman Digital</strong><span className="brand-caption">Management platform</span></span>
        </a>
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="sidebar-nav" aria-label="Workspace sections">
          {navigation.slice(0, 4).map((item) => (
            <button
              className={`sidebar-link${activeSection === item.id ? ' sidebar-link-active' : ''}`}
              type="button"
              key={item.id}
              aria-current={activeSection === item.id ? 'page' : undefined}
              onClick={() => navigateTo(item.id)}
            >
              <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <p className="sidebar-label sidebar-label-admin">ADMINISTRATION</p>
        <nav className="sidebar-nav" aria-label="Administration sections">
          <button className="sidebar-link sidebar-link-unavailable" type="button" disabled aria-describedby="developer-access-note">
            <span className="sidebar-icon" aria-hidden="true">D</span>Developer Portal
            <span className="sidebar-unavailable">Restricted</span>
          </button>
          <span className="sidebar-note" id="developer-access-note">Developer access is restricted to Developer accounts.</span>
          {navigation.slice(4).map((item) => (
            <button
              className={`sidebar-link${activeSection === item.id ? ' sidebar-link-active' : ''}`}
              type="button"
              key={item.id}
              aria-current={activeSection === item.id ? 'page' : undefined}
              onClick={() => navigateTo(item.id)}
            >
              <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-account">
          <span className="account-avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
          <span className="sidebar-account-copy"><strong>{email}</strong><span>Graphic Design</span></span>
        </div>
      </aside>

      {mobileNavigationOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={closeMobileNavigation} />}

      <div className="portal-main">
        <header className="portal-topbar">
          <button
            className="mobile-menu-button"
            type="button"
            ref={mobileMenuButtonRef}
            aria-label={mobileNavigationOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-controls="graphic-design-navigation"
            aria-expanded={mobileNavigationOpen}
            onClick={() => mobileNavigationOpen ? closeMobileNavigation() : setMobileNavigationOpen(true)}
          >
            <span aria-hidden="true">{mobileNavigationOpen ? '×' : '☰'}</span>
          </button>
          <div className="topbar-context"><span className="topbar-kicker">Graphic Design workspace</span><strong>{pageDetails[activeSection].title}</strong></div>
          <div className="portal-topbar-actions">
            <span className="topbar-user">{email}</span>
            <button className="button button-secondary logout-button" onClick={onLogout} disabled={loggingOut}>
              {loggingOut ? 'Signing out…' : 'Log out'}
            </button>
          </div>
        </header>

        <main className="dashboard-content portal-content">
          <header className="page-heading">
            <div>
              <p className="eyebrow">Graphic Design</p>
              <h1>{pageDetails[activeSection].title}</h1>
              <p className="dashboard-intro">{pageDetails[activeSection].description}</p>
            </div>
            {activeSection === 'portfolio' && (
              <button className="button button-primary new-project-button" type="button" onClick={createNewProject}>
                <span aria-hidden="true">+</span> New Project
              </button>
            )}
          </header>
          {error && <p className="form-error" role="alert">{error}</p>}
          {loadingWorkspace && <p role="status">Loading your design workspace…</p>}
          {notice && <p className="success-message" role="status">{notice}</p>}
          {logoutError && <p className="form-error" role="alert">{logoutError}</p>}

          {activeSection === 'dashboard' && (
            <section aria-labelledby="overview-title">
              <div className="section-heading overview-heading">
                <div><p className="eyebrow">Your work</p><h2 id="overview-title">Workspace overview</h2></div>
              </div>
              <div className="metric-grid">
                <article className="metric-card"><span className="metric-icon" aria-hidden="true">P</span><span className="status-label">Portfolio projects</span><strong>{content.length}</strong><button type="button" className="metric-link" onClick={() => navigateTo('portfolio')}>View portfolio <span aria-hidden="true">→</span></button></article>
                <article className="metric-card"><span className="metric-icon" aria-hidden="true">✓</span><span className="status-label">Published</span><strong>{publishedCount}</strong><button type="button" className="metric-link" onClick={() => { setContentFilter('published'); navigateTo('portfolio') }}>View published work <span aria-hidden="true">→</span></button></article>
                <article className="metric-card"><span className="metric-icon" aria-hidden="true">D</span><span className="status-label">Drafts / unpublished</span><strong>{draftCount}</strong><button type="button" className="metric-link" onClick={() => { setContentFilter('draft'); navigateTo('portfolio') }}>Review drafts <span aria-hidden="true">→</span></button></article>
                <article className="metric-card"><span className="metric-icon" aria-hidden="true">T</span><span className="status-label">Design tasks</span><strong>{tasks.length}</strong><button type="button" className="metric-link" onClick={() => navigateTo('tasks')}>View tasks <span aria-hidden="true">→</span></button></article>
              </div>
              <div className="overview-lower-grid">
                <section className="overview-panel" aria-labelledby="recent-projects-title">
                  <div className="panel-heading"><div><p className="eyebrow">Latest updates</p><h2 id="recent-projects-title">Recent portfolio projects</h2></div><button type="button" className="text-button" onClick={() => navigateTo('portfolio')}>View all</button></div>
                  {content.length ? (
                    <ul className="recent-list">
                      {content.slice(0, 4).map((item) => <li key={item.id}><span className="recent-project-icon" aria-hidden="true">P</span><span className="recent-copy"><strong>{item.title}</strong><span>{item.category || 'Uncategorised'} · {item.publication_status === 'published' ? 'Published' : 'Draft / unpublished'}</span></span></li>)}
                    </ul>
                  ) : <p className="empty-state">Portfolio projects you create will appear here.</p>}
                </section>
                <section className="overview-panel" aria-labelledby="tasks-overview-title">
                  <div className="panel-heading"><div><p className="eyebrow">Assigned work</p><h2 id="tasks-overview-title">Design tasks</h2></div><button type="button" className="text-button" onClick={() => navigateTo('tasks')}>View all</button></div>
                  {tasks.length ? (
                    <ul className="recent-list">
                      {tasks.slice(0, 4).map((task) => <li key={task.id}><span className="recent-project-icon" aria-hidden="true">T</span><span className="recent-copy"><strong>{task.title}</strong><span>{task.deadline ? `Due ${task.deadline}` : 'No deadline'} · {task.status}</span></span></li>)}
                    </ul>
                  ) : <p className="empty-state">No design tasks are assigned to you yet.</p>}
                </section>
              </div>
            </section>
          )}

          {activeSection === 'portfolio' && (
            <section aria-label="Portfolio projects">
              <div className="portfolio-toolbar">
                <label>Search projects<input type="search" value={contentSearch} onChange={(event) => setContentSearch(event.target.value)} placeholder="Search titles, descriptions or tags" /></label>
                <label>Publication status<select value={contentFilter} onChange={(event) => setContentFilter(event.target.value as typeof contentFilter)}>
                  <option value="all">All statuses ({content.length})</option>
                  <option value="published">Published ({publishedCount})</option>
                  <option value="draft">Draft / unpublished ({draftCount})</option>
                </select></label>
                <label>Category<select value={contentCategory} onChange={(event) => setContentCategory(event.target.value)}>
                  <option value="all">All categories</option><option value="logo">Logo design</option><option value="branding">Branding</option><option value="print">Print</option>
                </select></label>
              </div>
              {contentFormOpen && (
                <form className="workspace-form content-form project-editor" onSubmit={saveContent}>
                  <div className="editor-heading"><div><p className="eyebrow">{editingContentId ? 'Update project details' : 'New portfolio entry'}</p><h2>{editingContentId ? 'Edit project' : 'Create a project draft'}</h2></div><button className="icon-close-button" type="button" aria-label="Close project form" onClick={() => { setContentFormOpen(false); setEditingContentId(null); setContentForm(emptyContentForm) }}>×</button></div>
                  <label>Project title<input required maxLength={160} value={contentForm.title} onChange={(event) => setContentForm((current) => ({ ...current, title: event.target.value }))} /></label>
                  <label>Description<textarea rows={3} maxLength={5000} value={contentForm.description} onChange={(event) => setContentForm((current) => ({ ...current, description: event.target.value }))} /></label>
                  <label>Image alt text<input maxLength={250} value={contentForm.altText} onChange={(event) => setContentForm((current) => ({ ...current, altText: event.target.value }))} /></label>
                  <div className="editor-fields">
                    <label>Category<select value={contentForm.category} onChange={(event) => setContentForm((current) => ({ ...current, category: event.target.value }))}><option value="logo">Logo design</option><option value="branding">Branding</option><option value="print">Print</option></select></label>
                    <label>Display order<input type="number" min={0} max={100000} required value={contentForm.displayOrder} onChange={(event) => setContentForm((current) => ({ ...current, displayOrder: event.target.value }))} /></label>
                  </div>
                  <label>Tags, separated by commas<input maxLength={500} value={contentForm.tags} onChange={(event) => setContentForm((current) => ({ ...current, tags: event.target.value }))} /></label>
                  <label>Attach an image<select value={contentForm.assetId} onChange={(event) => setContentForm((current) => ({ ...current, assetId: event.target.value }))}><option value="">{editingContentId ? 'Keep existing image / no replacement' : 'No image'}</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.original_name}</option>)}</select></label>
                  {selectedAsset && <img className="content-thumbnail editor-thumbnail" src={`/api/graphic-design/assets/${selectedAsset.id}/preview`} alt="Selected project image preview" />}
                  <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : editingContentId ? 'Save changes' : 'Save draft'}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => { setContentFormOpen(false); setEditingContentId(null); setContentForm(emptyContentForm) }}>Cancel</button></div>
                </form>
              )}
              {!loadingWorkspace && filteredContent.length === 0 && <p className="empty-state portfolio-empty">{content.length === 0 ? 'No portfolio projects yet. Create a project draft to get started.' : 'No projects match these search and filter options.'}</p>}
              <div className="portfolio-card-grid">
                {filteredContent.map((item) => (
                  <article className="portfolio-card" key={item.id}>
                    <div className="portfolio-card-image">
                      {item.asset_id ? <img src={`/api/graphic-design/assets/${item.asset_id}/preview`} alt={item.alt_text || item.title} loading="lazy" /> : item.legacy_image_url ? <img src={new URL(item.legacy_image_url, 'https://fetmandigital.com/').href} alt={item.alt_text || item.title} loading="lazy" /> : <div className="portfolio-image-placeholder" aria-label="No project image"><span aria-hidden="true">FD</span></div>}
                      <span className={`publication-badge${item.publication_status === 'published' ? ' publication-badge-live' : ''}`}>{item.publication_status === 'published' ? 'Published' : 'Draft / unpublished'}</span>
                    </div>
                    <div className="portfolio-card-body">
                      <div className="portfolio-card-meta"><span>{item.category || 'Uncategorised'}</span><span>Order {item.display_order}</span></div>
                      <h2>{item.title}</h2>
                      <p>{item.description || 'No description provided.'}</p>
                      {Array.isArray(item.tags) && item.tags.length > 0 && <ul className="portfolio-tag-list" aria-label="Project tags">{item.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>}
                      <div className="portfolio-card-actions">
                        <a className="button button-secondary" href={`/api/graphic-design/content/${item.id}/preview`} target="_blank" rel="noreferrer">Preview</a>
                        <button className="button button-secondary" type="button" disabled={busy} onClick={() => editContent(item)}>Edit</button>
                        <button className="button button-primary" type="button" disabled={busy} onClick={() => void changePublication(item)}>{item.publication_status === 'published' ? 'Unpublish' : 'Publish'}</button>
                        {item.publication_status !== 'published' && <button className="button button-danger" type="button" disabled={busy} onClick={() => void removeContent(item)}>Remove draft</button>}
                        {item.publication_status === 'published' && <span className="published-retention-note">Unpublish before removing</span>}
                        <button className="text-button" type="button" disabled={busy} onClick={() => void loadRevisions(item.id)}>Version history</button>
                      </div>
                      {revisions[item.id] && <pre className="revision-list">{JSON.stringify(revisions[item.id], null, 2)}</pre>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeSection === 'tasks' && (
            <section aria-label="Design tasks">
              <div className="section-heading page-section-heading"><div><p className="eyebrow">Assigned to you</p><h2>Track your design work</h2></div><span className="stage">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}</span></div>
              <form className="workspace-form task-create-form" onSubmit={createTask}>
                <div><p className="eyebrow">Add work</p><h2>Create a design task</h2></div>
                <label>Project title<input required maxLength={160} value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} /></label>
                <label>Description<textarea rows={3} maxLength={5000} value={newTaskDescription} onChange={(event) => setNewTaskDescription(event.target.value)} /></label>
                <label>Deadline<input type="date" value={newTaskDeadline} onChange={(event) => setNewTaskDeadline(event.target.value)} /></label>
                <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add task'}</button>
              </form>
              {!loadingWorkspace && tasks.length === 0 && <p className="empty-state">No design tasks yet. Create a task above to start tracking your work.</p>}
              <div className="workspace-grid task-grid">
                {tasks.map((task) => (
                  <article className="workspace-card task-card" key={task.id}>
                    <div className="workspace-card-heading"><div><h3>{task.title}</h3><p className="status-detail">{task.deadline ? `Due ${task.deadline}` : 'No deadline set'}</p></div><span className={`task-status status-${task.status.toLowerCase().replaceAll(' ', '-')}`}>{task.status}</span></div>
                    <p className="workspace-description">{task.description || 'No project description.'}</p>
                    <label>Status<select value={task.status} disabled={busy} onChange={(event) => void changeStatus(task.id, event.target.value as TaskStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                    <form className="inline-form" onSubmit={(event) => void submitTaskNote(event, task.id)}>
                      <label>Progress note<textarea rows={2} maxLength={4000} value={taskNotes[task.id] || ''} onChange={(event) => setTaskNotes((current) => ({ ...current, [task.id]: event.target.value }))} /></label>
                      <button className="button button-secondary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save update'}</button>
                    </form>
                    <button className="text-button" type="button" disabled={busy} onClick={() => void runAction(() => loadTaskUpdates(task.id))}>{visibleUpdates[task.id] ? 'Refresh progress history' : 'View progress history'}</button>
                    {visibleUpdates[task.id] && <ul className="history-list">{(taskUpdates[task.id] || []).map((update) => <li key={update.id}><strong>{update.status || 'Progress note'}</strong>{update.note && ` — ${update.note}`}</li>)}</ul>}
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeSection === 'assets' && (
            <section aria-label="Design assets">
              <div className="section-heading page-section-heading"><div><p className="eyebrow">Private files</p><h2>Your design library</h2></div><span className="stage">{assets.length} {assets.length === 1 ? 'image' : 'images'}</span></div>
              <form className="workspace-form upload-form" onSubmit={uploadAsset}>
                <div><p className="eyebrow">Asset upload</p><h2>Add an image</h2></div>
                <p>JPEG, PNG or WebP, up to 5 MB. Assets remain private until referenced by published content.</p>
                <label>Attach to task (optional)<select value={uploadTaskId} onChange={(event) => setUploadTaskId(event.target.value)}><option value="">No task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
                <label>Image file<input name="design-file" type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => { const file = event.target.files?.[0]; setUploadPreviewUrl(file ? URL.createObjectURL(file) : null); setUploadPreviewName(file?.name ?? '') }} /></label>
                {uploadPreviewUrl && <div className="upload-preview"><img className="content-thumbnail" src={uploadPreviewUrl} alt="Selected image preview" /><span>Ready to upload: {uploadPreviewName}</span></div>}
                <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload image'}</button>
              </form>
              {!loadingWorkspace && assets.length === 0 && <p className="empty-state">Uploaded images will appear here for use in design tasks and portfolio drafts.</p>}
              <div className="asset-grid asset-library-grid">{assets.map((asset) => (
                <article className="asset-card" key={asset.id}>
                  <img src={`/api/graphic-design/assets/${asset.id}/preview`} alt={`Preview of ${asset.original_name}`} loading="lazy" />
                  <strong>{asset.original_name}</strong><span>{(asset.byte_size / 1024).toFixed(0)} KB · {asset.media_type}</span>
                  {asset.task_id && <span>Attached to task #{asset.task_id}</span>}
                </article>
              ))}</div>
            </section>
          )}

          {activeSection === 'settings' && (
            <section className="settings-grid" aria-label="Account settings">
              <article className="settings-card">
                <p className="eyebrow">Account</p><h2>Profile</h2>
                <dl className="account-details"><div><dt>Email address</dt><dd>{email}</dd></div><div><dt>Workspace role</dt><dd>Graphic Design</dd></div><div><dt>Portal access</dt><dd>Design tasks, assets and portfolio</dd></div></dl>
              </article>
              <article className="settings-card">
                <p className="eyebrow">Security</p><h2>Password</h2>
                <p className="settings-description">Change your password securely. Existing sessions on other devices will be signed out after a successful change.</p>
                <PasswordChange />
              </article>
              <article className="settings-card unavailable-card">
                <p className="eyebrow">Restricted area</p><h2>Developer Portal</h2>
                <p className="settings-description">This area is available to authorized Developer accounts only. Your Graphic Design access does not include administration or user management.</p>
                <span className="stage">Not available for this role</span>
              </article>
            </section>
          )}
        </main>
        <footer className="portal-footer">Fetman Digital <span aria-hidden="true">·</span> Internal tools</footer>
      </div>
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
    </div>
  )
}

export default GraphicDesignDashboard
