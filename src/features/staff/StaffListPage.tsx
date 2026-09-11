import { useState, type FormEvent } from 'react'
import { AlertCircle, Check, Plus, UserRound, X } from 'lucide-react'

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
import { createStaffMember, renameStaffMember, setStaffActive } from '@/features/staff/staff-api'
import { STAFF_NAME_MAX, validateStaffName, type StaffMember } from '@/features/staff/types'
import { useStaffMembers } from '@/features/staff/useStaffMembers'

/**
 * Admin-only staff roster.
 *
 * Shaped almost exactly like CategoriesPage — inline add and rename, an active toggle — with
 * one difference: **there is no delete.** Past orders name these people, so retiring someone
 * is deactivation, which hides them from the till and leaves their sales intact.
 */
export function StaffListPage() {
  const { staff, loading, error: loadError } = useStaffMembers()

  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const message = loadError ?? error

  async function run(action: () => Promise<void>) {
    setError(null)
    setPending(true)
    try {
      await action()
    } catch {
      setError('That change was refused. Only administrators can manage staff.')
    } finally {
      setPending(false)
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validated = validateStaffName(newName)
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    await run(async () => {
      await createStaffMember(validated.name)
      setNewName('')
    })
  }

  function startEditing(member: StaffMember) {
    setEditingId(member.id)
    setEditName(member.name)
    setError(null)
  }

  async function saveEdit(member: StaffMember) {
    const validated = validateStaffName(editName)
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    await run(async () => {
      await renameStaffMember(member.id, validated.name)
      setEditingId(null)
    })
  }

  if (loading) return <Skeleton className="h-96 w-full max-w-3xl" />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
        <p className="text-muted-foreground">
          People who operate the till. These are not login accounts — they identify who took an
          order. Deactivate to retire someone; their past orders keep their name.
        </p>
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
          <Label htmlFor="new-staff-name">Add staff member</Label>
          <Input
            id="new-staff-name"
            className="h-touch text-base"
            placeholder="Alice"
            maxLength={STAFF_NAME_MAX}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={pending}
          />
        </div>
        <Button type="submit" size="lg" className="h-touch text-base" disabled={pending}>
          <Plus aria-hidden="true" />
          Add
        </Button>
      </form>

      {staff.length === 0 ? (
        <p className="text-muted-foreground">No staff members yet. Add the first one above.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-64 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((member) => {
                const editing = editingId === member.id
                return (
                  <TableRow
                    key={member.id}
                    data-testid="staff-row"
                    data-staff-name={member.name}
                    data-active={member.active}
                  >
                    <TableCell>
                      {editing ? (
                        <Input
                          aria-label="Staff name"
                          className="h-touch text-base"
                          maxLength={STAFF_NAME_MAX}
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      ) : (
                        <span className="flex items-center gap-2 font-medium">
                          <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                          {member.name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={member.active ? 'text-sm' : 'text-sm text-muted-foreground'}
                      data-testid="staff-status"
                    >
                      {member.active ? 'Active' : 'Inactive'}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {editing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => void saveEdit(member)}
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
                            aria-label={`Rename ${member.name}`}
                            onClick={() => startEditing(member)}
                          >
                            Rename
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            data-testid="toggle-active"
                            onClick={() =>
                              void run(() => setStaffActive(member.id, !member.active))
                            }
                          >
                            {member.active ? 'Deactivate' : 'Reactivate'}
                          </Button>
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
