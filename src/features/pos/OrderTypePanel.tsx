import { AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ORDER_TYPE_LABELS,
  ORDER_TYPES,
  TABLE_NUMBER_MAX,
  validateTableNumber,
  type OrderType,
} from '@/features/pos/order-type'

/**
 * How this order is being served.
 *
 * Presentational, like `CartPanel`: it holds no state and decides nothing. The till owns the
 * selection, and `validatePlacement` — not this component — is what gates the order.
 *
 * The table field exists **only for dine-in**. Hiding it rather than disabling it is
 * deliberate: a greyed-out box still invites a tap and still suggests a takeaway might want
 * a table, when the rules refuse that outright.
 */
export function OrderTypePanel({
  orderType,
  tableNumber,
  disabled,
  onOrderTypeChange,
  onTableNumberChange,
}: {
  orderType: OrderType
  tableNumber: string
  disabled: boolean
  onOrderTypeChange: (next: OrderType) => void
  onTableNumberChange: (next: string) => void
}) {
  // Shown only once something has actually been typed — an empty field on a fresh order is
  // not yet a mistake, and greeting the operator with an error would be nagging, not help.
  const typed = tableNumber.trim() !== ''
  const validation = validateTableNumber(tableNumber)
  const error = typed && !validation.ok ? validation.error : null

  return (
    <div className="space-y-3 border-t p-4">
      <div className="grid gap-2">
        <Label>Order type</Label>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Order type">
          {ORDER_TYPES.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              variant={orderType === candidate ? 'default' : 'outline'}
              size="lg"
              className="h-touch text-base"
              aria-pressed={orderType === candidate}
              data-testid={`order-type-${candidate}`}
              disabled={disabled}
              onClick={() => onOrderTypeChange(candidate)}
            >
              {ORDER_TYPE_LABELS[candidate]}
            </Button>
          ))}
        </div>
      </div>

      {orderType === 'dine_in' && (
        <div className="grid gap-2">
          <Label htmlFor="table-number">Table number</Label>
          <Input
            id="table-number"
            className="h-touch text-base"
            placeholder="e.g. 5 or A3"
            /* A convenience, not the guard — validateTableNumber and the rules are that. */
            maxLength={TABLE_NUMBER_MAX}
            autoComplete="off"
            autoCapitalize="characters"
            value={tableNumber}
            onChange={(event) => onTableNumberChange(event.target.value)}
            disabled={disabled}
            aria-invalid={error !== null}
          />
          {error && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
