import { createHash } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { IdempotencyKeyReusedError, IdempotentRequestInProgressError, ValidationFailedError } from '@orbit/shared';
import type { Prisma } from '@orbit/domain';
import type { Request, Response } from 'express';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,200}$/;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TTL_MS = 24 * 3600 * 1000;
/** Größere Antworten werden nicht gespeichert: der Eintrag entfällt, die Anfrage ist dann nicht wiederholungssicher (selten: Exporte). */
const MAX_STORED_BODY_BYTES = 512 * 1024;
const PURGE_INTERVAL_MS = 3600 * 1000;

interface AuthedRequest extends Request {
  user?: { id: string; tenantId: string };
}

/**
 * Allgemeine Idempotenzschlüssel für schreibende Aufrufe (MST-08, MV3-03). Sendet ein Client `Idempotency-Key: <Schlüssel>` mit einer schreibenden Anfrage, wird sie
 * höchstens einmal ausgeführt: eine Wiederholung (Netzfehler, Doppelklick, erneuter Versuch) liefert dieselbe Antwort mit dem Header `Idempotent-Replayed: true`, statt
 * einen zweiten Vorgang, eine zweite Rechnung oder eine zweite Nachricht anzulegen.
 *
 *  - Der Schlüssel gilt je Mandant; derselbe Schlüssel mit anderem Pfad oder Inhalt ist ein Fehler (422), keine Wiederholung.
 *  - Läuft die erste Anfrage noch, antwortet die zweite mit 409 (`retryable`) – nie mit einer zweiten Ausführung.
 *  - Schlägt die Anfrage fehl, wird der Eintrag verworfen: der Client darf mit demselben Schlüssel erneut versuchen.
 *  - Ohne Header, bei Lesezugriffen, ohne angemeldeten Nutzer und bei Datei-Uploads (multipart) geschieht nichts.
 *  - Das Anlegen ist atomar (eindeutiger Index auf Mandant + Schlüssel), nicht „erst lesen, dann schreiben“.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  private lastPurge = 0;

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<AuthedRequest>();
    const response = http.getResponse<Response>();
    const raw = request.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || !WRITE_METHODS.has(request.method) || !request.user?.tenantId) return next.handle();
    if (String(request.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/')) return next.handle();
    if (!KEY_PATTERN.test(key)) return throwError(() => new ValidationFailedError('Idempotency-Key muss 8 bis 200 Zeichen lang sein (Buchstaben, Ziffern, _ - : .).'));

    const { tenantId, id: userId } = request.user;
    const path = request.originalUrl.split('?')[0] ?? request.path;
    const requestHash = createHash('sha256').update(`${request.method} ${request.originalUrl}\n${JSON.stringify(request.body ?? null)}`).digest('hex');

    return from(this.begin(tenantId, userId, key, request.method, path, requestHash)).pipe(
      mergeMap((begun) => {
        if (begun.replay) {
          response.setHeader('Idempotent-Replayed', 'true');
          response.status(begun.replay.status);
          return of(begun.replay.body);
        }
        return next.handle().pipe(
          mergeMap((body) => from(this.complete(tenantId, key, response.statusCode, body)).pipe(mergeMap(() => of(body)))),
          catchError((error: unknown) => from(this.discard(tenantId, key)).pipe(mergeMap(() => throwError(() => error)))),
        );
      }),
    );
  }

  private async begin(tenantId: string, userId: string, key: string, method: string, path: string, requestHash: string): Promise<{ replay?: { status: number; body: unknown } }> {
    const scoped = this.prisma.forTenantId(tenantId);
    void this.purgeExpired();
    const now = new Date();
    // Abgelaufene Einträge zu diesem Schlüssel zählen nicht mehr.
    await scoped.idempotencyRecord.deleteMany({ where: { key, expiresAt: { lte: now } } });
    try {
      await scoped.idempotencyRecord.create({ data: { tenantId, userId, key, method, path, requestHash, state: 'IN_PROGRESS', expiresAt: new Date(now.getTime() + TTL_MS) } });
      return {};
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
    const existing = await scoped.idempotencyRecord.findFirst({ where: { key } });
    if (!existing) return this.begin(tenantId, userId, key, method, path, requestHash); // zwischenzeitlich verworfen: erneut versuchen
    if (existing.requestHash !== requestHash || existing.method !== method || existing.path !== path) {
      throw new IdempotencyKeyReusedError('Dieser Idempotency-Key wurde bereits für eine andere Anfrage verwendet.');
    }
    if (existing.state !== 'COMPLETED') throw new IdempotentRequestInProgressError('Dieselbe Anfrage wird gerade noch verarbeitet. Bitte kurz warten und erneut senden.');
    return { replay: { status: existing.responseStatus ?? 200, body: existing.responseBody ?? undefined } };
  }

  private async complete(tenantId: string, key: string, status: number, body: unknown): Promise<void> {
    try {
      const json = body === undefined ? null : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue);
      if (Buffer.byteLength(JSON.stringify(json)) > MAX_STORED_BODY_BYTES) return this.discard(tenantId, key);
      await this.prisma.forTenantId(tenantId).idempotencyRecord.updateMany({ where: { key }, data: { state: 'COMPLETED', responseStatus: status, responseBody: json ?? undefined } });
    } catch (error) {
      // Die Anfrage war erfolgreich; ein nicht speicherbares Ergebnis darf sie nicht nachträglich scheitern lassen.
      this.logger.warn(`idempotency result not stored: ${error instanceof Error ? error.message : String(error)}`);
      await this.discard(tenantId, key);
    }
  }

  private async discard(tenantId: string, key: string): Promise<void> {
    await this.prisma.forTenantId(tenantId).idempotencyRecord.deleteMany({ where: { key } }).catch(() => undefined);
  }

  /** Höchstens stündlich je Prozess: abgelaufene Einträge aller Mandanten entfernen (Betriebswartung, daher ohne Mandantenbezug). */
  private async purgeExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPurge < PURGE_INTERVAL_MS) return;
    this.lastPurge = now;
    await this.prisma.withRlsBypass((tx) => tx.idempotencyRecord.deleteMany({ where: { expiresAt: { lte: new Date(now) } } })).catch(() => undefined);
  }
}
