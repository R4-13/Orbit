/**
 * Prüft den HubSpot-Adapter gegen einen ECHTEN HubSpot-Testaccount: legt eindeutig gekennzeichnete Testdatensätze an (Name beginnt mit „ORBIT-Test“), spielt den ganzen Weg durch
 * (Kontakt, Unternehmen, Verknüpfung, Anfrage als Deal, Notiz, Wiederfinden, kein Überschreiben) und **löscht sie am Ende wieder** (HubSpot legt gelöschte Datensätze 90 Tage in den
 * Papierkorb). Nur für Testaccounts gedacht.
 *
 *   set -a && source .env && set +a      # enthält HUBSPOT_SERVICE_KEY
 *   pnpm --filter @orbit/api exec ts-node scripts/hubspot-live-check.ts [--keep]
 *
 * `--keep` lässt die Datensätze stehen (zum Ansehen in HubSpot); sie sind am Namen erkennbar und können von Hand gelöscht werden.
 */
import { randomBytes } from 'node:crypto';
import { HubSpotCrmConnector } from '@orbit/integration-core';

const key = process.env.HUBSPOT_SERVICE_KEY?.trim();
if (!key) {
  console.error('HUBSPOT_SERVICE_KEY ist nicht gesetzt.');
  process.exit(1);
}
const keep = process.argv.includes('--keep');
const hub = new HubSpotCrmConnector({ tokenFor: async () => key });
const tenantId = 'live-check';
const tag = randomBytes(3).toString('hex');
const created: Array<['contacts' | 'companies' | 'deals' | 'notes', string]> = [];
let failures = 0;
let testDomain: string | undefined;

function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${name}${detail === undefined ? '' : ` – ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  const access = await hub.verifyAccess(key as string);
  check('Schlüssel und Berechtigungen (Kontakte, Unternehmen, Deals)', access.ok, access);
  if (!access.ok) return;

  // Die E-Mail liegt auf der Domain des Testunternehmens: HubSpot legt aus der Domain einer Kontakt-Adresse selbst ein Unternehmen an bzw. ordnet es zu.
  const domain = `orbit-test-${tag}.example.com`;
  const email = `kontakt@${domain}`;
  testDomain = domain;

  const company = await hub.upsertCompany({ tenantId, name: `ORBIT-Test Firma ${tag}`, domain });
  created.push(['companies', company.externalId]);
  check('Unternehmen angelegt', /^\d+$/.test(company.externalId), company);
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const again = await hub.upsertCompany({ tenantId, name: 'Anderer Name', domain });
  check('Unternehmen über die Domain wiedergefunden, nicht doppelt angelegt', again.externalId === company.externalId && again.name === company.name, again);

  // HubSpot-Suchindex: neue Datensätze sind erst nach einigen Sekunden suchbar.
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const contact = await hub.upsertContact({ tenantId, email, firstName: 'ORBIT-Test', lastName: `Kontakt ${tag}`, phone: '+49 221 5550100', companyExternalId: company.externalId });
  created.push(['contacts', contact.externalId]);
  check('Kontakt angelegt und mit dem Unternehmen verknüpft', /^\d+$/.test(contact.externalId), contact);
  const same = await hub.upsertContact({ tenantId, email: email.toUpperCase(), firstName: 'Geändert', lastName: 'Geändert' });
  check('Kontakt über die E-Mail (Groß/Klein egal) wiedergefunden', same.externalId === contact.externalId, same.externalId);
  check('Bestehender Kontakt wurde nicht überschrieben', same.firstName === 'ORBIT-Test' && same.lastName === `Kontakt ${tag}`, { firstName: same.firstName, lastName: same.lastName });
  const found = await hub.findContactByEmail(tenantId, email);
  check('Suche nach der E-Mail liefert den Kontakt', found?.externalId === contact.externalId);
  check('Suche nach einer unbekannten E-Mail liefert „nicht gefunden“', (await hub.findContactByEmail(tenantId, `orbit-unbekannt-${tag}@example.com`)) === null);

  const lead = await hub.createLead({ tenantId, contactExternalId: contact.externalId, companyExternalId: company.externalId, source: 'EMAIL', notes: `ORBIT-Test ${tag}: Anfrage Wärmepumpe` });
  created.push(['deals', lead.externalId]);
  check('Anfrage als Deal angelegt (erste Phase der ersten Pipeline)', /^\d+$/.test(lead.externalId), lead);

  await hub.logActivity({ tenantId, contactExternalId: contact.externalId, activityType: 'EMAIL_RECEIVED', summary: `ORBIT-Test ${tag}`, occurredAt: new Date() });
  check('Notiz am Kontakt angelegt', true);
}

async function cleanup(): Promise<void> {
  if (keep) {
    console.log(`\n--keep: ${created.length} Testdatensätze bleiben stehen (Namen beginnen mit „ORBIT-Test“).`);
    return;
  }
  // HubSpot kann zur Domain der Kontakt-Adresse selbst Unternehmen angelegt haben: alle mit der Testdomain werden mit entfernt.
  if (testDomain) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    for (const id of await hub.findCompanyIdsByDomain(tenantId, testDomain)) if (!created.some(([, known]) => known === id)) created.push(['companies', id]);
  }
  // Notizen hängen am Kontakt; zuerst Deals, dann Kontakt und Unternehmen.
  for (const [object, id] of [...created].reverse()) {
    try {
      await hub.archive(tenantId, object, id);
    } catch (error) {
      check(`Aufräumen ${object}/${id}`, false, error instanceof Error ? error.message : String(error));
    }
  }
  console.log(`\nAufgeräumt: ${created.length} Testdatensätze gelöscht (Papierkorb von HubSpot, 90 Tage). Notizen verschwinden mit dem Kontakt.`);
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error('Abbruch:', error instanceof Error ? `${error.name}: ${error.message}` : error);
  })
  .finally(async () => {
    await cleanup();
    console.log(failures === 0 ? '\nAlles in Ordnung.' : `\n${failures} Prüfung(en) fehlgeschlagen.`);
    process.exitCode = failures === 0 ? 0 : 2;
  });
