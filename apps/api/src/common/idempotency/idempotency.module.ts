import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/** Macht `Idempotency-Key` für alle schreibenden Endpunkte verfügbar (globaler Interceptor, läuft nach den Guards). */
@Module({ providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }] })
export class IdempotencyModule {}
