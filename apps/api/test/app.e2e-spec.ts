import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health -> 200', () => {
    return request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it('GET /api/v1/health/ready -> 200', () => {
    return request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
  });
});
