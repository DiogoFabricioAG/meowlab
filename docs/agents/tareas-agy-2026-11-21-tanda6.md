# Tareas para los agentes AGY — sexta tanda (21/11/2026)

Los cuatro agentes terminaron la tanda 5. Esta tanda le da **una tarea a cada uno**:

| Agente | Tarea |
| --- | --- |
| OPS 1 | **T10**: Tender Cat se activa con el pago |
| OPS 2 | **T9**: pagar meses por adelantado con Yape. Está escrita en la [tanda 5](tareas-agy-2026-11-21-tanda5.md), sección T9 |
| OPS 3 | **T12**: Reorder Cat carga proveedores por Excel |
| OPS 4 | **T11**: equipo, con transferir la empresa, salir de ella y acceso al vincular WhatsApp después |

**T8 (consejo de gatos) está al final, en su versión 2.** No tiene agente asignado: la toma el **primer agente que termine** su tarea, de preferencia OPS 4, que hizo el paso 1.

Antes de empezar, cada agente marca su tarea con su nombre en el tablero. Quien coordina revisa, fusiona y despliega. **Ningún agente fusiona ni despliega.**

Es un documento fechado. Si contradice al código o a `AGENTS.md`, mandan ellos.

## Reglas comunes

Valen las «Reglas comunes» de la [tanda 5](tareas-agy-2026-11-21-tanda5.md):

- `npm ci` en tu worktree;
- revisión visual con capturas a 1366 y 390 px si cambia una pantalla;
- toda acción nueva del portal va en `isPortalCompanyRequest`;
- Mercado Pago sin llamadas reales;
- la suite del Worker **completa**, sin fallas.

Además:

- **Archivos compartidos.** T10, T11 y T12 pueden tocar `src/node/bridge/http-handler.ts` o `src/node/server.ts`. Cambia solo tus líneas y rebasa sobre `origin/main` antes de abrir el PR.
- **Nada de teléfonos reales.** La prueba por WhatsApp la hace el operador después del despliegue.

---

## T10 — Tender Cat se activa con el pago

- **Tarea del tablero:** `tender-activacion-suscripcion-20261120`.
- **Worktree y rama:** `D:/meowlab-wt-t10-tender`, rama `feat/tender-activacion-pago`, desde `origin/main`.

### Problema

- Cuando una empresa paga, el portal manda al bridge los gatos pagados y `active_until`.
- `src/node/portal/entitlement-service.ts` activa los gatos de `ENTITLED_AGENTS`, pero `tender` no está en esa lista: termina en `skipped` y no se activa nada.
- Hoy Tender Cat no se vende (`available: false` en Plan). Esta tarea deja lista la activación para cuando se abra la venta.

### Qué hacer

1. **Averigua dónde vive hoy el «Tender Cat activo» de una empresa:**
   - el servicio de Tender (`apps/tender-service/`, su base y su perfil de negocio);
   - la cortesía de CREACIONES J&D;
   - lo que lee el portal para mostrar «Activo».
2. **Haz que `tender` sea un gato con derecho de uso**, con la misma regla que los demás:
   - `source = 'subscription'` y `active_until`;
   - sin tocar una cortesía activa;
   - el pago siguiente extiende el periodo, nunca lo acorta.
3. **Al vencer `active_until`, Tender Cat deja de buscar y avisar** para esa empresa, con la misma lógica de vencimiento que los otros gatos.
4. **No cambies Plan.** `available` sigue en `false` hasta que el operador decida el precio. Anótalo como pregunta abierta en el PR.

### Archivos permitidos

- `src/node/portal/entitlement-service.ts`.
- Una migración PostgreSQL nueva si hace falta, sin aplicarla.
- `apps/tender-service/`, solo la lectura del derecho de uso.
- Sus pruebas.

### Terminado cuando

- Hay pruebas con estos casos:
  - pago nuevo;
  - renovación que extiende el periodo;
  - cortesía activa que no se toca;
  - vencimiento que apaga el servicio;
  - empresa inexistente.
- Pasan la suite del Worker completa y `tsc`, y las pruebas del servicio de Tender si existen.
- El PR explica el flujo y la migración a aplicar.

---

## T11 — Equipo: transferir la empresa, salir de ella y acceso al vincular WhatsApp después

- **Tareas del tablero:** `portal-org-transferir-20261113` y `portal-org-vincular-despues-20261113`.
- **Worktree y rama:** `D:/meowlab-wt-t11-equipo`, rama `feat/equipo-transferir-salir`, desde `origin/main`.
- **Lee antes** el ADR 0010 de `docs/decisions/`, que es la decisión sobre equipos.

### Qué hacer

