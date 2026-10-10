'use client';

import Link from 'next/link';
import { useCopy } from '@/lib/i18n/client';
import type { GettingStartedStep } from '@/lib/home/gettingStarted';
import AddMileageForm from './AddMileageForm';
import AddServiceItemForm from './AddServiceItemForm';

export default function HomeGettingStarted({ step }: { step: GettingStartedStep }) {
  const { RU, path } = useCopy();
  const copy = RU.home.gettingStarted;
  const title = copy[`${step.kind}Title`];
  const body = copy[`${step.kind}Body`];

  return (
    <section className="getting-started" aria-labelledby="getting-started-title" data-step={step.kind}>
      <p className="getting-started-label">{copy.label}</p>
      <h2 id="getting-started-title">{title}</h2>
      {step.kind === 'replacement' && <p className="getting-started-item">{step.item.title}</p>}
      <p>{body}</p>
      {step.kind === 'history' && <p>{copy.historyNote}</p>}
      <div className="getting-started-actions">
        {step.kind === 'odometer' && <AddMileageForm buttonLabel={copy.odometerAction} />}
        {step.kind === 'item' && <AddServiceItemForm />}
        {step.kind === 'replacement' && (
          <Link className="btn-primary" href={path(`/items/${encodeURIComponent(step.item.id)}`)} prefetch={false}>
            {copy.replacementAction}
          </Link>
        )}
        <a className="btn-secondary" href={path('/demo')}>{copy.demoAction}</a>
      </div>
    </section>
  );
}
