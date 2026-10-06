-- Konstantennamen an die Prisma-Konvention angleichen (kein Drift zwischen Schema und Datenbank).
ALTER TABLE "platform_role_assignments" RENAME CONSTRAINT "platform_role_assignments_user_fkey" TO "platform_role_assignments_platform_user_id_fkey";
ALTER TABLE "platform_sessions" RENAME CONSTRAINT "platform_sessions_user_fkey" TO "platform_sessions_platform_user_id_fkey";
