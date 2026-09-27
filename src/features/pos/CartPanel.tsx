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
    /*
     * `min-h-0 flex-1` rather than `h-full`: inside the New Order column this panel has to be
     * able to be SHORTER than its lines, so that the list below scrolls and whatever follows
     * the panel keeps its place. At full height it pushed the service choice and Place order
     * out of the bottom of the column, where the column's rounded corners clipped them away.
     *
     * Also a size container, so each line lays itself out by the width this panel actually
     * has rather than by the width of the screen — see the line below.
     */
    // On a `short` screen the whole column scrolls instead, so this keeps its natural height.
    <div className="@container flex min-h-0 flex-1 flex-col short:flex-none">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-3">
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

      <div className="min-h-0 flex-1 overflow-y-auto short:overflow-visible">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <ShoppingBasket className="size-6 text-muted-foreground/70" aria-hidden="true" />
            <p className="text-sm font-medium">{t('cart.empty')}</p>
            <p className="text-sm text-muted-foreground">{t('cart.tapToAdd')}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {cart.map((line) => (
              /*
               * One row where the panel is at least 25rem wide, two rows where it is not.
               *
               * On one row the quantity, the line total and the delete button take a fixed
               * ~300px, and in a phone-width or tablet-portrait cart that left the name 14–84px
               * — often a single letter. Narrower than 25rem the line becomes two rows instead:
               * the name and the line total across the top, the quantity and delete beneath.
               * The DOM order, and so the reading and tab order, is the same in both.
               */
              <li
                key={line.lineId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 @[25rem]:grid-cols-[minmax(0,1fr)_auto_auto_auto] @[25rem]:gap-x-2"
                data-testid="cart-line"
                data-item-name={line.name}
              >
                <div className="col-start-1 row-start-1 min-w-0">
                  {/* Wraps on two rows, where it has the width to; truncates on one. */}
                  <span className="block font-medium wrap-break-word @[25rem]:truncate">
                    {line.name}
                  </span>
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

                <div className="col-start-1 row-start-2 flex items-center gap-1 @[25rem]:col-start-2 @[25rem]:row-start-1">
                  <Button
                    variant="outline"
                    size="icon"
                    // 40px rather than the 32px `icon` size: thumb-sized on a till, and still
                    // no taller than the name and price it sits beside.
                    className="size-10"
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
                    className="size-10"
                    aria-label={t('cart.addOne', { name: line.name })}
                    onClick={() => onIncrement(line.lineId)}
                    disabled={disabled}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </div>

                <span
                  className="col-start-2 row-start-1 w-20 text-right tabular-nums @[25rem]:col-start-3"
                  data-testid="line-total"
                >
                  {formatMoney(lineTotal(line))}
                </span>

                <Button
                  variant="ghost"
                  size="icon"
                  className="col-start-2 row-start-2 size-10 justify-self-end @[25rem]:col-start-4 @[25rem]:row-start-1"
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

      <div className="flex shrink-0 items-baseline gap-3 border-t bg-muted/40 px-4 py-3">
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
