import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { EN } from '../en';
import { calcServiceStatus } from '@/lib/service/calcServiceStatus';
import { buildServiceItemStatusVM } from '@/lib/service/serviceItemStatusVM';
import { translateSystem } from '../copy';
import type { ServiceItem, ServiceEvent } from '@/lib/db/types';
function files(directory: string): string[] {
  return fs.readdirSync(directory).flatMap(name => {
    const file = path.join(directory, name);
    return fs.statSync(file).isDirectory() ? name === '__tests__' ? [] : files(file) : file.endsWith('.tsx') ? [file] : [];
  });
}
it('has no hardcoded Cyrillic user copy in JSX or string expressions outside typed translations', () => {
  const unlocalized: string[] = [];
  for (const file of files(path.resolve('src/app'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if ((ts.isStringLiteral(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /[А-Яа-яЁё]/.test(node.text)) {
        const parent = node.parent;
        if (ts.isCallExpression(parent) && parent.expression.getText(source) === 't') {
          expect(Object.hasOwn(EN, node.text), `${file}: missing key ${node.text}`).toBe(true); return;
        }
        // Comparisons match stored user titles or legacy action/status contracts;
        // translating those would change behavior or user data.
        if (ts.isCallExpression(parent) && parent.expression.getText(source).endsWith('.includes')) return;
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) return;
        unlocalized.push(`${path.relative(process.cwd(), file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(unlocalized).toEqual([]);
});
const item: ServiceItem = {
  id: 'item', user_id: 'user', title: 'Моё название', interval_km: 10000, interval_days: null,
  notify_before_days: 30, notify_before_km: null, measurement_mode: 'km', note: 'Моя заметка', is_active: true, created_at: '2026-01-01T00:00:00Z',
};
const event: ServiceEvent = { id: 'event', user_id: 'user', service_item_id: 'item', mileage_km: 100000, occurred_at: '2026-01-01T12:00:00Z', note: 'Мой комментарий', created_at: '2026-01-01T12:00:00Z' };
describe('system text from the unchanged calculation engine', () => {
  it.each(['km', 'calendar'] as const)('localizes every %s status without changing calculations or personal text', mode => {
    const configured = { ...item, measurement_mode: mode, interval_km: mode === 'km' ? 10000 : null, interval_days: mode === 'calendar' ? 365 : null };
    for (const mileage of [null, 100000, 109000, 110001]) for (const dailyKmRate of [null, 30]) for (const lastEvent of [null, event]) for (const date of ['2026-01-02', '2026-12-15', '2027-02-01']) {
      const status = calcServiceStatus({ serviceItem: configured, latestOdometerMileageKm: mileage, lastEvent, dailyKmRate, now: new Date(date) });
      const before = structuredClone(status);
      const vm = buildServiceItemStatusVM(configured, status, { measurement_mode: mode, interval_km: configured.interval_km, interval_days: configured.interval_days, notify_before_days: 30, dailyKmRate });
      for (const text of [status.why, status.primary.label, status.primary.unit, vm.statusText]) expect(translateSystem('en', text), text).not.toMatch(/[А-Яа-яЁё]/);
      expect(status).toEqual(before);
    }
    expect(configured.title).toBe('Моё название'); expect(configured.note).toBe('Моя заметка'); expect(event.note).toBe('Мой комментарий');
  });
});
