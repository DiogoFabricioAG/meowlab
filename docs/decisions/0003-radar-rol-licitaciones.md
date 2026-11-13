# 0003. RADAR como rol de licitaciones de Manolo

- Estado: aceptado e implementado.
- Fecha: 2026-10-31.
- Responsable: fundador de MeowLab.

## Contexto

El fundador solicita gestionar RADAR desde la misma TUI de contactos y roles.
El diseño inicial sólo proporcionaba notificaciones: un contacto podía vincular
el escritorio y continuar recibiendo respuestas de su rol fiscal. La vinculación
no equivalía a seleccionar un asistente de licitaciones.

## Decisión

Registrar `radar` en `RoleRegistry` y `whatsapp.role_catalog`, con etiqueta
«RADAR · Licitaciones». Se asigna por la TUI existente y se resuelve por el mismo
camino VPS → D1 → rol base que los otros handlers. No se asigna automáticamente
al vincular un escritorio y no se modifica ningún contacto en esta entrega.

El handler ofrece orientación sobre requisitos y fuentes, `RADAR AYUDA` y
`RADAR ESTADO`. Su adaptador obtiene el estado real por tenant, canal y contacto;
no recibe un teléfono propuesto por IA ni devuelve tokens. No usa historial
fiscal, credenciales FacturaYa ni sus operaciones. Las búsquedas y el análisis
con evidencia continúan en el escritorio: el rol no tiene acceso a SQLite local
ni implementa un nuevo buscador OECE remoto.

El webhook único, la API para las instalaciones existentes y la autorización de
alertas se conservan como transporte de RADAR, no como un bot o callback nuevo.
Los comandos de consentimiento se procesan antes de las ráfagas/roles y toleran
saltos de línea/espacios de WhatsApp. Un control inválido no puede caer en una
operación fiscal. La asignación del rol no concede permiso para notificar.

Esta decisión sustituye la exclusión de RADAR del catálogo de roles en ADR-0001;
conserva su aislamiento de datos, consentimiento y ventana auténtica de 24 horas.

## Adopción y rollback

Migración PostgreSQL `008-radar-role.sql`, idempotente y sin escrituras en
contactos. Reiniciar la TUI para refrescar opciones. Asignación a cargo del
administrador; ningún número se requiere para crear o publicar el rol.

La entrega Worker usa una copia del despliegue activo y un parche reversible
limitado a registro, adaptador de estado y controles RADAR. No publica el resto
del árbol local ni cambia bindings, ráfagas, secretos o proveedores.
Véase [operación](../operations/radar-role-2026-10-31.md).

Para retirar la opción, marcar `assignable=false` en el catálogo sin borrar
contactos ni instalaciones. Antes de retirar el handler, reasignar explícitamente
los contactos que lo usen; el administrador decide el rol de destino.
