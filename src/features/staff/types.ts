import type { Timestamp } from 'firebase/firestore'

/** Mirrored in firestore.rules; keep the two in step. */
export const STAFF_NAME_MAX = 60

/**
 * A named person who operates the till.
 *
 * Deliberately **not** a Firebase account. A food stall shares one device and one login
 * across a shift; giving every worker email/password credentials is impractical and was
 * ruled out. A staff identity answers "who rang this up", nothing more — it carries no
 * permissions of its own, and the signed-in Firebase role remains the only authorisation
 * boundary.
 *
 * There is no deletion. Inactive members drop out of the till's picker but stay available
 * to explain past orders, and a record that history points at should not be removable by
 * accident.
 */
export interface StaffMember {
  id: string
  name: string
  active: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

export function parseStaffMember(id: string, data: Record<string, unknown>): StaffMember | null {
  const { name, active, createdAt, updatedAt } = data

  if (typeof name !== 'string' || name.trim() === '') return null
  if (name.length > STAFF_NAME_MAX) return null
  if (typeof active !== 'boolean') return null

  return {
    id,
    name,
    active,
    createdAt: (createdAt as Timestamp | undefined) ?? null,
    updatedAt: (updatedAt as Timestamp | undefined) ?? null,
  }
}

export function byName(a: StaffMember, b: StaffMember): number {
  return a.name.localeCompare(b.name)
}

export type StaffNameResult = { ok: true; name: string } | { ok: false; error: string }

export function validateStaffName(input: string): StaffNameResult {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, error: 'Enter a name for this staff member.' }
  if (trimmed.length > STAFF_NAME_MAX) {
    return { ok: false, error: `Names can be at most ${STAFF_NAME_MAX} characters.` }
  }
  return { ok: true, name: trimmed }
}
