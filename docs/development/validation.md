# Validación de cambios

Ejecuta solo las comprobaciones aplicables, pero nunca omitas una comprobación
por no conocer el comando.

## Matriz mínima

| Cambio | Comprobaciones mínimas |
| --- | --- |
| Solo documentación | enlaces locales, `git diff --check` |
| Landing Astro | `pnpm build` y revisión visual |
| Componente interactivo de landing | build, escritorio, móvil y navegación con teclado |
| Worker o rol | `npm test -- --run`, `npm run typecheck` |
| Bridge Node | pruebas, typecheck y `npm run build:node` |
| TUI | `npm run test:tui`; `npm run users:tui:check` solo con acceso autorizado |
| Wrangler, bindings o tipos `Env` | typecheck, `npx wrangler types --check`, deploy en seco |
| D1 | prueba local de migración desde una base vacía y desde el esquema anterior |
| PostgreSQL | aplicar migración en base desechable, smoke test y rollback documentado |
| Docker/VPS | `docker compose config`, build y healthcheck en un entorno controlado |
| Contrato privado | pruebas de firma, payload inválido, replay, duplicado y conflicto |

## Comandos

Landing, desde `D:\meowlab`:

```powershell
pnpm build
```

Manolo, desde `D:\meowlab\apps\manolo-whatsapp-worker`:

```powershell
npm test -- --run
npm run test:tui
npm run typecheck
npm run build:node
npx wrangler types --check
npx wrangler deploy --env production --dry-run
```

El deploy en seco puede requerir una sesión válida de Wrangler, pero no debe
publicar una nueva versión.

## Revisión de seguridad

Antes de entregar:

```powershell
git status --short
git diff --check
git diff -- . ':!pnpm-lock.yaml' ':!apps/manolo-whatsapp-worker/package-lock.json'
```

Revisa también archivos no rastreados. `git diff` no muestra su contenido por
defecto. Confirma que no se agregaron `.env`, `.dev.vars`, claves privadas,
tokens, volcados de base, PDFs de clientes ni conversaciones reales.

## Pruebas de comportamiento crítico

Todo cambio del flujo conversacional debe cubrir, según corresponda:

- evento duplicado de Meta;
- mensaje de estado sin contenido;
- error del proveedor externo;
- interacción repetida;
- aislamiento entre tenants y contactos;
- expiración o reanudación de sesión;
- confirmación y cancelación;
- respuesta multimodal que conserve el rol;
- caída del VPS y activación correcta del fallback permitido;
- log sin datos sensibles.

## Despliegue no implícito

Que las pruebas pasen no autoriza un despliegue. La entrega debe indicar por
separado qué se probó localmente y qué versión, si alguna, se publicó.

