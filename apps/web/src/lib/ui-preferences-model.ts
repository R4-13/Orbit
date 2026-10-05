import { SONDE_DEFAULT_WIDTH, clampSondeWidth, type NavMode } from './shell-layout';

/** Version des gespeicherten Layouts: bei Änderung werden bekannte Einstellungen migriert, ungültige sicher verworfen (UI v2 §20.3). */
export const UI_PREFERENCES_VERSION = 1;

export type HomePeriod = 'TODAY' | 'WEEK' | 'MONTH';
export type HomeView = 'MINE' | 'TEAM';

/** Optionale Zonen der Home-Seite. Aufmerksamkeit und KPIs sind Pflicht und deshalb nicht abschaltbar (§20.2). */
export const HOME_OPTIONAL_ZONES = ['inbox', 'finance', 'sales', 'tasks', 'completed'] as const;
export type HomeOptionalZone = (typeof HOME_OPTIONAL_ZONES)[number];

export interface HomePreferences {
  period: HomePeriod;
  view: HomeView;
  /** Reihenfolge der zwei Fachbereichskarten innerhalb ihrer Zone. */
  domainOrder: Array<'finance' | 'sales'>;
  /** Bewusst ausgeblendete optionale Zonen. */
  hidden: HomeOptionalZone[];
}

export interface UiPreferences {
  layoutVersion: number;
  navMode: NavMode;
  /** `null` = nie entschieden: Erststart öffnet Sonde nur, wenn sie angedockt werden kann (§8.2). */
  sondeOpen: boolean | null;
  sondeWidth: number;
  home: HomePreferences;
}

export const DEFAULT_HOME_PREFERENCES: HomePreferences = {
  period: 'TODAY',
  view: 'MINE',
  domainOrder: ['finance', 'sales'],
  hidden: [],
};

export const DEFAULT_PREFERENCES: UiPreferences = {
  layoutVersion: UI_PREFERENCES_VERSION,
  navMode: 'labels',
  sondeOpen: null,
  sondeWidth: SONDE_DEFAULT_WIDTH,
  home: DEFAULT_HOME_PREFERENCES,
};

export function preferencesKey(tenantId: string, userId: string): string {
  return `orbit.ui.v${UI_PREFERENCES_VERSION}.${tenantId}.${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Liest gespeicherte Einstellungen defensiv: jeder ungültige oder fremde Wert fällt auf den Standard zurück. */
export function parsePreferences(raw: string | null): UiPreferences {
  if (!raw) return DEFAULT_PREFERENCES;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (!isRecord(value) || value.layoutVersion !== UI_PREFERENCES_VERSION) return DEFAULT_PREFERENCES;

  const home = isRecord(value.home) ? value.home : {};
  const domainOrder = Array.isArray(home.domainOrder) ? home.domainOrder.filter((item): item is 'finance' | 'sales' => item === 'finance' || item === 'sales') : [];
  const hidden = Array.isArray(home.hidden)
    ? home.hidden.filter((item): item is HomeOptionalZone => (HOME_OPTIONAL_ZONES as readonly unknown[]).includes(item))
    : [];

  return {
    layoutVersion: UI_PREFERENCES_VERSION,
    navMode: value.navMode === 'rail' ? 'rail' : 'labels',
    sondeOpen: typeof value.sondeOpen === 'boolean' ? value.sondeOpen : null,
    sondeWidth: typeof value.sondeWidth === 'number' && Number.isFinite(value.sondeWidth) ? clampSondeWidth(value.sondeWidth) : SONDE_DEFAULT_WIDTH,
    home: {
      period: home.period === 'WEEK' || home.period === 'MONTH' ? home.period : 'TODAY',
      view: home.view === 'TEAM' ? 'TEAM' : 'MINE',
      domainOrder: domainOrder.length === 2 && new Set(domainOrder).size === 2 ? domainOrder : DEFAULT_HOME_PREFERENCES.domainOrder,
      hidden: [...new Set(hidden)],
    },
  };
}

export function serializePreferences(preferences: UiPreferences): string {
  return JSON.stringify(preferences);
}
