import type { CookieOptions, Request } from 'express';
import type { OrbitEnv } from '@orbit/config';

/**
 * Refresh-Token einer Sitzung als httpOnly-Cookie (Cookie-Modus), gemeinsam für Betreiber- und Mandantenanmeldung. Das Skript der Seite kann das Token
 * dadurch nie lesen – ein Cross-Site-Skript kann es nicht mitnehmen; es kann den Refresh höchstens im Namen des Browsers auslösen, solange die Seite
 * offen ist. Der Pfad begrenzt das Cookie auf die Anmelderouten, `SameSite=Strict` verhindert das Mitsenden bei fremden Seiten; zusätzlich verlangt der
 * Cookie-Weg einen eigenen Header (ein nicht einfacher Header löst eine CORS-Vorabprüfung aus – ein fremdes Formular kann ihn nicht setzen).
 * API-Clients ohne Browser nutzen weiter das Refresh-Token im Antwortkörper.
 */
export interface SessionCookieSpec {
  /** Cookie-Name. */
  name: string;
  /** Kleingeschriebener Header, der den Cookie-Modus einschaltet (Wert „1“). */
  modeHeader: string;
  /** Pfad, auf den das Cookie begrenzt ist. */
  path: string;
}

export interface SessionCookie {
  readonly spec: SessionCookieSpec;
  isCookieMode(request: Pick<Request, 'headers'>): boolean;
  read(request: Pick<Request, 'headers'>): string | undefined;
  /** `maxAgeMs` fehlt = Sitzungs-Cookie (endet mit dem Browser). `Secure` überall außer in Entwicklung und Test. */
  options(env: Pick<OrbitEnv, 'ORBIT_ENVIRONMENT'>, maxAgeMs?: number): CookieOptions;
  clearOptions(env: Pick<OrbitEnv, 'ORBIT_ENVIRONMENT'>): CookieOptions;
}

export function createSessionCookie(spec: SessionCookieSpec): SessionCookie {
  const options = (env: Pick<OrbitEnv, 'ORBIT_ENVIRONMENT'>, maxAgeMs?: number): CookieOptions => ({
    httpOnly: true,
    sameSite: 'strict',
    path: spec.path,
    secure: !['development', 'test'].includes(env.ORBIT_ENVIRONMENT),
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  });
  return {
    spec,
    isCookieMode: (request) => request.headers[spec.modeHeader] === '1',
    read: (request) => {
      const header = request.headers.cookie;
      if (!header) return undefined;
      for (const part of header.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === spec.name) return decodeURIComponent(rest.join('='));
      }
      return undefined;
    },
    options,
    clearOptions: (env) => options(env),
  };
}