1. **Transferir la propiedad.**
   - La titular elige a un miembro del equipo.
   - Un diálogo le dice qué pierde (Plan, cobros, Configuración, quitar miembros) y le pide confirmar.
   - El nuevo titular recibe esos permisos y la anterior queda como miembro.
   - Solo se puede transferir a alguien que ya es miembro.
2. **Salir de una empresa.**
   - Un miembro puede salir.
   - La titular no puede salir sin transferir antes, y el portal se lo explica.
3. **Acceso al vincular WhatsApp después.**
   - Hoy el número entra a `tenant_members` solo si ya estaba vinculado al aceptar la invitación.
   - Si alguien acepta y vincula su WhatsApp después, debe recibir el acceso a los gatos de esa empresa en ese momento.
4. **Varias empresas.** Si la persona pertenece a varias, el portal y los gatos siguen respetando la empresa elegida.

### Archivos permitidos

- La página de equipo del portal y sus rutas en `apps/meowlab-app/server/`.
- El servicio de empresas del portal en el bridge (`src/node/portal/`), con sus contratos en `portal-company-contracts.ts`.
- Una migración nueva si hace falta, sin aplicarla.
- Las pruebas.

### Terminado cuando

- Hay pruebas para cada caso:
  - transferir a un miembro;
  - transferir a alguien que no es miembro, que se rechaza;
  - la titular que intenta salir;
  - un miembro que sale;
  - vincular después da acceso;
  - otra empresa no se ve afectada.
- Pasan las suites del portal y del Worker completas, `typecheck` y `build`.
- El PR trae capturas de los diálogos a 1366 y 390 px.

---

## T12 — Reorder Cat: cargar proveedores por Excel

- **Tarea del tablero:** `reorder-cat-2-20261115`, solo la parte de proveedores por Excel.
- **Worktree y rama:** `D:/meowlab-wt-t12-reorder`, rama `feat/reorder-proveedores-excel`, desde `origin/main`.

### Qué hacer

1. **Por WhatsApp, en `/reorder`,** la dueña manda un Excel o CSV con sus proveedores: nombre, teléfono y, si los hay, los productos que le compra y los días de entrega.
2. **Reutiliza la lectura de hojas de Stock Cat** (`src/stock/extractor.ts` y lo que usa la carga de inventario), en lugar de escribir otra.
3. **Confirmar antes de guardar**, igual que en Stock Cat:
   - el gato muestra lo que entendió, por ejemplo «3 proveedores, 12 productos asignados», y pide sí o no;
   - las filas dudosas (un teléfono inválido, un producto que no está en el inventario) se listan aparte y no se guardan.
4. **Sin duplicados.** El mismo archivo o el mismo proveedor dos veces actualiza, no duplica. La llave es el teléfono normalizado.
5. **Fuera de alcance:** pedir precios a varios proveedores y el número propio de la empresa. Quedan en el tablero.

### Archivos permitidos

- `src/reorder/`.
- El servicio de Reorder del bridge (`src/node/reorder/`).
- Su ruteo en `src/index.ts`, solo `/reorder`.
- Lo necesario de `src/stock/` para **reutilizar** el lector, sin cambiar su comportamiento.
- Las pruebas.

### Terminado cuando

- Hay pruebas para estos casos:
  - Excel válido;
  - CSV;
  - filas dudosas;
  - el mismo archivo dos veces;
  - la respuesta «no», que no guarda nada;
  - un archivo de otra empresa no se cruza.
- Pasan la suite del Worker completa y `tsc`.
- El PR trae una conversación de ejemplo con los mensajes del gato.

---

## T8, versión 2 — La mesa del consejo: cómo va tu negocio

