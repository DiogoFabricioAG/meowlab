import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

type TestEnv = typeof env & {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

beforeAll(async () => {
  const testEnv = env as unknown as TestEnv;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name)
       VALUES ('test-quotes', 'Test Quotes')`,
    ),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO bot_configs (
         tenant_id,
         system_prompt,
         ai_provider,
         ai_model,
         temperature,
         max_tokens,
         role_key
       )
       VALUES (
         'test-quotes',
         'Asistente de cotizaciones de prueba.',
         'groq',
         'llama-3.1-8b-instant',
         0.2,
         180,
         'quotes'
       )`,
    ),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO whatsapp_numbers (
         id,
         tenant_id,
         phone_number_id,
         display_name
       )
       VALUES ('test-quotes-number', 'test-quotes', '888888888888888', 'Test Quotes')`,
    ),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO quote_configs (
         tenant_id,
         legal_name,
         tax_id,
         address,
         services_json,
         bank_name,
         bank_account,
         bank_cci,
         advisor_name,
         advisor_phone
       )
       VALUES (
         'test-quotes',
         'Empresa de Prueba',
         '20123456789',
         'Dirección de prueba',
         '[]',
         'BCP',
         '123456789',
         '001123456789',
         'Asesor de prueba',
         '999999999'
       )`,
    ),
  ]);
});
