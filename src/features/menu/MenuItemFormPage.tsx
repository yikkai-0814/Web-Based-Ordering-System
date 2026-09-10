import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AlertCircle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { createMenuItem, updateMenuItem, type CostInput } from '@/features/menu/menu-api'
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
        <h1 className="text-2xl font-semibold tracking-tight">Item not found</h1>
        <p className="text-muted-foreground">It may have been deleted by someone else.</p>
        <Button asChild size="lg" className="h-touch text-base">
          <Link to="/menu">Back to the menu</Link>
        </Button>
      </div>
    )
  }

  if (categories.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Create a category first</h1>
        <p className="text-muted-foreground">
          Every item belongs to a category, so there needs to be at least one before you can add
          items.
        </p>
        <Button asChild size="lg" className="h-touch text-base">
          <Link to="/menu/categories">Go to categories</Link>
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
  const navigate = useNavigate()
  const isEditing = Boolean(itemId)

  // Seeded once at mount — see the note on MenuItemFormPage.
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? categories[0]?.id ?? '')
  const [priceText, setPriceText] = useState(existing ? toPriceInputValue(existing.price) : '')
  // Blank means "not recorded", which is deliberately not the same as zero.
  const [costText, setCostText] = useState(
    existingCost === null ? '' : toPriceInputValue(existingCost),
  )
  const [sortOrder, setSortOrder] = useState(String(existing?.sortOrder ?? 0))
  const [active, setActive] = useState(existing?.active ?? true)

  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (name.trim() === '') {
      setError('Enter a name for this item.')
      return
    }
    if (name.trim().length > ITEM_NAME_MAX) {
      setError(`Names can be at most ${ITEM_NAME_MAX} characters.`)
      return
    }
    if (description.length > ITEM_DESCRIPTION_MAX) {
      setError(`Descriptions can be at most ${ITEM_DESCRIPTION_MAX} characters.`)
      return
    }
    if (categoryId === '') {
      setError('Choose a category.')
      return
    }

    // The one conversion that matters: text -> whole sen, with a real message on failure
    // rather than a NaN sliding into the database.
    const parsedPrice = parsePriceInput(priceText)
    if (!parsedPrice.ok) {
      setError(parsedPrice.error)
      return
    }

    // Cost is optional. Blank stores no cost document at all rather than a misleading 0.
    let parsedCost: CostInput = null
    if (costText.trim() !== '') {
      const result = parsePriceInput(costText)
      if (!result.ok) {
        setError(`Cost: ${result.error}`)
        return
      }
      parsedCost = result.sen
    }

    const parsedSort = Number(sortOrder)
    if (!Number.isInteger(parsedSort)) {
      setError('Sort order must be a whole number.')
      return
    }

    setError(null)
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
      setError('That change was refused. Your account may not have permission to edit the menu.')
      setPending(false)
    }
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="text-xl">{isEditing ? 'Edit item' : 'New item'}</CardTitle>
        <CardDescription>
          Prices are entered in {CURRENCY_PREFIX} and stored to the sen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="grid gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
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
            <Label htmlFor="description">Description (optional)</Label>
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
            <Label htmlFor="categoryId">Category</Label>
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
                  {category.active ? '' : ' (hidden)'}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="price">Price ({CURRENCY_PREFIX})</Label>
            <Input
              id="price"
              inputMode="decimal"
              placeholder="12.50"
              className="h-touch text-base"
              value={priceText}
              onChange={(event) => setPriceText(event.target.value)}
              disabled={pending}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cost">Cost ({CURRENCY_PREFIX})</Label>
            <Input
              id="cost"
              inputMode="decimal"
              placeholder="Leave blank if not recorded"
              className="h-touch text-base"
              value={costText}
              onChange={(event) => setCostText(event.target.value)}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              What the café pays for this item. Visible to administrators only — staff accounts
              cannot read it. Leave blank if you have not recorded it; that is not the same as zero.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sortOrder">Sort order</Label>
            <Input
              id="sortOrder"
              inputMode="numeric"
              className="h-touch text-base"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              Lower numbers appear first. Items with the same number are sorted by name.
            </p>
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
            Available for sale
          </label>

          <div className="flex gap-3">
            <Button type="submit" size="lg" className="h-touch text-base" disabled={pending}>
              {pending ? 'Saving…' : isEditing ? 'Save changes' : 'Create item'}
            </Button>
            <Button asChild type="button" variant="outline" size="lg" className="h-touch text-base">
              <Link to="/menu">Cancel</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
