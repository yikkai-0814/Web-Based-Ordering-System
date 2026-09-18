import { message, type Message } from '@/features/i18n/messages'
import { useTranslation } from '@/features/i18n/useTranslation'
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
import { StatusBadge } from '@/features/pos/StatusBadge'
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
  const { t } = useTranslation()
  const { staff, loading, error: loadError } = useStaffMembers()

  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [error, setError] = useState<Message | null>(null)
  const [pending, setPending] = useState(false)

  const banner = loadError ?? error

  async function run(action: () => Promise<void>) {
    setError(null)
    setPending(true)
    try {
      await action()
    } catch {
      setError(message('staff.writeRefusedAdmin'))
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.staff')}</h1>
        <p className="text-muted-foreground">{t('staff.blurb')}</p>
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
          <Label htmlFor="new-staff-name">{t('staff.addMember')}</Label>
          <Input
            id="new-staff-name"
            className="h-touch text-base"
            placeholder={t('staff.namePlaceholder')}
            maxLength={STAFF_NAME_MAX}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={pending}
          />
        </div>
        <Button type="submit" size="lg" className="h-touch text-base" disabled={pending}>
          <Plus aria-hidden="true" />
          {t('common.add')}
        </Button>
      </form>

      {/* Only the roster waits. Everything above — the heading, the blurb, the form for
          adding somebody — is static or usable straight away, so returning a bare skeleton
          for the whole page meant a navigation here showed nothing at all, not even a title,
          until Firestore answered. */}
      {loading ? (
        <Skeleton className="h-96 w-full max-w-3xl" />
      ) : staff.length === 0 ? (
        <p className="text-muted-foreground">{t('staff.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          {/* The status and action columns ask for 7rem and 16rem; below about 36rem the
              browser takes that back from them and the buttons start wrapping into each
              other. Declaring the width the columns need lets this container scroll instead,
              which is the same answer Orders and Reports already give. */}
          <Table className="min-w-xl">
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.name')}</TableHead>
                <TableHead className="w-28">{t('staff.columnStatus')}</TableHead>
                <TableHead className="w-64 text-right">{t('common.actions')}</TableHead>
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
                          aria-label={t('staff.name')}
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
                    <TableCell>
                      {/* The same badge the menu and the orders list use: grey-versus-darker-
                          grey text said nothing at a glance, and whether somebody is still on
                          the roster is the one thing this column exists to answer. */}
                      <StatusBadge
                        label={t(member.active ? 'common.active' : 'common.inactive')}
                        tone={member.active ? 'good' : 'warn'}
                        testId="staff-status"
                        value={member.active ? 'active' : 'inactive'}
                      />
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
                            aria-label={t('common.renameNamed', { name: member.name })}
                            onClick={() => startEditing(member)}
                          >
                            {t('common.rename')}
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
                            {t(member.active ? 'common.deactivate' : 'staff.reactivate')}
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
