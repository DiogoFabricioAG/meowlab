# 0008. Modelo de datos de MeowLab como ERP

- Estado: aceptado (2026-11-12)
- Responsable: MeowLab
- Detalle: [`docs/architecture/erp-modelo-datos-borrador.md`](../architecture/erp-modelo-datos-borrador.md)
  (diagramas entidad-relación, tablas por módulo y origen de cada tabla actual).

## Contexto

El informe ejecutivo 2027–2029 vende seis agentes por separado (Invoice, Sales,
Stock, Reorder, Support y Collections Cat) y hoy existen además RADAR (licitaciones),
FacturaYa (motor fiscal), Manolo (Worker y bridge) y el portal. Sus datos están
repartidos en D1, el esquema `whatsapp` de PostgreSQL, la base del portal,
FacturaYa y `print_system`. Para que los agentes colaboren (vender, facturar,
descontar stock, reponer, cobrar y atender sobre los mismos datos) hace falta un
modelo común.

## Decisión

1. **MeowLab es un ERP con agentes como interfaz.** Ningún agente es dueño de sus
   datos: todos leen y escriben módulos compartidos. FacturaYa y RADAR se integran en
   MeowLab; el ERP es la fuente de verdad de clientes y productos.
2. **Un PostgreSQL, un esquema por módulo.** Plataforma: `core`, `channel`, `agents`,
   `billing`, `metering`, `audit`. ERP: `commerce`, `sales`, `fiscal`, `receivables`,
   `inventory`, `purchasing`, `support`, `tenders`. Los permisos de base se otorgan por
   esquema.
3. **Agentes y módulos.** Invoice Cat → `fiscal`; Sales Cat → `sales`; Stock Cat →
   `inventory`; Reorder Cat → `purchasing`; Support Cat → `support`; Collections Cat →
   `receivables`; **Tender Cat** (nuevo nombre del agente de RADAR, S/ 35 al mes) →
   `tenders`. RADAR queda como nombre de la aplicación de escritorio.
4. **Aislamiento entre empresas.** Toda fila de negocio lleva `org_id`; las llaves
   foráneas son compuestas `(org_id, id)` y hay Row Level Security. Dentro de una
   empresa no hay permisos por módulo: todos los miembros ven lo mismo y sólo el
   `owner` administra plan, pagos y miembros.
5. **Identidad unificada.** Persona, identidades verificadas (WhatsApp, correo,
   Google) y membresías en empresas reemplazan a contacto, cuenta del portal y miembro
   de FacturaYa por separado.
6. **Dinero en céntimos y sólo PEN** por ahora (`CHECK (currency = 'PEN')`), IGV por
   línea con su afectación SUNAT.
7. **Libros inmutables y sin stock negativo.** Stock, pagos y auditoría sólo agregan
   movimientos. Confirmar un pedido reserva stock o no se confirma. Los comprobantes
   aceptados no se editan: se corrigen con notas.
8. **Los agentes preparan, una persona confirma.** Reorder Cat, al cruzar el umbral,
   contacta al proveedor por WhatsApp o, si el producto es propio, crea una orden de
   producción (sólo producto terminado, sin recetas); la compra o la producción existen
   cuando una persona aprueba. Collections Cat registra capturas como pagos pendientes
   hasta su aprobación.
9. **Números de WhatsApp.** Cada número tiene dueño (`org` o `platform`) y una lista
   de agentes que atienden en él. Los agentes que hablan con los clientes de la empresa
   van en el número de la empresa; Tender Cat es un rol transversal en el número de
   MeowLab, con su costo de Meta medido por empresa.
10. **Primer corte:** un almacén («Principal») y una lista de precios («General») por
    empresa, creados automáticamente.
11. **FacturaYa, mientras siga aparte,** emite y `fiscal` es su reflejo consultable con
    `facturaya_ref`; al integrarlo, el motor fiscal escribe directamente en `fiscal`.

## Consecuencias

- Cada agente nuevo se construye sobre módulos que ya usan los demás: Sales Cat
  necesita `commerce`, `sales` e `inventory` antes de venderse.
- La identidad unificada cambia cómo se resuelven roles y vinculaciones (ADR-0006) y
  dónde vive la suscripción (ADR-0007): ambas pasan de cuentas o contactos a empresas.
- La migración desde D1 y los esquemas actuales es gradual; el detalle indica el destino
  de cada tabla de hoy.
- `metering` empieza a registrar consumo por empresa y agente, que el informe necesita y
  hoy no existe.

## Fases

1. `core` + `agents`: identidad unificada y activaciones por empresa (lo necesitan el
   bloqueo por impago y la fase 3 del portal).
2. `commerce` + `fiscal` (reflejo de FacturaYa) + `receivables`: Invoice y Collections
   Cat.
3. `sales`: Sales Cat.
4. `inventory` y `purchasing`: Stock y Reorder Cat.
5. `support` y migración de `radar_*` a `tenders`.
