import { assertProcessingPath, processingPathOf } from './processing-path';

const scopedWith = (plans: number, runs: number) =>
  ({
    processPlan: { count: jest.fn(async () => plans) },
    workflowRun: { count: jest.fn(async () => runs) },
  }) as never;

describe('processingPathOf – genau ein Bearbeitungsweg je Vorgang', () => {
  it('ein Plan irgendeiner Herkunft bedeutet ENGINE – auch wenn zusätzlich Workflow-Läufe existieren (die Engine hat Vorrang, nichts läuft doppelt weiter)', async () => {
    expect(await processingPathOf(scopedWith(1, 0), 'c1')).toBe('ENGINE');
    expect(await processingPathOf(scopedWith(2, 3), 'c1')).toBe('ENGINE');
  });
  it('nur Workflow-Läufe bedeuten LEGACY, nichts bedeutet NONE', async () => {
    expect(await processingPathOf(scopedWith(0, 1), 'c1')).toBe('LEGACY');
    expect(await processingPathOf(scopedWith(0, 0), 'c1')).toBe('NONE');
  });
});

describe('assertProcessingPath', () => {
  it('erlaubt den ersten Start und die Fortsetzung auf dem eigenen Weg', async () => {
    await expect(assertProcessingPath(scopedWith(0, 0), 'c1', 'ENGINE')).resolves.toBeUndefined();
    await expect(assertProcessingPath(scopedWith(0, 0), 'c1', 'LEGACY')).resolves.toBeUndefined();
    await expect(assertProcessingPath(scopedWith(1, 0), 'c1', 'ENGINE')).resolves.toBeUndefined();
    await expect(assertProcessingPath(scopedWith(0, 2), 'c1', 'LEGACY')).resolves.toBeUndefined();
  });
  it('verweigert die Engine für einen Vorgang im Altweg und umgekehrt (409 PROCESSING_PATH_CONFLICT)', async () => {
    await expect(assertProcessingPath(scopedWith(0, 1), 'c1', 'ENGINE')).rejects.toMatchObject({ code: 'PROCESSING_PATH_CONFLICT', httpStatus: 409, details: { current: 'LEGACY', wanted: 'ENGINE' } });
    await expect(assertProcessingPath(scopedWith(1, 0), 'c1', 'LEGACY')).rejects.toMatchObject({ code: 'PROCESSING_PATH_CONFLICT', details: { current: 'ENGINE', wanted: 'LEGACY' } });
  });
});
