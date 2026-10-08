import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Mandantenanmeldung im Cookie-Modus (Browser): das Refresh-Token kommt nur als httpOnly-Cookie, nie im Körper; ohne den Modus-Header verhält sich alles wie
 * bisher (API-Clients). Gleiche Schutzmaßnahmen wie bei der Betreiberanmeldung: Cookie-Weg nur mit Header, Rotation, Löschen bei Fehlschlag und Abmeldung.
 */
describe('Tenant auth cookie mode (e2e)', () => {
  let app: INestApplication;
  const credentials = { email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' };
  const MODE = { 'X-Orbit-Cookie': '1' };

  const post = (path: string, headers: Record<string, string> = {}) => request(app.getHttpServer()).post(`/api/v1/auth/${path}`).set(headers);
  const cookieOf = (response: request.Response): string => ((response.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) => c.startsWith('orbit_rt=')) ?? '';
  const valueOf = (cookie: string): string => decodeURIComponent(cookie.split(';')[0]!.split('=')[1]!);

  beforeAll(async () => {
    app = await bootstrapE2eApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('Browser: Refresh-Token nur als httpOnly-Cookie (SameSite=Strict, nur Anmelderouten, dauerhaft wie das Token), nie im Körper; API-Clients ohne den Header bekommen das Token im Körper und kein Cookie', async () => {
    const api = await post('login').send(credentials).expect(200);
    expect(cookieOf(api)).toBe('');
    expect(api.body.refreshToken).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));

    const browser = await post('login', MODE).send(credentials).expect(200);
    const cookie = cookieOf(browser);
    expect(browser.body.refreshToken).toBe('');
    expect(browser.body.accessToken).toEqual(expect.any(String));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toMatch(/Max-Age=604800/); // 7 Tage wie JWT_REFRESH_TTL: Anmeldung über Browserneustarts hinweg wie bisher
    expect(cookie).not.toMatch(/Secure/i); // Entwicklung ohne TLS; in staging/production gesetzt (Unit-Test)
    expect(valueOf(cookie)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('Refresh über das Cookie braucht den Modus-Header, rotiert das Cookie, das alte ist wertlos und ein Fehlschlag löscht das Cookie beim Browser', async () => {
    const raw = valueOf(cookieOf(await post('login', MODE).send(credentials).expect(200)));
    await post('refresh').set('Cookie', `orbit_rt=${raw}`).send({}).expect(401); // fremder Auslöser ohne Header
    const refreshed = await post('refresh', MODE).set('Cookie', `orbit_rt=${raw}`).send({}).expect(200);
    const next = cookieOf(refreshed);
    expect(valueOf(next)).not.toBe(raw);
    expect(refreshed.body.refreshToken).toBe('');
    await request(app.getHttpServer()).get('/api/v1/auth/me').set({ Authorization: `Bearer ${refreshed.body.accessToken}` }).expect(200);

    const stale = await post('refresh', MODE).set('Cookie', `orbit_rt=${raw}`).send({}).expect(401);
    expect(cookieOf(stale)).toMatch(/orbit_rt=;/);
    await post('refresh', MODE).send({}).expect(401); // ohne Cookie
  });

  it('API-Clients: das Refresh-Token im Körper funktioniert unverändert, auch ohne Cookie und ohne Header', async () => {
    const login = await post('login').send(credentials).expect(200);
    const refreshed = await post('refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    expect(refreshed.body.refreshToken).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(cookieOf(refreshed)).toBe('');
    await post('refresh').send({ refreshToken: login.body.refreshToken }).expect(401); // rotiert
  });

  it('Abmelden im Cookie-Modus widerruft das Token serverseitig und löscht das Cookie; ohne Token ist es harmlos', async () => {
    const raw = valueOf(cookieOf(await post('login', MODE).send(credentials).expect(200)));
    const out = await post('logout', MODE).set('Cookie', `orbit_rt=${raw}`).send({}).expect(204);
    expect(cookieOf(out)).toMatch(/orbit_rt=;/);
    await post('refresh', MODE).set('Cookie', `orbit_rt=${raw}`).send({}).expect(401); // widerrufen
    await post('logout', MODE).send({}).expect(204);
  });
});
