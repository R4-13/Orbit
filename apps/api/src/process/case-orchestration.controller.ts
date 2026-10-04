import { Controller, Get, Headers, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CaseGraphView, CaseNodeDetail } from '@orbit/shared';
import { PERMISSIONS } from '@orbit/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { CaseEventsService } from './case-events.service';
import { CaseOrchestrationService, type OrchestrationMode } from './case-orchestration.service';

/** Poll interval of the stream. State is read from PostgreSQL, so every API replica serves the same events. */
const STREAM_POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;
/** A stream ends after this long so a client re-authenticates (token expiry) and resumes from its cursor — nothing is lost. */
const STREAM_MAX_MS = 5 * 60_000;

function toNonNegativeInt(value: string | undefined, fallback: number): number {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : fallback;
}

function parseMode(value: string | undefined): OrchestrationMode {
  return value === 'ACTUAL' || value === 'DEFINITION' ? value : 'COMBINED';
}

/**
 * Amendment 02 §18 — read side of the case orchestration: the graph projection, node details, the event list and a
 * resumable event stream. Everything is tenant-scoped through the authenticated user and requires `case.read`.
 */
@ApiTags('case-orchestration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CASE_READ)
@Controller({ path: 'cases' })
export class CaseOrchestrationController {
  constructor(
    private readonly orchestration: CaseOrchestrationService,
    private readonly events: CaseEventsService,
  ) {}

  @Get(':id/orchestration')
  projection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') caseId: string,
    @Query('mode') mode?: string,
    @Query('planRevision') planRevision?: string,
  ): Promise<CaseGraphView> {
    const revision = planRevision && /^\d+$/.test(planRevision) ? Number(planRevision) : undefined;
    return this.orchestration.projection({ tenantId: user.tenantId, permissions: user.permissions }, caseId, { mode: parseMode(mode), planRevision: revision });
  }

  @Get(':id/orchestration/nodes/:nodeId')
  node(@CurrentUser() user: AuthenticatedUser, @Param('id') caseId: string, @Param('nodeId') nodeId: string, @Query('planRevision') planRevision?: string): Promise<CaseNodeDetail> {
    const revision = planRevision && /^\d+$/.test(planRevision) ? Number(planRevision) : undefined;
    return this.orchestration.nodeDetail({ tenantId: user.tenantId, permissions: user.permissions }, caseId, nodeId, revision);
  }

  @Get(':id/events')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') caseId: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ): Promise<Array<{ sequence: number; type: string; payload: unknown; at: string }>> {
    // The case lookup enforces tenant ownership (a foreign case id is a 404, never an empty list).
    await this.orchestration.projection({ tenantId: user.tenantId, permissions: user.permissions }, caseId, { mode: 'DEFINITION' });
    const rows = await this.events.list(user.tenantId, caseId, toNonNegativeInt(after, 0), toNonNegativeInt(limit, 200));
    return rows.map((e) => ({ sequence: e.sequence, type: e.type, payload: e.payload, at: e.createdAt.toISOString() }));
  }

  /**
   * Server-sent events with a sequence cursor (`?after=` or `Last-Event-ID`). A reconnecting client gets exactly the
   * events it missed, in order; the cursor is the per-case sequence, so replicas and restarts do not matter.
   */
  @Get(':id/events/stream')
  async stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') caseId: string,
    @Res() res: Response,
    @Query('after') afterQuery?: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    // Runs BEFORE the SSE headers: a foreign or unknown case is a real 404.
    await this.orchestration.projection({ tenantId: user.tenantId, permissions: user.permissions }, caseId, { mode: 'DEFINITION' });

    let cursor = Number(afterQuery ?? lastEventId ?? 0);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    let closed = false;
    let busy = false;
    const startedAt = Date.now();
    const finish = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      res.end();
    };
    const pump = async (): Promise<void> => {
      if (closed || busy) return;
      busy = true;
      try {
        const rows = await this.events.list(user.tenantId, caseId, cursor, 100);
        for (const e of rows) {
          res.write(`id: ${e.sequence}\nevent: case-event\ndata: ${JSON.stringify({ sequence: e.sequence, type: e.type, payload: e.payload, at: e.createdAt.toISOString() })}\n\n`);
          cursor = e.sequence;
        }
        if (Date.now() - startedAt > STREAM_MAX_MS) {
          res.write(`event: reconnect\ndata: ${JSON.stringify({ after: cursor })}\n\n`);
          finish();
        }
      } catch {
        finish();
      } finally {
        busy = false;
      }
    };
    const poll = setInterval(() => void pump(), STREAM_POLL_MS);
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': keep-alive\n\n');
    }, HEARTBEAT_MS);
    res.on('close', finish);
    await pump();
  }
}
