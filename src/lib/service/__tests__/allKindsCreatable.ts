import type * as ServiceEventKinds from '../serviceEventKinds';

/**
 * Release B for a test file: every kind the app reads is also creatable.
 *
 * The shipped release A creates replacements only (`CREATABLE_SERVICE_EVENT_KINDS`), but the
 * check / top-up behaviour of the form and of `addServiceEvent` stays covered by the suites
 * that use this helper, so release B needs only the one-line constant change. Release A's
 * own behaviour is covered without it (`serviceRecordFormReleaseA.test.tsx`,
 * `serviceEventCreationReleaseA.test.ts`).
 *
 * `vi.mock` is hoisted above imports, so the helper is loaded inside the factory:
 *
 *   vi.mock('@/lib/service/serviceEventKinds', async (importOriginal) =>
 *     (await import('@/lib/service/__tests__/allKindsCreatable')).allKindsCreatable(await importOriginal()));
 */
export function allKindsCreatable(actual: typeof ServiceEventKinds): typeof ServiceEventKinds {
  return {
    ...actual,
    CREATABLE_SERVICE_EVENT_KINDS: actual.SERVICE_EVENT_KINDS,
    isCreatableServiceEventKind: actual.isServiceEventKind,
  };
}
