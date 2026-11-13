# Modelo de datos de MeowLab como ERP — borrador

- Estado: **aceptado como base del modelo** por el
  [ADR-0008](../decisions/0008-modelo-de-datos-erp.md) (2026-11-12). Este documento
  es el detalle; el ADR registra las decisiones. No hay migraciones ni código.
- Base: los seis agentes del informe ejecutivo 2027–2029, RADAR y la
  infraestructura que ya corre (Manolo, bridge, portal, FacturaYa).
- Cuando se acuerde, se convierte en un ADR y en migraciones por fase.

## 1. Idea central

MeowLab no es un conjunto de bots sueltos: es **un ERP pequeño con agentes como
interfaz**. Cada agente es una forma de leer y escribir en módulos compartidos, no
un dueño de sus propios datos. Así, Sales Cat crea un pedido, Invoice Cat lo factura,
Stock Cat descuenta el inventario, Reorder Cat propone la compra, Collections Cat
cobra la factura y Support Cat atiende al cliente, **sobre los mismos clientes,
productos y documentos**.

```mermaid
flowchart LR
  subgraph Plataforma
    core[core · empresas, personas, identidades]
    channel[channel · WhatsApp y conversaciones]
    agents[agents · catálogo, activaciones, sesiones]
    billing[billing · cobro de MeowLab]
    metering[metering · consumo por agente]
    audit[audit · auditoría e idempotencia]
  end
  subgraph ERP del cliente
    commerce[commerce · socios y productos]
    sales[sales · cotizaciones y pedidos]
    fiscal[fiscal · comprobantes y GRE]
    receivables[receivables · cuentas por cobrar]
    inventory[inventory · almacenes y movimientos]
    purchasing[purchasing · reposición y compras]
    support[support · tickets y conocimiento]
    tenders[tenders · licitaciones]
  end
  sales --> fiscal --> receivables
  sales --> inventory
  purchasing --> inventory
  inventory --> purchasing
  commerce --- sales & fiscal & inventory & purchasing & receivables
```

| Agente | Precio | Módulo que opera | Lee además |
| --- | --- | --- | --- |
| Invoice Cat | S/ 39 | `fiscal` | `commerce`, `sales` |
| Sales Cat | S/ 59 | `sales` | `commerce`, `inventory` (disponibilidad) |
| Stock Cat | S/ 29 | `inventory` | `commerce` |
| Reorder Cat | S/ 25 | `purchasing` | `inventory`, `sales` (demanda) |
| Support Cat | S/ 39 | `support` | todos, sólo lectura |
| Collections Cat | S/ 25 | `receivables` | `fiscal`, `commerce` |
| **Tender Cat** (hoy RADAR) | S/ 35 | `tenders` | `sales` (cotizar una licitación) |

**Nombre para RADAR: «Tender Cat».** Sigue la convención «<oficio> Cat» del
catálogo y *tender* es licitación en inglés comercial. Alternativas: «Bid Cat» (más
corto) o «Licita Cat» (más claro en español, rompe la convención en inglés). RADAR
puede quedar como nombre de la aplicación de escritorio.

## 2. Reglas transversales

1. **Un PostgreSQL, un esquema por módulo.** Los límites de los módulos son límites
   de esquema; los permisos se otorgan por esquema (como ya se hizo con
   `print_system` y el rol de sólo lectura del asesor).
2. **Todo dato de negocio lleva `org_id`.** Las llaves foráneas entre tablas de
   negocio son compuestas `(org_id, id)`: es imposible, por construcción, que un
   pedido de una empresa apunte al cliente de otra. Además, Row Level Security con
   `current_setting('app.org_id')`.
3. **Dinero en céntimos (`bigint`), sólo soles por ahora** (decisión 2026-11-12). La
   columna `currency` existe con `CHECK (currency = 'PEN')`: admitir USD más adelante
   es quitar el `CHECK` y agregar tipo de cambio, sin rediseñar. IGV por línea con su
   afectación SUNAT (gravado, exonerado, inafecto). Nunca `float`.
4. **Libros inmutables.** Movimientos de inventario, pagos recibidos y eventos de
   auditoría sólo se insertan; los saldos se derivan. Los comprobantes aceptados por
   SUNAT no se editan: se corrigen con notas.
5. **Identificadores** `uuid` (v7, ordenables en el tiempo) en tablas nuevas;
   correlativos humanos (serie-número, número de pedido) como columnas aparte, únicas
   por empresa.
