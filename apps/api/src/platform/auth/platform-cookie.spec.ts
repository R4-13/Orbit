import { clearCookieOptions, isCookieMode, readRefreshCookie, refreshCookieOptions } from './platform-cookie';

describe('Refresh-Cookie der Betreibersitzung', () => {
  it('Secure überall außer Entwicklung und Test; immer httpOnly und SameSite=Strict, nur an den Anmelderouten', () => {
    for (const environment of ['development', 'test'] as const) expect(refreshCookieOptions({ ORBIT_ENVIRONMENT: environment }).secure).toBe(false);
    for (const environment of ['staging', 'production'] as const) expect(refreshCookieOptions({ ORBIT_ENVIRONMENT: environment }).secure).toBe(true);
    expect(refreshCookieOptions({ ORBIT_ENVIRONMENT: 'production' })).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/api/v1/platform/auth' });
    expect(clearCookieOptions({ ORBIT_ENVIRONMENT: 'production' })).toMatchObject({ httpOnly: true, path: '/api/v1/platform/auth', secure: true });
  });

  it('liest nur das eigene Cookie, auch zwischen fremden; ohne Cookie nichts', () => {
    expect(readRefreshCookie({ headers: { cookie: 'a=1; orbit_platform_rt=abc%3D123; b=2' } })).toBe('abc=123');
    expect(readRefreshCookie({ headers: { cookie: 'orbit_platform_rt_other=zzz; a=1' } })).toBeUndefined();
    expect(readRefreshCookie({ headers: {} })).toBeUndefined();
  });

  it('der Cookie-Modus wird nur durch den ausdrücklichen Header „1“ erkannt', () => {
    expect(isCookieMode({ headers: { 'x-orbit-platform-cookie': '1' } })).toBe(true);
    expect(isCookieMode({ headers: { 'x-orbit-platform-cookie': 'true' } })).toBe(false);
    expect(isCookieMode({ headers: {} })).toBe(false);
  });
});
