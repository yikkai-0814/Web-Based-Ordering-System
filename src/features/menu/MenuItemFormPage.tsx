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
import { NativeSelect } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { LANGUAGE_LABELS, LANGUAGES, type Language } from '@/features/i18n/languages'
import {
  emptyItemNames,
  storedTranslations,
  validateItemNames,
  type LocalizedName,
} from '@/features/menu/item-names'
import { createMenuItem, updateMenuItem } from '@/features/menu/menu-api'
import { ModifierGroupsEditor } from '@/features/menu/ModifierGroupsEditor'
import { EMPTY_CUSTOMISATION, type DraftCustomisation } from '@/features/menu/item-customisation'
import { NewItemCustomisation } from '@/features/menu/NewItemCustomisation'
import { useModifierGroups } from '@/features/menu/useModifierGroups'
import { useItemCosts } from '@/features/menu/useItemCosts'
import type { ModifierGroup } from '@/features/menu/modifiers'
import {
  ITEM_DESCRIPTION_MAX,
  ITEM_NAME_MAX,
  type Category,
  type MenuItem,
} from '@/features/menu/types'
import { useCategories } from '@/features/menu/useCategories'
import { useMenuItems } from '@/features/menu/useMenuItems'
import { CURRENCY_PREFIX, parsePriceInput, toPriceInputValue } from '@/lib/money'

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
  // The pool of reusable definitions, offered on the create form. Loaded here rather than
  // inside the form so the form is still seeded once, from settled props.
  const { groups, loading: groupsLoading } = useModifierGroups()

  const existing = isEditing ? items.find((item) => item.id === itemId) : undefined
  const loading = categoriesLoading || costsLoading || groupsLoading || (isEditing && itemsLoading)

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
      reusableGroups={groups}
      itemId={itemId}
    />
  )
}

/**
 * The id of one language's name field. English keeps `name`, the id it has always had, so
 * anything pointing at it — a label, a test, a browser's own autofill memory — still finds
 * the field that holds the item's canonical name.
 */
function nameFieldId(language: Language): string {
  return language === 'en' ? 'name' : `name-${language}`
}

