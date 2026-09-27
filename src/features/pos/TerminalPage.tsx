import { isMessageError, message, type Message } from '@/features/i18n/messages'
import { useTranslation } from '@/features/i18n/useTranslation'
import { useMemo, useRef, useState } from 'react'
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
import { getLocalizedMenuItemName } from '@/features/menu/item-names'
import {
  addToCart,
  cartItemCount,
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
  const { t, language } = useTranslation()
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
  /** The cart column, which the phone summary bar's "Review order" brings into view. */
  const cartRef = useRef<HTMLElement>(null)

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
  const itemCount = cartItemCount(cart)
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
        /**
         * Snapshotted here, in the language the till was speaking — the name the customer
         * was shown when they ordered. From this point it is history: `addToCart` copies it
         * onto the line, the line is written onto the order, and nothing ever resolves it
         * against the menu again. An admin renaming or retranslating the item tomorrow does
         * not touch it.
         */
        name: getLocalizedMenuItemName(item, language),
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

  /**
   * Below `md` the cart sits under the whole menu, so the summary bar offers a way down to it.
   *
   * It scrolls the existing cart into view rather than opening a second copy of it, and moves
   * focus there as well, so a keyboard or screen-reader user lands where a sighted one is now
   * looking. Motion is skipped for anyone who has asked their device for less of it.
   */
  function reviewOrder() {
    const panel = cartRef.current
    if (!panel) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    panel.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    panel.focus({ preventScroll: true })
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
    /*
     * Menu and cart side by side from `md`, one above the other below it.
     *
     * `md` rather than `lg` since the sidebar became a 64px rail between `md` and `xl`: a
     * 768px tablet now has about 650px of page, enough for a two-column menu beside a 20rem
     * cart. The cart widens with the screen, and the menu takes whatever is left.
     */
    <div className="mx-auto grid w-full max-w-7xl gap-4 md:grid-cols-[1fr_20rem] lg:grid-cols-[1fr_24rem] xl:grid-cols-[1fr_26rem]">
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

      {/* A size container, so the tile grid below counts columns from the width the menu
          actually has — which depends on the sidebar and the cart beside it — rather than from
          the width of the whole screen. */}
      <section className="@container min-w-0 space-y-5">
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
            {/* Two columns, three from 32rem of menu, four from 50rem: a 1024px tablet gets
                three, a phone two, and a 1536px desktop four — as it had before. */}
            <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @[50rem]:grid-cols-4">
              {groupItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid="pos-item"
                  /* The canonical English name, so a test or a script can find the tile
                     whatever language the till is set to. The label below is what the
                     person at the counter reads. */
                  data-item-name={item.name}
                  onClick={() => addItem(item)}
                  disabled={pending}
                  /* A minimum height, not a fixed one: a one-line name keeps the compact tile,
                     and a name that needs two lines or more gets them, rather than being
                     clipped under its own price. */
                  className="flex min-h-touch-lg flex-col justify-center gap-0.5 rounded-xl border bg-card px-3 py-2 text-left shadow-xs transition-[box-shadow,border-color,background-color,transform] duration-100 hover:border-primary/40 hover:bg-primary/[0.04] hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] active:bg-primary/[0.08] disabled:opacity-50"
                >
                  <span className="text-sm leading-snug font-medium wrap-break-word">
                    {getLocalizedMenuItemName(item, language)}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {formatMoney(item.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/*
         * Below `md` only, and only once something is in the order: how much is in it, what it
         * comes to, and the way down to it.
         *
         * `sticky` within the menu, not `fixed`. While the menu is being browsed it rides above
         * the mobile nav (offset by that nav's own height, like the cart's footer). When the
         * menu ends it comes to rest in the flow just above the cart it points at, so it never
         * covers the last row of items and never sits on top of the cart's own Place order.
         * Edge to edge, like the nav beneath it, rather than as another card. `z-10`, below
         * the Topbar's `z-20`: once it has come to rest and scrolls up with the page, it passes
         * under the bar rather than being painted over it.
         */}
        {itemCount > 0 && (
          <div
            className="sticky bottom-mobile-nav z-10 -mx-4 flex items-center gap-3 border-t bg-card px-4 py-3 md:hidden"
            data-testid="order-summary"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground" data-testid="order-summary-count">
                {t(itemCount === 1 ? 'cart.itemsOne' : 'cart.itemsOther', { count: itemCount })}
              </p>
              <p className="text-lg font-semibold tabular-nums" data-testid="order-summary-total">
                {formatMoney(total)}
              </p>
            </div>
            <Button
              type="button"
              size="lg"
              className="h-touch px-4 text-base"
              data-testid="review-order"
              onClick={reviewOrder}
            >
              {t('terminal.reviewOrder')}
            </Button>
          </div>
        )}
      </section>

      {/*
       * On a phone this sits below the menu in ordinary flow; from `md` it becomes its own
       * column and stays put while the menu scrolls.
       *
       * Stuck 1rem below the Topbar and 1rem clear of the bottom of the screen, both measured
       * from the Topbar's own height variable rather than from numbers that happen to match
       * it today. Inside, only the list of lines scrolls: the service choice and the Place
       * order footer never shrink, so no cart is ever long enough to push them out of sight.
       *
       * On a `short` screen (under 40rem tall — a phone on its side) those fixed parts alone
       * are taller than the column can be, so there the whole column scrolls instead, and
       * Place order is reached by scrolling the cart rather than lost below the screen.
       *
       * `overflow-clip`, not `overflow-hidden`, to round off the corners. Both clip, but
       * `hidden` also makes this panel a scroll container, and a `sticky` descendant sticks to
       * its nearest scroll container: the phone footer below was being held 68px up from the
       * bottom of THIS panel — over the table number field — instead of above the mobile nav.
       *
       * Focusable (but not a tab stop) because "Review order" sends focus here, and labelled
       * so that arriving is announced as arriving at the order.
       */}
      <aside
        ref={cartRef}
        tabIndex={-1}
        aria-label={t('cart.currentOrder')}
        className="flex min-h-96 min-w-0 scroll-mt-[calc(var(--topbar-height)+1rem)] flex-col overflow-clip rounded-xl border bg-card shadow-xs focus:outline-none md:sticky md:top-[calc(var(--topbar-height)+1rem)] md:h-[calc(100svh-var(--topbar-height)-2rem)] md:min-h-0 md:short:overflow-y-auto"
      >
        <CartPanel
          cart={cart}
          disabled={pending}
          onIncrement={(lineId) => setCart((current) => incrementLine(current, lineId))}
          onDecrement={(lineId) => setCart((current) => decrementLine(current, lineId))}
          onRemove={(lineId) => setCart((current) => removeLine(current, lineId))}
          onClear={() => setCart(clearCart())}
        />

        {error && (
          <Alert variant="destructive" className="mx-4 w-auto shrink-0">
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
         * Sticky below `md`, so the total and the one action are reachable without scrolling
         * to the end of a long cart — and offset by the mobile nav's own height so the two
         * bottom-anchored things can never sit on top of each other. It is `sticky`, not
         * `fixed`: it stays inside this panel, cannot cover the menu or a dialog, and the
         * cart above it scrolls freely behind an opaque surface rather than being hidden by
         * it. From `md` there is no mobile nav to clear, and the panel is its own
         * screen-height column, so it simply sits at the bottom of it. `z-10`, like the
         * summary bar, so it too scrolls under the Topbar rather than over it.
         */}
        <div className="sticky bottom-mobile-nav z-10 shrink-0 space-y-2 border-t bg-card p-4 md:static">
          <div className="flex items-baseline justify-between gap-3 md:hidden">
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
