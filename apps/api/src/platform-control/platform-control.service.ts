import { Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import {
  evaluateFlag,
  tenantGateOf,
  type FlagDefinition,
  type FlagEvaluation,
  type KillSwitchKey,
  type TenantGate,
} from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface ConnectorGovernance {
  lifecycle: string;
  reason?: string | null;
}

/** Wie lange eine Plattformentscheidung höchstens veraltet sein darf. Schreibende Zugriffe im selben Prozess invalidieren sofort. */
const TTL_MS = 5_000;

/**
 * Lesender Laufzeitzugriff auf die Plattformsteuerung (Amendment 03 §6, §13–§15): Kill Switches, Connector-Zustand, Mandantensperren, Feature Flags.
 * Wird von den Durchsetzungspunkten (Policy, KI-Auflösung, Planer, Capability-Ausführbarkeit, Anmeldung) abgefragt. Entscheidungen werden höchstens 5 Sekunden
 * zwischengespeichert, damit nicht jede Anfrage die Datenbank belastet; in einem Prozess wirken Änderungen sofort (`invalidate`), über mehrere Replikas
 * nach spätestens `TTL_MS`. Ein Lesefehler führt NIE zu einer Lockerung: Kill Switch → Annahme „aktiv“ ist nicht möglich, deshalb wird der letzte bekannte Wert
 * weiterverwendet, ohne Wert gilt der sichere Standard des jeweiligen Aufrufers (siehe `killSwitchEngaged`).
 */
@Injectable()
export class PlatformControlService {
  private readonly switches = new Map<string, CacheEntry<boolean>>();
  private readonly gates = new Map<string, CacheEntry<TenantGate>>();
  private connectors?: CacheEntry<Map<string, ConnectorGovernance>>;
  private flags?: CacheEntry<Map<string, FlagDefinition & { exposeToTenant: boolean }>>;
  private lastKnownSwitches = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {}

  invalidate(): void {
    this.switches.clear();
    this.gates.clear();
    this.connectors = undefined;
    this.flags = undefined;
  }

  async killSwitchEngaged(key: KillSwitchKey): Promise<boolean> {
    const cached = this.switches.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const row = await this.prisma.withPlatformScope((tx) => tx.platformKillSwitch.findUnique({ where: { key } }));
      const value = row?.engaged ?? false;
      this.lastKnownSwitches.set(key, value);
      this.switches.set(key, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    } catch {
      // Datenbank nicht lesbar: den zuletzt bekannten Zustand halten (ein gezogener Schalter bleibt gezogen), sonst „nicht gezogen“.
      return this.lastKnownSwitches.get(key) ?? false;
    }
  }

  async tenantGate(tenantId: string): Promise<TenantGate> {
    const cached = this.gates.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true, suspensionScopes: true } });
    // Unbekannter Mandant: nichts erlauben (fail closed).
    const gate = row ? tenantGateOf(row.status, row.suspensionScopes) : tenantGateOf('CLOSED', []);
    this.gates.set(tenantId, { value: gate, expiresAt: Date.now() + TTL_MS });
    return gate;
  }

  /** Plattformzustand eines Connectors. Ohne Zeile gilt ACTIVE (verhaltenserhaltend). */
  async connectorGovernance(connectorKey: string): Promise<ConnectorGovernance> {
    if (!this.connectors || this.connectors.expiresAt <= Date.now()) {
      const rows = await this.prisma.withPlatformScope((tx) => tx.platformConnectorDefinition.findMany());
      this.connectors = { value: new Map(rows.map((r) => [r.connectorKey, { lifecycle: r.lifecycle, reason: r.reason }])), expiresAt: Date.now() + TTL_MS };
    }
    return this.connectors.value.get(connectorKey) ?? { lifecycle: 'ACTIVE' };
  }

  /** Ein Connector, der keine neuen Verbindungen oder Aktionen annehmen darf. */
  async connectorBlocked(connectorKey: string): Promise<{ blocked: boolean; reason?: string }> {
    const governance = await this.connectorGovernance(connectorKey);
    if (['SUSPENDED', 'RETIRED'].includes(governance.lifecycle)) return { blocked: true, reason: governance.reason ?? undefined };
    return { blocked: false };
  }

  /** Auswertung eines Flags für einen Mandanten. Unbekannte Flags liefern `undefined` – der Aufrufer entscheidet über seinen Standard. */
  async evaluate(key: string, tenantId: string): Promise<FlagEvaluation | undefined> {
    if (!this.flags || this.flags.expiresAt <= Date.now()) {
      const rows = await this.prisma.withPlatformScope((tx) => tx.platformFeatureFlag.findMany());
      this.flags = {
        value: new Map(rows.map((r) => [r.key, { ...this.toDefinition(r), exposeToTenant: r.exposeToTenant }])),
        expiresAt: Date.now() + TTL_MS,
      };
    }
    const flag = this.flags.value.get(key);
    if (!flag) return undefined;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { featureCohorts: true } });
    return evaluateFlag(flag, { tenantId, cohorts: tenant?.featureCohorts ?? [], environment: this.env.ORBIT_ENVIRONMENT });
  }

  /** Alle für Mandanten freigegebenen Flags mit dem für diesen Mandanten geltenden Wert (nie Kohorten-/Override-Interna). */
  async evaluateExposed(tenantId: string): Promise<Record<string, boolean | string | number>> {
    await this.evaluate('__warm__', tenantId);
    const out: Record<string, boolean | string | number> = {};
    for (const [key, flag] of this.flags?.value ?? []) {
      if (!flag.exposeToTenant) continue;
      const result = await this.evaluate(key, tenantId);
      if (result) out[key] = result.value;
    }
    return out;
  }

  private toDefinition(row: { key: string; lifecycle: string; defaultValue: unknown; environmentOverrides: unknown; cohortOverrides: unknown; tenantOverrides: unknown; expiresAt: Date | null }): FlagDefinition {
    const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
    return {
      key: row.key,
      lifecycle: row.lifecycle,
      defaultValue: row.defaultValue as FlagDefinition['defaultValue'],
      environmentOverrides: list(row.environmentOverrides),
      cohortOverrides: list(row.cohortOverrides),
      tenantOverrides: list(row.tenantOverrides),
      expiresAt: row.expiresAt,
    };
  }
}
