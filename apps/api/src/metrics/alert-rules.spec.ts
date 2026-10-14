import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MetricsService } from './metrics.service';

/** Die Alarmregeln (infra/prometheus/orbit-alerts.yml) dürfen nur Metriken verwenden, die ORBIT wirklich liefert – sonst schweigt ein Alarm für immer. */
describe('Prometheus-Alarmregeln', () => {
  const rules = readFileSync(join(__dirname, '../../../../infra/prometheus/orbit-alerts.yml'), 'utf8');

  it('verwenden ausschließlich vorhandene Metriken', async () => {
    const service = new MetricsService();
    const known = new Set((await service.registry.getMetricsAsJSON()).map((m) => m.name));
    const used = new Set<string>();
    for (const line of rules.split('\n')) {
      for (const match of line.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+?)(?:_count|_bucket|_sum)?(?=[{[ )]|$)/g)) {
        const name = match[1]!;
        if (/_(seconds|total|depth|time)$/.test(name)) used.add(name);
      }
    }
    expect(used.size).toBeGreaterThan(4);
    for (const name of used) expect({ name, known: known.has(name) }).toEqual({ name, known: true });
  });

  it('jede Regel hat Schweregrad, Titel und Beschreibung', () => {
    const alerts = rules.split('- alert: ').slice(1);
    expect(alerts.length).toBeGreaterThanOrEqual(8);
    for (const block of alerts) {
      expect(block).toMatch(/severity:/);
      expect(block).toMatch(/summary:/);
      expect(block).toMatch(/description:/);
    }
  });
});
