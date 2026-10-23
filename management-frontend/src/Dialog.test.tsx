import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dialog, { type DialogVariant } from './Dialog'

function renderDialog(
  variant: DialogVariant = 'confirm',
  busy = false,
  onConfirm: (() => void) | undefined =
    variant === 'confirm' || variant === 'destructive' ? vi.fn() : undefined,
  onCancel = vi.fn(),
) {
  const result = render(
    <Dialog
      open
      variant={variant}
      title="Confirm action"
      description="This action changes account access."
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
  return { ...result, onConfirm, onCancel }
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentElement ? document.body : null
    },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Fetman branded dialog', () => {
  it('confirms and cancels actions using labelled dialog controls', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()

    expect(screen.getByRole('dialog', { name: 'Confirm action' }).getAttribute('open')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('supports Escape and traps Tab focus within the modal', () => {
    const { onCancel } = renderDialog()
    const dialog = screen.getByRole('dialog')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Confirm' })

    confirm.focus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the element that opened the dialog', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open confirmation</button>
          <Dialog
            open={open}
            variant="info"
            title="Action complete"
            description="The action is complete."
            onCancel={() => setOpen(false)}
          />
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open confirmation' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(document.activeElement).toBe(trigger)
  })

  it('prevents Escape and duplicate actions while an operation is running', () => {
    const { onCancel, onConfirm } = renderDialog('destructive', true)
    const dialog = screen.getByRole('dialog')

    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
    expect(onCancel).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Please wait…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it.each([
    ['success', '✓'],
    ['error', '!'],
  ] as const)('clearly presents and dismisses the %s outcome', async (variant, indicator) => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { container } = renderDialog(variant, false, undefined, onCancel)

    expect(document.body.contains(screen.getByRole('dialog', { name: 'Confirm action' }))).toBe(true)
    expect(container.querySelector('.fd-dialog-indicator')?.textContent).toBe(indicator)
    expect(screen.getByText('This action changes account access.')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('provides a labelled informational dialog', () => {
    const { container } = renderDialog('info')
    expect(screen.getByRole('dialog', { name: 'Confirm action' })).not.toBeNull()
    expect(container.querySelector('.fd-dialog-indicator')?.textContent).toBe('i')
  })

  it('defines a narrow-screen layout for modal actions', () => {
    const styles = readFileSync(resolve('src/App.css'), 'utf8')

    expect(styles).toMatch(/@media\s*\(max-width:\s*520px\)[\s\S]*?\.fd-dialog-actions[\s\S]*?flex-direction:\s*column-reverse/)
    expect(styles).toMatch(/\.fd-dialog-actions\s+\.button\s*\{\s*width:\s*100%/)
  })
})
