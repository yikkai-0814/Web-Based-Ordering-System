import type { Message } from '@/features/i18n/messages'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context'
import { parseUserProfile, type AuthStatus, type UserProfile } from '@/features/auth/types'
import { INACTIVE_MESSAGE, NO_PROFILE_MESSAGE } from '@/lib/auth-errors'
import { auth, db } from '@/lib/firebase'

interface AuthState {
  status: AuthStatus
  user: User | null
  profile: UserProfile | null
}

const INITIAL: AuthState = { status: 'loading', user: null, profile: null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(INITIAL)
  const [rejectionMessage, setRejectionMessage] = useState<Message | null>(null)

  // Holds the unsubscribe for the users/{uid} snapshot listener, which is torn down and
  // recreated every time the signed-in user changes.
  const unsubscribeProfile = useRef<(() => void) | null>(null)

  /** Ends a session the app will not accept, and records why for the login screen. */
  const rejectSession = useCallback(async (reason: Message) => {
    setRejectionMessage(reason)
    unsubscribeProfile.current?.()
    unsubscribeProfile.current = null
    await firebaseSignOut(auth)
    setState({ status: 'unauthenticated', user: null, profile: null })
  }, [])

  useEffect(() => {
    const stopAuthListener = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile.current?.()
      unsubscribeProfile.current = null

      if (!user) {
        setState({ status: 'unauthenticated', user: null, profile: null })
        return
      }

      setState({ status: 'loading', user, profile: null })

      // A live subscription rather than a one-off read: an admin flipping `active` to
      // false, or changing someone's role, then takes effect in the open session
      // instead of waiting for the next login.
      unsubscribeProfile.current = onSnapshot(
        doc(db, 'users', user.uid),
        (snapshot) => {
          if (!snapshot.exists()) {
            void rejectSession(NO_PROFILE_MESSAGE)
            return
          }

          const profile = parseUserProfile(user.uid, snapshot.data())
          if (!profile) {
            void rejectSession(NO_PROFILE_MESSAGE)
            return
          }
          if (!profile.active) {
            void rejectSession(INACTIVE_MESSAGE)
            return
          }

          setRejectionMessage(null)
          setState({ status: 'authenticated', user, profile })
        },
        () => {
          // The rules refused the read, so from the app's point of view this account
          // has no usable profile.
          void rejectSession(NO_PROFILE_MESSAGE)
        },
      )
    })

    return () => {
      stopAuthListener()
      unsubscribeProfile.current?.()
      unsubscribeProfile.current = null
    }
  }, [rejectSession])

  const signIn = useCallback(async (email: string, password: string) => {
    setRejectionMessage(null)
    await signInWithEmailAndPassword(auth, email.trim(), password)
    // The rest of the work — loading the profile and deciding whether to accept the
    // session — happens in the onAuthStateChanged listener above.
  }, [])

  const signOut = useCallback(async () => {
    setRejectionMessage(null)
    await firebaseSignOut(auth)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      profile: state.profile,
      role: state.profile?.role ?? null,
      rejectionMessage,
      signIn,
      signOut,
    }),
    [state, rejectionMessage, signIn, signOut],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
