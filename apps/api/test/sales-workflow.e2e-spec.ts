import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * End-to-end Sales workflow against the live Postgres instance: Company ->
 * Contact -> Lead (incl. the automatic follow-up Task) -> Lead
 * qualification -> Meeting proposal -> Meeting confirmation -> Task
 * completion. Uses the seeded "Musterwerk GmbH" sales user (Phase 13) for
 * auth, but creates fresh Company/Contact/Lead records per run (unique
 * domains/emails via randomUUID) rather than mutating the seeded demo
 * fixtures the frontend manual QA relies on.
 */
describe('Sales workflow (e2e)', () => {
  let app: INestApplication;
  let salesToken: string;

  beforeAll(async () => {
    app = await bootstrapE2eApp();

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'sales@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);
    salesToken = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the full Company -> Contact -> Lead -> Task -> Meeting flow', async () => {
    const runId = randomUUID();
    const auth = `Bearer ${salesToken}`;

    const company = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', auth)
      .send({ name: `E2E Handel ${runId} GmbH`, domain: `e2e-${runId}.example` })
      .expect(201);

    const firstName = 'Erika';
    const lastName = `Testkontakt-${runId}`;
    const contact = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Authorization', auth)
      .send({ firstName, lastName, email: `erika.${runId}@e2e-${runId}.example`, companyId: company.body.id })
      .expect(201);

    const lead = await request(app.getHttpServer())
      .post('/api/v1/leads')
      .set('Authorization', auth)
      .send({
        contactId: contact.body.id,
        companyId: company.body.id,
        source: 'WEB',
        notes: 'E2E: Interesse an Rahmenvertrag.',
      })
      .expect(201);
    expect(lead.body.status).toBe('NEW');

    // Creating a Lead synchronously creates a follow-up Task (leads.service.ts).
    const expectedTaskTitle = `Neuen Lead kontaktieren: ${firstName} ${lastName}`;
    const tasks = await request(app.getHttpServer())
      .get('/api/v1/tasks?status=OPEN')
      .set('Authorization', auth)
      .expect(200);
    const followUpTask = (tasks.body as Array<{ id: string; title: string; status: string }>).find(
      (task) => task.title === expectedTaskTitle,
    );
    expect(followUpTask).toBeDefined();

    const qualified = await request(app.getHttpServer())
      .patch(`/api/v1/leads/${lead.body.id}/status`)
      .set('Authorization', auth)
      .send({ status: 'QUALIFIED' })
      .expect(200);
    expect(qualified.body.status).toBe('QUALIFIED');

    const earliestStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const latestEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const proposed = await request(app.getHttpServer())
      .post('/api/v1/meetings/propose')
      .set('Authorization', auth)
      .send({
        contactId: contact.body.id,
        title: 'E2E Beratungstermin',
        durationMinutes: 30,
        earliestStart,
        latestEnd,
      })
      .expect(201);
    expect(proposed.body.status).toBe('PROPOSED');
    expect(proposed.body.proposedSlots).toBeTruthy();

    const start = earliestStart;
    const end = new Date(new Date(earliestStart).getTime() + 30 * 60 * 1000).toISOString();
    const confirmed = await request(app.getHttpServer())
      .patch(`/api/v1/meetings/${proposed.body.id}/confirm`)
      .set('Authorization', auth)
      .send({ start, end, attendeeEmails: [contact.body.email] })
      .expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.calendarExternalId).toEqual(expect.any(String));

    const completedTask = await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${followUpTask!.id}/complete`)
      .set('Authorization', auth)
      .expect(200);
    expect(completedTask.body.status).toBe('DONE');
  });

  it('rejects Lead creation for an unknown contactId with 404', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ contactId: randomUUID(), source: 'MANUAL' })
      .expect(404);
  });
});
