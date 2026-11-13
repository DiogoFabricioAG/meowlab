# Onboarding del rol cat y retiro de los roles de finanzas

Fecha: 12/11/2026 (04:49–05:00 UTC). Autorizado por el operador: «limpia los roles
fantasma y despliega el onboarding».

## Worker de Manolo

- Versión `dd113051-d5d9-49e2-ace3-be29756a5e45` (100 %), desde el commit publicado
  `d3a845d82f28414685004f139cc27451c3c1d8d2` (rama `feat/manolo-onboarding-cat`).
  Reemplaza a `f679d352` (`ba2ad51`); la diferencia de código es sólo
  `src/roles/cat-role.ts` y sus pruebas: el rol por defecto ofrece botones para
  Facturación y GRE, Cotizaciones o Gato Manolo y guarda la elección en
  `contact_role_states`. La activación de roles empresariales sigue siendo del
  administrador.
- Construido desde `git -c core.autocrlf=false archive` del commit. Pruebas en esa
  copia: 586/588. Los 2 fallos son `radar.test.ts` y `radar-routing.test.ts`, que usan
  el reloj real y reciben `deferred` porque RADAR sólo envía alertas en horario diurno
  de Lima (se corrieron a las 23:48 de Lima); el código de RADAR es idéntico al
  desplegado. Tarea `radar-tests-clock-20261112`.
- Verificación: `/health` 200, verificación del webhook con token falso 404 (igual que
  antes), cron `*/15` sin cambios, `wrangler tail` de 40 s sin errores ni excepciones.
- Rollback: `npx wrangler rollback f679d352-88ff-46ab-80e1-edb6dbc61cc5 --name whatsapp-webhook-meta-production`.

## PostgreSQL de la plataforma

Se aplicó `infra/postgres/migrations/007-remove-legacy-finance-roles.sql`, versionada
desde antes y nunca aplicada (hash idéntico al de git y al de `/opt/manolo-platform`):

- `finance`, `finance-cat` y `finance-player-cat` quedan `active = false` y
  `assignable = false` (3 filas): ya no se ofrecen en la TUI.
- El único contacto con `finance-cat` (tenant `manolo`, activo el 11/11) queda sin rol
  asignado: lo atiende el rol por defecto, ahora con el onboarding.
- El tenant `home-finance` tenía `finance` como rol por defecto; pasa a `cat`.

Manolo ya no tenía código para esos roles, así que en la práctica esos usuarios ya
caían en el gato por defecto; la migración alinea el catálogo con el código.
