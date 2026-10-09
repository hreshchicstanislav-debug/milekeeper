'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useCopy } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/routing';
import { demoWelcomeCopy, hasSeenDemoWelcome, rememberDemoWelcome } from '@/lib/demo/welcome';
import { lockScroll, unlockScroll } from '@/lib/ui/scrollLock';
import LanguageSwitcher from '../components/LanguageSwitcher';

/** Only mounted by the public demo; no account modal or auth dependencies. */
export default function DemoWelcome() {
  const { locale } = useCopy();
  const copy = demoWelcomeCopy[locale];
  const [open, setOpen] = useState(false);
  const aboutRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useCallback(() => aboutRef.current?.focus({ preventScroll: true }), []);
  // SSR and the first client render are identical. Storage is read after hydration.
  useEffect(() => { setOpen(!hasSeenDemoWelcome()); }, []);
  const close = () => {
    rememberDemoWelcome();
    setOpen(false);
  };
  return <>
    <button ref={aboutRef} className="demo-about" type="button" onClick={() => setOpen(true)}>{copy.about}</button>
    {open ? <WelcomeDialog copy={copy} ownDataHref={localizedPath('/', locale)} onClose={close} returnFocus={returnFocus} /> : null}
  </>;
}

type WelcomeCopy = typeof demoWelcomeCopy.ru | typeof demoWelcomeCopy.en;

function WelcomeDialog({ copy, ownDataHref, onClose, returnFocus }: { copy: WelcomeCopy; ownDataHref: string; onClose: () => void; returnFocus: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('.demo-welcome-close')?.focus({ preventScroll: true });
    lockScroll('DemoWelcome');
    return () => {
      dialog.close();
      unlockScroll('DemoWelcome');
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
      else returnFocus();
    };
  }, [returnFocus]);
  return <dialog ref={dialogRef} className="demo-welcome" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="demo-welcome-controls">
      <LanguageSwitcher persistPreference={false} />
      <button className="demo-welcome-close" type="button" aria-label={copy.close} onClick={onClose}>×</button>
    </div>
    <h2 id={titleId}>{copy.title}</h2>
    <div id={descriptionId} className="demo-welcome-description"><p>{copy.intro}</p><p>{copy.detail}</p></div>
    <div className="demo-welcome-note"><strong>{copy.badge}</strong><p>{copy.fictional}</p></div>
    <div className="demo-welcome-actions">
      <button className="add-mileage-button" type="button" onClick={onClose}>{copy.explore}</button>
      <a className="btn-secondary demo-link-button" href={ownDataHref} onClick={onClose}>{copy.ownData}</a>
    </div>
  </dialog>;
}
