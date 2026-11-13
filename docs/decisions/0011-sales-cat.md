# 0011. Sales Cat: el vendedor del negocio en su propio WhatsApp

- Estado: aceptado (2026-11-13), respuestas del operador al cuestionario de Sales Cat
- Responsable: MeowLab
- Relacionado: ADR-0008 (modelo de datos, números y módulos), ADR-0009 (Kapso),
  ADR-0010 (empresas en el portal), rol de cotizaciones de Manolo (migraciones D1
  `0005`–`0009`, `src/roles/quote-role.ts`, `src/quotes/`)

## Contexto

El ADR-0008 asignó a Sales Cat el módulo `sales` (cotizaciones y pedidos), S/ 59 al mes,
y fijó que los agentes que hablan con los clientes de una empresa van en el número de
esa empresa. Manolo ya tiene un rol de cotizaciones que extrae los ítems con IA y genera
un PDF. Este ADR fija qué es Sales Cat a partir del cuestionario del operador.

## Decisión

1. **Es la puerta de entrada de los clientes del negocio.** Una persona A le escribe al
   número de WhatsApp del negocio B y la atiende Sales Cat: capta al prospecto (lead),
   responde, arma la cotización y registra la venta. Corre en el número de la empresa
   (Meta o Kapso, ADR-0009), nunca en el de MeowLab.
2. **La titular y su equipo le hablan por el chat de Manolo** con un comando (`/sales`) o
   con el nombre que el negocio le ponga a su gato. Le preguntan quién escribió, cuántas
   cotizaciones hubo, cómo van las ventas, y pueden **tomar la conversación con un
   cliente** y hablarle directamente.
3. **Rubro inicial: productos y servicios** (comercio e imprenta, taller, agencia).
   Piloto con CREACIONES J&D.
4. **Absorbe el rol de cotizaciones** actual: su extracción con IA y su PDF pasan a ser
   parte de Sales Cat.
5. **La venta se cuenta por texto.** Lo que Sales Cat genera (cotización, pedido) se
   guarda en la plataforma y se comparte con **un botón con enlace** para verlo; el
   cliente final no necesita cuenta.
6. **Catálogo opcional:** si un producto no existe, se crea al vuelo con el precio dicho,
   y también se pueden crear y editar productos conversando con el gato.
7. **Clientes:** pueden quedar como «cliente varios»; con RUC o DNI se identifican.
8. **Cada venta guarda** fecha, cliente, productos con cantidad y precio, descuento,
   forma de pago (efectivo, Yape, Plin, transferencia, crédito), vendedor y notas.
9. **Ventas al crédito:** se registran como deuda desde el inicio; Collections Cat las
   cobra cuando exista, y mientras tanto se cobran a mano.
10. **Confirmación:** antes de guardar, Sales Cat muestra el resumen y pide confirmar.
11. **Con Invoice Cat:** al registrar la venta pregunta si se emite factura o boleta.
12. **Con Stock Cat:** cada venta descuenta stock y sin stock no se vende (ADR-0008, sin
    stock negativo). Mientras Stock Cat no exista, Sales Cat no controla stock.
13. **Funciona solo:** no requiere Invoice Cat ni Stock Cat activos.
14. **Consultas:** responde todo lo que sabe de ventas, cotizaciones, clientes y
    productos. Lo que es de otro agente (por ejemplo «¿cuánto me deben?», de Collections
    Cat) lo deriva a ese agente; si la empresa no lo tiene, Sales Cat responde con lo que
    sabe.
15. **No envía resúmenes por su cuenta:** sólo responde cuando se le pregunta.
16. **Metas mensuales** en una segunda fase.
17. **En el portal:** su ficha en «Tus agentes» y su línea en el «Hoy» de Inicio («Sales
    Cat registró 12 ventas por S/ 1,240»).
18. **Equipo:** todos ven todo (ADR-0008, sin permisos por módulo).
19. **Corregir o anular:** cualquiera del equipo, con registro de quién y cuándo.
20. **Precio:** S/ 59 al mes, sin cambio.

## Consecuencias

- Sales Cat necesita un número de WhatsApp de la empresa antes de venderse; para el
  piloto, CREACIONES J&D usa un número propio (Meta) o el del piloto de Kapso.
- Es el primer agente que conversa con terceros: requiere límites claros (qué puede
  prometer, precios que no inventa, cuándo pasa la conversación a una persona) y un
  modo de toma de control por la titular.
- Construye los módulos `commerce` (clientes y productos) y `sales` (cotizaciones,
  pedidos y ventas) del ADR-0008 sobre PostgreSQL, que después usan Invoice, Stock y
  Collections Cat.
- El rol de cotizaciones actual (D1) migra a `sales`; sus PDF y numeración se conservan.

## Fases

1. **Interno:** la titular registra ventas y cotizaciones por el chat de Manolo
   (`/sales`), catálogo al vuelo, clientes, enlace a la cotización guardada,
   confirmación y factura o boleta con Invoice Cat. Línea en Inicio y ficha en el portal.
2. **Frente al cliente:** Sales Cat atiende en el número de la empresa, capta prospectos,
   cotiza y registra pedidos; la titular consulta y toma la conversación desde Manolo.
3. **Después:** metas mensuales, nombre propio del gato por empresa, stock con Stock Cat
   y deudas con Collections Cat.

## Preguntas abiertas

- Qué número usará CREACIONES J&D para hablar con sus clientes.
- Cómo toma la titular una conversación: desde el chat de Manolo (Sales Cat le reenvía
  los mensajes) o desde el portal.
- Qué puede decidir Sales Cat solo frente a un cliente (descuentos, plazos) y cuándo
  avisa a la titular.
