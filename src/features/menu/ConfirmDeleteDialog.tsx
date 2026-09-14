import { useTranslation } from '@/features/i18n/useTranslation'
import { useState, type ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

/**
 * Deletion is irreversible, so it goes behind a confirmation. Archiving is the reversible
 * everyday action and deliberately does not.
 */
export function ConfirmDeleteDialog({
  title,
  description,
  onConfirm,
  children,
}: {
  title: string
  description: string
  onConfirm: () => Promise<void>
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-delete"
            disabled={busy}
            onClick={() => void handleConfirm()}
          >
            {t(busy ? 'common.deleting' : 'common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
