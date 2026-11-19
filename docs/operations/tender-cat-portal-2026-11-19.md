# Tender Cat en producción

El fundador autorizó el despliegue el 19 de noviembre de 2026. El portal y el bridge proceden del commit publicado `3ed0fef5ab64` de MeowLab. La API y la web de RADAR proceden de `394b1fa1550a` de radar-compras-publicas. La cuenta del piloto quedó vinculada tras cruzar la titularidad del portal y la instalación de sincronización.

La ruta `/agentes/licitaciones` sirve la lista y las fichas. El recurso público del portal es `index-23ON8BB_.js` y el de RADAR es `index-C4nR0UVt.js`. Ambos devolvieron HTTP 200 con los cambios de esta entrega. Los dos endpoints de salud devolvieron 200 y las consultas privadas sin sesión devolvieron 401. Una consulta de solo lectura confirmó que existen destacadas guardadas esta semana. Queda pendiente el recorrido de un participante con su sesión.

El procedimiento de reversión del VPS está en `/opt/manolo-platform/releases/tender-3ed0fef5ab64/rollback.sh`. Restaura el portal `4b35a5e1608f`, el bridge `support-cat-20261115T201344Z` y las imágenes y la configuración anteriores de RADAR.