- **Tarea del tablero:** `portal-consejo-de-gatos-20261121`.
- **Worktree y rama:** `D:/meowlab-wt-t8-consejo`, rama `feat/consejo-de-gatos`.
  - Rebasa el paso 1 (PR #79, en borrador) sobre `origin/main` y sigue en el mismo PR.
  - Reutiliza la ilustración de la mesa redonda.
- **Decisión del operador:** la **mesa redonda**, sin repetir nada de Inicio. Tiene que quedar claro que **cada cosa está en un solo lugar**.

### Un lugar para cada pregunta

| Pregunta de la dueña | Dónde se responde | Ritmo |
| --- | --- | --- |
| ¿Qué tengo que hacer ahora? | Inicio · **Para atender** | Al momento |
| ¿Qué hicieron hoy mis gatos? | Inicio · **Tus gatos hoy** | Hoy |
| ¿Qué pasó antes? | Inicio · **Actividad reciente** | Historial |
| **¿Cómo va mi negocio y qué puedo mejorar?** | **Tus agentes · la mesa del consejo** | Semanas y meses |
| ¿Qué hizo este gato en detalle? | La ficha de cada gato (`/agentes/*`) | Cuando la abres |

Consecuencias:

- **La mesa no muestra pendientes ni lo de hoy.**
  - Fuera los textos del tipo «Tienes 2 cobros vencidos», «1 consulta necesita tu respuesta» o «Hoy registró 2 movimientos»: eso ya está en Inicio.
  - Fuera también las líneas «Hoy…» de cada intervención del paso 1.
- **«Tendencia (14 días)» sale de Inicio** (`HomeActivity.tsx`) y pasa a la mesa.
  - En la mesa es «lo que el consejo revisa en su reunión», arriba o junto a la mesa.
  - Hay que mejorar cómo se lee, porque el operador dijo que hoy no se entiende bien: una escala clara, montos en soles y la comparación con la semana anterior.
- **Inicio** se queda con Para atender, Tus gatos hoy y Actividad reciente.

### Qué dice cada gato: tendencias y oportunidades

- **Reglas fijas** (sin IA) en un módulo puro y probado. Usan solo lo que el portal ya recibe: el resumen semanal (`WeeklySummary`) y los 14 días de actividad (`ActivityDay`).
- **Un consejo por gato:** el que más pesa según su umbral. Si no se cumple ningún umbral, el gato dice una frase corta con humor de que está tranquilo.
- **Si faltan datos,** el gato dice «todavía no tengo suficientes datos para aconsejarte». Nunca dice «todo en orden».

| Gato | Dato | Ejemplo de consejo | Acción |
| --- | --- | --- | --- |
| Sales Cat | `monthTotalCents` / `goalTargetCents` contra la parte del mes que ya pasó (hora de Lima) | «A este ritmo cierras el mes en el 78 % de tu meta: te faltan S/ 1 200, unos S/ 130 por día.» Sin meta: «Ponme una meta y te digo cómo vas.» | Ver meta |
| Sales Cat (alternativa) | `salesCents` de los últimos 7 días contra los 7 anteriores | «Vendiste 25 % más que la semana pasada.» | Ver ventas |
| Invoice Cat | `totalPen` contra `previousTotalPen` | «Facturaste S/ 3 400, un 12 % menos que la semana pasada.» | Ver comprobantes |
| Collections Cat | `paidWeekCents` contra `owedCents`, y la parte de deudas atrasadas | «Esta semana cobraste S/ 800 de los S/ 2 500 que te deben. 3 de cada 10 deudas se te atrasan: pide adelanto a los clientes nuevos.» | Ver cobranza |
| Reorder Cat | `monthSpentCents` contra las ventas del mes | «Este mes tus compras son el 64 % de lo que vendiste.» | Ver pedidos |
| Support Cat | `answered` / `customers` y `escalated` | «Resolví solo 8 de cada 10 consultas.» Si el dato existe, agrega qué tipo de consultas pasa a la dueña: «Lo que te paso suele ser de precios: súmalo a tus respuestas.» | Ver respuestas |
| Tender Cat | `interesting` / `found` | «De 14 licitaciones, solo 2 encajan con tu negocio. Revisa tu perfil para que busque mejor.» | Ver licitaciones |
| Stock Cat | Hoy no hay dato de productos sin movimiento | No inventa. Dice «todavía no tengo datos», y el dato que falta queda como tarea del bridge (`bridge-productos-sin-movimiento-20261121`). | Ver productos |

- **Silla vacía:** si un gato se puede comprar en Plan y la empresa no lo tiene, su silla dice «Este puesto está libre: suma a X para…», con un enlace a Plan. Tender Cat no se ofrece mientras esté con `available: false`.
- **Los umbrales,** por ejemplo desde qué porcentaje de cambio vale la pena comentar, van como constantes con nombre y se explican en el PR.

### Tono y forma

- Divertido, no infantil: frases cortas, de tú, con algún emoji.
- Nunca dice «RADAR», «FacturaYa» ni «Manolo».
- En el celular la mesa se convierte en una lista vertical que se lee bien a 390 px.
- Respeta `prefers-reduced-motion`.
- Los consejos son texto real, no imágenes.
- «Ver lo que hizo» sigue en cada intervención y lleva a la ficha del gato.

### Archivos permitidos

- `web/src/AgentsPage.tsx` y los componentes nuevos del consejo.
- Un módulo puro con las reglas de consejo.
- `HomeActivity.tsx` y `WeeklyHome.tsx`, solo para **quitar** Tendencia de Inicio.
- Las pruebas del portal.
- **No se tocan:** el bridge, las fichas `/agentes/*` ni Plan.

### Terminado cuando

- Las reglas tienen pruebas con datos, sin datos, con un gato sin contratar y justo en los umbrales.
- Inicio ya no muestra Tendencia, y nada de la mesa repite Para atender ni Tus gatos hoy.
- Pasan `npm test`, `npm run typecheck` y `npm run build`.
- El PR trae capturas a 1366 y 390 px de la mesa y de Inicio.
- La tarea del tablero queda en `done`.
