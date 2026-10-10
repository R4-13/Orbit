import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AutomationLevel, EscalationPolicy, OnboardingStep, StaffInput, UpdateTenantProfileRequest } from '@orbit/shared';
import { apiFetch } from '../api-client';

export interface TenantProfileView {
  id: string;
  industry: string | null;
  description: string | null;
  services: string[];
  exclusions: string[];
  serviceArea: string | null;
  openingHours: Array<{ days: string[]; from: string; to: string }> | null;
  emergencyService: boolean;
  emergencyNote: string | null;
  tone: string;
  languages: string[];
  faqs: Array<{ question: string; answer: string }> | null;
  automationConfirmedAt: string | null;
  onboardingCompletedAt: string | null;
}

export interface TenantProfileState {
  profile: TenantProfileView | null;
  escalationPolicy: EscalationPolicy;
  escalationDefaults: EscalationPolicy;
  automation: AutomationLevel;
  onboarding: { steps: OnboardingStep[]; doneCount: number; complete: boolean; gaps: string[] };
}

export function useTenantProfile(enabled = true) {
  return useQuery({ queryKey: ['tenant-profile'], queryFn: () => apiFetch<TenantProfileState>('/v1/tenant/profile'), enabled });
}

export function useUpdateTenantProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantProfileRequest) => apiFetch<TenantProfileState>('/v1/tenant/profile', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (state) => queryClient.setQueryData(['tenant-profile'], state),
  });
}

export interface StaffView {
  id: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  roleKind: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  teamsAddress: string | null;
  whatsappNumber: string | null;
  preferredChannel: string;
  responsibilities: string[];
  calendarId: string | null;
  availabilityNote: string | null;
  supervisorId: string | null;
  deputyId: string | null;
  supervisorName: string | null;
  deputyName: string | null;
  active: boolean;
}

export function useStaff(includeInactive: boolean) {
  return useQuery({ queryKey: ['staff', includeInactive], queryFn: () => apiFetch<StaffView[]>(`/v1/staff?includeInactive=${includeInactive}`) });
}

function useInvalidateOrganization() {
  const queryClient = useQueryClient();
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: ['staff'] }), queryClient.invalidateQueries({ queryKey: ['tenant-profile'] })]);
}

export function useCreateStaff() {
  const invalidate = useInvalidateOrganization();
  return useMutation({ mutationFn: (input: Partial<StaffInput>) => apiFetch<StaffView>('/v1/staff', { method: 'POST', body: JSON.stringify(input) }), onSuccess: invalidate });
}

export function useUpdateStaff() {
  const invalidate = useInvalidateOrganization();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<StaffInput> }) => apiFetch<StaffView>(`/v1/staff/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: invalidate,
  });
}

export function useDeactivateStaff() {
  const invalidate = useInvalidateOrganization();
  return useMutation({ mutationFn: (id: string) => apiFetch<StaffView>(`/v1/staff/${id}`, { method: 'DELETE' }), onSuccess: invalidate });
}

export interface StaffImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  failed: number;
  rows: Array<{ line: number; name: string; action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'DEACTIVATE' | 'ERROR'; errors: string[]; warnings: string[] }>;
  mapping?: Array<{ header: string; field: string | null }>;
}

export function usePreviewStaffImport() {
  return useMutation({
    mutationFn: (input: { csv: string; deactivateMissing: boolean }) => apiFetch<StaffImportResult>('/v1/staff/import/preview', { method: 'POST', body: JSON.stringify(input) }),
  });
}

export function useImportStaff() {
  const invalidate = useInvalidateOrganization();
  return useMutation({
    mutationFn: (input: { csv: string; deactivateMissing: boolean }) => apiFetch<StaffImportResult>('/v1/staff/import', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}
