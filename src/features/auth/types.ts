import { message, type Message } from '@/features/i18n/messages'
import type { TranslationKey } from '@/features/i18n/translations/en'
import type { Timestamp } from 'firebase/firestore'

export const ROLES = ['admin', 'staff'] as const

/** Mirrored in firestore.rules; keep the two in step. */
export const DISPLAY_NAME_MAX = 60

export type Role = (typeof ROLES)[number]

/** The shape of a `users/{uid}` document. Created by an admin, never by the app. */
export interface UserProfile {
  uid: string
  email: string
  displayName: string
  role: Role
  active: boolean
  createdAt: Timestamp | null
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/**
 * Firestore documents are untyped at the wire level, so a profile is validated before
 * the app trusts it. A malformed document is treated exactly like a missing one: the
 * user is signed out rather than defaulted to some role.
 */
export function parseUserProfile(uid: string, data: Record<string, unknown>): UserProfile | null {
  const { email, displayName, role, active, createdAt } = data

  if (!isRole(role)) return null
  if (typeof active !== 'boolean') return null

  return {
    uid,
    email: typeof email === 'string' ? email : '',
    displayName: typeof displayName === 'string' && displayName ? displayName : 'Unnamed user',
    role,
    active,
    createdAt: (createdAt as Timestamp | undefined) ?? null,
  }
}

export type DisplayNameResult = { ok: true; name: string } | { ok: false; error: Message }

/**
 * The one field of their own profile a person may change.
 *
 * Pure, and the same shape as `validateStaffName`, for the same reason: the Settings form
 * and the security rules have to agree about what a usable name is, and the rule that
 * decides it should be testable without a browser or an emulator. This is not the control —
 * firestore.rules is — it is what stops the form sending a write that would be refused.
 */
export function validateDisplayName(input: string): DisplayNameResult {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, error: message('validation.displayNameRequired') }
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: message('validation.staffNameTooLong', { max: DISPLAY_NAME_MAX }) }
  }
  return { ok: true, name: trimmed }
}

export const ROLE_LABEL_KEYS: Record<Role, TranslationKey> = {
  admin: 'role.admin',
  staff: 'role.staff',
}
