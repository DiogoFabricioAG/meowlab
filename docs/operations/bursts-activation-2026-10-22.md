# Agrupación de WhatsApp — operación 2026-10-22

Autorización explícita: publicar cambios en GitHub, replicar vía `ssh meowlab`
y desplegar/activar en Cloudflare tras completar la recuperación administrativa.

## Entrega aislada

Paquete: `apps/manolo-whatsapp-worker/releases/bursts-20261022`.
La release contiene su fuente JS revisada, configuración, fixtures D1 y pruebas.
No depende de los cambios sin commit del árbol principal de Manolo.

Se descargó una copia privada de la fuente/configuración realmente desplegadas.
Base activa: `02e3ea4b-da57-47ba-b73d-4ecb4fe8f849`, fuente SHA-256
`60529391edd28a05bf056a39e970b6e0333feea2baddb1eb9604012bc5227efa`.
Se sustituyó sólo el ingreso/runtime de lotes, límite de prompt y despacho
administrativo; el resto de handlers, RADAR y configuración de proveedores se
conservan. Huellas en `release-manifest.json`. No se leen valores de secretos
Cloudflare ni se copian credenciales o conversaciones al repositorio.

Validación: suite local completa 210 pruebas, typecheck y build Node; paquete
aislado 36 pruebas (RADAR, agrupación y administración) y dry-run Wrangler
4.151.3. Sin emisión real o webhook Meta fabricado en producción.

## VPS

El checkout `/opt/meowlab` tiene cambios locales de la landing: no se hace pull,
reset, stash ni reinstalación allí. `/opt/manolo-platform` no es checkout Git.
Se replicará el commit de GitHub en un nuevo directorio
`/opt/manolo-platform/releases/bursts-git-20261022`. No se reconstruye ni reinicia
bridge, FacturaYa, PostgreSQL o landing: esta mejora se ejecuta en Cloudflare.
El checkout sirve como réplica verificable y aloja la CLI administrativa.

## Recuperación

Desde el checkout de réplica:

```sh
docker exec -i manolo-platform-bridge-1 node --input-type=module - \
  --tenant TENANT --contact ID --action inspect \
  < apps/manolo-whatsapp-worker/infra/vps/burst-admin.mjs
```

Comprobar el estado real en FacturaYa antes de liberar. Repetir con
`--action release --expected HUELLA --review-ref TICKET --verified-facturaya`.
La huella invalida revisiones obsoletas; rechaza cola activa y emisión pendiente,
preserva datos y elimina confirmaciones antiguas. No repetir una emisión como
procedimiento de diagnóstico ni forzar un resultado fiscal desconocido.

## Estado de ejecución

Preparación y pruebas completas; publicación GitHub, réplica y activación en
curso. La evidencia final se añadirá después de verificar cada operación.

## Rollback

No borrar la clase DO ni volver al ingreso inmediato con entradas pendientes.
Acordar mantenimiento, drenar y reconciliar primero. Conservar D1 y los datos
nuevos; no restaurar un respaldo global como rollback. Los servicios de VPS no
cambian en esta operación.
