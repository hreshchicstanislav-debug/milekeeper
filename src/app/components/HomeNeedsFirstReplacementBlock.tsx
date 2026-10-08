'use client';

import { useCopy } from '@/lib/i18n/client';

import Link from 'next/link';
import type { ServiceItem } from '@/lib/db/types';

interface HomeNeedsFirstReplacementBlockProps {
  items: ServiceItem[];
  totalCount: number;
}

/**
 * Home "Needs First Replacement" block component
 * Shows service items that need their first replacement event to be marked
 * Returns null if items array is empty (no empty surface)
 */
export default function HomeNeedsFirstReplacementBlock({ 
  items, 
  totalCount 
}: HomeNeedsFirstReplacementBlockProps) {
  const { t, path } = useCopy();
  // IMPORTANT: Return null if no items (no empty surface)
  if (items.length === 0) {
    return null;
  }

  const hasMore = totalCount > items.length;
  const remainingCount = totalCount - items.length;

  return (
    <section className="needs-first-replacement-section">
      <h2 className="needs-first-replacement-title">{t("Нужно отметить первую замену")}</h2>
      <p className="needs-first-replacement-subtitle">

        {t("Чтобы начать отсчёт, нажми «Отметить замену» хотя бы один раз.")}
      </p>
      <div className="needs-first-replacement-group">
        <div className="needs-first-replacement-list">
          {items.map((item, index) => (
            <div
              key={item.id}
              className={`needs-first-replacement-row ${index === items.length - 1 && !hasMore ? 'last' : ''}`}
            >
              <span className="needs-first-replacement-row-title" title={item.title}>
                {item.title}
              </span>
            </div>
          ))}
          {hasMore && (
            <div className="needs-first-replacement-row last">
              <span className="needs-first-replacement-row-more">

                {t('Ещё {count}…').replace('{count}', String(remainingCount))}
              </span>
            </div>
          )}
        </div>
        <div className="needs-first-replacement-footer">
          <Link href={path('/items')} className="needs-first-replacement-link">

            {t("Открыть все элементы")}
          </Link>
        </div>
      </div>
    </section>
  );
}

