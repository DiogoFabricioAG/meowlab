-- Retira asignaciones de roles que ya no existen en el runtime.
-- Las tablas y datos históricos se conservan para no destruir información.
UPDATE bot_configs
SET role_key = 'cat',
    updated_at = CURRENT_TIMESTAMP
WHERE role_key IN ('finance', 'finance-cat', 'finance-player-cat');

UPDATE contacts
SET active_role_key = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE active_role_key IN ('finance', 'finance-cat', 'finance-player-cat');
