import { FirebaseError } from 'firebase/app'

import { message, type Message } from '@/features/i18n/messages'
import type { TranslationKey } from '@/features/i18n/translations/en'

/**
 * Firebase auth error codes are not fit to show a cashier standing at a till. This maps the
 * ones a login screen can actually produce to a message the interface can say in whatever
 * language it is set to.
 *
 * Note that `auth/user-not-found`, `auth/wrong-password` and `auth/invalid-credential` all
 * map to the same sentence on purpose: telling an attacker which addresses have accounts is
 * a free user-enumeration oracle.
 */
const CODES: Record<string, TranslationKey> = {
  'auth/invalid-credential': 'auth.error.invalidCredential',
  'auth/invalid-email': 'auth.error.invalidCredential',
  'auth/user-not-found': 'auth.error.invalidCredential',
  'auth/wrong-password': 'auth.error.invalidCredential',
  'auth/missing-password': 'auth.error.missingPassword',
  'auth/user-disabled': 'auth.error.userDisabled',
  'auth/too-many-requests': 'auth.error.tooManyRequests',
  'auth/network-request-failed': 'auth.error.networkRequestFailed',
  'auth/internal-error': 'auth.error.internal',
}

const FALLBACK: TranslationKey = 'auth.error.internal'

export function authErrorMessage(error: unknown): Message {
  if (error instanceof FirebaseError) {
    return message(CODES[error.code] ?? FALLBACK)
  }
  return message(FALLBACK)
}

/** Reasons the app itself refuses a session, after Firebase has accepted the credentials. */
export const NO_PROFILE_MESSAGE: Message = message('auth.error.noProfile')

export const INACTIVE_MESSAGE: Message = message('auth.error.inactive')
