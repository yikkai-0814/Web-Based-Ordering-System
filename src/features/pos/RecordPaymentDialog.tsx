import { useState } from 'react'
import { AlertCircle, Wallet } from 'lucide-react'

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
import { changeDue } from '@/features/pos/cart'
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@/features/pos/types'
import { CURRENCY_PREFIX, formatMoney, parsePriceInput } from '@/lib/money'

/**
 * Taking money for an order that has already been placed.
 *
 * Cash is the only method with arithmetic behind it; e-wallet is recorded as a label, with
 * no gateway — the system never learns whether the transfer actually succeeded, so the
 * person at the till is the one confirming that.
 *
 * A plain confirm button rather than `AlertDialogAction`, for the same reason as
 * `VoidOrderDialog`: the dialog has to stay open when a tendered amount is refused, and
 * `AlertDialogAction` closes on click, which would swallow the message before it was read.
 */
export function RecordPaymentDialog({
  orderNumber,
  total,
  onConfirm,
}: {
  orderNumber: number
  total: number
  onConfirm: (method: PaymentMethod, cashTendered: number | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [tenderText, setTenderText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Live change preview, meaningful only once the entry parses to a sufficient amount.
  const parsedTender = tenderText.trim() === '' ? null : parsePriceInput(tenderText)
  const preview = method === 'cash' && parsedTender?.ok ? changeDue(total, parsedTender.sen) : null

  function reset(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setMethod('cash')
      setTenderText('')
      setError(null)
    }
  }

  async function submit(chosen: PaymentMethod, cashTendered: number | null) {
    setError(null)
    setPending(true)
    try {
      await onConfirm(chosen, cashTendered)
      reset(false)
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'That payment could not be recorded.',
      )
    } finally {
      setPending(false)
    }
  }

  function handleConfirm() {
    if (method !== 'cash') {
      void submit(method, null)
      return
    }

    if (tenderText.trim() === '') {
      setError('Enter the amount received.')
      return
    }
    const parsed = parsePriceInput(tenderText)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    // Refused here so an under-payment never reaches Firestore; the rules check it again.
    const change = changeDue(total, parsed.sen)
    if (!change.ok) {
      setError(change.error)
      return
    }
    void submit('cash', parsed.sen)
  }

  return (
    <AlertDialog open={open} onOpenChange={reset}>
      <AlertDialogTrigger asChild>
        <Button size="lg" className="h-touch text-base" data-testid="record-payment">
          <Wallet aria-hidden="true" />
          Record Payment
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Record payment for order #{orderNumber}</AlertDialogTitle>
          <AlertDialogDescription>
            This marks the order paid. It cannot be undone or changed afterwards, so check the
            amount before confirming.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="flex items-baseline gap-3 rounded-lg border px-3 py-2">
            <span className="text-sm text-muted-foreground">Order total</span>
            <span
              className="ml-auto text-2xl font-semibold tabular-nums"
              data-testid="payment-total"
            >
              {formatMoney(total)}
            </span>
          </div>

          <div className="grid gap-2">
            <Label>Payment method</Label>
            <div className="flex gap-2" role="group" aria-label="Payment method">
              {PAYMENT_METHODS.map((candidate) => (
                <Button
                  key={candidate}
                  type="button"
                  variant={method === candidate ? 'default' : 'outline'}
                  size="lg"
                  className="h-touch flex-1 text-base"
                  aria-pressed={method === candidate}
                  data-testid={`payment-${candidate}`}
                  onClick={() => {
                    setMethod(candidate)
                    setError(null)
                  }}
                  disabled={pending}
                >
                  {PAYMENT_LABELS[candidate]}
                </Button>
              ))}
            </div>
          </div>

          {method === 'cash' ? (
            <div className="grid gap-2">
              <Label htmlFor="cash-received">Cash received ({CURRENCY_PREFIX})</Label>
              <Input
                id="cash-received"
                inputMode="decimal"
                placeholder={formatMoney(total).replace(`${CURRENCY_PREFIX} `, '')}
                className="h-touch text-base"
                value={tenderText}
                onChange={(event) => setTenderText(event.target.value)}
                disabled={pending}
                autoFocus
              />
              <div className="flex items-baseline gap-2 text-sm">
                <span className="text-muted-foreground">Change</span>
                <span
                  className="ml-auto text-lg font-semibold tabular-nums"
                  data-testid="payment-change"
                >
                  {preview?.ok ? formatMoney(preview.change) : '—'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Recorded only — no payment gateway is involved. Confirm once the transfer has been
              seen to succeed on the customer&rsquo;s phone.
            </p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button disabled={pending} data-testid="confirm-payment" onClick={handleConfirm}>
            {pending ? 'Recording…' : 'Confirm payment'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
