# Inventario de migración - 2026-08-24

## Cloudflare Worker de WhatsApp

- Servicio: `whatsapp-webhook-meta-production`.
- Versión activa confirmada: `ef7677ba-ace3-470e-b4a6-a548168a9d18` al 100% del tráfico.
- D1 principal: `whatsapp-webhook-meta-db`.
- D1 de Print System: `gamarra_db`.
- R2: `whatsapp-webhook-meta-enterprise-documents`.
- Browser Run: generación de PDF para cotizaciones.
- PostgreSQL externo: Neon para roles financieros heredados.
- Proveedores: Meta Graph API, Groq, OpenAI y FacturaYa.

Los secretos existentes se inventariaron únicamente por nombre. Sus valores no fueron leídos ni copiados.

## D1 principal

- ID: `9040fc7c-000a-4d4b-9946-5f230827bf06`.
- Tamaño reportado: 479232 bytes.
- Tablas de negocio: 14, más `d1_migrations`.
- Integridad del respaldo: `ok`.

| Tabla | Filas |
|---|---:|
| bot_configs | 2 |
| contact_role_states | 1 |
| contacts | 7 |
| conversations | 7 |
| d1_migrations | 12 |
| messages | 533 |
| pending_actions | 2 |
| quote_configs | 1 |
| quote_drafts | 19 |
| quote_items | 27 |
| quote_sequence_members | 3 |
| quote_sequence_scopes | 2 |
| store_payment_notifications | 0 |
| tenants | 2 |
| whatsapp_numbers | 1 |

La tabla de notificaciones de tienda se conserva en el respaldo, pero queda fuera del trabajo de migración actual.

## D1 de Print System

- ID: `2854138d-a7c5-4272-a923-6aeaa7e62ccc`.
- Tamaño reportado: 98304 bytes.
- Integridad del respaldo: `ok`.

| Tabla | Filas |
|---|---:|
| activos_fijos | 0 |
| clientes | 53 |
| compras | 10 |
| pagos | 159 |
| usuarios | 2 |
| variables_negocio | 1 |
| ventas | 244 |

## R2

El bucket `whatsapp-webhook-meta-enterprise-documents` reportó cero objetos y cero bytes. No requiere copia de datos en esta fase, aunque se conserva el adaptador para futuros documentos temporales.

## Finanzas Player

- Pages project: `finanzas-player`.
- Dominios: `finanzas-player.pages.dev` y `finance.diogoabregu.tech`.
- Último deployment inventariado: `52bf3611-a2cb-4273-ae34-d55dadcfd50d`.
- Hyperdrive: `finanzas-player-db`.
- Origen PostgreSQL: Neon, base `player`.
- KV: `finanzas-player-rate-limits`.
- Secretos por nombre: `JWT_SECRET` y `WHATSAPP_API_TOKEN`.

Cloudflare no permite recuperar los valores de secretos cifrados. Para `pg_dump` se necesitará crear o proporcionar una credencial de Neon dedicada a backup.

## VPS

- RAM: 3.8 GiB.
- RAM disponible observada: 2.9 GiB.
- Swap: 0.
- Disco raíz: 48 GiB, 42 GiB disponibles durante el inventario.
- Entrada pública: Caddy en 80/443.
- Servicios existentes: FacturaYa, Licitaciones y sus dos PostgreSQL.

## FacturaYa

FacturaYa ya está en el VPS y tiene un flujo de respaldo cifrado que incluye PostgreSQL, XML, CDR, configuración y Docker Secrets. Su ejecución requiere una contraseña de respaldo de al menos 16 caracteres que no debe almacenarse en el repositorio.
