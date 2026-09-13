# Manifiesto de respaldos D1 - 2026-08-24

Los archivos se encuentran bajo `backups/d1/2026-08-24/` y están excluidos del control de versiones porque contienen datos de producción.

| Base | Bytes | SHA-256 | Integridad |
|---|---:|---|---|
| whatsapp-webhook-meta-db | 266653 | `2db326937ea444bc3e5adb8778f254dda03d69c99533dc373f4f95588c2a98bf` | ok |
| gamarra_db | 97040 | `8b00fb7ba46ff9f6cc0cea081a3f458e970458f2eebf85222a574b9ec2f2dc6b` | ok |

La verificación reconstruyó cada exportación en una base SQLite en memoria, ejecutó `PRAGMA integrity_check` y contó las filas sin imprimir datos personales.

Estos respaldos son el punto de referencia inicial. Antes del corte se debe generar otro juego y aplicar una exportación final con las escrituras pausadas.