6. **Estados explícitos** con `CHECK`, `created_at`/`updated_at` en `timestamptz` y
   `archived_at` en lugar de borrar.
7. **Idempotencia** por `(org_id, idempotency_key)` en toda operación que un agente
   pueda reintentar (la deduplicación de Meta y los botones ya lo exigen hoy).
8. **Origen del dato.** Las filas creadas por un agente guardan `source_agent`,
   `source_message_id` y `created_by_person_id`: se puede responder «quién lo pidió y
   en qué mensaje».

## 3. Plataforma

### 3.1 `core`: empresas, personas e identidades

Hoy la identidad está repartida: contacto de WhatsApp (`whatsapp.contacts`), cuenta
del portal (`meowlab_app.user`) y empresa de FacturaYa (`tenant_members`). El modelo
las une en **persona**, **identidades** y **membresías**.

```mermaid
erDiagram
  organizations ||--o{ memberships : tiene
  people ||--o{ memberships : pertenece
  people ||--o{ identities : se_identifica_con
  organizations ||--o{ org_tax_profiles : factura_como
  organizations {
    uuid id PK
    text display_name
    text status "active|suspended|closed"
  }
  org_tax_profiles {
    uuid id PK
    uuid org_id FK
    text ruc
    text razon_social
    text facturaya_company_ref "empresa en FacturaYa"
  }
  people {
    uuid id PK
    text display_name
  }
  identities {
    uuid id PK
    uuid person_id FK
    text kind "whatsapp|email|google"
    text value "E.164, correo o sub de Google"
    timestamptz verified_at "OTP, Google o enlace"
  }
  memberships {
    uuid org_id FK
    uuid person_id FK
    text role "owner|member"
  }
```

- `identities(kind, value)` es único: un número de WhatsApp pertenece a una sola
  persona. La vinculación por OTP del portal (ADR-0006) se convierte en «verificar
  una identidad `whatsapp` de la persona».
- Una persona puede pertenecer a varias empresas (contador con varios clientes); la
  empresa activa de la conversación vive en la sesión del agente.
- **Sin permisos por módulo** (decisión 2026-11-12: mypes con equipos pequeños). Todo
  miembro ve y opera todo lo de su empresa; `owner` además administra el plan, los
  pagos y los miembros. El aislamiento obligatorio es entre empresas.

### 3.2 `channel`: canales y conversaciones

`whatsapp_numbers`, `conversations` (persona × número), `messages` (entrantes y
salientes, con `meta_message_id` único para la deduplicación) y `outbox` (mensajes
por enviar con reintentos). Equivale a lo que hoy está en D1 y en `whatsapp.*`; la
migración de D1 a PostgreSQL ya está planeada.

Cada empresa tendrá su propio número (Kapso, su número comercial o Meta Cloud API
directa, según la fase del informe), y algunos roles podrían vivir en un número
**compartido** que opera el equipo de MeowLab. El modelo admite ambos:

- `whatsapp_numbers.owner`: `org` (número de la empresa) o `platform` (número de
  MeowLab), con `provider` (`kapso|meta`) y sus credenciales por referencia, nunca en
  la tabla.
- `number_agents`: qué agentes atienden en cada número. En un número de empresa, sus
  agentes contratados; en el número compartido, los roles transversales.
- En un número compartido, la empresa de cada conversación se resuelve por la
  identidad de la persona (`core.identities`) y su membresía, como ya hace Manolo con
  `tenant_members`.

### 3.3 `agents`: catálogo, activaciones y sesiones

```mermaid
erDiagram
  agent_catalog ||--o{ agent_prices : cuesta
  agent_catalog ||--o{ agent_activations : se_activa_en
  organizations ||--o{ agent_activations : contrata
  agent_activations ||--o{ agent_sessions : conversa
  agent_catalog {
    text key PK "invoice|sales|stock|reorder|support|collections|tender"
    text name
    text runtime_role "enterprise-advisor, quotes, radar"
    bool sellable
  }
  agent_prices {
    text agent_key FK
    bigint price_cents
    date valid_from
  }
  agent_activations {
    uuid org_id FK
    text agent_key FK
    text status "trial|active|grace|blocked|cancelled"
    jsonb config "datos de cobro, almacén por defecto, etc."
  }
  agent_sessions {
    uuid org_id FK
    uuid person_id FK
    text agent_key FK
    jsonb state "hoy contact_role_states"
    bigint version "compare-and-set"
  }
```

`agent_activations.status` es lo que consulta el bridge para el bloqueo por impago
(ADR-0007, fase 2). Los precios tienen vigencia: cambiar una tarifa no reescribe la
historia de lo cobrado.

