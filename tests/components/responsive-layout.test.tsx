// @vitest-environment jsdom
/**
 * The responsive contracts that are structural rather than visual.
 *
 * jsdom applies no Tailwind and computes no layout, so nothing here can assert a pixel. What
 * it CAN assert is the set of class contracts the layout depends on — the ones that were
 * found missing in an audit and whose absence is silent until somebody opens the app on a
 * short window or a narrow phone. Each is written as "this is why it is here", so a future
 * edit that drops one fails with a reason rather than a diff.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderComponent } from './render'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: 'admin', profile: { uid: 'u1', role: 'admin' } }),
}))
vi.mock('@/features/staff/useStaffMembers', () => ({
  useStaffMembers: () => ({
    staff: [{ id: 's1', name: 'Alice', active: true, createdAt: null }],
    loading: false,
    error: null,
  }),
}))
vi.mock('@/features/staff/staff-api', () => ({
  createStaffMember: vi.fn(),
  renameStaffMember: vi.fn(),
  setStaffActive: vi.fn(),
}))

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { StaffListPage } from '@/features/staff/StaffListPage'

/**
 * Every dialog in the application is this one primitive, so the viewport rules belong to it
 * rather than to each of the six places it is used.
 *
 * The height pair is the one that actually strands a user: the content is `fixed` and centred
 * with a translate, so a dialog taller than the window has no scrollbar of its own and no page
 * scroll to fall back on — its footer buttons simply cannot be reached. That is hit by a
 * landscape phone and a short laptop window long before it is hit by a narrow one.
 */
describe('a dialog always fits the window it opens in', () => {
  function renderDialog(className?: string) {
    renderComponent(
      <AlertDialog open>
        <AlertDialogContent className={className} data-testid="dialog">
          <AlertDialogTitle>Title</AlertDialogTitle>
          <AlertDialogDescription>Body</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    )
    return screen.getByTestId('dialog')
  }

  it('can scroll inside itself when it is taller than the viewport', () => {
    const dialog = renderDialog()

    expect(dialog.className).toContain('max-h-[calc(100svh-2rem)]')
    expect(dialog.className).toContain('overflow-y-auto')
  })

  it('leaves a gutter at each edge rather than meeting them', () => {
    // `w-full` on a translate-centred box met both edges of a narrow phone exactly.
    const dialog = renderDialog()

    expect(dialog.className).toContain('w-[calc(100%-2rem)]')
    expect(dialog.className).not.toMatch(/(^|\s)w-full(\s|$)/)
  })

  it('still lets one dialog choose its own ceiling', () => {
    // The customisation dialog asks for 85svh because it holds a list. `cn` resolves the
    // conflict in the caller's favour, which is what makes the default safe to set at all.
    const dialog = renderDialog('max-h-[85svh]')

    expect(dialog.className).toContain('max-h-[85svh]')
    expect(dialog.className).not.toContain('max-h-[calc(100svh-2rem)]')
  })
})

/**
 * The admin tables.
 *
 * Each declares fixed widths for its status and action columns. Below the sum of those a
 * browser takes the space back from them, and editable controls start wrapping into each
 * other — so the table states the width it needs and its own container scrolls, which is the
 * answer Orders and Reports already gave. The page itself never scrolls sideways: `main` is
 * `min-w-0` and the scroll happens in the table's container.
 */
describe('a data table asks for the width its columns need', () => {
  it('is declared on the staff roster', () => {
    renderComponent(<StaffListPage />)

    const table = document.querySelector('[data-slot="table"]')
    expect(table?.className).toContain('min-w-')
    // The scroll belongs to the table's own container, never to the page.
    expect(table?.closest('[data-slot="table-container"]')?.className).toContain('overflow-x-auto')
  })
})
