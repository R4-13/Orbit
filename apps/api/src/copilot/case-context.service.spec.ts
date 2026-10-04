import { PERMISSIONS, type CaseGraphView } from '@orbit/shared';
import { SondeCaseContextService } from './case-context.service';

const graph = (over: Partial<CaseGraphView> = {}): CaseGraphView => ({
  caseId: 'c1',
  caseRevision: 3,
  projectionRevision: 9,
  planId: 'p1',
  planRevision: 1,
  lastEventSequence: 9,
  generatedAt: new Date().toISOString(),
  mode: 'COMBINED',
  overallStatus: 'WAITING_FOR_APPROVAL',
  currentNodeIds: ['ask'],
  attentionReasons: ['Rückfrage senden: Freigabe erforderlich.'],
  nodes: [
    { id: 'ask', title: 'Rückfrage senden', type: 'ACTION', state: 'AWAITING_APPROVAL', provenance: 'EXECUTED', availableActions: [] },
    { id: 'done', title: 'Abschluss prüfen', type: 'COMPLETE', state: 'PLANNED', provenance: 'PLANNED', availableActions: [] },
  ],
  edges: [],
  availableActions: [{ commandKey: 'PAUSE', title: 'Anhalten', fields: [], requiresPreview: false, expectedCaseRevision: 3 }],
  revisions: [],
  blueprint: { key: 'REQUEST_FOR_QUOTE', version: '1.0.0', title: 'Angebotsanfrage' },
  ...over,
});

describe('SondeCaseContextService', () => {
  const READ = [PERMISSIONS.CASE_READ];

  it('builds a read-only context from the server projection, including states, attention and permitted actions', async () => {
    const orchestration = {
      projection: jest.fn().mockResolvedValue(graph()),
      nodeDetail: jest.fn().mockResolvedValue({ title: 'Rückfrage senden', state: 'AWAITING_APPROVAL', stateExplanation: 'Wartet auf Freigabe.', preview: { recipient: 'kunde@kunde.example', subject: 'Re: Anfrage' }, action: { status: 'AWAITING_APPROVAL', receipts: [] }, availableActions: [{ title: 'Rückfrage freigeben & senden' }] }),
    };
    const text = await new SondeCaseContextService(orchestration as never).build('t1', READ, { caseId: 'c1', nodeId: 'ask' });

    expect(text).toContain('Freigabe erforderlich');
    expect(text).toContain('Rückfrage senden [ask]');
    expect(text).toContain('Empfänger: kunde@kunde.example');
    expect(text).toContain('noch nichts ausgeführt');
    expect(text).toContain('Rückfrage freigeben & senden');
    expect(text).toContain('Führe keine Freigabe');
    expect(orchestration.projection).toHaveBeenCalledWith({ tenantId: 't1', permissions: READ }, 'c1', { mode: 'COMBINED', planRevision: undefined });
  });

  it('builds nothing without case.read, and nothing (no error) for an unknown or foreign case', async () => {
    const orchestration = { projection: jest.fn().mockRejectedValue(new Error('not found')), nodeDetail: jest.fn() };
    const service = new SondeCaseContextService(orchestration as never);
    expect(await service.build('t1', [], { caseId: 'c1' })).toBeNull();
    expect(orchestration.projection).not.toHaveBeenCalled();
    expect(await service.build('t1', READ, { caseId: 'c1' })).toBeNull();
  });
});