### 3.4 `billing`: lo que MeowLab le cobra a sus clientes

Generaliza la migración `0003_billing.sql` del portal: la suscripción pasa de la
cuenta del portal a la **empresa**.

- `subscriptions` (empresa, proveedor, `provider_ref`, estado, `paid_until`),
  `subscription_items` (agentes incluidos y su precio congelado), `discount_tiers`.
- `payments` (único por proveedor y referencia; concede un periodo) y
  `payment_claims` (capturas de Yape pendientes de aprobación).
- **Collections Cat sobre MeowLab:** MeowLab es una empresa más dentro del sistema.
  Las cuotas de sus suscripciones se reflejan como cuentas por cobrar en *su propio*
  módulo `receivables`, y Collections Cat las cobra igual que lo haría para cualquier
  comercio. `billing` es la regla de negocio de la plataforma; `receivables` es la
  herramienta del ERP.

### 3.5 `metering` y `audit`

- `metering.usage_events`: empresa, agente, tipo (`ai_tokens`, `meta_template`,
  `meta_message`, `pdf_render`, `sunat_call`), cantidad, costo estimado en céntimos.
  El informe pide medir costo por documento y por agente; hoy no se registra.
- `audit.events` (quién, qué, cuándo, sobre qué entidad, desde qué mensaje) e
  `audit.idempotency_keys`.

## 4. ERP del cliente

### 4.1 `commerce`: datos maestros compartidos

```mermaid
erDiagram
  partners ||--o{ partner_addresses : tiene
  partners ||--o{ partner_contacts : tiene
  products ||--o{ product_prices : cotiza
  price_lists ||--o{ product_prices : agrupa
  partners {
    uuid id PK
    uuid org_id FK
    text doc_type "RUC|DNI|CE|sin_documento"
    text doc_number
    text name
    bool is_customer
    bool is_supplier
    int credit_days
  }
  partner_addresses {
    uuid id PK
    text ubigeo
    text line
    text purpose "fiscal|entrega|partida"
  }
  products {
    uuid id PK
    uuid org_id FK
    text sku
    text name
    text unit_code "catálogo SUNAT"
    text igv_affectation "10, 20, 30…"
    bool tracks_stock
    text supply_type "purchase|manufacture|service"
  }
  price_lists {
    uuid id PK
    uuid org_id FK
    text name
  }
  product_prices {
    uuid product_id FK
    uuid price_list_id FK
    bigint unit_price_cents
    bool includes_igv
  }
```

Un mismo socio puede ser cliente y proveedor. `(org_id, doc_type, doc_number)` es
único cuando hay documento. Las direcciones con ubigeo sirven igual a la factura y a
la guía de remisión.

### 4.2 `sales` (Sales Cat), `fiscal` (Invoice Cat) y `receivables` (Collections Cat)

```mermaid
erDiagram
  quotes ||--o{ quote_lines : contiene
  quotes |o--o| sales_orders : se_convierte
  sales_orders ||--o{ sales_order_lines : contiene
  sales_orders ||--o{ fiscal_documents : se_factura_en
  fiscal_documents ||--o{ fiscal_lines : contiene
  fiscal_documents ||--o| despatch_details : si_es_GRE
  fiscal_documents ||--o{ document_files : guarda
  fiscal_documents ||--o{ receivables : genera
  receivables ||--o{ allocations : se_paga_con
  payments_received ||--o{ allocations : se_aplica
  payments_received ||--o{ payment_evidence : respalda
  receivables ||--o{ collection_actions : se_gestiona
  sales_orders {
    uuid id PK
    uuid org_id FK
    uuid customer_id FK
    text number
    text status "draft|confirmed|fulfilled|invoiced|cancelled"
  }
  fiscal_documents {
    uuid id PK
    uuid org_id FK
    text kind "factura|boleta|nota_credito|nota_debito|gre"
    text series
    int number
    text sunat_status "pending|accepted|observed|rejected"
    bigint total_cents
    text facturaya_ref
    uuid related_document_id "nota o GRE de una factura"
  }
  receivables {
    uuid id PK
    uuid org_id FK
    uuid fiscal_document_id FK
    int installment "cuota"
    date due_date
    bigint amount_cents
    bigint balance_cents
  }
  payments_received {
    uuid id PK
    uuid org_id FK
    uuid partner_id FK
    text method "yape|plin|transferencia|efectivo|mercadopago"
    bigint amount_cents
    text status "pending|confirmed|rejected"
  }
  payment_evidence {
    uuid id PK
    text object_key "captura en R2"
    text extracted_operation "número de operación leído"
    uuid reviewed_by
  }
  collection_actions {
    uuid id PK
    text kind "recordatorio|promesa|llamada"
    timestamptz sent_at
    uuid message_id
  }
```

