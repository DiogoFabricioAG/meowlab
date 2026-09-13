\set ON_ERROR_STOP on

CREATE TEMP TABLE expected_counts (
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  expected_count BIGINT NOT NULL
);

INSERT INTO expected_counts (schema_name, table_name, expected_count) VALUES
  ('whatsapp', 'tenants', 2),
  ('whatsapp', 'whatsapp_numbers', 1),
  ('whatsapp', 'bot_configs', 2),
  ('whatsapp', 'contacts', 7),
  ('whatsapp', 'conversations', 7),
  ('whatsapp', 'messages', 533),
  ('whatsapp', 'pending_actions', 2),
  ('whatsapp', 'quote_configs', 1),
  ('whatsapp', 'quote_sequence_scopes', 2),
  ('whatsapp', 'quote_drafts', 19),
  ('whatsapp', 'quote_items', 27),
  ('whatsapp', 'quote_sequence_members', 3),
  ('whatsapp', 'contact_role_states', 1),
  ('whatsapp', 'store_payment_notifications', 0),
  ('print_system', 'clientes', 53),
  ('print_system', 'ventas', 244),
  ('print_system', 'pagos', 159),
  ('print_system', 'compras', 10),
  ('print_system', 'activos_fijos', 0),
  ('print_system', 'usuarios', 2),
  ('print_system', 'variables_negocio', 1);

BEGIN READ ONLY;

DO $$
DECLARE
  expected RECORD;
  actual_count BIGINT;
BEGIN
  FOR expected IN SELECT * FROM expected_counts LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM %I.%I',
      expected.schema_name,
      expected.table_name
    ) INTO actual_count;
    IF actual_count <> expected.expected_count THEN
      RAISE EXCEPTION 'count mismatch for %.%: expected %, got %',
        expected.schema_name,
        expected.table_name,
        expected.expected_count,
        actual_count;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  invalid_constraints INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO invalid_constraints
  FROM pg_constraint constraint_entry
  INNER JOIN pg_namespace namespace_entry
    ON namespace_entry.oid = constraint_entry.connamespace
  WHERE namespace_entry.nspname IN ('whatsapp', 'print_system')
    AND NOT constraint_entry.convalidated;

  IF invalid_constraints <> 0 THEN
    RAISE EXCEPTION 'there are % unvalidated constraints', invalid_constraints;
  END IF;
END $$;

DO $$
DECLARE
  required_index TEXT;
BEGIN
  FOREACH required_index IN ARRAY ARRAY[
    'whatsapp.idx_quote_drafts_one_active',
    'whatsapp.store_payment_notifications_order_idx',
    'whatsapp.messages_tenant_id_meta_message_id_key',
    'print_system.clientes_numero_key'
  ] LOOP
    IF to_regclass(required_index) IS NULL THEN
      RAISE EXCEPTION 'required index is missing: %', required_index;
    END IF;
  END LOOP;
END $$;

SELECT 'snapshot_reconciliation=ok';

ROLLBACK;
