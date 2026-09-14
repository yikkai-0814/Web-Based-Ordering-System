import { message, type Message } from '@/features/i18n/messages'
import { useTranslation } from '@/features/i18n/useTranslation'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AlertCircle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { createMenuItem, updateMenuItem } from '@/features/menu/menu-api'
import { ModifierGroupsEditor } from '@/features/menu/ModifierGroupsEditor'
import { useItemCosts } from '@/features/menu/useItemCosts'
import {
  ITEM_DESCRIPTION_MAX,
  ITEM_NAME_MAX,
  type Category,
  type MenuItem,
} from '@/features/menu/types'
import { useCategories } from '@/features/menu/useCategories'
import { useMenuItems } from '@/features/menu/useMenuItems'
import { CURRENCY_PREFIX, parsePriceInput, toPriceInputValue } from '@/lib/money'

const SELECT_CLASS =
  'h-touch w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

/**
 * Route component for both `/menu/new` and `/menu/:itemId/edit`.
 *
 * It resolves the data first and only then mounts the form, so the form can seed its state
 * straight from props. That ordering matters: the item is a **live** subscription, and if
 * the form synced from it on every snapshot, an edit arriving from another device would
 * overwrite whatever the admin was halfway through typing. Mounting once with a `key`
 * makes that impossible by construction rather than by a guard that can be got wrong.
 */
export function MenuItemFormPage() {
  const { t } = useTranslation()
  const { itemId } = useParams<{ itemId: string }>()
  const isEditing = Boolean(itemId)

  const { categories, loading: categoriesLoading } = useCategories()
  const { items, loading: itemsLoading } = useMenuItems()
  const { costs, loading: costsLoading } = useItemCosts()

  const existing = isEditing ? items.find((item) => item.id === itemId) : undefined
  const loading = categoriesLoading || costsLoading || (isEditing && itemsLoading)

  if (loading) {
    return <Skeleton className="h-96 w-full max-w-xl" />
  }

  if (isEditing && !existing) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('menu.itemNotFound')}</h1>
        <p className="text-muted-foreground">{t('menu.itemNotFoundBlurb')}</p>
        <Button asChild size="lg" className="h-touch text-base">
          <Link to="/menu">{t('menu.backToMenu')}</Link>
        </Button>
      </div>
    )
  }

  if (categories.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('menu.createCategoryFirst')}</h1>
        <p className="text-muted-foreground">{t('menu.createCategoryFirstBlurb')}</p>
        <Button asChild size="lg" className="h-touch text-base">
          <Link to="/menu/categories">{t('menu.goToCategories')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <MenuItemForm
      key={existing?.id ?? 'new'}
      existing={existing}
      existingCost={existing ? (costs.get(existing.id) ?? null) : null}
      categories={categories}
      itemId={itemId}
    />
  )
}

