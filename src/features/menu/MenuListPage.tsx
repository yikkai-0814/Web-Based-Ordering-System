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
import { getLocalizedMenuItemName } from '@/features/menu/item-names'
import { useCategories } from '@/features/menu/useCategories'
import { useItemCosts } from '@/features/menu/useItemCosts'
import { useMenuItems } from '@/features/menu/useMenuItems'
import { useAuth } from '@/features/auth/useAuth'
import { StatusBadge } from '@/features/pos/StatusBadge'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

interface Group {
  category: Category | null
  items: MenuItem[]
}

export function MenuListPage() {
  const { t, language } = useTranslation()
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
                <StatusBadge label={t('menu.hidden')} tone="warn" value="hidden" />
              )}
            </h2>

            {groupItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('menu.noItemsInCategory')}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                {/* Only an admin sees the cost and action columns, and only then do the fixed
                    columns total 39rem and need more room than a phone has. A staff account
                    sees item, price and status, which fit — so the width is asked for when it
                    is actually needed rather than forcing a scrollbar on the read-only view. */}
                <Table className={cn(isAdmin && 'min-w-3xl')}>
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
                        /* The item's canonical English name, which identifies the row
                           whatever the screen is set to. The cell below shows the name for
                           the current language. */
                        data-item-name={item.name}
                      >
                        <TableCell>
                          <span className="font-medium">
                            {getLocalizedMenuItemName(item, language)}
                          </span>
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
                          {/* Grey-versus-darker-grey was the only difference here, which is
                              not a difference you can see while scanning a long catalogue. */}
                          <StatusBadge
                            label={t(item.active ? 'menu.available' : 'menu.archived')}
                            tone={item.active ? 'good' : 'warn'}
                            testId="item-status"
                            value={item.active ? 'active' : 'inactive'}
                          />
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            {/* A flex row, not three inline-level buttons in a text-aligned
                                cell. Laid out inline they share a baseline, and an
                                `inline-flex` box's baseline is synthesized from its first
                                child: for Archive and Delete that is their text, but for Edit
                                it is the Pencil, and an SVG has no text baseline, so the
                                browser falls back to the bottom edge of the icon. Edit was
                                therefore sitting a few pixels higher than the buttons beside
                                it — the same class of fault as the icon-and-text rows in
                                ModifierGroupsEditor, which is why this is the same
                                `flex items-center justify-end gap-1` those use. Aligning the
                                boxes to each other rather than to a baseline is what fixes
                                it; no offset is applied to Edit itself.

                                The gap is part of the fix rather than decoration: with the
                                buttons flush, the 3px focus ring of one sat on top of its
                                neighbour. */}
                            <div className="flex items-center justify-end gap-1">
                              <Button asChild variant="ghost" size="sm">
                                <Link
                                  to={`/menu/${item.id}/edit`}
                                  aria-label={t('menu.editItemNamed', {
                                    name: getLocalizedMenuItemName(item, language),
                                  })}
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
                                title={t('menu.deleteTitle', {
                                  name: getLocalizedMenuItemName(item, language),
                                })}
                                description={t('menu.deleteBlurb')}
                                onConfirm={() => run(() => deleteMenuItem(item.id))}
                              >
                                <Button variant="destructive" size="sm">
                                  {t('common.delete')}
                                </Button>
                              </ConfirmDeleteDialog>
                            </div>
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
