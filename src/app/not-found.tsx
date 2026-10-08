'use client';
import Link from 'next/link';
import { useCopy } from '@/lib/i18n/client';
export default function NotFound() {
  const { t, path } = useCopy();
  return <div className="page-content"><h1>{t('Страница не найдена')}</h1><Link href={path('/')}>{t('На главную')}</Link></div>;
}
