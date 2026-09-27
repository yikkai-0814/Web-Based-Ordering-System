// @vitest-environment jsdom
/**
 * The overlay is adjustable per dialog, and only per dialog.
 *
 * The customisation dialog drops the backdrop blur because it made the first frame of every
 * open expensive on a slower tablet. Every other dialog must keep the blur it has always had,
 * which is what the default below pins.
 */
import { describe, expect, it } from 'vitest'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

import { renderComponent } from './render'

function overlayOf(overlayClassName?: string) {
  renderComponent(
    <AlertDialog open>
      <AlertDialogContent overlayClassName={overlayClassName}>
        <AlertDialogTitle>Title</AlertDialogTitle>
        <AlertDialogDescription>Body</AlertDialogDescription>
      </AlertDialogContent>
    </AlertDialog>,
  )
  return document.querySelector('[data-slot="alert-dialog-overlay"]')!.className.split(/\s+/)
}

describe('the alert dialog overlay', () => {
  it('keeps its blur by default', () => {
    expect(overlayOf()).toContain('supports-backdrop-filter:backdrop-blur-xs')
  })

  it('takes a dialog’s own adjustment', () => {
    const classes = overlayOf('supports-backdrop-filter:backdrop-blur-none')
    expect(classes).toContain('supports-backdrop-filter:backdrop-blur-none')
    expect(classes).not.toContain('supports-backdrop-filter:backdrop-blur-xs')
  })
})
