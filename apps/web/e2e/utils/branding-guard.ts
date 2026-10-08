import { API_BASE_URL, DEMO_USERS, loginViaApi } from './login';

const FIELDS = [
  'companyDisplayName',
  'logoUrl',
  'logoMarkUrl',
  'primaryColor',
  'primaryForeground',
  'secondaryColor',
  'secondaryForeground',
  'accentColor',
  'accentForeground',
  'navigationBackground',
  'navigationForeground',
  'borderRadiusPreset',
] as const;

/**
 * Sichert das Erscheinungsbild des Demo-Mandanten und liefert eine Funktion, die es exakt wiederherstellt. Tests, die Logo, Name oder Farben speichern,
 * dürfen die Einstellungen der Person, die diese Umgebung nutzt, nie dauerhaft verändern – früher blieb nach jedem Lauf ein 1×1-Pixel-Testlogo als
 * Firmenlogo zurück und verdrängte das hochgeladene Logo.
 */
export async function snapshotBranding(): Promise<() => Promise<void>> {
  const token = await loginViaApi(DEMO_USERS.admin);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await fetch(`${API_BASE_URL}/api/v1/tenant/branding`, { headers });
  if (!response.ok) throw new Error(`Erscheinungsbild konnte nicht gesichert werden: ${response.status}`);
  const { branding } = (await response.json()) as { branding: Record<string, unknown> | null };

  return async () => {
    if (!branding) {
      await fetch(`${API_BASE_URL}/api/v1/tenant/branding`, { method: 'DELETE', headers });
      return;
    }
    // Ausdrücklich auch `null` senden: ein im Test gesetztes Feld, das vorher leer war, wird so wieder geleert.
    const body = Object.fromEntries(FIELDS.map((field) => [field, branding[field] ?? null]));
    const restored = await fetch(`${API_BASE_URL}/api/v1/tenant/branding`, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!restored.ok) throw new Error(`Erscheinungsbild konnte nicht wiederhergestellt werden: ${restored.status} ${await restored.text()}`);
  };
}
