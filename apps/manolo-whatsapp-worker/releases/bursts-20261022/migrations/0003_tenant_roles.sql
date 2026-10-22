ALTER TABLE bot_configs
  ADD COLUMN role_key TEXT NOT NULL DEFAULT 'cat';

CREATE INDEX IF NOT EXISTS idx_bot_configs_role_key
  ON bot_configs (role_key);

INSERT OR IGNORE INTO tenants (id, name)
VALUES ('home-finance', 'Home Finance');

INSERT OR IGNORE INTO bot_configs (
  tenant_id,
  system_prompt,
  ai_provider,
  ai_model,
  temperature,
  max_tokens,
  role_key
)
VALUES (
  'home-finance',
  'Eres un asistente de finanzas personales. Ayudas a registrar ingresos y gastos, consultar balances y explicar movimientos de forma clara y breve.',
  'groq',
  'llama-3.1-8b-instant',
  0.2,
  180,
  'finance'
);
