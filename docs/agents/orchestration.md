# Orquestación de agentes

`AGENTS.md` define qué debe leer y respetar cada agente. Herdr u otra herramienta
solo coordina terminales; no cambia la propiedad de los archivos ni las reglas
arquitectónicas.

## División recomendada

Para una entrega grande, separa por límites estables:

| Flujo | Propiedad exclusiva sugerida |
| --- | --- |
| Auditoría | lectura del repositorio, contratos y riesgos; sin editar |
| Landing | `src/`, `public/` y documentación de landing |
| Worker | `src/index.ts`, roles y adaptadores Cloudflare |
| VPS | `src/node/`, `infra/vps/`, `infra/postgres/` |
| Datos | migraciones y verificación de paridad |
| Pruebas | `test/`, fixtures y matriz de regresión |
| Documentación | `docs/`, README y ADR; integra después de estabilizar contratos |

No asignes dos agentes a editar el mismo archivo. En especial,
`src/index.ts`, `wrangler.jsonc`, los lockfiles y `AGENTS.md` necesitan un único
propietario durante cada iteración.

## Secuencia

1. **Scout:** determina estado Git, límites y contratos afectados.
2. **Diseño:** define fuente de verdad, compatibilidad e idempotencia.
3. **Implementación:** cada agente trabaja en su zona acordada.
4. **Integración:** un solo agente resuelve cambios cruzados y actualiza la
   composición.
5. **Verificación:** ejecuta pruebas desde un worktree coherente, no desde
   fragmentos aislados.
6. **Operación:** despliegue y migraciones solo después del gate y con
   autorización separada.

## Contrato de handoff

Cada agente debe devolver:

```text
Objetivo:
Archivos modificados:
Decisiones tomadas:
Contratos o migraciones afectadas:
Pruebas ejecutadas y resultado:
Riesgos o pendientes:
¿Se desplegó?: no/sí + versión
```

Una respuesta “terminado” sin pruebas ni archivos no es un handoff válido.

## Trabajo paralelo seguro

Puede paralelizarse:

- revisión visual de la landing y pruebas del Worker;
- implementación de un adaptador y pruebas de un rol, si sus contratos ya están
  congelados;
- documentación de estado y auditoría de secretos;
- build Cloudflare y build Node.

Debe serializarse:

- cambios a un contrato compartido y sus consumidores;
- numeración de migraciones;
- modificación de `src/index.ts` o `wrangler.jsonc`;
- corte de una fuente de verdad;
- despliegues y rollback;
- actualización final de documentación tras integrar varias ramas.

## Reglas para Herdr

- Un pane corresponde a un objetivo concreto y una zona de archivos.
- El pane de verificación no modifica implementación mientras prueba.
- Antes de cerrar un pane, captura su handoff y confirma que no haya procesos
  activos necesarios.
- Los comandos exactos dependen de la versión instalada de Herdr y se consultan
  en su ayuda en vivo; no se fijan aquí como contrato del repositorio.
- Ningún pane puede desplegar, borrar datos, rotar secretos o hacer commit solo
  por haber sido creado por el orquestador.

