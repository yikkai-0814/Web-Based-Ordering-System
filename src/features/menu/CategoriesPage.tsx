import { message, type Message } from '@/features/i18n/messages'
import { useTranslation } from '@/features/i18n/useTranslation'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AlertCircle, Check, Pencil, Plus, X } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  createCategory,
  deleteCategory,
  setCategoryActive,
  updateCategory,
} from '@/features/menu/menu-api'
import { CATEGORY_NAME_MAX, type Category } from '@/features/menu/types'
import { useCategories } from '@/features/menu/useCategories'
import { StatusBadge } from '@/features/pos/StatusBadge'
import { useMenuItems } from '@/features/menu/useMenuItems'

export function CategoriesPage() {
  const { t } = useTranslation()
  const { categories, loading, error: loadError } = useCategories()
  const { items } = useMenuItems()

  const [newName, setNewName] = useState('')
  const [newSortOrder, setNewSortOrder] = useState('0')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSortOrder, setEditSortOrder] = useState('0')
  const [error, setError] = useState<Message | null>(null)
  const [pending, setPending] = useState(false)

  const banner = loadError ?? error

  async function run(action: () => Promise<void>) {
    setError(null)
    setPending(true)
    try {
      await action()
    } catch {
      setError(message('menu.writeRefusedShort'))
    } finally {
      setPending(false)
    }
  }

  function validateName(value: string): Message | null {
    if (value.trim() === '') return message('validation.categoryNameRequired')
    if (value.trim().length > CATEGORY_NAME_MAX) {
      return message('validation.itemNameTooLong', { max: CATEGORY_NAME_MAX })
    }
    return null
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nameError = validateName(newName)
    if (nameError) {
      setError(nameError)
      return
    }
    const sort = Number(newSortOrder)
    if (!Number.isInteger(sort)) {
      setError(message('modifierAdmin.badSortOrder'))
      return
    }
    await run(async () => {
      await createCategory({ name: newName.trim(), sortOrder: sort, active: true })
      setNewName('')
      setNewSortOrder('0')
    })
  }

  function startEditing(category: Category) {
    setEditingId(category.id)
    setEditName(category.name)
    setEditSortOrder(String(category.sortOrder))
    setError(null)
  }

  async function saveEdit(category: Category) {
    const nameError = validateName(editName)
    if (nameError) {
      setError(nameError)
      return
    }
    const sort = Number(editSortOrder)
    if (!Number.isInteger(sort)) {
      setError(message('modifierAdmin.badSortOrder'))
      return
    }
    await run(async () => {
      await updateCategory(category.id, {
        name: editName.trim(),
        sortOrder: sort,
        active: category.active,
      })
      setEditingId(null)
    })
  }

  const itemCount = (categoryId: string) =>
    items.filter((item) => item.categoryId === categoryId).length

  if (loading) {
    return <Skeleton className="h-96 w-full max-w-3xl" />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">{t('menu.categories')}</h1>
          <p className="text-muted-foreground">{t('menu.categoriesBlurb')}</p>
        </div>
        <Button asChild variant="outline" size="lg" className="h-touch text-base">
          <Link to="/menu">{t('menu.backToMenu')}</Link>
        </Button>
      </div>

      {banner && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{t(banner)}</AlertDescription>
        </Alert>
      )}

      <form
        onSubmit={(event) => void handleCreate(event)}
        noValidate
        className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <div className="grid min-w-48 flex-1 gap-2">
          <Label htmlFor="new-category-name">{t('menu.newCategory')}</Label>
          <Input
            id="new-category-name"
            className="h-touch text-base"
            placeholder={t('menu.categoryPlaceholder')}
            maxLength={CATEGORY_NAME_MAX}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="grid w-32 gap-2">
          <Label htmlFor="new-category-sort">{t('common.sortOrder')}</Label>
          <Input
            id="new-category-sort"
            inputMode="numeric"
            className="h-touch text-base"
            value={newSortOrder}
            onChange={(event) => setNewSortOrder(event.target.value)}
            disabled={pending}
          />
        </div>
        <Button type="submit" size="lg" className="h-touch text-base" disabled={pending}>
          <Plus aria-hidden="true" />
          {t('common.add')}
        </Button>
      </form>

      {categories.length === 0 ? (
        <p className="text-muted-foreground">{t('menu.noCategories')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          {/* Five columns, of which four are fixed and total 38rem before the name has any
              room at all. Scrolling this container is honest; squeezing four editable
              controls into a phone's width is not. */}
          <Table className="min-w-3xl">
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.name')}</TableHead>
                <TableHead className="w-28">{t('common.sortOrder')}</TableHead>
                <TableHead className="w-24">{t('orders.column.items')}</TableHead>
                <TableHead className="w-28">{t('menu.columnStatus')}</TableHead>
                <TableHead className="w-72 text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category) => {
                const editing = editingId === category.id
                const count = itemCount(category.id)
                return (
                  <TableRow key={category.id} data-testid="category-row">
                    <TableCell>
                      {editing ? (
                        <Input
                          aria-label={t('menu.categoryName')}
                          className="h-touch text-base"
                          value={editName}
                          maxLength={CATEGORY_NAME_MAX}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      ) : (
                        <span className="font-medium">{category.name}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editing ? (
                        <Input
                          aria-label={t('menu.categorySortOrder')}
                          inputMode="numeric"
                          className="h-touch text-base"
                          value={editSortOrder}
                          onChange={(event) => setEditSortOrder(event.target.value)}
                        />
                      ) : (
                        <span className="tabular-nums">{category.sortOrder}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{count}</TableCell>
                    <TableCell>
                      <StatusBadge
                        label={t(category.active ? 'menu.visible' : 'menu.hidden')}
                        tone={category.active ? 'good' : 'warn'}
                        testId="category-status"
                        value={category.active ? 'active' : 'inactive'}
                      />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {editing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => void saveEdit(category)}
                          >
                            <Check aria-hidden="true" />
                            {t('common.save')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => setEditingId(null)}
                          >
                            <X aria-hidden="true" />
                            {t('common.cancel')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('common.renameNamed', { name: category.name })}
                            onClick={() => startEditing(category)}
                          >
                            <Pencil aria-hidden="true" />
                            {t('common.rename')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              void run(() => setCategoryActive(category.id, !category.active))
                            }
                          >
                            {t(category.active ? 'menu.hide' : 'menu.show')}
                          </Button>
                          <ConfirmDeleteDialog
                            title={t('menu.deleteTitle', { name: category.name })}
                            description={
                              count > 0
                                ? t(
                                    count === 1
                                      ? 'menu.deleteCategoryInUseOne'
                                      : 'menu.deleteCategoryInUseOther',
                                    { count },
                                  )
                                : t('menu.deleteCategoryEmpty')
                            }
                            onConfirm={() => run(() => deleteCategory(category.id))}
                          >
                            <Button variant="destructive" size="sm">
                              {t('common.delete')}
                            </Button>
                          </ConfirmDeleteDialog>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
