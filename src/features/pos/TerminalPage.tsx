import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/useAuth'
import { useCategories } from '@/features/menu/useCategories'
import { useMenuItems } from '@/features/menu/useMenuItems'
import { bySortOrderThenName, type MenuItem } from '@/features/menu/types'
import { CartPanel } from '@/features/pos/CartPanel'
import { PaymentPanel } from '@/features/pos/PaymentPanel'
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
import type { PaymentMethod } from '@/features/pos/types'
import { formatMoney } from '@/lib/money'

export function TerminalPage() {
  const { profile } = useAuth()
  const { categories, loading: categoriesLoading } = useCategories()
  const { items, loading: itemsLoading, error: itemsError } = useMenuItems()

  const [cart, setCart] = useState<Cart>(EMPTY_CART)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastOrder, setLastOrder] = useState<{ number: number; total: number } | null>(null)

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
  const canPay = validateCart(cart).ok

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

  async function takePayment(method: PaymentMethod, cashTendered: number | null) {
    if (!profile) return
    setPending(true)
    setError(null)
    try {
      const created = await createOrder({
        cart,
        paymentMethod: method,
        cashTendered,
        user: { uid: profile.uid, displayName: profile.displayName },
      })
      // Straight back to an empty cart — the next customer is already waiting.
      setCart(clearCart())
      setLastOrder({ number: created.number, total })
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : 'That sale could not be saved. Please try again.',
      )
    } finally {
      setPending(false)
    }
  }

  if (categoriesLoading || itemsLoading) {
    return <Skeleton className="h-[70vh] w-full" />
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
              Order #{lastOrder.number} saved · {formatMoney(lastOrder.total)}
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

        <PaymentPanel
          total={total}
          disabled={!canPay}
          pending={pending}
          onTakePayment={(method, tendered) => void takePayment(method, tendered)}
        />
      </aside>
    </div>
  )
}
