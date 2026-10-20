import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

export type DialogVariant = 'confirm' | 'destructive' | 'success' | 'error' | 'info'

type DialogProps = {
  open: boolean
  variant: DialogVariant
  title: string
  description: string
  confirmLabel?: string
  confirmForm?: string
  cancelLabel?: string
  busy?: boolean
  children?: ReactNode
  onConfirm?: () => void | Promise<void>
  onCancel: () => void
}

const indicators: Record<DialogVariant, string> = {
  confirm: '?',
  destructive: '!',
  success: '✓',
  error: '!',
  info: 'i',
}

function Dialog({
  open,
  variant,
  title,
  description,
  confirmLabel,
  confirmForm,
  cancelLabel = 'Cancel',
  busy = false,
  children,
  onConfirm,
  onCancel,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const dialogId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) {
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
        dialog.showModal()
      }
      dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [open, title])

  function trapTabKey(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`fd-dialog fd-dialog-${variant}`}
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
      onKeyDown={trapTabKey}
    >
      <div className="fd-dialog-panel">
        <span className="fd-dialog-indicator" aria-hidden="true">{indicators[variant]}</span>
        <div className="fd-dialog-copy">
          <h2 id={`${dialogId}-title`}>{title}</h2>
          <p id={`${dialogId}-description`}>{description}</p>
        </div>
        {children && <div className="fd-dialog-content">{children}</div>}
        <div className="fd-dialog-actions">
          {(onConfirm || confirmForm) && (variant === 'confirm' || variant === 'destructive') && (
            <button
              className="button button-secondary"
              type="button"
              data-dialog-initial-focus
              disabled={busy}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            className={`button ${variant === 'destructive' ? 'button-danger' : 'button-primary'}`}
            type={confirmForm ? 'submit' : 'button'}
            form={confirmForm}
            data-dialog-initial-focus={!onConfirm || variant === 'success' || variant === 'error' || variant === 'info' ? true : undefined}
            disabled={busy}
            onClick={() => {
              if (confirmForm) return
              if (onConfirm) void onConfirm()
              else onCancel()
            }}
          >
            {busy ? 'Please wait…' : confirmLabel || (onConfirm ? 'Confirm' : 'Close')}
          </button>
        </div>
      </div>
    </dialog>
  )
}

export default Dialog
