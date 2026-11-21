# 0019. Alta de empresa sin RUC obligatorio

- Estado: aceptado (2026-11-21)
- Responsable: MeowLab
- Relacionado: ADR-0010 (empresas e invitaciones en el portal), ADR-0008 (modelo ERP)

## Contexto

La pantalla de bienvenida del portal (`app.meowlab.tech`) exigía ingresar un RUC y
validarlo en SUNAT para crear una empresa. Sin embargo, solo **Invoice Cat**
necesita RUC y credenciales SOL para emitir comprobantes electrónicos. Sales Cat,
Stock Cat, Collections Cat, Reorder Cat, Support Cat y Tender Cat pueden operar con
negocios informales o con emprendedores que prefieren no ingresar su RUC al inicio.

## Decisión

1. **Empresa sin RUC en el alta.** Una cuenta puede crear una empresa indicando solo
   su nombre comercial (`name`, obligatorio, 1–160 caracteres) y, opcionalmente,
   su rubro (`sector`) y ciudad (`city`). En `whatsapp.tenants`, `ruc`, `legal_name`
   y `address` quedan en `NULL`.
2. **Invoice Cat exige RUC.** Si la empresa no tiene RUC:
   - no puede activar ni usar Invoice Cat para emitir o consultar comprobantes;
   - en las tarjetas de Invoice Cat (Tus agentes / resumen) se muestra
     «Para emitir comprobantes, agrega el RUC de tu empresa» con un acceso directo
     para registrarlo.
3. **Agregar el RUC después (`set_ruc`).** Solo la cuenta titular (`owner`) de la
   empresa puede asociar un RUC más adelante:
   - el bridge valida el dígito verificador del RUC, consulta el padrón de SUNAT y
     exige estado `ACTIVO`;
   - verifica que el RUC no pertenezca a otra empresa (`whatsapp_tenants_ruc_unique`).
     Si ya existe, rechaza sin revelar quién la administra (`taken`);
   - actualiza `ruc`, `legal_name` y `address` con los datos oficiales de SUNAT,
     conservando el nombre comercial (`name`) que ya tenía la empresa;
   - a partir de ese momento, la empresa puede continuar con el registro de su clave
     SOL para activar Invoice Cat.
4. **Unicidad sin RUC.** Sin RUC no existe un identificador fiscal único para detectar
   duplicados entre cuentas o dentro de una misma cuenta. Se mantiene el límite de
   **3 empresas propias por cuenta** (`MAX_OWNED_COMPANIES`, serializado por
   `pg_advisory_xact_lock`) como barrera conservadora contra altas repetidas o spam.

## Consecuencias

- Mejora la conversión en la bienvenida del portal: negocios sin RUC o que aún no
  desean ingresarlo pueden empezar de inmediato con los demás gatos.
- La creación sin RUC no consume cuota del proveedor de consultas SUNAT.
- Se agregan columnas opcionales `sector` y `city` en `whatsapp.tenants` mediante la
  migración `023-company-without-ruc.sql`.

## Preguntas abiertas

- ¿El `sector` y `city` capturados en el alta sin RUC deben precargarse como perfil
  inicial de **Tender Cat** o **Sales Cat** en una fase siguiente? (Por ahora se
  guardan en `whatsapp.tenants` sin alterar el flujo de Tender Cat).
- ¿Conviene permitir editar `name`, `sector` y `city` desde Configuración más
  adelante? (Fuera del alcance actual; el endpoint solo cubre alta y `set_ruc`).
