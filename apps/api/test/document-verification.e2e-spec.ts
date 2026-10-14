import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/** Prüfung hochgeladener Dateien an ihren Bytes (MST-09) gegen echtes MinIO und Postgres. */
describe('Dokumenten-Upload: Prüfung der Bytes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let tenantId: string;
  let token: string;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** Legt Dokument samt (optional) Objekt an; der Upload selbst wird durch direktes Schreiben in den Speicher ersetzt. */
  async function register(declared: { fileName: string; mimeType: string; sizeBytes: number }, content?: Buffer): Promise<string> {
    const created = (await api().post('/api/v1/documents/upload-url').set(auth()).send(declared).expect(201)).body as { document: { id: string; storageKey: string } };
    if (content) await storage.putObjectBytes(created.document.storageKey, content, declared.mimeType);
    return created.document.id;
  }
  const stored = (id: string) => prisma.forTenantId(tenantId).document.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    const suffix = randomUUID();
    const { tenant, adminUser } = await app.get(TenantsService).bootstrapTenant({ name: `Doc ${suffix.slice(0, 8)}`, slug: `e2e-docs-${suffix}`, adminEmail: `a-${suffix}@e2e-docs.example`, adminPassword: PASSWORD, adminFirstName: 'A', adminLastName: 'B' });
    tenantId = tenant.id;
    token = (await api().post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD }).expect(200)).body.accessToken as string;
  });
  afterAll(async () => {
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  it('eine echte PDF in angekündigter Größe wird bestätigt und lässt sich herunterladen', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');
    const id = await register({ fileName: 'rechnung.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length }, pdf);
    const verified = (await api().post(`/api/v1/documents/${id}/verify`).set(auth()).expect(200)).body as { verificationStatus: string };
    expect(verified.verificationStatus).toBe('VERIFIED');
    await api().get(`/api/v1/documents/${id}/download-url`).set(auth()).expect(200);
  });

  it('ein Programm, das sich als PDF ausgibt, wird abgelehnt, gelöscht und nie ausgeliefert', async () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(60, 1)]);
    const id = await register({ fileName: 'rechnung.pdf', mimeType: 'application/pdf', sizeBytes: exe.length }, exe);
    const rejected = await api().post(`/api/v1/documents/${id}/verify`).set(auth()).expect(403);
    expect(JSON.stringify(rejected.body)).toContain('Windows');
    const row = await stored(id);
    expect(row).toMatchObject({ verificationStatus: 'REJECTED' });
    expect(await storage.probeObject(row.storageKey, 16)).toBeUndefined();
    await api().get(`/api/v1/documents/${id}/download-url`).set(auth()).expect(403);
    expect(await prisma.forTenantId(tenantId).auditLog.count({ where: { eventType: 'DOCUMENT_UPLOAD_REJECTED', entityId: id } })).toBe(1);
  });

  it('eine andere Größe als angekündigt wird abgelehnt', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
    const id = await register({ fileName: 'bild.png', mimeType: 'image/png', sizeBytes: 20 }, png);
    await api().post(`/api/v1/documents/${id}/verify`).set(auth()).expect(403);
    expect((await stored(id)).verificationNote).toContain('weicht');
  });

  it('ohne Upload bleibt der Status offen (der Upload kann noch laufen)', async () => {
    const id = await register({ fileName: 'spaeter.pdf', mimeType: 'application/pdf', sizeBytes: 100 });
    await api().post(`/api/v1/documents/${id}/verify`).set(auth()).expect(400);
    expect((await stored(id)).verificationStatus).toBe('PENDING');
  });

  it('wer die Prüfung vergisst, wird beim ersten Download geprüft', async () => {
    const text = Buffer.from('Hallo Welt, das ist eine Notiz.');
    const ok = await register({ fileName: 'notiz.txt', mimeType: 'text/plain', sizeBytes: text.length }, text);
    await api().get(`/api/v1/documents/${ok}/download-url`).set(auth()).expect(200);
    expect((await stored(ok)).verificationStatus).toBe('VERIFIED');

    const fake = Buffer.from('#!/bin/sh\necho hallo\n');
    const bad = await register({ fileName: 'notiz.txt', mimeType: 'text/plain', sizeBytes: fake.length }, fake);
    await api().get(`/api/v1/documents/${bad}/download-url`).set(auth()).expect(403);
    expect((await stored(bad)).verificationStatus).toBe('REJECTED');
  });
});
