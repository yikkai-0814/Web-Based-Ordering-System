/**
 * Whether the desktop sidebar is showing labels or only icons.
 *
 * Per-device and per-browser, like the operator selection and the theme: it is a preference
 * about the screen somebody is working at, not about their account, and a manager collapsing
 * it on the office laptop should not narrow the till in the shop.
 *
 * Pure, so the "what does this stored value mean" question is settled and tested here rather
 * than inside a component.
 */
export const SIDEBAR_STORAGE_KEY = 'ordering-system.sidebar.collapsed'

/**
 * Reads the stored preference.
 *
 * Expanded unless the value says otherwise: a first visit, a cleared browser, or anything
 * unrecognisable should show the navigation in full rather than a column of unexplained
 * icons.
 */
export function parseCollapsed(raw: string | null | undefined): boolean {
  return raw === 'true'
}

export function serializeCollapsed(collapsed: boolean): string {
  return collapsed ? 'true' : 'false'
}
