-- Amendment 02 section 14.4 - approvals for prepared external effects (ActionIntent), bound to payload hash and plan revision.
ALTER TYPE "ApprovalEntityType" ADD VALUE IF NOT EXISTS 'PROCESS_ACTION';