function MenuItemForm({
  existing,
  existingCost,
  categories,
  itemId,
}: {
  existing: MenuItem | undefined
  existingCost: number | null
  categories: Category[]
  itemId: string | undefined
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isEditing = Boolean(itemId)

  // Seeded once at mount — see the note on MenuItemFormPage.
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? categories[0]?.id ?? '')
  const [priceText, setPriceText] = useState(existing ? toPriceInputValue(existing.price) : '')
  /**
   * Cost is mandatory, so this starts blank only for an item that predates the rule — and
   * that item cannot be saved again until somebody fills it in, which is the point. An
   * item without a cost turns every margin it appears in into an upper bound.
   */
  const [costText, setCostText] = useState(
    existingCost === null ? '' : toPriceInputValue(existingCost),
  )
  const [sortOrder, setSortOrder] = useState(String(existing?.sortOrder ?? 0))
  const [active, setActive] = useState(existing?.active ?? true)

  const [error, setError] = useState<Message | null>(null)
  /**
   * Reported under the field rather than in the banner at the top of the form.
   *
   * This is the one check somebody will trip repeatedly — it is a newly required field on a
   * form they already know — so the message belongs where the cursor is going, and the
   * cursor is sent there too. The other checks stay in the banner; they are typos.
   */
  const [costError, setCostError] = useState<Message | null>(null)
  const costInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (name.trim() === '') {
      setError(message('validation.itemNameRequired'))
      return
    }
    if (name.trim().length > ITEM_NAME_MAX) {
      setError(message('validation.itemNameTooLong', { max: ITEM_NAME_MAX }))
      return
    }
    if (description.length > ITEM_DESCRIPTION_MAX) {
      setError(message('validation.descriptionTooLong', { max: ITEM_DESCRIPTION_MAX }))
      return
    }
    if (categoryId === '') {
      setError(message('validation.categoryRequired'))
      return
    }

    // The one conversion that matters: text -> whole sen, with a real message on failure
    // rather than a NaN sliding into the database.
    const parsedPrice = parsePriceInput(priceText)
    if (!parsedPrice.ok) {
      setError(parsedPrice.error)
      return
    }

    // Cost is mandatory. Blank, whitespace or unparseable all stop the submit here, with
    // the message under the field and the cursor in it.
    if (costText.trim() === '') {
      setError(null)
      setCostError(message('validation.costRequired'))
      costInput.current?.focus()
      return
    }
    // `parsePriceInput` is the same parser the price field uses: it rejects a negative, a
    // non-number and more than two decimals, and accepts 0 — which is a real answer.
    const parsedCostResult = parsePriceInput(costText)
    if (!parsedCostResult.ok) {
      setError(null)
      setCostError(parsedCostResult.error)
      costInput.current?.focus()
      return
    }
    const parsedCost = parsedCostResult.sen

    const parsedSort = Number(sortOrder)
    if (!Number.isInteger(parsedSort)) {
      setError(message('modifierAdmin.badSortOrder'))
      return
    }

    setError(null)
    setCostError(null)
    setPending(true)
    try {
      const input = {
        name: name.trim(),
        description: description.trim(),
        categoryId,
        price: parsedPrice.sen,
        sortOrder: parsedSort,
        active,
      }
      if (isEditing && itemId) {
        await updateMenuItem(itemId, input, { next: parsedCost, previous: existingCost })
      } else {
        await createMenuItem(input, parsedCost)
      }
      void navigate('/menu')
    } catch {
      setError(message('menu.writeRefused'))
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-xl">
            {t(isEditing ? 'menu.editItem' : 'menu.newItem')}
          </CardTitle>
          <CardDescription>{t('menu.priceHint', { currency: CURRENCY_PREFIX })}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void handleSubmit(event)} noValidate className="grid gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertDescription>{t(error)}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2">
              <Label htmlFor="name">{t('common.name')}</Label>
              <Input
                id="name"
                className="h-touch text-base"
                value={name}
                maxLength={ITEM_NAME_MAX}
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">{t('menu.descriptionOptional')}</Label>
              <Input
                id="description"
                className="h-touch text-base"
                value={description}
                maxLength={ITEM_DESCRIPTION_MAX}
                onChange={(event) => setDescription(event.target.value)}
                disabled={pending}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="categoryId">{t('menu.category')}</Label>
              {/* A native select: on a touch screen the OS picker beats a custom listbox. */}
              <select
                id="categoryId"
                className={SELECT_CLASS}
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                disabled={pending}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.active ? '' : t('menu.hiddenSuffix')}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="price">
                {t('menu.priceCurrency', { currency: CURRENCY_PREFIX })}
              </Label>
              <Input
                id="price"
                inputMode="decimal"
                placeholder={t('menu.pricePlaceholder')}
                className="h-touch text-base"
                value={priceText}
                onChange={(event) => setPriceText(event.target.value)}
                disabled={pending}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cost">
                {t('menu.costCurrency', { currency: CURRENCY_PREFIX })}{' '}
                {/* Decoration for the eye only: `required` and `aria-invalid` on the input
                    are what a screen reader is actually told. */}
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </Label>
              <Input
                ref={costInput}
                id="cost"
                inputMode="decimal"
                required
                aria-invalid={costError !== null}
                aria-describedby={costError ? 'cost-error' : 'cost-hint'}
                placeholder={t('menu.costPlaceholder')}
                className="h-touch text-base"
                value={costText}
                onChange={(event) => {
                  setCostText(event.target.value)
                  setCostError(null)
                }}
                disabled={pending}
                data-testid="cost"
              />
              {costError && (
                <p
                  id="cost-error"
                  role="alert"
                  className="text-xs text-destructive"
                  data-testid="cost-error"
                >
                  {t(costError)}
                </p>
              )}
              <p id="cost-hint" className="text-xs text-muted-foreground">
                {t('menu.costBlurb')}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sortOrder">{t('common.sortOrder')}</Label>
              <Input
                id="sortOrder"
                inputMode="numeric"
                className="h-touch text-base"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                disabled={pending}
              />
              <p className="text-xs text-muted-foreground">{t('menu.sortOrderHint')}</p>
            </div>

            <label className="flex items-center gap-3 text-sm">
              <input
                id="active"
                type="checkbox"
                className="size-5"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                disabled={pending}
              />
              {t('menu.availableForSale')}
            </label>

            <div className="flex gap-3">
              <Button type="submit" size="lg" className="h-touch text-base" disabled={pending}>
                {pending
                  ? t('common.saving')
                  : t(isEditing ? 'menu.saveChanges' : 'menu.createItem')}
              </Button>
              <Button
                asChild
                type="button"
                variant="outline"
                size="lg"
                className="h-touch text-base"
              >
                <Link to="/menu">{t('common.cancel')}</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Only once the item exists: a group is keyed to an item id, and there is none to key
          it to until the item has been created. Saving first is one extra step on the rarer
          action, which is better than holding groups in memory and writing them in a second
          batch that could half-fail. */}
      {isEditing && itemId ? (
        <ModifierGroupsEditor itemId={itemId} />
      ) : (
        <p className="max-w-xl text-sm text-muted-foreground">{t('modifierAdmin.saveItemFirst')}</p>
      )}
    </div>
  )
}
