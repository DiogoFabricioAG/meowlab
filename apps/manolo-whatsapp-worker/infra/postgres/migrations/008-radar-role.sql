BEGIN;

-- Register a selectable role; existing contact assignments remain untouched.
INSERT INTO whatsapp.role_catalog (role_key, label, description, sort_order, assignable, active)
VALUES ('radar', 'RADAR · Licitaciones', 'Orientación sobre convocatorias y estado de alertas del escritorio RADAR.', 60, TRUE, TRUE)
ON CONFLICT (role_key) DO UPDATE SET label = EXCLUDED.label,
  description = EXCLUDED.description, sort_order = EXCLUDED.sort_order,
  assignable = TRUE, active = TRUE, updated_at = CURRENT_TIMESTAMP;

COMMIT;
