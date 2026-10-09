'use client';

import { useCopy } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/routing';
import { demoCopy, formatDemoSoon } from '@/lib/demo/copy';
import type { DemoSnapshot } from '@/lib/demo/snapshot';
import StatusRowCompact from '../components/StatusRowCompact';
import StatusRowDetail from '../components/StatusRowDetail';
import DemoWelcome from './DemoWelcome';

export default function DemoDashboard({ snapshot }: { snapshot: DemoSnapshot }) {
  const { locale } = useCopy();
  const copy = demoCopy[locale];
  const number = (value: number | null) => value === null ? '—' : new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 0 }).format(value);
  const login = localizedPath('/login', locale);
  const date = (day: string) => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  return <div className="demo-dashboard">
    <div className="demo-banner"><strong>MileKeeper</strong><span>{copy.badge}</span></div>
    <DemoWelcome />
    <a className="demo-back" href={login}>{copy.back}</a>
    <h1>{copy.title}</h1>
    <p className="demo-muted">{copy.intro}</p>
    <p className="demo-date">{copy.date}: <time dateTime={snapshot.day}>{date(snapshot.day)}</time></p>
    <section className="demo-card" aria-label={copy.estimated}>
      <p className="demo-muted">{copy.estimated}</p>
      <p className="demo-odometer">{snapshot.odometer.isEstimated ? '~' : ''}{number(snapshot.odometer.estimatedKm)} <span>{copy.km}</span></p>
      <dl className="demo-facts">
        <div><dt>{copy.actual}</dt><dd>{number(snapshot.odometer.lastActualKm)} {copy.km}</dd><small><time dateTime={snapshot.measuredDay}>{copy.measuredOn} {date(snapshot.measuredDay)}</time></small></div>
        <div><dt>{copy.rate}</dt><dd>~{number(snapshot.rate.dailyRate)} {copy.perDay}</dd></div>
      </dl>
    </section>
    <p className="demo-explanation">{copy.explanation}</p>
    <section aria-labelledby="demo-soon">
      <h2 id="demo-soon">{copy.soon}</h2>
      <div className="demo-card demo-rows">{snapshot.soon.map(row => <StatusRowCompact key={row.id}
        title={copy.items[row.id as keyof typeof copy.items]}
        statusText={formatDemoSoon(row, locale)}
        category={row.isOverdue ? 'critical' : 'warning'} isPredictionReliable={snapshot.items.find(item => item.id === row.id)?.vm.isPredictionReliable ?? false} />)}</div>
    </section>
    <section aria-labelledby="demo-items">
      <h2 id="demo-items">{copy.all}</h2>
      <div className="demo-card demo-rows">{snapshot.items.map(row => <div className="demo-item" key={row.id}>
        <StatusRowDetail title={copy.items[row.id]} {...row.vm} />
        <div className="demo-item-meta">{row.status.status !== 'UNKNOWN' && <span>{copy.statuses[row.status.status]}</span>}<span>{row.status.remainingKm !== null ? `${copy.distance}: ${number(row.status.remainingKm)} ${copy.km}` : row.status.status === 'UNKNOWN' ? copy.missing : copy.calendar}</span></div>
      </div>)}</div>
      <p className="demo-explanation">{copy.forecast}</p>
    </section>
    <div className="demo-exit"><p className="demo-muted">{copy.exitHelp}</p><a className="add-mileage-button demo-link-button" href={login}>{copy.exit}</a></div>
  </div>;
}
