import { Minus, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cartItemCount, cartTotal, lineTotal, type Cart } from '@/features/pos/cart'
import { formatMoney } from '@/lib/money'

export function CartPanel({
  cart,
  onIncrement,
  onDecrement,
  onRemove,
  onClear,
  disabled = false,
}: {
  cart: Cart
  onIncrement: (menuItemId: string) => void
  onDecrement: (menuItemId: string) => void
  onRemove: (menuItemId: string) => void
  onClear: () => void
  disabled?: boolean
}) {
  const count = cartItemCount(cart)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="font-medium">Current order</h2>
        <span className="text-sm text-muted-foreground" data-testid="cart-count">
          {count === 1 ? '1 item' : `${count} items`}
        </span>
        {cart.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onClear}
            disabled={disabled}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No items yet. Tap an item to add it.</p>
        ) : (
          <ul className="divide-y">
            {cart.map((line) => (
              <li
                key={line.menuItemId}
                className="flex items-center gap-2 px-4 py-3"
                data-testid="cart-line"
                data-item-name={line.name}
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{line.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatMoney(line.unitPrice)} each
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Remove one ${line.name}`}
                    onClick={() => onDecrement(line.menuItemId)}
                    disabled={disabled}
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <span
                    className="w-8 text-center tabular-nums"
                    data-testid="line-quantity"
                    aria-label={`Quantity of ${line.name}`}
                  >
                    {line.quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Add one ${line.name}`}
                    onClick={() => onIncrement(line.menuItemId)}
                    disabled={disabled}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </div>

                <span className="w-20 text-right tabular-nums" data-testid="line-total">
                  {formatMoney(lineTotal(line))}
                </span>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${line.name} from the order`}
                  onClick={() => onRemove(line.menuItemId)}
                  disabled={disabled}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-baseline gap-3 border-t px-4 py-3">
        <span className="text-base font-medium">Total</span>
        <span className="ml-auto text-2xl font-semibold tabular-nums" data-testid="cart-total">
          {formatMoney(cartTotal(cart))}
        </span>
      </div>
    </div>
  )
}
