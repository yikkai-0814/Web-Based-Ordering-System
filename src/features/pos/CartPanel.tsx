import { useTranslation } from '@/features/i18n/useTranslation'
import { Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cartItemCount, cartTotal, lineTotal, type Cart } from '@/features/pos/cart'
import { describeModifiers } from '@/features/menu/modifiers'
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
  onIncrement: (lineId: string) => void
  onDecrement: (lineId: string) => void
  onRemove: (lineId: string) => void
  onClear: () => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const count = cartItemCount(cart)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3">
        <h2 className="font-heading font-medium">{t('cart.currentOrder')}</h2>
        <span
          className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
          data-testid="cart-count"
        >
          {t(count === 1 ? 'cart.itemsOne' : 'cart.itemsOther', { count })}
        </span>
        {cart.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onClear}
            disabled={disabled}
          >
            {t('cart.clear')}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <ShoppingBasket className="size-6 text-muted-foreground/70" aria-hidden="true" />
            <p className="text-sm font-medium">{t('cart.empty')}</p>
            <p className="text-sm text-muted-foreground">{t('cart.tapToAdd')}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {cart.map((line) => (
              <li
                key={line.lineId}
                className="flex items-center gap-2 px-4 py-3"
                data-testid="cart-line"
                data-item-name={line.name}
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{line.name}</span>
                  {/* What makes this line different from the same dish ordered another way.
                      Without it two lines of "Chicken Chop Rice" would look like a bug. */}
                  {line.modifiers.length > 0 && (
                    <span
                      className="block truncate text-xs text-foreground"
                      data-testid="cart-line-modifiers"
                    >
                      {describeModifiers(line.modifiers)}
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {t('cart.each', { price: formatMoney(line.unitPrice) })}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t('cart.removeOne', { name: line.name })}
                    onClick={() => onDecrement(line.lineId)}
                    disabled={disabled}
                  >
                    <Minus aria-hidden="true" />
                  </Button>
                  <span
                    className="w-8 text-center tabular-nums"
                    data-testid="line-quantity"
                    aria-label={t('cart.quantityOf', { name: line.name })}
                  >
                    {line.quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t('cart.addOne', { name: line.name })}
                    onClick={() => onIncrement(line.lineId)}
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
                  aria-label={t('cart.remove', { name: line.name })}
                  onClick={() => onRemove(line.lineId)}
                  disabled={disabled}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-baseline gap-3 border-t bg-muted/40 px-4 py-3">
        <span className="text-base font-medium">{t('common.total')}</span>
        <span
          className="ml-auto text-2xl font-semibold tabular-nums sm:text-3xl"
          data-testid="cart-total"
        >
          {formatMoney(cartTotal(cart))}
        </span>
      </div>
    </div>
  )
}
