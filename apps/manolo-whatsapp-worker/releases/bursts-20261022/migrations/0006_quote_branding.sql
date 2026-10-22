UPDATE quote_configs
SET logo_url = 'https://whatsapp-webhook-meta-production.diogofabricio17.workers.dev/logo.png',
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'manolo';
