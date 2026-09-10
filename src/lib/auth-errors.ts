import { FirebaseError } from 'firebase/app'

/**
 * Firebase auth error codes are not fit to show a cashier standing at a till. This maps
 * the ones a login screen can actually produce to plain language.
 *
 * Note that `auth/user-not-found`, `auth/wrong-password` and `auth/invalid-credential`
 * all map to the same sentence on purpose: telling an attacker which addresses have
 * accounts is a free user-enumeration oracle.
 */
const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That email or password is not correct.',
  'auth/invalid-email': 'That email or password is not correct.',
  'auth/user-not-found': 'That email or password is not correct.',
  'auth/wrong-password': 'That email or password is not correct.',
  'auth/missing-password': 'Please enter your password.',
  'auth/user-disabled': 'This account has been disabled. Ask an administrator for help.',
  'auth/too-many-requests':
    'Too many failed attempts. Wait a minute before trying again, or ask an administrator to reset the password.',
  'auth/network-request-failed': 'Cannot reach the server. Check the network connection.',
  'auth/internal-error': 'Something went wrong signing in. Please try again.',
}

const FALLBACK = 'Something went wrong signing in. Please try again.'

export function authErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    return MESSAGES[error.code] ?? FALLBACK
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return FALLBACK
}

/** Reasons the app itself refuses a session, after Firebase has accepted the credentials. */
export const NO_PROFILE_MESSAGE =
  'This account is not set up for the ordering system yet. Ask an administrator to finish creating it.'

export const INACTIVE_MESSAGE =
  'This account has been deactivated. Ask an administrator to reactivate it.'
