-- Least-privilege role for the print advisor's model-generated SQL: it can only read print_system.
-- The password is set by infra/vps/apply-print-advisor-read-only-role.sh from a Docker secret.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manolo_advisor_ro') THEN
    CREATE ROLE manolo_advisor_ro;
  END IF;
END
$$;

ALTER ROLE manolo_advisor_ro WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
ALTER ROLE manolo_advisor_ro SET default_transaction_read_only = on;
ALTER ROLE manolo_advisor_ro SET statement_timeout = '8s';
ALTER ROLE manolo_advisor_ro SET search_path = print_system;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO manolo_advisor_ro', current_database());
END
$$;

REVOKE ALL ON SCHEMA whatsapp FROM manolo_advisor_ro;
REVOKE ALL ON ALL TABLES IN SCHEMA whatsapp FROM manolo_advisor_ro;
GRANT USAGE ON SCHEMA print_system TO manolo_advisor_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA print_system TO manolo_advisor_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA print_system GRANT SELECT ON TABLES TO manolo_advisor_ro;
