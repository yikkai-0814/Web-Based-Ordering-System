import { isMessageError, message, type Message } from '@/features/i18n/messages'
import { useTranslation } from '@/features/i18n/useTranslation'
import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, CupSoda } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/data/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/useAuth'
import { StaffPicker } from '@/features/staff/StaffPicker'
import { useStaffSession } from '@/features/staff/useStaffSession'
import { useCategories } from '@/features/menu/useCategories'
import { useMenuItems } from '@/features/menu/useMenuItems'
import { bySortOrderThenName, type MenuItem } from '@/features/menu/types'
import { offeredGroupsFor, type SelectedModifier } from '@/features/menu/modifiers'
import { useModifierGroups } from '@/features/menu/useModifierGroups'
import { ItemCustomisationDialog } from '@/features/pos/ItemCustomisationDialog'
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

interface PlacedOrder {
  number: number
  total: number
  service: Message
}

/**
 * What was just written, shown on the screen that asks who is making the next order.
 *
 * It reports the order the counter has finished with, at the moment the counter is starting
 * the next one — which is where the person standing there is actually looking.
 */
function OrderPlacedAlert({ order }: { order: PlacedOrder }) {
  const { t } = useTranslation()
  return (
    <Alert className="mx-auto max-w-2xl" data-testid="order-confirmation">
      <CheckCircle2 aria-hidden="true" />
      {/* Echoes what was actually written, so the operator confirms the service details
          rather than assuming them. */}
      <AlertDescription data-testid="confirmation-service">
        {t('terminal.placedBanner', {
          number: order.number,
          total: formatMoney(order.total),
          service: t(order.service),
        })}
      </AlertDescription>
    </Alert>
  )
}