- **El destino es un solo MeowLab** (decisión 2026-11-12): FacturaYa y RADAR son hoy
  productos aparte y se integrarán. Mientras tanto FacturaYa sigue siendo el motor
  fiscal (firma, envío a SUNAT, CDR) y `fiscal` es su reflejo consultable: cada fila
  apunta a su `facturaya_ref` y se actualiza desde FacturaYa. Al integrarlo, el motor
  fiscal escribe directamente en `fiscal` y `facturaya_ref` queda como dato histórico.
  Clientes y productos nacen en `commerce`, que es la fuente de verdad; FacturaYa
  recibe copias al emitir.
- Las cuotas que ya se cargan en la factura (forma de pago a crédito) se convierten en
  `receivables`. Un pago se reparte entre varias deudas con `allocations`.
- **Collections Cat** trabaja aquí: una captura crea `payments_received` en
  `pending` con su `payment_evidence`; sólo una persona o una conciliación confiable
  la pasa a `confirmed`. Es la misma regla que ya se fijó para Yape en ADR-0007.
- Las cotizaciones en PDF de hoy (`quote_drafts`, `quote_items`) migran a `quotes`.

### 4.3 `inventory` (Stock Cat) y `purchasing` (Reorder Cat)

```mermaid
erDiagram
  warehouses ||--o{ stock_movements : registra
  products ||--o{ stock_movements : mueve
  warehouses ||--o{ stock_counts : se_cuenta
  stock_counts ||--o{ stock_count_lines : contiene
  reorder_rules }o--|| products : vigila
  reorder_proposals ||--o{ reorder_proposal_lines : propone
  reorder_proposals ||--o{ supplier_requests : contacta_proveedor
  reorder_proposals |o--o| purchase_orders : se_aprueba_como
  reorder_proposals |o--o| production_orders : o_se_produce
  products ||--o{ stock_reservations : reserva
  purchase_orders ||--o{ purchase_order_lines : contiene
  purchase_orders ||--o{ goods_receipts : se_recibe
  stock_movements {
    uuid id PK
    uuid org_id FK
    uuid product_id FK
    uuid warehouse_id FK
    numeric quantity "positivo entra, negativo sale"
    text reason "venta|compra|ajuste|traslado|merma"
    text source_type "sales_order|goods_receipt|stock_count|gre"
    uuid source_id
  }
  stock_counts {
    uuid id PK
    text status "open|reconciled"
  }
  stock_reservations {
    uuid sales_order_line_id FK
    numeric quantity
    text status "active|consumed|released"
  }
  supplier_requests {
    uuid id PK
    uuid supplier_id FK
    uuid message_id "conversación con el proveedor"
    text status "sent|answered|accepted|declined"
  }
  production_orders {
    uuid id PK
    uuid product_id FK
    numeric quantity
    text status "planned|in_progress|done|cancelled"
  }
  reorder_rules {
    uuid product_id FK
    uuid warehouse_id FK
    numeric min_qty
    numeric max_qty
    uuid preferred_supplier_id
  }
  reorder_proposals {
    uuid id PK
    text status "proposed|approved|rejected|ordered"
  }
  purchase_orders {
    uuid id PK
    uuid supplier_id FK
    text status "draft|sent|partial|received|cancelled"
  }
```

- El stock es la suma de `stock_movements` (con una vista materializada
  `stock_balances` para leer rápido). Una venta, una recepción, un conteo o una GRE
  generan movimientos; nadie «edita el stock».
- **No se vende sin stock** (decisión 2026-11-12). Confirmar un pedido crea
  `stock_reservations` en la misma transacción que verifica `disponible =
  existencias − reservado`; si no alcanza, el pedido no se confirma. El saldo nunca
  queda negativo: un bloqueo por producto y almacén lo garantiza aunque dos pedidos
  lleguen a la vez.
- **Stock Cat** concilia: un conteo crea `stock_count_lines` y la diferencia se
  registra como movimiento `ajuste`, con quién lo aprobó.
