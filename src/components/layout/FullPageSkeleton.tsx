import { useTranslation } from '@/features/i18n/useTranslation'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shown while the auth state is still resolving.
 *
 * Firebase restores a session asynchronously, so rendering the login screen during that
 * window makes every hard refresh flash "signed out" before snapping back. Holding this
 * placeholder until the status is known avoids that.
 */
export function FullPageSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-svh flex-col" aria-busy="true" aria-label={t('common.loading')}>
      <div className="flex h-16 items-center gap-4 border-b px-6">
        <Skeleton className="h-8 w-40" />
        <div className="ml-auto flex items-center gap-3">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </div>
      <div className="flex flex-1">
        <div className="hidden w-60 flex-col gap-3 border-r p-4 md:flex">
          <Skeleton className="h-touch w-full" />
          <Skeleton className="h-touch w-full" />
          <Skeleton className="h-touch w-full" />
        </div>
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full max-w-3xl" />
        </div>
      </div>
    </div>
  )
}
