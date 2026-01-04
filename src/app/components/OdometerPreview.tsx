import type { OdometerEntry } from '@/lib/db/types';
import { RU, formatNumber } from '@/lib/copy/ru';
import { formatDateTimeRu } from '@/lib/ui/formatDateTimeRu';

interface OdometerPreviewProps {
  entries: OdometerEntry[];
}

export default function OdometerPreview({ entries }: OdometerPreviewProps) {
  // Show first 10 entries
  const previewEntries = entries.slice(0, 10);

  return (
    <div className="dev-odometer-preview">
      <h3 className="dev-odometer-preview-title">{RU.devTools.previewTitle}</h3>
      {previewEntries.length === 0 ? (
        <p className="dev-odometer-preview-empty">{RU.devTools.previewEmpty}</p>
      ) : (
        <div className="dev-odometer-preview-list">
          {previewEntries.map((entry) => (
            <div key={entry.id} className="dev-odometer-preview-item">
              <span className="dev-odometer-preview-date">
                {formatDateTimeRu(entry.occurred_at)}
              </span>
              <span className="dev-odometer-preview-arrow">→</span>
              <span className="dev-odometer-preview-mileage">
                {formatNumber(entry.mileage_km)} {RU.common.km}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

