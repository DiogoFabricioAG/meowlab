# Tender Cat en producción

El fundador autorizó el despliegue el 19 de noviembre de 2026. El portal y el bridge proceden del commit publicado `3ed0fef5ab64` de MeowLab. La API y la web de RADAR proceden de `394b1fa1550a` de radar-compras-publicas. La cuenta del piloto quedó vinculada tras cruzar la titularidad del portal y la instalación de sincronización.

La ruta `/agentes/licitaciones` sirve la lista y las fichas. El recurso público del portal es `index-23ON8BB_.js` y el de RADAR es `index-C4nR0UVt.js`. Ambos devolvieron HTTP 200 con los cambios de esta entrega. Los dos endpoints de salud devolvieron 200 y las consultas privadas sin sesión devolvieron 401. Una consulta de solo lectura confirmó que existen destacadas guardadas esta semana. Queda pendiente el recorrido de un participante con su sesión.

El procedimiento de reversión del VPS está en `/opt/manolo-platform/releases/tender-3ed0fef5ab64/rollback.sh`. Restaura el portal `4b35a5e1608f`, el bridge `support-cat-20261115T201344Z` y las imágenes y la configuración anteriores de RADAR.

## Títulos breves en el portal

El mismo día se actualizó el portal y el bridge a `1fde2b38cfa7`. Tender Cat usa el proveedor de IA del bridge y la descripción pública para identificar el objeto de cada destacada. La ficha permite desplegar la descripción de origen. La generación agrupa las destacadas, reutiliza resultados en memoria y recurre a un extracto ante indisponibilidad. La verificación incluyó cinco convocatorias reales, el despliegue de la descripción en móvil y escritorio con datos de prueba, la salud de ambos servicios y el recurso público `index-BjJ5N3ST.js`. El procedimiento `/opt/manolo-platform/releases/tender-titles-1fde2b38cfa7/rollback.sh` restaura la primera versión de las vistas.
