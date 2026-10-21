/**
 * Sucht (nur lesend) Nachrichten über ihre RFC-Message-ID im Postfach eines Betriebs – einschließlich Spam und Papierkorb – und meldet, wo sie liegen (Etiketten) und ob ORBIT sie kennt.
 * Zweck: nachweisen, warum eine gesendete Mail nicht in ORBIT erschien (Zustellung, Spam, Abfrage), statt es zu vermuten. Verändert nichts im Postfach und in ORBIT.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/find-mail-in-mailbox.ts <tenant-slug> "<message-id>" ["<message-id>" …]
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { GmailConnectorService } from '../src/integrations/gmail-connector.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const [slug, ...ids] = process.argv.slice(2);
  if (!slug || ids.length === 0) throw new Error('Aufruf: find-mail-in-mailbox.ts <tenant-slug> "<message-id>" …');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const gmail = app.get(GmailConnectorService) as unknown as { getValidAccessToken(t: string): Promise<string>; gmailFetch(token: string, path: string): Promise<Response> };
    const token = await gmail.getValidAccessToken(tenant.id);
    for (const rfc of ids) {
      const query = encodeURIComponent(`rfc822msgid:${rfc.replace(/^<|>$/g, '')}`);
      const list = (await (await gmail.gmailFetch(token, `/users/me/messages?q=${query}&includeSpamTrash=true`)).json()) as { messages?: Array<{ id: string }> };
      const found = list.messages ?? [];
      const known = await prisma.forTenantId(tenant.id).emailMessage.count({ where: { rfcMessageId: rfc } });
      if (found.length === 0) {
        console.log(`${rfc}: im Postfach NICHT gefunden (auch nicht in Spam/Papierkorb) · in ORBIT bekannt: ${known}`);
        continue;
      }
      for (const m of found) {
        const meta = (await (await gmail.gmailFetch(token, `/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`)).json()) as { labelIds?: string[]; internalDate?: string };
        const inbox = meta.labelIds?.includes('INBOX') ? 'JA' : 'NEIN';
        console.log(`${rfc}: gefunden (Gmail-Kennung ${m.id}) · Etiketten ${JSON.stringify(meta.labelIds ?? [])} · im Posteingang: ${inbox} · eingegangen ${meta.internalDate ? new Date(Number(meta.internalDate)).toISOString() : '?'} · in ORBIT bekannt: ${known}`);
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
