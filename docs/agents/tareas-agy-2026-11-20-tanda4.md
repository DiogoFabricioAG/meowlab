# Tareas para los agentes AGY — cuarta tanda del 20/11/2026

Cuarta ronda para **AGY-1**, **AGY-2** y **AGY-3**. AGY-1 terminó la app Android,
fase 1 (PR #47, fusionado), y su sección se agregó después de las otras dos. Como siempre, quien coordina revisa, fusiona y despliega. **Ningún agente
fusiona ni despliega.**

La prioridad del operador ahora son las **funcionalidades**: los gatos y el portal
completos en la web, antes que publicar la app.

Es un documento fechado. Si contradice al código o a `AGENTS.md`, mandan ellos.

---

## Reglas comunes

Valen las «Reglas comunes» de las tandas anteriores:

- [`tareas-agy-2026-11-20.md`](tareas-agy-2026-11-20.md);
- [`tareas-agy-2026-11-20-tanda2.md`](tareas-agy-2026-11-20-tanda2.md);
- [`tareas-agy-2026-11-20-tanda3.md`](tareas-agy-2026-11-20-tanda3.md).

Además:

1. **`node_modules` de la raíz.**
   - El `tsconfig.json` de la raíz extiende el de Astro, y Vitest lo encuentra
     también al correr las pruebas del portal.
   - En tu worktree, enlaza también `node_modules` de la raíz con un junction a
     `D:\meowlab\node_modules`. Si no, las pruebas del portal fallan con
     «Failed to load tsconfig 'astro/tsconfigs/base'».
2. **Mercado Pago ya está en producción.** Desde el 20/11 el portal cobra de verdad.
   - No pruebes compras ni llames a la API de Mercado Pago con las credenciales del
     VPS.
   - Para pruebas, usa los dobles (`MercadoPagoApi`) que ya tienen las pruebas del
     portal.
3. **Tablero.** Tus tareas ya están en `in_progress` con tu nombre. Las tareas
   «hermanas» que tu trabajo cierre también pasan a `done` con la misma evidencia.

---

## AGY-2 — Cobros: que todos los gatos se puedan comprar y que el pago los active

- **Tarea principal:** `billing-activacion-gatos-20261120`.
- **Tareas hermanas que se cierran con esta:**
  - `stock-cat-3-venta-20261113`;
  - `collections-cat-3-venta-20261114`, solo la parte de «a la venta en el Plan»;
  - `billing-tender-cat-catalog-20261112`;
  - `portal-tender-catalogo-20261113`.
- **Worktree y rama:** `D:/meowlab-wt-activacion-gatos`, rama
  `feat/billing-activacion-gatos`.
- **Lectura obligatoria:**
  - `docs/decisions/0007-cobros-mercado-pago-y-yape.md`;
  - ADR-0014 a ADR-0017, en la sección del precio de cada gato.

### Cómo está hoy

- **Catálogo (`billing_agents`, PostgreSQL del portal):** solo `invoice` y `sales`
  tienen `available = true`.
  - `stock` (S/ 29), `reorder` (S/ 25), `support` (S/ 39) y `collections` (S/ 25)
    están en `false`.
  - **Tender Cat (S/ 35) no está en el catálogo.**
- **Activación tras el pago:** el portal llama al bridge
  (`/v1/portal/entitlements`). `PortalEntitlementService`, en
  `apps/manolo-whatsapp-worker/src/node/portal/entitlement-service.ts`, solo
  activa Sales Cat: `ENTITLED_AGENTS = ["sales"]`.
  - Escribe `sales.settings` con `source = 'subscription'` y `active_until`
    monótono.
  - No toca una cortesía activa.

### Qué hacer

1. **Migración nueva del portal**
   - Archivo `apps/meowlab-app/migrations-postgres/0005_…sql`. **No la apliques.**
   - Pone `available = true` en `stock`, `reorder`, `support` y `collections`.
   - Actualiza la descripción de cada gato con lo que hace hoy, en una frase para la
     dueña.
   - Agrega Tender Cat: clave `tender`, S/ 35, descripción de lo que hace.
   - Mantiene los precios de las ADR.
2. **Activación por gato en el bridge**
   - Extiende `ENTITLED_AGENTS` a `stock`, `collections`, `reorder` y `support`.
   - Cada uno escribe su tabla:
     - `stock.settings`;
     - `receivables.settings`;
     - `purchasing.settings`;
     - `support.settings`.
   - Misma regla que Sales Cat:
     - no tocar una cortesía activa;
     - una cortesía apagada pasa a suscripción;
     - `active_until` nunca retrocede.
   - **Primero revisa las columnas de cada tabla.** Si alguna no tiene `source` o
     `active_until`, hace falta una migración nueva del bridge en
     `infra/postgres/migrations/`, sin aplicar. Comprueba el siguiente número libre
     también en las ramas `origin/feat/tender-*`.
   - **Support y Collections usan el número de la empresa.** Si su tabla exige datos
     que el pago no trae (por ejemplo `phone_number_id`), el pago la deja
     **habilitada pero pendiente de configuración**, no a medias. Explica en el PR
     qué ve la dueña y qué le falta.
3. **Tender Cat**
   - Su activación vive en el servicio de Tender, que es de otra sesión. No la
     implementes.
   - El pago de `tender` debe quedar registrado y el bridge debe devolverlo en
     `skipped`, sin error.
   - Agrega al tablero una tarea `todo` para que el flujo de Tender lo active.
4. **Invoice Cat**
   - El pago no sustituye la clave SOL.
   - En la tarjeta de Plan y en la de «Tus agentes», di qué falta después de pagar:
     «Después del pago, conecta tu clave SOL de SUNAT».
5. **Pruebas**
   - Del bridge, por gato:
     - activación;
     - cortesía respetada;
     - `active_until` monótono;
     - aislamiento por tenant: el pago de una empresa no activa a otra.
   - Del portal: el catálogo muestra los siete gatos y el descuento por cantidad
     (`billing_discounts`) sigue calculando bien con 5 o más.

### Archivos permitidos

- `apps/meowlab-app/migrations-postgres/`.
- `apps/meowlab-app/server/billing/` y las tarjetas de Plan y «Tus agentes» en
  `web/src`, solo los textos de activación.
- `apps/manolo-whatsapp-worker/src/node/portal/entitlement-service.ts`,
  `src/bridge/portal-entitlement-contracts.ts`, sus pruebas y, si hace falta,
  `infra/postgres/migrations/`.

### Terminado cuando

- **Portal:** pasan `npm test`, `npm run typecheck` y `npm run build`.
- **Worker:** pasan `npm test`, con la línea base de 2 fallas de Tender, y
  `npx tsc --noEmit`.
- **El PR trae:**
  - la tabla final del catálogo (clave, nombre, precio, disponible);
  - qué tabla activa cada gato;
  - las migraciones que habrá que aplicar al desplegar, en orden.

---

## AGY-3 — Stock Cat, fase 2: digitalizar con Excel, fotos y la factura del proveedor

- **Tarea del tablero:** `stock-cat-2-digitalizar-20261113`.
- **Worktree y rama:** `D:/meowlab-wt-stock-digitalizar`, rama
  `feat/stock-cat-digitalizar`.
- **Lectura obligatoria:** `docs/decisions/0014-stock-cat.md`, en especial las
  decisiones 5, 6, 8, 9, 10 y 12, y la sección «Consecuencias».

### Objetivo

Que la dueña pueda cargar su inventario sin escribir producto por producto:

1. **Carga inicial desde Excel:** manda un `.xlsx` o `.csv` por WhatsApp con su
   lista (producto, cantidad, costo y, si tiene, stock mínimo).
2. **Carga inicial desde una foto:** de una lista impresa o de su cuaderno.
3. **Entradas desde la foto de la factura del proveedor:** el gato lee productos,
   cantidades y costos unitarios.

**En los tres casos:**

- el gato muestra lo que entendió en un resumen corto y pide confirmar con botones
  («Guardar», «Corregir», «Cancelar»);
- **nada se guarda sin confirmación**;
- al confirmar, se registran como movimientos normales: carga inicial o entrada
  con costo. Así el costo promedio ponderado y las alertas de mínimo siguen
  funcionando.

### Cómo

- **Investiga primero:**
  - cómo llega hoy un documento o imagen al rol de Stock Cat
    (`src/roles/stock-role.ts`) y la normalización multimodal del Worker;
  - cómo leen fotos Invoice Cat o Collections Cat (capturas de Yape) y reutiliza
    ese camino, sin crear otro.
- **Excel en el bridge:**
  - con una librería mantenida y sin vulnerabilidades conocidas. Justifica cuál en
    el PR; nada de dependencias abandonadas;
  - limita el tamaño (por ejemplo 2 MB y 500 filas) y responde con un mensaje
    claro si se pasa;
  - acepta encabezados en español con variantes («Producto», «Descripción»,
    «Cant.», «Cantidad», «Costo», «P. unit.»);
  - si no reconoce las columnas, pregunta cuál es cuál.
- **Imágenes:**
  - el modelo multimodal ya usado devuelve una lista estructurada (nombre,
    cantidad, costo opcional);
  - se valida con un esquema antes de mostrarla;
  - lo ilegible no se inventa: se marca y se pregunta.
- **Asociación con el catálogo:**
  - por nombre sin distinguir mayúsculas, como dice la ADR;
  - lo que no coincide se ofrece como producto nuevo;
  - los alias se recuerdan.
- **Factura del proveedor:**
  - guarda el proveedor y el número de la factura en el movimiento, si se leen;
  - la misma factura no puede registrarse dos veces: idempotencia por proveedor y
    número.
- **Textos:** en primera persona del gato, cortos, para la dueña. Sin «Manolo».

### Archivos permitidos

- `apps/manolo-whatsapp-worker/src/roles/stock-role.ts`,
  `src/node/stock/` y sus pruebas.
- El adaptador multimodal, solo si hace falta una función nueva y sin cambiar el
  comportamiento de los demás roles.
- `infra/postgres/migrations/`, solo si hace falta una columna nueva (proveedor y
  número de factura, alias). Sin aplicar; revisa el siguiente número libre,
  también en `origin/feat/tender-*` y en la rama de AGY-2.
- `package.json` y `package-lock.json` del Worker, solo para la librería de Excel.

### Terminado cuando

- **Worker:** pasan `npm test`, con la línea base, y `npx tsc --noEmit`.
- **Pruebas nuevas:**
  - Excel con encabezados variados;
  - Excel demasiado grande;
  - foto con un ítem ilegible;
  - factura repetida;
  - confirmación y cancelación;
  - aislamiento por tenant.
- **El PR trae** un ejemplo de conversación para cada uno de los tres flujos, como
  texto de chat, y la librería elegida con su versión y su `npm audit`.
- La tarea del tablero queda en `done`.

---

## AGY-1 — Sales Cat, fase 3: metas del mes, nombre propio y ventas al crédito en Collections

- **Tarea del tablero:** `sales-cat-3-extras-20261113`. Esta tanda cubre las metas, el
  nombre propio y las deudas; **no** cubre el stock.
- **Worktree y rama:** `D:/meowlab-wt-sales-fase3`, rama `feat/sales-cat-fase-3`.
- **Lectura obligatoria:** `docs/decisions/0011-sales-cat.md` (decisiones 2, 9, 14, 15,
  16 y 17, y las fases) y `docs/decisions/0015-collections-cat.md`.

### Qué hacer

1. **Metas mensuales**
   - **Cómo se pone la meta:**
     - por chat: «mi meta de diciembre es S/ 20,000», «¿cómo voy con la meta?»;
     - desde la ficha de Sales Cat en el portal.
   - **Qué guarda:** una meta de monto por empresa y por mes.
   - **Qué responde Sales Cat cuando le preguntan:** cuánto lleva, qué porcentaje es,
     cuánto falta y a qué ritmo diario tendría que vender en los días que quedan.
   - **No envía avisos por su cuenta** (decisión 15). Solo la línea de Inicio puede
     mostrar el avance, por ejemplo «Sales Cat: S/ 12,400 de S/ 20,000 (62 %)».
   - **Ventas que cuentan:** las confirmadas del mes en hora de Lima. Las anuladas no
     cuentan.
2. **Nombre propio del gato por empresa (decisión 2)**
   - La titular puede ponerle nombre por chat («llámate Michi») o desde la ficha del
     portal.
   - En el chat, escribir ese nombre al inicio («Michi, ¿cuánto vendimos hoy?») lo
     llama igual que `/sales`.
   - El nombre se usa en sus respuestas.
   - **Límites del nombre:** de 2 a 20 caracteres y sin enlaces. Tampoco puede
     coincidir con el nombre o el comando de otro gato ni con «MeowLab».
   - **No puede romper el ruteo de los demás roles ni la deduplicación.** Agrega
     pruebas de que «/stock», «/collections» y los mensajes normales siguen yendo
     donde iban.
3. **Ventas al crédito como deuda en Collections Cat (decisión 9)**
   - **Hoy:** una venta con forma de pago `credito` guarda su saldo en `sales.sales`,
     pero no crea deuda en `receivables`.
   - **Qué cambia:** al confirmarla, si la empresa tiene Collections Cat activo, crea la
     deuda del cliente en `receivables.debts`, enlazada a la venta:
     - el vencimiento usa `default_due_days` de Collections;
     - si la venta trae fecha, usa esa.
   - **Una sola deuda por venta:** idempotencia por venta.
   - **Anular la venta** anula la deuda si aún no tiene pagos. Si ya tiene pagos, no la
     toca y avisa a la titular.
   - **Sin Collections Cat activo**, todo sigue como hoy: el saldo queda en la venta.
   - **Si después se activa Collections**, ofrece por chat traer las ventas al crédito
     con saldo pendiente. No las migres solas.
   - **Respuestas de Sales Cat:** dice «Registré la venta al crédito; Collections Cat
     le hará seguimiento» solo cuando de verdad creó la deuda.

### Archivos permitidos

- `apps/manolo-whatsapp-worker/src/roles/sales-role.ts`, `src/node/sales/` y sus pruebas.
- `src/node/collections/`, solo para una función de alta y anulación de deuda desde
  Sales, sin cambiar los flujos de Collections. Sus pruebas deben seguir igual.
- El ruteo de roles, solo lo mínimo para el nombre propio, con pruebas.
- `infra/postgres/migrations/` para la tabla de metas, el nombre del gato y el enlace
  venta-deuda. Sin aplicar. Revisa el siguiente número libre también en las ramas de
  AGY-2 y AGY-3 y en `origin/feat/tender-*`; si chocan, usa el siguiente y anótalo.
- Portal: la ficha de Sales Cat en `apps/meowlab-app/web/src` (meta y nombre), la
  línea de Inicio y la ruta de servidor que haga falta. Usa `apiFetch` y `PageHeader`,
  que ya están en `main`.
- **No toques Stock Cat** (es de AGY-3) **ni Plan ni la activación por pago** (son de
  AGY-2).

### Terminado cuando

- **Worker:** pasan `npm test`, con la línea base de 2 fallas de Tender, y
  `npx tsc --noEmit`.
- **Portal:** pasan `npm test`, `npm run typecheck` y `npm run build`.
- **Pruebas nuevas:**
  - meta del mes con ventas anuladas;
  - cambio de mes en hora de Lima;
  - nombre propio que no rompe el ruteo;
  - venta al crédito que crea una sola deuda;
  - anulación con y sin pagos;
  - empresa sin Collections;
  - aislamiento por tenant.
- **El PR trae:**
  - un ejemplo de conversación para cada una de las tres funciones;
  - las migraciones que habrá que aplicar, en orden.
