import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/useAuth'
import { StaffPicker } from '@/features/staff/StaffPicker'
import { useStaffSession } from '@/features/staff/useStaffSession'
import { useCategories } from '@/features/menu/useCategories'
import { useMenuItems } from '@/features/menu/useMenuItems'
import { bySortOrderThenName, type MenuItem } from '@/features/menu/types'
import { CartPanel } from '@/features/pos/CartPanel'
import { OrderTypePanel } from '@/features/pos/OrderTypePanel'
import { orderTypeSummaryOf, validatePlacement, type OrderType } from '@/features/pos/order-type'
import { Button } from '@/components/ui/button'
import {
  addToCart,
  cartTotal,
  clearCart,
  decrementLine,
  EMPTY_CART,
  incrementLine,
  removeLine,
  validateCart,
  type Cart,
} from '@/features/pos/cart'
import { createOrder } from '@/features/pos/pos-api'
import { formatMoney } from '@/lib/money'

export function TerminalPage() {
  const { profile } = useAuth()
  const { operator, loading: staffLoading } = useStaffSession()
  const { categories, loading: categoriesLoading } = useCategories()
  const { items, loading: itemsLoading, error: itemsError } = useMenuItems()

  const [cart, setCart] = useState<Cart>(EMPTY_CART)
  /**
   * Dine-in by default, deliberately.
   *
   * A dine-in order cannot be placed until somebody types a table number, so a forgotten
   * toggle *blocks*. Defaulting to takeaway would do the opposite: a dine-in order rung up
   * without anyone touching this would sail through and be silently mis-recorded, and
   * orders are immutable, so it could only be fixed by voiding and ringing it again.
   */
  const [orderType, setOrderType] = useState<OrderType>('dine_in')
  const [tableNumber, setTableNumber] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastOrder, setLastOrder] = useState<{
    number: number
    total: number
    service: string
  } | null>(null)

  // Only what is actually for sale: archived items and hidden categories never reach the
  // till, so staff cannot ring up something the café has taken off the menu.
  const groups = useMemo(() => {
    const sellable = items.filter((item) => item.active)
    const visibleCategories = categories.filter((category) => category.active)

    return visibleCategories
      .map((category) => ({
        category,
        items: sellable.filter((item) => item.categoryId === category.id).sort(bySortOrderThenName),
      }))
      .filter((group) => group.items.length > 0)
  }, [categories, items])

  const total = cartTotal(cart)
  // Both halves of the gate: a valid cart, and a settled answer to how it is served.
  const placement = validatePlacement(orderType, tableNumber)
  const canPlace = validateCart(cart).ok && placement.ok

  function addItem(item: MenuItem) {
    setLastOrder(null)
    setError(null)
    setCart((current) =>
      addToCart(current, {
        menuItemId: item.id,
        name: item.name,
        unitPrice: item.price,
      }),
    )
  }

  /**
   * Places the order **unpaid**. The customer is not asked to pay here — they pay when they
   * collect, and whoever is on the till records it from the order's page then.
   */
  async function placeOrder() {
    if (!profile || !operator || !placement.ok) return
    setPending(true)
    setError(null)
    try {
      const created = await createOrder({
        cart,
        placement: { orderType, tableNumber },
        user: { uid: profile.uid, displayName: profile.displayName },
        staff: { id: operator.id, name: operator.name },
      })
      const service = orderTypeSummaryOf({
        orderType: placement.orderType,
        tableNumber: placement.tableNumber,
      })
      // Straight back to an empty cart — the next customer is already waiting.
      setCart(clearCart())
      // Back to the default too. Carrying "Table 5" into the next customer's order is
      // exactly the silent wrong-data failure this is here to prevent, and it would be
      // invisible because the field looks the same either way.
      setOrderType('dine_in')
      setTableNumber('')
      setLastOrder({ number: created.number, total, service })
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'That order could not be saved. Please try again.',
      )
    } finally {
      setPending(false)
    }
  }

  if (categoriesLoading || itemsLoading || staffLoading) {
    return <Skeleton className="h-[70vh] w-full" />
  }

  // Nothing can be rung up until somebody says who is on the till. The same check the
  // rules enforce server-side, surfaced here so the failure never reaches the counter.
  if (!operator) {
    return <StaffPicker />
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_26rem]">
      <section className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Till</h1>
          <p className="text-muted-foreground">Tap an item to add it to the order.</p>
        </div>

        {itemsError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{itemsError}</AlertDescription>
          </Alert>
        )}

        {groups.length === 0 && (
          <p className="text-muted-foreground">
            Nothing is available for sale. An administrator needs to add menu items, or make
            existing ones available.
          </p>
        )}

        {groups.map(({ category, items: groupItems }) => (
          <div key={category.id} className="space-y-2">
            <h2 className="text-lg font-medium">{category.name}</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {groupItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid="pos-item"
                  data-item-name={item.name}
                  onClick={() => addItem(item)}
                  disabled={pending}
                  className="flex h-touch-lg flex-col justify-center rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                >
                  <span className="line-clamp-2 text-sm font-medium">{item.name}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatMoney(item.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <aside className="flex min-h-[24rem] flex-col rounded-lg border bg-card lg:sticky lg:top-4 lg:h-[calc(100svh-6rem)]">
        {lastOrder && (
          <Alert className="m-4 mb-0" data-testid="order-confirmation">
            <CheckCircle2 aria-hidden="true" />
            <AlertDescription>
              Order #{lastOrder.number} placed · {formatMoney(lastOrder.total)} ·{' '}
              {/* Echoes what was actually written, so the operator confirms the service
                  details rather than assuming them. */}
              <span data-testid="confirmation-service">{lastOrder.service}</span> ·{' '}
              <span className="font-semibold">unpaid</span>. Record payment from the Orders page
              once the customer has paid.
            </AlertDescription>
          </Alert>
        )}

        <CartPanel
          cart={cart}
          disabled={pending}
          onIncrement={(id) => setCart((current) => incrementLine(current, id))}
          onDecrement={(id) => setCart((current) => decrementLine(current, id))}
          onRemove={(id) => setCart((current) => removeLine(current, id))}
          onClear={() => setCart(clearCart())}
        />

        {error && (
          <Alert variant="destructive" className="mx-4">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <OrderTypePanel
          orderType={orderType}
          tableNumber={tableNumber}
          disabled={pending}
          onOrderTypeChange={(next) => {
            setOrderType(next)
            // The typed table number is KEPT when switching to takeaway. It is simply never
            // written, and the field is visible again the moment dine-in is reselected — so
            // nothing is hidden, and a mis-tap does not destroy what was typed. It is
            // cleared on success, so it can never outlive the order it was typed for.
            setLastOrder(null)
            setError(null)
          }}
          onTableNumberChange={(next) => {
            setTableNumber(next)
            setLastOrder(null)
            setError(null)
          }}
        />

        {/* Placing the order is the only action here. Payment is a separate step, taken on
            the order's own page after the customer has collected and paid. */}
        <div className="space-y-2 border-t p-4">
          <Button
            type="button"
            size="lg"
            className="h-touch-lg w-full text-lg"
            data-testid="place-order"
            disabled={!canPlace || pending}
            onClick={() => void placeOrder()}
          >
            {pending ? 'Saving…' : `Place order · ${formatMoney(total)}`}
          </Button>
          {/* Never leave a dead button unexplained: when the gate is service rather than the
              cart, say which. */}
          <p className="text-center text-xs text-muted-foreground">
            {!placement.ok && cart.length > 0
              ? placement.error
              : 'The order is created unpaid. Payment is recorded separately.'}
          </p>
        </div>
      </aside>
    </div>
  )
}
