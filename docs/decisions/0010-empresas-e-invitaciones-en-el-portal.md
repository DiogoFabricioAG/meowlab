# 0010. Empresas e invitaciones en el portal

- Estado: aceptado (2026-11-13)
- Responsable: MeowLab
- Relacionado: ADR-0006 (portal), ADR-0007 (cobros), ADR-0008 (modelo ERP, fase 1)

## Contexto

Hoy una persona crea su cuenta en app.meowlab.tech, vincula su WhatsApp y, si nadie la
agregó a mano desde la TUI, queda en «Sin empresa» sin saber qué hacer (caso del número
…5481). Las membresías dependen del número de WhatsApp (`whatsapp.tenant_members`) y sólo
el operador las administra. Las empresas viven en `whatsapp.tenants` (estado `active` o
`paused`, RUC opcional y único).

## Decisión

1. **Paso «Tu empresa» después de crear la cuenta**, con tres opciones: crear mi empresa,
   unirme con una invitación, o hacerlo después (queda como recordatorio en el panel).
2. **Crear mi empresa.** La persona escribe el RUC; se muestran razón social y dirección
   según SUNAT para confirmar. Queda creada con esa cuenta como **dueña**. Si el RUC ya
   existe en MeowLab no se crea otra ni se revela a quién pertenece: se indica que pida
   una invitación al dueño.
3. **Verificación sólo para Invoice Cat** (decisión del operador). Crear la empresa y usar
   los demás agentes no exige pruebas. Activar Invoice Cat (emitir y ver datos fiscales)
   exige las credenciales SOL de la empresa: usuario secundario y certificado, que
   prueban el control del RUC. Hasta entonces la empresa no puede emitir ni ver
   comprobantes.
4. **Unirse sólo por invitación del dueño** (decisión del operador). Sin buscador de
   empresas ni solicitudes por RUC. El dueño genera desde el portal un **enlace seguro**
   para enviarlo por WhatsApp al empleado:
   - `https://app.meowlab.tech/invitacion/<código>`: código aleatorio de 128 bits; se
     guarda sólo su hash;
   - de un solo uso, vence a los 7 días y el dueño puede revocarlo;
   - al abrirlo, la persona inicia sesión o crea su cuenta y acepta; queda como
     **miembro**;
   - opcionalmente atado al número de WhatsApp del empleado: entonces sólo una cuenta con
     ese número vinculado puede aceptarlo.
5. **Membresías por cuenta del portal.** El dueño ve su equipo, invita, quita miembros y
   transfiere la propiedad. Al aceptar, si la cuenta tiene WhatsApp vinculado, el número
   se agrega también como miembro de la empresa para los agentes (hoy
   `tenant_members`), con los permisos que el dueño elija para Invoice Cat.
6. **Dónde vive.** En PostgreSQL de la plataforma, que es la autoridad de empresas y
   permisos, a través del bridge con el secreto del portal. Es el primer paso de la fase
   1 del ADR-0008 (personas, membresías, empresas); las tablas nuevas se diseñan para
   moverse luego al esquema `core`.

## Consecuencias

- El operador deja de dar membresías a mano para los casos normales; la TUI queda para
  soporte.
- La suscripción (ADR-0007) puede pasar de la cuenta del portal a la empresa: el dueño
  paga por su equipo.
- Las empresas creadas desde el portal empiezan sin integración FacturaYa; la
  activación de Invoice Cat crea esa integración cuando se verifican las credenciales SOL.

## Fases

1. Crear empresa con RUC (consulta SUNAT), dueño, y paso «Tu empresa».
2. Invitaciones con enlace seguro, aceptación y panel de equipo del dueño.
3. Activación de Invoice Cat con credenciales SOL y alta en FacturaYa.