- **Reorder Cat** se dispara cuando un producto cruza su umbral de `reorder_rules`
  (y considera la demanda reciente de `sales`). Según cómo se abastece el producto
  (`products.supply_type`):
  - `purchase`: contacta al proveedor por WhatsApp para pedir la reposición y registra
    la conversación en `supplier_requests` (pedido, respuesta, precio y fecha
    ofrecidos). La orden de compra existe cuando una persona aprueba.
  - `manufacture` (producto propio): crea una `production_orders` (producto, cantidad,
    estado `planned|in_progress|done`). Al terminarla entra el producto terminado. Sin
    recetas en el primer corte (decisión 2026-11-12): no se descuentan insumos.

  Mismo principio que «la IA no emite sin botón»: el agente prepara, una persona
  confirma.

### 4.4 `support` (Support Cat) y `tenders` (Tender Cat)

- `support`: `tickets` (cliente, canal, estado, prioridad, asignado a),
  `ticket_events` (mensajes y cambios, enlazados a `channel.messages`),
  `knowledge_articles` (preguntas frecuentes de cada empresa, con versión) y
  `escalations` (cuando el agente deriva a una persona).
- `tenders`: `tender_notices` (OCID, entidad, objeto, monto, plazos; compartidos entre
  empresas porque son públicos), `tender_matches` (aviso × empresa, con puntaje y
  motivo), `tender_selections` (interesa / descartado, hoy `radar_*_selections`) y
  `tender_bids` (preparación de la propuesta; puede generar una cotización en
  `sales.quotes`). Las tablas `radar_*` actuales se migran aquí.

## 5. De dónde viene cada cosa hoy

| Hoy | Destino |
| --- | --- |
| `whatsapp.tenants`, `tenant_members`, `whatsapp.contacts`, `meowlab_app.user` | `core` (empresas, personas, identidades, membresías) |
| `whatsapp.role_catalog`, `contact_role_states`, `bot_configs` | `agents` |
| D1 `conversations`/`messages`, `whatsapp.conversations`/`messages` | `channel` |
| D1 y `whatsapp.quote_*` | `sales.quotes` |
| FacturaYa (`invoices`, `credit_notes`, `despatches`, `customers`) | `fiscal` (reflejo) y `commerce.partners` |
| `whatsapp.radar_*` | `tenders` |
| `meowlab_app.billing_*` | `billing` |
| `print_system.*` (imprenta del asesor) | datos de una empresa en `commerce`, `sales` y `purchasing` |

## 6. Orden sugerido

1. `core` + `agents`: unificar identidad y activaciones (lo necesitan el bloqueo por
   impago y la fase 3 del portal).
2. `commerce` + `fiscal` (reflejo de FacturaYa) + `receivables`: Invoice Cat y
   Collections Cat, que son lo que ya se vende y cobra.
3. `sales`: Sales Cat (está en pruebas).
4. `inventory` y `purchasing`: Stock y Reorder Cat.
5. `support` y la migración de `tenders`.

## 7. Decisiones y preguntas abiertas

Respuestas del operador (2026-11-12):

| Pregunta | Decisión |
| --- | --- |
| Fuente de verdad | Todo se integra en MeowLab. FacturaYa y RADAR son productos sueltos hoy; el ERP es la fuente de verdad de clientes y productos y FacturaYa recibe copias hasta integrarse (4.2). |
| Stock negativo | **No.** No se vende sin stock: el pedido reserva o no se confirma. Al cruzar el umbral, Reorder Cat contacta al proveedor o, si el producto es propio, genera una orden de producción (4.3). |
| Monedas | Sólo PEN por ahora (regla 3). |
| Tender Cat | **S/ 35 al mes**, como **rol transversal en el número de MeowLab** (como funciona RADAR hoy): los avisos son públicos y compartidos, las alertas proactivas no ponen en riesgo la calidad del número comercial de cada cliente y se puede vender sin esperar a que el cliente tenga su número listo. El costo de las plantillas de Meta se mide por empresa en `metering`. |
| Permisos | Todos los miembros de una empresa ven lo mismo; sólo el `owner` administra plan, pagos y miembros (3.1). |
| Producción | Sólo se registra el producto terminado; sin recetas ni descuento de insumos en el primer corte. |
| Números de WhatsApp | Los agentes que hablan con los clientes de la empresa (Sales, Support, Collections hacia el cliente final) atienden en el **número de la empresa**; los que sólo hablan con el dueño o su equipo pueden vivir en el **número de MeowLab** cuando lo simplifica (3.2). |
| Almacenes y listas de precios | Cada empresa empieza con **un almacén** («Principal») y **una lista de precios** («General»), creados automáticamente. El modelo admite más, pero los agentes no los exponen hasta que un cliente lo necesite. |
