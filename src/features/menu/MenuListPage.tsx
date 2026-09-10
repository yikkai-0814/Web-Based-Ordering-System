import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertCircle, FolderCog, Pencil, Plus } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDeleteDialog } from '@/features/menu/ConfirmDeleteDialog'
import { deleteMenuItem, setMenuItemActive } from '@/features/menu/menu-api'
import { bySortOrderThenName, type Category, type MenuItem } from '@/features/menu/types'
import { useCategories } from '@/features/menu/useCategories'
import { useItemCosts } from '@/features/menu/useItemCosts'
import { useMenuItems } from '@/features/menu/useMenuItems'
import { useAuth } from '@/features/auth/useAuth'
import { formatMoney } from '@/lib/money'

interface Group {
  category: Category | null
  items: MenuItem[]
}

export function MenuListPage() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'

  const { categories, loading: categoriesLoading, error: categoriesError } = useCategories()
  const { items, loading: itemsLoading, error: itemsError } = useMenuItems()
  // Staff do not subscribe at all — see useItemCosts.
  const { costs } = useItemCosts()
  const [actionError, setActionError] = useState<string | null>(null)

  const loading = categoriesLoading || itemsLoading
  const error = categoriesError ?? itemsError ?? actionError

  // Grouping happens in memory — see use-collection.ts for why the catalog is not queried
  // per category.
  const groups = useMemo<Group[]>(() => {
    const byCategory = new Map<string, MenuItem[]>()
    for (const item of items) {
      const bucket = byCategory.get(item.categoryId)
      if (bucket) bucket.push(item)
      else byCategory.set(item.categoryId, [item])
    }

    const result: Group[] = categories.map((category) => ({
      category,
      items: byCategory.get(category.id) ?? [],
    }))

    // Items whose category was deleted still need somewhere to appear, or an admin would
    // have no way to find and fix them.
    const knownIds = new Set(categories.map((category) => category.id))
    const orphans = items.filter((item) => !knownIds.has(item.categoryId))
    if (orphans.length > 0) {
      result.push({ category: null, items: [...orphans].sort(bySortOrderThenName) })
    }

    return result
  }, [categories, items])

  async function run(action: () => Promise<void>) {
    setActionError(null)
    try {
      await action()
    } catch {
      setActionError('That change was refused. Your account may not have permission.')
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-64 w-full max-w-4xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Menu</h1>
          <p className="text-muted-foreground">
            {isAdmin
              ? 'Everything the café sells. Changes appear on every till immediately.'
              : 'Everything the café sells. Ask an administrator to make changes.'}
          </p>
        </div>
        {isAdmin && (
          <>
            <Button asChild variant="outline" size="lg" className="h-touch text-base">
              <Link to="/menu/categories">
                <FolderCog aria-hidden="true" />
                Categories
              </Link>
            </Button>
            <Button asChild size="lg" className="h-touch text-base">
              <Link to="/menu/new">
                <Plus aria-hidden="true" />
                New item
              </Link>
            </Button>
          </>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {groups.length === 0 && (
        <p className="text-muted-foreground">
          The menu is empty. {isAdmin ? 'Create a category first, then add items to it.' : ''}
        </p>
      )}

      {groups.map(({ category, items: groupItems }) => (
        <section key={category?.id ?? '__uncategorised'} className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            {category?.name ?? 'Uncategorised'}
            {category && !category.active && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Hidden
              </span>
            )}
          </h2>

          {groupItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items in this category yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="w-32 text-right">Price</TableHead>
                    {/* Cost is admin-only, and enforced as such by firestore.rules —
                        this column simply does not exist for staff. */}
                    {isAdmin && <TableHead className="w-32 text-right">Cost</TableHead>}
                    <TableHead className="w-28">Status</TableHead>
                    {isAdmin && <TableHead className="w-64 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupItems.map((item) => (
                    <TableRow key={item.id} data-testid="menu-item-row" data-item-name={item.name}>
                      <TableCell>
                        <span className="font-medium">{item.name}</span>
                        {item.description && (
                          <span className="block text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums" data-testid="item-price">
                        {formatMoney(item.price)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell
                          className="text-right tabular-nums text-muted-foreground"
                          data-testid="item-cost"
                        >
                          {costs.has(item.id) ? formatMoney(costs.get(item.id) ?? 0) : '—'}
                        </TableCell>
                      )}
                      <TableCell>
                        <span
                          className={
                            item.active
                              ? 'text-sm text-foreground'
                              : 'text-sm text-muted-foreground'
                          }
                        >
                          {item.active ? 'Available' : 'Archived'}
                        </span>
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right whitespace-nowrap">
                          <Button asChild variant="ghost" size="sm">
                            <Link to={`/menu/${item.id}/edit`} aria-label={`Edit ${item.name}`}>
                              <Pencil aria-hidden="true" />
                              Edit
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void run(() => setMenuItemActive(item.id, !item.active))}
                          >
                            {item.active ? 'Archive' : 'Restore'}
                          </Button>
                          <ConfirmDeleteDialog
                            title={`Delete ${item.name}?`}
                            description="This removes the item from the menu permanently. Past sales are unaffected — they record the name and price at the time of sale. To hide it from service without deleting, use Archive instead."
                            onConfirm={() => run(() => deleteMenuItem(item.id))}
                          >
                            <Button variant="destructive" size="sm">
                              Delete
                            </Button>
                          </ConfirmDeleteDialog>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
