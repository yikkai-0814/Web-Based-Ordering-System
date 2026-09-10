import { useState } from 'react'
import { AlertCircle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { changeDue } from '@/features/pos/cart'
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@/features/pos/types'
import { CURRENCY_PREFIX, formatMoney, parsePriceInput } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Payment capture. Cash is the only method that needs arithmetic; e-wallet is recorded as
 * a label, with no gateway behind it — the system never learns whether the transfer
 * actually succeeded, so the person at the till is the one confirming that.
 */
export function PaymentPanel({
  total,
  disabled,
  pending,
  onTakePayment,
}: {
  total: number
  disabled: boolean
  pending: boolean
  onTakePayment: (method: PaymentMethod, cashTendered: number | null) => void
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [tenderText, setTenderText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Live change preview. Only meaningful once the entry parses to a sufficient amount.
  const parsedTender = tenderText.trim() === '' ? null : parsePriceInput(tenderText)
  const preview = method === 'cash' && parsedTender?.ok ? changeDue(total, parsedTender.sen) : null

  function handleSubmit() {
    setError(null)

    if (method !== 'cash') {
      onTakePayment(method, null)
      return
    }

    if (tenderText.trim() === '') {
      setError('Enter the amount tendered.')
      return
    }
    const parsed = parsePriceInput(tenderText)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    const change = changeDue(total, parsed.sen)
    if (!change.ok) {
      setError(change.error)
      return
    }
    onTakePayment('cash', parsed.sen)
    setTenderText('')
  }

  return (
    <div className="space-y-4 border-t p-4">
      <div className="grid gap-2">
        <Label>Payment method</Label>
        <div className="flex gap-2" role="group" aria-label="Payment method">
          {PAYMENT_METHODS.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant={method === candidate ? 'default' : 'outline'}
              size="lg"
              className={cn('h-touch flex-1 text-base')}
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

      {method === 'cash' && (
        <div className="grid gap-2">
          <Label htmlFor="tendered">Amount tendered ({CURRENCY_PREFIX})</Label>
          <Input
            id="tendered"
            inputMode="decimal"
            placeholder={formatMoney(total).replace(`${CURRENCY_PREFIX} `, '')}
            className="h-touch text-base"
            value={tenderText}
            onChange={(event) => setTenderText(event.target.value)}
            disabled={pending}
          />
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted-foreground">Change due</span>
            <span className="ml-auto text-lg font-semibold tabular-nums" data-testid="change-due">
              {preview?.ok ? formatMoney(preview.change) : '—'}
            </span>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        type="button"
        size="lg"
        className="h-touch-lg w-full text-lg"
        data-testid="take-payment"
        disabled={disabled || pending}
        onClick={handleSubmit}
      >
        {pending ? 'Saving…' : `Take payment · ${formatMoney(total)}`}
      </Button>
    </div>
  )
}
