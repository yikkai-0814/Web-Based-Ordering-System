import type { Message } from '@/features/i18n/messages'
import { message } from '@/features/i18n/messages'
import { useTranslation } from '@/features/i18n/useTranslation'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertCircle, FolderCog, Pencil, Plus, TriangleAlert } from 'lucide-react'

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
  const { t } = useTranslation()
  const { role } = useAuth()
  const isAdmin = role === 'admin'

  const { categories, loading: categoriesLoading, error: categoriesError } = useCategories()
  const { items, loading: itemsLoading, error: itemsError } = useMenuItems()
  // Staff do not subscribe at all — see useItemCosts.
  const { costs } = useItemCosts()
  const [actionError, setActionError] = useState<Message | null>(null)

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
      setActionError(message('menu.writeRefusedShort'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">{t('nav.menu')}</h1>
          <p className="text-muted-foreground">
            {t(isAdmin ? 'menu.blurbAdmin' : 'menu.blurbStaff')}
          </p>
        </div>
        {isAdmin && (
          <>
            <Button asChild variant="outline" size="lg" className="h-touch text-base">
              <Link to="/menu/categories">
                <FolderCog aria-hidden="true" />
                {t('menu.categories')}
              </Link>
            </Button>
            <Button asChild size="lg" className="h-touch text-base">
              <Link to="/menu/new">
                <Plus aria-hidden="true" />
                {t('menu.newItem')}
              </Link>
            </Button>
          </>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      )}

      {/* Only the catalogue waits. The heading, the blurb and the two admin buttons are
          static, so blanking them while the collections load bought nothing and made a
          navigation to this page read as a grey rectangle — measured at 611 ms before the
          heading appeared on a cold client, where the page's own structure could have been
          on screen in a single frame. The links work immediately now, too. */}
      {loading && <Skeleton className="h-64 w-full max-w-4xl" />}

      {!loading && groups.length === 0 && (
        <p className="text-muted-foreground">{t(isAdmin ? 'menu.isEmptyAdmin' : 'menu.isEmpty')}</p>
      )}

      {!loading &&
        groups.map(({ category, items: groupItems }) => (
          <section key={category?.id ?? '__uncategorised'} className="space-y-2">
            <h2 className="flex items-center gap-2 text-lg font-medium">
              {/* The category name is the vendor's own; only the stand-in is translated. */}
              {category?.name ?? t('menu.uncategorised')}
              {category && !category.active && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {t('menu.hidden')}
                </span>
              )}
            </h2>

            {groupItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('menu.noItemsInCategory')}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('menu.columnItem')}</TableHead>
                      <TableHead className="w-32 text-right">{t('common.price')}</TableHead>
                      {/* Cost is admin-only, and enforced as such by firestore.rules —
                        this column simply does not exist for staff. */}
                      {isAdmin && (
                        <TableHead className="w-32 text-right">{t('menu.cost')}</TableHead>
                      )}
                      <TableHead className="w-28">{t('menu.columnStatus')}</TableHead>
                      {isAdmin && (
                        <TableHead className="w-64 text-right">{t('common.actions')}</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupItems.map((item) => (
                      <TableRow
                        key={item.id}
                        data-testid="menu-item-row"
                        data-item-name={item.name}
                      >
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
                            {/* An item with no cost is not a blank, it is a job to do: every
                              margin it appears in is an upper bound until somebody fills it
                              in. A dash said nothing and read as "zero" at a glance, so the
                              row now says what is wrong and links to where to fix it. */}
                            {costs.has(item.id) ? (
                              formatMoney(costs.get(item.id) ?? 0)
                            ) : (
                              <Link
                                to={`/menu/${item.id}/edit`}
                                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/25 transition-colors hover:bg-primary/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                                data-testid="item-missing-cost"
                              >
                                <TriangleAlert className="size-3" aria-hidden="true" />
                                {t('menu.missingCost')}
                              </Link>
                            )}
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
                            {t(item.active ? 'menu.available' : 'menu.archived')}
                          </span>
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right whitespace-nowrap">
                            <Button asChild variant="ghost" size="sm">
                              <Link
                                to={`/menu/${item.id}/edit`}
                                aria-label={t('menu.editItemNamed', { name: item.name })}
                              >
                                <Pencil aria-hidden="true" />
                                {t('common.edit')}
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void run(() => setMenuItemActive(item.id, !item.active))
                              }
                            >
                              {t(item.active ? 'menu.archive' : 'menu.restore')}
                            </Button>
                            <ConfirmDeleteDialog
                              title={t('menu.deleteTitle', { name: item.name })}
                              description={t('menu.deleteBlurb')}
                              onConfirm={() => run(() => deleteMenuItem(item.id))}
                            >
                              <Button variant="destructive" size="sm">
                                {t('common.delete')}
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
