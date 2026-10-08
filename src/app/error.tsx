'use client';
import { useCopy } from '@/lib/i18n/client';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useCopy();
  return <div className="page-content" role="alert"><p>{t('Не удалось выполнить действие. Попробуйте ещё раз.')}</p><button onClick={reset}>{t('Повторить')}</button></div>;
}
