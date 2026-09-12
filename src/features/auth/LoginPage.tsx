import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { AlertCircle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { landingPathFor } from '@/components/layout/nav-items'
import { useAuth } from '@/features/auth/useAuth'
import { authErrorMessage } from '@/lib/auth-errors'

/** Deliberately minimal — one form does not justify a form library. */
function validate(email: string, password: string): string | null {
  if (!email.trim()) return 'Please enter your email address.'
  if (!email.includes('@')) return 'That does not look like an email address.'
  if (!password) return 'Please enter your password.'
  return null
}

interface LocationState {
  from?: { pathname?: string }
}

export function LoginPage() {
  const { status, role, signIn, rejectionMessage } = useAuth()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Where RequireAuth wanted to go before it detoured through here. Falling back to the
  // role's own landing page rather than a fixed one, so a staff member who simply signed in
  // arrives at New Order — while a deep link they actually asked for still wins.
  const from = (location.state as LocationState | null)?.from?.pathname ?? landingPathFor(role)

  if (status === 'authenticated') {
    return <Navigate to={from} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validate(email, password)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setPending(true)
    try {
      await signIn(email, password)
      // On success the auth listener flips `status`, and the redirect above takes over.
    } catch (caught) {
      setError(authErrorMessage(caught))
      setPassword('')
    } finally {
      setPending(false)
    }
  }

  // A form error takes precedence; otherwise show why the previous session was ended.
  const message = error ?? rejectionMessage

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            Accounts are created by an administrator. There is no self-service sign-up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void handleSubmit(event)} noValidate className="grid gap-4">
            {message && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                className="h-touch text-base"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="h-touch text-base"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
              />
            </div>

            <Button type="submit" size="lg" className="h-touch w-full text-base" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
