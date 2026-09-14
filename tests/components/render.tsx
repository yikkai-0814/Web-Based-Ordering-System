import type { ReactElement, ReactNode } from 'react'

import { cleanup, render, type RenderResult } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel, type UserEvent } from '@testing-library/user-event'
import { afterEach } from 'vitest'

import { LanguageProvider } from '@/features/i18n/LanguageProvider'

/**
 * The one way this suite puts a component on screen.
 *
 * Two chores live here rather than in every file. The first is teardown: React Testing
 * Library only unmounts automatically when Vitest's globals are enabled, and they are not —
 * so without this `afterEach`, a dialog opened by one test would still be in the document
 * during the next one. Importing this module is what registers it, and every test file
 * imports it because every test file needs `renderComponent`.
 *
 * The second is the pointer-events escape hatch below.
 */
afterEach(cleanup)

export interface RenderedComponent extends RenderResult {
  user: UserEvent
}

export function renderComponent(ui: ReactElement): RenderedComponent {
  const user = userEvent.setup({
    /**
     * Radix sets `pointer-events: none` on `<body>` while a modal dialog is open, so that
     * the page behind it cannot be clicked. user-event reads that as "this element is not
     * clickable" and throws — on the very buttons inside the dialog that a person clicks
     * perfectly well, because jsdom has no layout and cannot see that the dialog itself is
     * on top.
     *
     * Turning the check off is the accepted fix for Radix under jsdom. It costs the ability
     * to catch a genuinely unclickable element, which is a visual-layout concern this suite
     * was never able to judge anyway.
     */
    pointerEventsCheck: PointerEventsCheckLevel.Never,
  })

  /**
   * Wrapped in the language provider because `t` is now how every component gets its words,
   * and a component rendered outside it throws. English is the default and no test changes
   * it, so every assertion on English text means exactly what it did before.
   */
  const rendered = render(<LanguageProvider>{ui}</LanguageProvider>)
  return {
    user,
    ...rendered,
    // Re-rendering has to keep the provider, or the component throws on its second render.
    rerender: (next: ReactNode) => rendered.rerender(<LanguageProvider>{next}</LanguageProvider>),
  }
}
