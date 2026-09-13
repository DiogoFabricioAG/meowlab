# Decisiones arquitectónicas

Este directorio almacena ADRs para decisiones estructurales que afectan más de
una aplicación, cambian una fuente de verdad o son costosas de revertir.

## Cuándo crear un ADR

- Introducir o retirar una base de datos, cola, framework o proveedor.
- Cambiar la ubicación del webhook de Meta.
- Mover sesiones o workflows entre Worker y VPS.
- Modificar el modelo de aislamiento multi-tenant.
- Cambiar el esquema de firma, idempotencia o cifrado.
- Unificar o separar despliegues del monorepo.

Una corrección local, un nuevo componente o una variable adicional no requiere
ADR salvo que cambie una frontera arquitectónica.

## Nombre

```text
NNNN-titulo-corto.md
```

Ejemplo: `0001-postgresql-como-autoridad-de-plataforma.md`.

## Plantilla

```markdown
# NNNN. Título

- Estado: propuesto | aceptado | reemplazado | rechazado
- Fecha: AAAA-MM-DD
- Responsables:

## Contexto

## Decisión

## Alternativas consideradas

## Consecuencias

## Plan de adopción y rollback

## Evidencia de validación
```

Los documentos fundacionales ya existentes pueden citarse desde un ADR, pero
no deben reescribirse como si la decisión ya estuviera desplegada.

