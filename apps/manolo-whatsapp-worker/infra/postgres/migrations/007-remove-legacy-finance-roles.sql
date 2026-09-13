BEGIN;

-- Normaliza asignaciones existentes antes de retirar las opciones del catálogo.
UPDATE whatsapp.bot_configs
SET role_key = 'cat',
    updated_at = CURRENT_TIMESTAMP
WHERE role_key IN ('finance', 'finance-cat', 'finance-player-cat');

UPDATE whatsapp.contacts
SET active_role_key = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE active_role_key IN ('finance', 'finance-cat', 'finance-player-cat');

UPDATE whatsapp.role_catalog
SET active = FALSE,
    assignable = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE role_key IN ('finance', 'finance-cat', 'finance-player-cat');

COMMIT;
