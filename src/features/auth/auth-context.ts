import type { Message } from '@/features/i18n/messages'
import { createContext } from 'react'
import type { User } from 'firebase/auth'

import type { AuthStatus, Role, UserProfile } from '@/features/auth/types'

export interface AuthContextValue {
  status: AuthStatus
  /** The Firebase credential. Present only once a profile has also been accepted. */
  user: User | null
  profile: UserProfile | null
  role: Role | null
  /**
   * Why the last session ended, when the app itself ended it — a missing profile
   * document or a deactivated account. The login screen shows this so the user is not
   * bounced back to a blank form with no explanation.
   */
  rejectionMessage: Message | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

/**
 * Kept in its own module so AuthProvider.tsx exports a component and nothing else,
 * which is what React Fast Refresh needs to hot-reload it cleanly.
 */
export const AuthContext = createContext<AuthContextValue | null>(null)
