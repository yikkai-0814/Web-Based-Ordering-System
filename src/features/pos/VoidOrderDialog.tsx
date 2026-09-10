import { useState } from 'react'
import { AlertCircle, Ban } from 'lucide-react'

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
import { validateVoidReason, VOID_REASON_MAX } from '@/features/pos/voids'
import { formatMoney } from '@/lib/money'

/**
 * Voiding is irreversible and reverses money, so it asks for a reason and says plainly that
 * it cannot be undone.
 *
 * Uses a plain confirm button rather than `AlertDialogAction`, because the dialog must stay
 * open when validation fails — `AlertDialogAction` closes on click, which would swallow the
 * error message before anyone read it.
 */
export function VoidOrderDialog({
  orderNumber,
  amount,
  onConfirm,
}: {
  orderNumber: number
  amount: number
  onConfirm: (reason: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function reset(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setReason('')
      setError(null)
    }
  }

  async function handleConfirm() {
    const validated = validateVoidReason(reason)
    if (!validated.ok) {
      setError(validated.error)
      return
    }

    setError(null)
    setPending(true)
    try {
      await onConfirm(validated.reason)
      reset(false)
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'That sale could not be voided.',
      )
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
          <AlertDialogTitle>Void order #{orderNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            This reverses {formatMoney(amount)} and <strong>cannot be undone</strong>. The sale
            itself stays on the record; this adds a permanent note that it was cancelled, with your
            name against it.
          </AlertDialogDescription>
        </AlertDialogHeader>

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

        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            data-testid="confirm-void"
            onClick={() => void handleConfirm()}
          >
            {pending ? 'Voiding…' : 'Void sale'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
