import { useTranslation } from '@/features/i18n/useTranslation'
import { Link } from 'react-router'
import { ShieldOff } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function ForbiddenPage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <ShieldOff className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">{t('auth.forbidden.title')}</h1>
      <p className="text-muted-foreground">{t('auth.forbidden.blurb')}</p>
      <Button asChild size="lg" className="h-touch text-base">
        <Link to="/dashboard">{t('dashboard.back')}</Link>
      </Button>
    </div>
  )
}
