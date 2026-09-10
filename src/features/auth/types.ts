import type { Timestamp } from 'firebase/firestore'

export const ROLES = ['admin', 'staff'] as const

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

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  staff: 'Staff',
}
