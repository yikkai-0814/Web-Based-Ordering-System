import { useState } from 'react'
import { AlertCircle, Ban, ShieldCheck } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  validateManagerCredentials,
  validateVoidReason,
  VOID_REASON_MAX,
} from '@/features/pos/voids'
import { formatMoney } from '@/lib/money'

export interface ManagerCredentials {
  email: string
  password: string
}

/**
 * Voiding is irreversible and reverses money, so it asks for a reason and says plainly that
 * it cannot be undone.
 *
 * Two shapes, one dialog. An admin voids their own sale in a single step, exactly as before.
 * Anyone else gets a second step asking a manager to sign in — `requiresAuthorization` is
 * the only difference, and it is decided by the caller from the signed-in role.
 *
 * The credentials are held in component state for the moment it takes to use them, passed to
 * `onConfirm`, and cleared whenever the dialog closes — including when it closes because the
 * void succeeded. Nothing here decides whether they are a manager's; that is settled by
 * Firebase Auth and then by firestore.rules, which is the point of the design.
 *
 * Uses a plain confirm button rather than `AlertDialogAction`, because the dialog must stay
 * open when validation fails — `AlertDialogAction` closes on click, which would swallow the
 * error message before anyone read it.
 */
export function VoidOrderDialog({
  orderNumber,
  amount,
  requiresAuthorization,
  onConfirm,
}: {
  orderNumber: number
  amount: number
  requiresAuthorization: boolean
  onConfirm: (reason: string, credentials: ManagerCredentials | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'reason' | 'authorize'>('reason')
  const [reason, setReason] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function reset(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setStep('reason')
      setReason('')
      setEmail('')
      setPassword('')
      setError(null)
    }
  }

  /** Step one. For an admin this is the whole thing; for staff it opens the second step. */
  async function handleReasonStep() {
    const validated = validateVoidReason(reason)
    if (!validated.ok) {
      setError(validated.error)
      return
    }

    setError(null)

    if (requiresAuthorization) {
      setStep('authorize')
      return
    }

    await submit(validated.reason, null)
  }

  async function handleAuthorizeStep() {
    const validatedReason = validateVoidReason(reason)
    if (!validatedReason.ok) {
      // Cannot normally happen — step one checked it — but the reason is what gets written,
      // so it is re-validated rather than trusted because it passed a moment ago.
      setStep('reason')
      setError(validatedReason.error)
      return
    }

    const credentials = validateManagerCredentials(email, password)
    if (!credentials.ok) {
      setError(credentials.error)
      return
    }

    await submit(validatedReason.reason, {
      email: credentials.email,
      password: credentials.password,
    })
  }

  async function submit(validReason: string, credentials: ManagerCredentials | null) {
    setError(null)
    setPending(true)
    try {
      await onConfirm(validReason, credentials)
      reset(false)
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'That sale could not be voided.',
      )
      // Keep the reason so nothing has to be retyped, but never keep the password.
      setPassword('')
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={reset}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="lg"
          className="h-touch text-base"
          data-testid="void-order"
        >
          <Ban aria-hidden="true" />
          Void sale
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {step === 'reason'
              ? `Void order #${orderNumber}?`
              : `Manager authorisation for order #${orderNumber}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {step === 'reason' ? (
              <>
                This reverses {formatMoney(amount)} and <strong>cannot be undone</strong>. The sale
                itself stays on the record; this adds a permanent note that it was cancelled, with
                your name against it.
              </>
            ) : (
              <>
                A manager must sign in to approve this. Their name is recorded as having authorised
                it, and yours as having requested it. They are <strong>not</strong> signed in to the
                till — your session stays exactly as it is.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {step === 'reason' ? (
          <div className="grid gap-2">
            <Label htmlFor="void-reason">Reason</Label>
            <Input
              id="void-reason"
              className="h-touch text-base"
              placeholder="e.g. Wrong item rung up"
              maxLength={VOID_REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={pending}
              autoFocus
            />
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="manager-email">Manager email</Label>
              <Input
                id="manager-email"
                type="email"
                autoComplete="off"
                className="h-touch text-base"
                data-testid="manager-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manager-password">Manager password</Label>
              <Input
                id="manager-password"
                type="password"
                autoComplete="off"
                className="h-touch text-base"
                data-testid="manager-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
              />
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {step === 'reason' ? (
            <Button
              variant="destructive"
              disabled={pending}
              data-testid={requiresAuthorization ? 'continue-void' : 'confirm-void'}
              onClick={() => void handleReasonStep()}
            >
              {requiresAuthorization ? (
                <>
                  <ShieldCheck aria-hidden="true" />
                  Continue
                </>
              ) : pending ? (
                'Voiding…'
              ) : (
                'Void sale'
              )}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={pending}
              data-testid="confirm-void"
              onClick={() => void handleAuthorizeStep()}
            >
              {pending ? 'Voiding…' : 'Authorise and void'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
