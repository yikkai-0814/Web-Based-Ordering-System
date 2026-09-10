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
import { useMenuItems } from '@/features/menu/useMenuItems'

export function CategoriesPage() {
  const { categories, loading, error: loadError } = useCategories()
  const { items } = useMenuItems()

  const [newName, setNewName] = useState('')
  const [newSortOrder, setNewSortOrder] = useState('0')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSortOrder, setEditSortOrder] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const message = loadError ?? error

  async function run(action: () => Promise<void>) {
    setError(null)
    setPending(true)
    try {
      await action()
    } catch {
      setError('That change was refused. Your account may not have permission.')
    } finally {
      setPending(false)
    }
  }

  function validateName(value: string): string | null {
    if (value.trim() === '') return 'Enter a category name.'
    if (value.trim().length > CATEGORY_NAME_MAX)
      return `Names can be at most ${CATEGORY_NAME_MAX} characters.`
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
      setError('Sort order must be a whole number.')
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
      setError('Sort order must be a whole number.')
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
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="text-muted-foreground">
            How the menu is grouped. Lower sort orders appear first.
          </p>
        </div>
        <Button asChild variant="outline" size="lg" className="h-touch text-base">
          <Link to="/menu">Back to the menu</Link>
        </Button>
      </div>

      {message && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <form
        onSubmit={(event) => void handleCreate(event)}
        noValidate
        className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <div className="grid min-w-48 flex-1 gap-2">
          <Label htmlFor="new-category-name">New category</Label>
          <Input
            id="new-category-name"
            className="h-touch text-base"
            placeholder="Coffee"
            maxLength={CATEGORY_NAME_MAX}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="grid w-32 gap-2">
          <Label htmlFor="new-category-sort">Sort order</Label>
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
          Add
        </Button>
      </form>

      {categories.length === 0 ? (
        <p className="text-muted-foreground">No categories yet. Add the first one above.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Sort order</TableHead>
                <TableHead className="w-24">Items</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-72 text-right">Actions</TableHead>
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
                          aria-label="Category name"
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
                          aria-label="Category sort order"
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
                    <TableCell className="text-sm text-muted-foreground">
                      {category.active ? 'Visible' : 'Hidden'}
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
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => setEditingId(null)}
                          >
                            <X aria-hidden="true" />
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Rename ${category.name}`}
                            onClick={() => startEditing(category)}
                          >
                            <Pencil aria-hidden="true" />
                            Rename
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              void run(() => setCategoryActive(category.id, !category.active))
                            }
                          >
                            {category.active ? 'Hide' : 'Show'}
                          </Button>
                          <ConfirmDeleteDialog
                            title={`Delete ${category.name}?`}
                            description={
                              count > 0
                                ? `${count} item${count === 1 ? '' : 's'} still belong to this category. They will not be deleted, but they will show as Uncategorised until you move them.`
                                : 'This category has no items. Deleting it cannot be undone.'
                            }
                            onConfirm={() => run(() => deleteCategory(category.id))}
                          >
                            <Button variant="destructive" size="sm">
                              Delete
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
