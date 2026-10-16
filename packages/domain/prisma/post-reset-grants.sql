-- Nach `prisma migrate reset` (pnpm db:reset): die Rechte für die Laufzeitrolle `orbit_app` neu setzen (MST-14).
-- `migrate reset` legt das Schema `public` neu an; die Default-Privileges aus docker/postgres/10-init-app-role.sh sind danach weg, und die neu angelegten Tabellen
-- gehörten nur dem Migrationsbenutzer. Idempotent; ohne die Rolle (kein Docker-Aufbau) passiert nichts.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'orbit_app') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO orbit_app', current_database());
    GRANT USAGE ON SCHEMA public TO orbit_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orbit_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orbit_app;
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orbit_app', current_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO orbit_app', current_user);
  END IF;
END
$$;
