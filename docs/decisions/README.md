# Decisiones arquitectónicas

Este directorio almacena ADRs para decisiones estructurales que afectan más de
una aplicación, cambian una fuente de verdad o son costosas de revertir.

## Índice

- [0014 — Stock Cat](0014-stock-cat.md): alertas para que nada se acabe; el stock baja con los
  comprobantes de Invoice Cat y se carga por chat, Excel o imagen.

- [0013 — Plantilla única y cotización en PDF](0013-plantilla-unica-y-cotizacion-en-pdf.md): un
  solo formato para todos los documentos, la cotización de Sales Cat como PDF y sin blob
  storage hasta que el volumen lo pida.

- [0012 — Formato de los documentos](0012-formato-de-documentos.md): kit de marca y plantillas.
  Reemplazado por 0013.

- [0011 — Sales Cat](0011-sales-cat.md): el vendedor del negocio en su propio WhatsApp;
  la titular lo consulta y toma conversaciones desde Manolo.

- [0010 — Empresas e invitaciones en el portal](0010-empresas-e-invitaciones-en-el-portal.md):
  crear empresa con RUC, unirse sólo con enlace del dueño y credenciales SOL sólo para Invoice Cat.

- [0009 — Kapso como proveedor de números](0009-kapso-proveedor-de-numeros.md):
  proveedor por número, payload de Meta reenviado a /webhooks/kapso con su firma y cada proveedor sólo por sus números.

- [0008 — Modelo de datos de MeowLab como ERP](0008-modelo-de-datos-erp.md):
  un esquema por módulo, agentes sobre datos compartidos, identidad unificada y Tender Cat en el número de MeowLab.

- [0007 — Cobros con Mercado Pago y Yape](0007-cobros-mercado-pago-y-yape.md):
  propuesto; catálogo por agente con descuento por equipo, suscripción recurrente y bloqueo por impago.

- [0006 — Portal app.meowlab.tech](0006-portal-app-meowlab.md):
  propuesto; cuentas Better Auth vinculadas al número por WhatsApp entrante y lectura por el bridge.

- [0005 — El modelo interpreta los mensajes de facturación](0005-modelo-interpreta-facturacion.md):
  interpretación semántica con procedencia, preguntas persistidas y validación de negocio separada.

- [0004 — Un turno para texto e imágenes contiguas](0004-rafagas-texto-imagen.md):
  extiende ADR-0002 para incorporar fotos en la misma ventana y normalizar cada entrada.
- [0003 — RADAR como rol de licitaciones](0003-radar-rol-licitaciones.md):
  publicado y asignable desde la TUI; conserva consentimiento y datos locales.
- [0002 — Agrupar ráfagas de WhatsApp por conversación](0002-agrupar-rafagas-whatsapp.md):
  implementación local; ventana de tres segundos, cola durable y activación pendiente.
- [0001 — RADAR como proyecto consumidor del canal WhatsApp compartido](0001-radar-canal-whatsapp-compartido.md):
  decisión original de notificaciones; su exclusión del catálogo de roles fue
  sustituida por ADR-0003. Se conserva el webhook único.

## Cuándo crear un ADR

- Introducir o retirar una base de datos, cola, framework o proveedor.
- Cambiar la ubicación del webhook de Meta.
- Mover sesiones o workflows entre Worker y VPS.
- Modificar el modelo de aislamiento multi-tenant.
- Cambiar el esquema de firma, idempotencia o cifrado.
- Unificar o separar despliegues del monorepo.

Una corrección local, un nuevo componente o una variable adicional no requiere
ADR salvo que cambie una frontera arquitectónica.

## Nombre

```text
NNNN-titulo-corto.md
```

Ejemplo: `0001-postgresql-como-autoridad-de-plataforma.md`.

## Plantilla

```markdown
# NNNN. Título

- Estado: propuesto | aceptado | reemplazado | rechazado
- Fecha: AAAA-MM-DD
- Responsables:

## Contexto

## Decisión

## Alternativas consideradas

## Consecuencias

## Plan de adopción y rollback

## Evidencia de validación
```

Los documentos fundacionales ya existentes pueden citarse desde un ADR, pero
no deben reescribirse como si la decisión ya estuviera desplegada.

