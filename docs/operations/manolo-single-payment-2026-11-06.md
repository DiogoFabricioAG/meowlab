# Pago único a crédito — 2026-11-06

## Causa y comportamiento

El checkpoint descartaba cuotas parciales sin importe y repetía el error genérico,
aunque ya hubiera recibido una fecha completa. Ahora conserva el vencimiento de
un pago único y mantiene independiente la fecha de emisión. No infiere años ni
usa fechas o documentos de identidad como evidencia de importes.

Cuando el usuario pide una sola cuota sin importe ni anticipo, prepara un borrador
interno al contado para obtener el total canónico de FacturaYa y luego prepara el
borrador a crédito con ese total y vencimiento. Ninguno emite un comprobante.
Si existe saldo conocido tras anticipo, lo conserva; si falta, pregunta por ese
saldo. Cambiar productos recalcula el importe derivado del total.

El resumen y el botón vigente siguen siendo obligatorios. Un total inconsistente
o un fallo de preparación bloquea Crear y conserva los datos para reintentar.

## Publicación y validación

- Worker activo al 100%: `8c75c490-06b1-4fe2-8cd4-4346f4377d4e`.
- Anterior: `b5f73411-1950-4f8d-a8a2-b38e5f25a4dc`.
- 385 pruebas en 24 archivos del paquete aislado, typecheck y dry-run correctos.
- Runtime descargado idéntico al dry-run; SHA256:
  `14ab9b914a1eda25dd296835dfec1a10e22aef5afffcd1af24c69e30fe2f414c`.
- Configuración, secretos, cron, agrupación y namespace DO conservados.
- Salud pública 200 y bridge fiscal saludable, sin reconstrucción del bridge.
- Fuente aislada replicada por SSH en
  `/opt/manolo-platform/releases/single-payment-20261106`.

Se corrigió exclusivamente el borrador pendiente reportado mediante comparación
de revisión: emisión `2026-11-05`, pago único `2026-12-06`, cliente y productos
conservados. Se invalidó cualquier confirmación anterior. No hubo llamadas
fiscales ni mensajes enviados; el usuario debe pedir Resumen y revisar antes de
confirmar. Checkpoint y respaldos privados permanecen fuera del repositorio.

## Limitación y rollback

El contrato público actual no ofrece cálculo sin persistencia ni eliminación de
borradores: puede quedar un borrador interno adicional de valoración. El tablero
registra acordar una operación específica con FacturaYa.

Para revertir el código, ejecutar en el paquete Worker:
`npx wrangler rollback b5f73411-1950-4f8d-a8a2-b38e5f25a4dc`.
No restaurar checkpoints antiguos sobre operaciones fiscales ya procesadas.