function MenuItemForm({
  existing,
  existingCost,
  categories,
  reusableGroups,
  itemId,
}: {
  existing: MenuItem | undefined
  existingCost: number | null
  categories: Category[]
  reusableGroups: ModifierGroup[]
  itemId: string | undefined
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isEditing = Boolean(itemId)

  /**
   * Seeded once at mount — see the note on MenuItemFormPage.
   *
   * All three languages are held together and submitted together, which is what keeps an
   * admin editing the Malay name from clearing the Chinese one: the field they did not touch
   * is still in this state and still goes back to Firestore.
   */
  const [names, setNames] = useState<LocalizedName>(existing?.names ?? emptyItemNames())
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

  /**
   * Customisation for an item that does not exist yet.
   *
   * Only the create path uses this. Editing keeps the immediate-save editor it has always
   * had, so this state is simply never read there.
   */
  const [customisation, setCustomisation] = useState<DraftCustomisation>(EMPTY_CUSTOMISATION)

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

    // English required, translations optional, every one of them trimmed and length-checked.
    // The rule lives in item-names.ts so the form and the till agree about what a name is.
    const validatedNames = validateItemNames(names)
    if (!validatedNames.ok) {
      setError(validatedNames.error)
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
        name: validatedNames.names.en,
        // Only the translations: English is `name`, and storing it twice would be two
        // records of one fact, free to disagree. See item-names.ts.
        names: storedTranslations(validatedNames.names),
        description: description.trim(),
        categoryId,
        price: parsedPrice.sen,
        sortOrder: parsedSort,
        active,
        // Editing never rewrites the attachments from here: the editor below owns them and
        // has already saved every change. Sending the item's own list back unchanged is what
        // keeps a save from undoing what was just attached.
        modifierGroupIds: isEditing
          ? (existing?.modifierGroupIds ?? [])
          : customisation.attachedIds,
      }
      if (isEditing && itemId) {
        await updateMenuItem(itemId, input, { next: parsedCost, previous: existingCost })
      } else {
        // The item, the groups invented on this form and the attachments, in one batch.
        await createMenuItem(input, parsedCost, customisation.drafts)
      }
      void navigate('/menu')
    } catch {
      setError(message('menu.writeRefused'))
      setPending(false)
    }
  }

  return (
    /* Details on the left, customisation on the right, so the horizontal space is used and
       the form does not become a very tall single column.

       **The split starts at `xl`, not `lg`, and the right column is 42rem.** The customisation
       card carries a four-column option table — name, adds, cost, actions — whose last three
       columns are fixed, so the name column is whatever the card has left over. The old 28rem
       track capped that card at 448px however wide the window was, leaving the name about
       50px wide and long option names unreadable.

       Widening the track alone would have been worse between 1024px and 1280px: the two
       columns together would not fit, and the details form would have been squeezed to its
       minimum content width instead. So the breakpoint moved up with it. Below `xl` this is
       one column, where each card reaches its own max-width — 42rem for the customisation
       card, which is exactly the track it gets above `xl`. The same editor at the same width,
       either side of the breakpoint; only the arrangement changes. */
    <div className="grid w-full max-w-6xl items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,42rem)]">
      <Card className="w-full">
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

            {/* One field per language, in the same stack and the same input styling as
                every other field on this form — the form is not redesigned, it has grown a
                row. The labels are the endonyms the language menu already uses, so the field
                a Malay speaker wants is labelled in Malay whatever the interface is set to.

                Rendered from LANGUAGES rather than written out three times, so a fourth
                language becomes a field here the day it is added to the list. */}
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t('menu.nameHeading')}</legend>
              {LANGUAGES.map((language) => (
                <div key={language} className="grid gap-2">
                  <Label htmlFor={nameFieldId(language)}>
                    {LANGUAGE_LABELS[language]}
                    {language === 'en' && (
                      /* Decoration for the eye only: `required` on the input is what a
                         screen reader is actually told. */
                      <span aria-hidden="true" className="text-destructive">
                        {' '}
                        *
                      </span>
                    )}
                  </Label>
                  <Input
                    id={nameFieldId(language)}
                    data-testid={nameFieldId(language)}
                    className="h-touch text-base"
                    value={names[language]}
                    maxLength={ITEM_NAME_MAX}
                    required={language === 'en'}
                    aria-describedby="names-hint"
                    onChange={(event) =>
                      setNames((current) => ({ ...current, [language]: event.target.value }))
                    }
                    disabled={pending}
                    autoFocus={language === 'en'}
                  />
                </div>
              ))}
              <p id="names-hint" className="text-xs text-muted-foreground">
                {t('menu.namesHint')}
              </p>
            </fieldset>

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
              <NativeSelect
                id="categoryId"
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
              </NativeSelect>
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

      {/* The right column.

          Editing keeps the editor it has always had, which writes each change immediately —
          the item exists, so there is an id to attach things to and no reason to defer.

          Creating cannot do that, and used to say so ("save the item first"). It now holds
          the configuration in memory and the form writes item, groups and attachments in one
          batch, so creating an item with its customisation is a single action. */}
      {isEditing && existing ? (
        <ModifierGroupsEditor item={existing} />
      ) : (
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-xl">{t('menu.customisationHeading')}</CardTitle>
            <CardDescription>{t('menu.customisationBlurb')}</CardDescription>
          </CardHeader>
          <CardContent>
            <NewItemCustomisation
              /* Shared definitions only: a group owned by another item is not reusable. */
              available={reusableGroups.filter((group) => group.itemId === null)}
              value={customisation}
              onChange={setCustomisation}
              disabled={pending}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