export function TerminalPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { operator, loading: staffLoading } = useStaffSession()
  const { categories, loading: categoriesLoading } = useCategories()
  const { items, loading: itemsLoading, error: itemsError } = useMenuItems()

  const [cart, setCart] = useState<Cart>(EMPTY_CART)
  /** The item whose customisation dialog is open, if any. */
  const [customising, setCustomising] = useState<MenuItem | null>(null)
  const { groups: modifierGroups } = useModifierGroups()
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
  /**
   * Whether somebody has said who is making **this** order.
   *
   * Per order, not per shift, and deliberately so: two people share one counter, and the
   * one who took the last order is not necessarily taking the next. Defaulting to the
   * previous name would put one person's sale under another's — permanently, since orders
   * are immutable — and it would do it silently, which is the worst kind of wrong.
   *
   * The persisted selection from Phase 13 is still what STORES the answer (uid-scoped, so
   * another account can never inherit it). It is simply not treated as an answer to a
   * question nobody has asked yet.
   */
  const [operatorChosen, setOperatorChosen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Message | null>(null)
  const [lastOrder, setLastOrder] = useState<PlacedOrder | null>(null)

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

  /**
   * Puts one of an item, configured, into the order.
   *
   * `addToCart` decides whether that is a new line or one more of an existing one: the same
   * item with the same options merges, the same item made differently does not.
   */
  function addConfigured(item: MenuItem, modifiers: SelectedModifier[]) {
    setLastOrder(null)
    setError(null)
    setCart((current) =>
      addToCart(current, {
        menuItemId: item.id,
        name: item.name,
        basePrice: item.price,
        modifiers,
      }),
    )
  }

  /**
   * Tapping an item. Anything with a choice to make opens the customisation dialog first;
   * anything without one is still a single tap, which is what keeps the counter quick.
   */
  function addItem(item: MenuItem) {
    const groups = offeredGroupsFor(modifierGroups, item)
    if (groups.length > 0) {
      setCustomising(item)
      return
    }
    addConfigured(item, [])
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
      // And back to asking who is making the next one. The confirmation below travels with
      // it, so the order just placed is still reported on the screen that asks.
      setOperatorChosen(false)
      setLastOrder({ number: created.number, total, service })
    } catch (caught) {
      setError(isMessageError(caught) ? caught.detail : message('terminal.placeFailed'))
    } finally {
      setPending(false)
    }
  }

  if (categoriesLoading || itemsLoading || staffLoading) {
    return <Skeleton className="h-[70vh] w-full" />
  }

  // Nothing is rung up until somebody says who is making this order — asked at the start of
  // every order, not once a shift. `operator` may already hold the last person's name; that
  // is what the Topbar reports and what the other screens use, but it is not an answer here.
  if (!operator || !operatorChosen) {
    return (
      <div className="space-y-4">
        {lastOrder && <OrderPlacedAlert order={lastOrder} />}
        <StaffPicker
          heading="terminal.whoIsMaking"
          blurb="terminal.whoIsMakingBlurb"
          onSelected={() => {
            setOperatorChosen(true)
            // The previous order's confirmation belongs to the previous order.
            setLastOrder(null)
          }}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[1fr_24rem] xl:grid-cols-[1fr_26rem]">
      {customising && (
        <ItemCustomisationDialog
          item={customising}
          groups={offeredGroupsFor(modifierGroups, customising)}
          onCancel={() => setCustomising(null)}
          onAdd={(modifiers) => {
            addConfigured(customising, modifiers)
            setCustomising(null)
          }}
        />
      )}

      <section className="min-w-0 space-y-5">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('nav.newOrder')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('terminal.blurb')}</p>
        </div>

        {itemsError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{t(itemsError)}</AlertDescription>
          </Alert>
        )}

        {groups.length === 0 && (
          <EmptyState
            title={t('terminal.noItems')}
            description={t('terminal.noItemsBlurb')}
            icon={<CupSoda className="size-6" aria-hidden="true" />}
          />
        )}

        {groups.map(({ category, items: groupItems }) => (
          <div key={category.id} className="space-y-2">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {category.name}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {groupItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid="pos-item"
                  data-item-name={item.name}
                  onClick={() => addItem(item)}
                  disabled={pending}
                  className="flex h-touch-lg flex-col justify-center gap-0.5 rounded-xl border bg-card px-3 py-2 text-left shadow-xs transition-[box-shadow,border-color,background-color,transform] duration-100 hover:border-primary/40 hover:bg-primary/[0.04] hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] active:bg-primary/[0.08] disabled:opacity-50"
                >
                  <span className="line-clamp-2 text-sm leading-snug font-medium">{item.name}</span>
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {formatMoney(item.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* On a phone this sits below the menu in ordinary flow; from lg it becomes its own
          column and stays put while the menu scrolls. */}
      <aside className="flex min-h-96 min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs lg:sticky lg:top-4 lg:h-[calc(100svh-6rem)]">
        <CartPanel
          cart={cart}
          disabled={pending}
          onIncrement={(lineId) => setCart((current) => incrementLine(current, lineId))}
          onDecrement={(lineId) => setCart((current) => decrementLine(current, lineId))}
          onRemove={(lineId) => setCart((current) => removeLine(current, lineId))}
          onClear={() => setCart(clearCart())}
        />

        {error && (
          <Alert variant="destructive" className="mx-4">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{t(error)}</AlertDescription>
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
        {/*
         * Sticky below `lg`, so the total and the one action are reachable without scrolling
         * to the end of a long cart — and offset by the mobile nav's own height so the two
         * bottom-anchored things can never sit on top of each other. It is `sticky`, not
         * `fixed`: it stays inside this panel, cannot cover the menu or a dialog, and the
         * cart above it scrolls freely behind an opaque surface rather than being hidden by
         * it.
         */}
        <div className="sticky bottom-mobile-nav z-20 space-y-2 border-t bg-card p-4 lg:static">
          <div className="flex items-baseline justify-between gap-3 lg:hidden">
            <span className="text-sm text-muted-foreground">{t('common.total')}</span>
            <span className="text-xl font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>
          <Button
            type="button"
            size="lg"
            className="h-touch-lg w-full text-lg font-semibold shadow-xs transition-[box-shadow,transform] duration-100 hover:shadow-sm active:scale-[0.99] disabled:shadow-none"
            data-testid="place-order"
            disabled={!canPlace || pending}
            onClick={() => void placeOrder()}
          >
            {pending
              ? t('common.saving')
              : t('terminal.placeOrderWithTotal', { total: formatMoney(total) })}
          </Button>
          {/* Never leave a dead button unexplained: when the gate is service rather than the
              cart, say which. */}
          <p className="text-center text-xs text-muted-foreground">
            {!placement.ok && cart.length > 0 ? t(placement.error) : t('terminal.unpaidNote')}
          </p>
        </div>
      </aside>
    </div>
  )
}
