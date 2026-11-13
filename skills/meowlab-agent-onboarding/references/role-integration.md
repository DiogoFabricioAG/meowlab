# Incorporar un rol conversacional

Leer primero los tipos vivos de `src/roles/contracts.ts`, el registro y la parte
de composición correspondiente. Si no se dispone de MeowLab, usar este contrato
como objetivo del handoff, no afirmar que se ha modificado ese repositorio.

## Cambios mínimos de un alta

1. Elegir `roleKey` estable y no ocupado. Declarar propósito, acciones permitidas
   y lo que el agente no sabe hacer. La clave y el prompt no conceden permisos.
2. Añadir `src/roles/<clave>-role.ts`, con `RoleHandler`. El handler depende de
   contratos, no de HTTP del proveedor o credenciales.
3. Si necesita un servicio, definir su interfaz bajo un dominio propio y crear
   el adaptador bajo `src/adapters/<servicio>/`. Añadir la capacidad tipada al
   contexto y componerla desde `src/index.ts`. No hacer que el rol fabrique sus
   credenciales ni reutilice un cliente de otro tenant.
4. Instanciar el handler una vez en `src/roles/registry.ts`; no crear segundo
   router paralelo. Una clave duplicada falla y una desconocida usa el fallback.
5. Añadir una migración **nueva** al catálogo PostgreSQL para que sea asignable
   en la TUI. Acordar el siguiente número libre con el mantenedor/otros agentes.
   No escribir en contactos existentes ni cambiar el rol por defecto del tenant
   como parte del alta. No duplicar el menú de la TUI con una lista hardcodeada.
6. Separar el registro local, migración remota, publicación del Worker/bridge y
   asignación explícita al contacto de prueba. El usuario autoriza cada operación
   externa necesaria, no todas por haber solicitado escribir el handler.

Un rol sin integración externa puede limitarse a personalidad/respuesta y no
necesita un nuevo endpoint, secreto o servicio del VPS.

## Ejemplo mínimo de forma (no es un agente funcional del servicio)

```ts
import type { RoleHandler, RoleHandlerContext, TenantContext } from "./contracts";

export class ServiceRoleHandler implements RoleHandler {
  readonly key = "service-example"; // Sustituir tras comprobar el registro.
  configure(tenant: TenantContext): TenantContext {
    return { ...tenant, roleKey: this.key,
      systemPrompt: "Orienta sobre el servicio. No afirmes ejecutar operaciones sin una herramienta disponible." };
  }
  async handle(context: RoleHandlerContext): Promise<void> {
    if (context.persisted.duplicate) return;
    const reply = await context.generateAiReply();
    await context.reply(reply || "No pude responder ahora. Vuelve a intentarlo.");
  }
}
```

Para operaciones reales, sustituir orientación genérica por una capacidad tipada
y autorizada, validar sus resultados y mostrar errores seguros. No registrar el
ejemplo como si ya estuviera conectado al backend.

## Estado y confirmación

Determinar qué datos forman un checkpoint, su TTL y el momento de guardado.
Preservar campos no modificados, aislar por tenant/contacto/rol y manejar CAS.
Al cambiar de empresa/rol, no heredar automáticamente borradores, permisos o
historial de otro dominio. No usar `context.env` para eludir la inyección.

Para acciones con efectos, distinguir preparación, confirmación y ejecución.
Validar autorización en el servidor al ejecutar, no sólo en el prompt. Una
respuesta incierta no permite un reintento automático; describir reconciliación
y clave idempotente. No invalidar la confirmación fiscal de FacturaYa al añadir
un rol nuevo ni permitir emisión por texto.

## Pruebas y evidencia

Cubrir identidad del rol en `configure`, registro y catálogo coherentes,
duplicados, respuestas del proveedor, ausencia de credenciales, aislamiento
entre dos tenants/contactos, expiración/reanudación y botones repetidos/antiguos.
Si hay estado, probar cambios concurrentes; si hay media, conservar el rol y
contexto sin exponer archivos. Comprobar que cambiar desde FacturaYa no pasa
historial fiscal a un dominio que no lo necesita.

En `apps/manolo-whatsapp-worker`:

```sh
npm test -- --run
npm run typecheck
```

Si toca bridge: también `npm run build:node`. Si toca TUI: `npm run test:tui`.
Si toca bindings: regenerar tipos y hacer dry-run según la guía de despliegue
vigente. Probar migraciones localmente en una base desechable; no aplicar todas
las migraciones pendientes de producción para registrar un único rol.

Antes de publicar, verificar versión activa y releases aisladas. No desplegar
todo un árbol sucio sólo para dar de alta este agente. Al finalizar, informar
qué código se probó, qué catálogo se modificó y qué se activó realmente.
