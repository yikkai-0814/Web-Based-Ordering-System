import { useTranslation } from '@/features/i18n/useTranslation'
import { Link } from 'react-router'
import { FileQuestion } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <FileQuestion className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">{t('auth.notFound.title')}</h1>
      <p className="text-muted-foreground">{t('auth.notFound.blurbShort')}</p>
      <Button asChild size="lg" className="h-touch text-base">
        <Link to="/dashboard">{t('dashboard.back')}</Link>
      </Button>
    </div>
  )
}
