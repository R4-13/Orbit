import { describe, expect, it } from 'vitest';
import { SUPPORT_MODE_SCOPES, SUPPORT_SCOPES, describeSupportIssue, supportScopesNeedApproval, validateSupportRequest } from './support-session';

const base = { mode: 'READ_DIAGNOSTICS', scopes: ['diagnostics.read'], minutes: 30, maxMinutes: 120 };

describe('validateSupportRequest (Amendment 03 §18)', () => {
  it('eine Diagnose-Anforderung innerhalb der Plattformgrenze ist zulässig', () => {
    expect(validateSupportRequest(base)).toEqual([]);
    expect(validateSupportRequest({ ...base, mode: 'READ_TENANT_CONTEXT', scopes: ['diagnostics.read', 'case.payload.read'] })).toEqual([]);
  });

  it('kein stilles Impersonation: unterstützte Aktionen und der Aktions-Scope sind nicht verfügbar', () => {
    expect(validateSupportRequest({ ...base, mode: 'ASSISTED_ACTION', scopes: ['tenant.action.execute'] })).toEqual(expect.arrayContaining(['ASSISTED_ACTION_NOT_AVAILABLE', 'ACTION_SCOPE_NOT_AVAILABLE']));
    expect(validateSupportRequest({ ...base, scopes: ['tenant.action.execute'] })).toContain('ACTION_SCOPE_NOT_AVAILABLE');
  });

  it('ein Diagnose-Modus trägt keine Fachinhalte (Payload-Scope gehört nicht dazu)', () => {
    expect(validateSupportRequest({ ...base, scopes: ['diagnostics.read', 'case.payload.read'] })).toContain('SCOPE_NOT_IN_MODE:case.payload.read');
    expect(SUPPORT_MODE_SCOPES.READ_DIAGNOSTICS).not.toContain(SUPPORT_SCOPES.CASE_PAYLOAD_READ);
  });

  it('Dauer folgt der Plattformrichtlinie, nicht einem Standard der Oberfläche', () => {
    expect(validateSupportRequest({ ...base, minutes: 121 })).toEqual(['DURATION_EXCEEDS_POLICY:120']);
    expect(validateSupportRequest({ ...base, minutes: 121, maxMinutes: 240 })).toEqual([]);
  });

  it('unbekannter Modus/Scope und leere Scopes werden benannt', () => {
    expect(validateSupportRequest({ ...base, mode: 'GOD_MODE' })).toEqual(['MODE_UNKNOWN']);
    expect(validateSupportRequest({ ...base, scopes: [] })).toContain('SCOPES_REQUIRED');
    expect(validateSupportRequest({ ...base, scopes: ['everything'] })).toContain('SCOPE_UNKNOWN:everything');
  });

  it('nur Fachinhalte verlangen eine zweite Person', () => {
    expect(supportScopesNeedApproval(['diagnostics.read', 'connector.status.read', 'tenant.config.read', 'case.metadata.read'])).toBe(false);
    expect(supportScopesNeedApproval(['diagnostics.read', 'case.payload.read'])).toBe(true);
  });

  it('jeder Befund hat eine verständliche Beschreibung', () => {
    for (const code of ['ASSISTED_ACTION_NOT_AVAILABLE', 'ACTION_SCOPE_NOT_AVAILABLE', 'SCOPES_REQUIRED', 'SCOPE_UNKNOWN:x', 'SCOPE_NOT_IN_MODE:y', 'DURATION_EXCEEDS_POLICY:60', 'MODE_UNKNOWN']) expect(describeSupportIssue(code).length).toBeGreaterThan(15);
    expect(describeSupportIssue('XYZ')).toBe('Die Anforderung ist nicht zulässig.');
  });
});
