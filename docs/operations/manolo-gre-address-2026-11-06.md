# GRE: direcciones de referencia e imágenes adjuntas — entrega 2026-11-06

## Estado

**Publicado** en el Worker `c1f9bc9e-35d2-4a77-be9d-a1059cd83cbc` al 100% (base
`c2070081`, que añadió el PDF). Fuentes en el commit `36b78` de
`origin/feat/gre-pdf-formato` (cabeza publicada `76678d4`). Sin migraciones,
secretos, cambios de cron, bindings ni bridge.

## Problema observado (prueba real del operador, 16:09–16:13)

1. Para el punto de llegada «ALMACEN DEL PROVEEDOR - ARMA - CASTROVIRREYNA -
   HUANCAVELICA», Manolo pidió tres veces «calle, número o lote», incluso tras
   «Solo coloca esa, no hay problema». Causa: el prompt ordenaba que un nombre de
   almacén no es una dirección y cada aclaración del modelo bloqueaba la guía.
2. Con la foto de otra GRE aprobada («no problema si solo colocas eso»), Manolo
   pidió el punto de partida y aclaraciones de productos de esa otra guía. Causa:
   el bloque de información visual indica usar productos y cantidades (pensado para
   facturas) y el intérprete GRE no distinguía texto del usuario e imagen.
3. El PDF no se generó porque la guía nunca llegó al resumen (consecuencia de 1 y 2).
   Los logs en vivo no registraron fallos de proveedor, interpretación ni PDF.

## Cambio

- La dirección es el texto que indique el usuario; SUNAT no exige calle ni número.
  Solo se pregunta si no hay ningún texto, y una aclaración del modelo ya no bloquea
  una dirección con texto.
- La imagen se envía al modelo separada del mensaje del usuario, como referencia, y
  solo puede cambiar campos pendientes o nombrados en el texto del usuario. Nunca
  sustituye por sí sola los productos de la factura ni el punto de partida.
- El PDF no repite distrito, provincia y departamento cuando la dirección ya los nombra.

## Verificación

- Repo: 552 pruebas / 46 archivos; typecheck OK. Pruebas nuevas reproducen la
  conversación real (dirección de referencia e imagen de otra GRE).
- Release por injerto (`tools/prepare-gre-address-release.mjs`, excepción registrada
  en `AGENTS.md`): 455 pruebas sobre el runtime injertado; dry-run con 21 bindings
  idénticos; 5.405,17 KiB (gzip 1.034,53 KiB); 13 fuentes idénticas al commit.
- `verify-gre-address-worker.mjs after`: bindings, compatibilidad y cron preservados,
  `/health` 200, bridge sin cambios, código activo idéntico al dry-run
  (`sha256:3085805f…`).

## Pendiente

- Repetir la prueba por WhatsApp hasta el resumen con PDF.
- Las sesiones abiertas conservan su estado: una aclaración guardada por la versión
  anterior se resuelve cuando el usuario responde (por ejemplo, «solo coloca esa»).
- Cada injerto suma ~450 KB al bundle; reconciliar `src/` con producción.

## Rollback

```sh
npx wrangler rollback c2070081-e27d-4d2b-a613-d2941c9aaa61 --name whatsapp-webhook-meta-production
```
