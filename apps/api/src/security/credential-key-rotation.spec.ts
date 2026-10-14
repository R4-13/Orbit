import { randomBytes } from 'node:crypto';
import { CredentialEncryptionService } from './credential-encryption.service';
import type { PrismaService } from '../prisma/prisma.service';
import { parseKey, reencrypt, rotateCredentialKey } from './credential-key-rotation';

const serviceFor = (key: Buffer) => new CredentialEncryptionService({ CREDENTIAL_ENCRYPTION_KEY: key.toString('base64') } as never);

describe('Schlüsselrotation (TEC-08)', () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);

  it('ein neu verschlüsselter Wert ist mit dem neuen Schlüssel lesbar, mit dem alten nicht mehr', () => {
    const secret = JSON.stringify({ accessToken: 'abc', refreshToken: 'def' });
    const original = serviceFor(oldKey).encrypt(secret);
    const rotated = reencrypt(original, oldKey, newKey);
    expect(serviceFor(newKey).decrypt(rotated)).toBe(secret);
    expect(() => serviceFor(oldKey).decrypt(rotated)).toThrow();
    expect(rotated.equals(original)).toBe(false);
  });

  it('ein falscher alter Schlüssel oder ein beschädigter Wert wirft statt etwas Falsches zu schreiben', () => {
    const original = serviceFor(oldKey).encrypt('geheim');
    expect(() => reencrypt(original, randomBytes(32), newKey)).toThrow();
    const tampered = Buffer.from(original);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => reencrypt(tampered, oldKey, newKey)).toThrow();
    expect(() => reencrypt(Buffer.alloc(5), oldKey, newKey)).toThrow();
  });

  it('der Schlüssel muss Base64 für genau 32 Byte sein', () => {
    expect(parseKey(randomBytes(32).toString('base64'), 'K')).toHaveLength(32);
    expect(() => parseKey(randomBytes(16).toString('base64'), 'K')).toThrow(/genau 32 Byte/);
    expect(() => parseKey('', 'K')).toThrow();
  });

  describe('rotateCredentialKey', () => {
    /** Ein Speicher-Double mit den drei Tabellen; `withRlsBypass` führt die Funktion unmittelbar aus (die Atomarität liefert die Datenbank-Transaktion). */
    function fakeDb(rows: { integration: Buffer[]; platform: Buffer[]; ai: Array<Buffer | null> }) {
      const writes: string[] = [];
      const table = (name: string, list: Array<Buffer | null>, column: string) => ({
        findMany: jest.fn(async () => list.map((value, index) => ({ id: `${name}-${index}`, [column]: value }))),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, Uint8Array> }) => {
          writes.push(where.id);
          list[Number(where.id.split('-')[1])] = Buffer.from(data[column] as Uint8Array);
        }),
      });
      const tx = {
        integrationCredentialSecret: table('integration', rows.integration, 'encryptedValue'),
        platformSecret: table('platform', rows.platform, 'encryptedValue'),
        aIProviderConnection: table('ai', rows.ai, 'encryptedCredentials'),
      };
      const prisma = { withRlsBypass: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaService;
      return { prisma, writes, rows };
    }

    it('schreibt alle drei Tabellen neu; der Probelauf schreibt nichts', async () => {
      const make = () => ({ integration: [serviceFor(oldKey).encrypt('a'), serviceFor(oldKey).encrypt('b')], platform: [serviceFor(oldKey).encrypt('c')], ai: [serviceFor(oldKey).encrypt('d'), null] });
      const dry = fakeDb(make());
      expect(await rotateCredentialKey(dry.prisma, oldKey, newKey, { dryRun: true })).toEqual({ integrationSecrets: 2, platformSecrets: 1, aiProviderConnections: 1, dryRun: true });
      expect(dry.writes).toEqual([]);

      const real = fakeDb(make());
      expect(await rotateCredentialKey(real.prisma, oldKey, newKey, { dryRun: false })).toMatchObject({ integrationSecrets: 2, platformSecrets: 1, aiProviderConnections: 1 });
      expect(real.writes).toHaveLength(4);
      const target = serviceFor(newKey);
      expect([target.decrypt(real.rows.integration[0]!), target.decrypt(real.rows.integration[1]!), target.decrypt(real.rows.platform[0]!), target.decrypt(real.rows.ai[0]!)]).toEqual(['a', 'b', 'c', 'd']);
    });

    it('ein nicht lesbarer Wert bricht den Lauf ab (die Transaktion verwirft dann alles)', async () => {
      const db = fakeDb({ integration: [serviceFor(oldKey).encrypt('a'), serviceFor(randomBytes(32)).encrypt('fremd')], platform: [], ai: [] });
      await expect(rotateCredentialKey(db.prisma, oldKey, newKey, { dryRun: false })).rejects.toThrow();
    });
  });
});
