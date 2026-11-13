# RADAR: frecuencia de alertas y fuente de resúmenes

Publicado el 2026-11-01: `10a50d2f-48c1-4718-9574-ca307b90d904`.
Base real: `45b386f5-2a61-43c5-9c00-f44264bf9548`. Snapshot privado antes y
después en `apps/manolo-whatsapp-worker/backups/radar-pacing-20261101/`.
Generador reproducible `tools/prepare-radar-pacing-release.mjs`: dos reemplazos
reversibles de composición; no despliega el árbol sucio completo.

Política: una reserva de alerta cada 30 minutos por número de negocio/usuario,
en [08:00,20:00) Lima. La misma sentencia INSERT comprueba consentimiento,
ventana y ausencia de otra reserva reciente. Historial existente como autoridad,
sin migración. Un envío incierto consume el turno; un replay no lo renueva.
La aplicación conserva los diferidos, vuelve a validar elegibilidad y no hace
catch-up de horas perdidas. Selección/sincronización y respuestas humanas siguen
independientes. Fuente SEACE factual al final del resumen, dentro de 1024 chars.

Validación: 268 pruebas/32 archivos, typecheck; paquete aislado 58/5 y dry-run;
salud 200, rutas sin autorización 401 y mismos bindings antes/después. No hubo
mensajes de prueba reales. Desktop: 60 pruebas, typecheck, build en copia aislada.
No se publicaron instaladores ni se tocó WebView.

Rollback: `npx wrangler@4.156.0 rollback 45b386f5-2a61-43c5-9c00-f44264bf9548`
desde el paquete aislado; no hay cambios de esquema que revertir. Ese rollback
elimina el espaciamiento central, por lo que exige una decisión operativa explícita.
