import type { RoleHandler, RoleHandlerContext, TenantContext } from "./contracts";
import { radarDialogue } from "./radar-dialogue";

export const RADAR_ROLE_KEY = "radar";
export const RADAR_SYSTEM_PROMPT = [
  "Eres RADAR, el asistente de licitaciones y contratación pública peruana de Manolo.",
  "Responde en español con claridad y brevedad, sin personalidad fiscal ni operaciones de FacturaYa.",
  "Ayuda a revisar resúmenes y guardar o descartar oportunidades. No inventes convocatorias, fechas, montos, precios ni antecedentes.",
  "Puedes recibir el contexto del último aviso enviado y el historial exclusivo de RADAR. No tienes acceso al SQLite del escritorio, al perfil del negocio ni a un buscador OECE desde WhatsApp.",
  "El escritorio busca automáticamente desde la conexión del usuario. Las oportunidades elegidas se sincronizan con Guardadas. La lectura completa de bases, cotización y documentos se realiza en la aplicación.",
  "Guardar o descartar requiere confirmación real de la herramienta. Preguntar si una oportunidad es interesante no autoriza guardarla. No anuncies una selección sin ejecutar la herramienta y recibir éxito. La selección puede quedar pendiente de sincronizar con una laptop apagada.",
  "Distingue orientación general de evidencia real. No prometas rentabilidad, adjudicación ni validez legal.",
  "La vinculación se inicia en Ajustes → WhatsApp del escritorio y se confirma enviando el mensaje preparado a Manolo.",
  "Sólo hay alertas durante las 24 horas posteriores al último mensaje del usuario, con RADAR abierto y conectado.",
  "RADAR ESTADO consulta el vínculo; RADAR BAJA revoca alertas, pero no cambia el rol asignado.",
  "No solicites credenciales Meta ni claves OpenAI por WhatsApp. No afirmes que cambiaste un rol o una configuración.",
].join(" ");

export class RadarRoleHandler implements RoleHandler {
  readonly key = RADAR_ROLE_KEY;

  configure(tenant: TenantContext): TenantContext {
    return { ...tenant, roleKey: RADAR_ROLE_KEY, systemPrompt: RADAR_SYSTEM_PROMPT,
      temperature: 0.3, maxTokens: Math.min(900, Math.max(400, tenant.maxTokens)) };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    if (context.persisted?.duplicate) return;
    const command = context.message.text.trim().toUpperCase();
    if (command === "RADAR ESTADO") {
      try {
        const status = await context.radar?.status();
        const text = !status?.available
          ? "No pude consultar las alertas en este canal. Abre Ajustes → WhatsApp en RADAR y comprueba el estado."
          : !status.linked
            ? "Este celular todavía no está vinculado. Abre RADAR → Ajustes → WhatsApp → Vincular WhatsApp y envía el mensaje preparado a Manolo."
            : status.open
              ? "Tu celular está vinculado a RADAR y la ventana de 24 horas está abierta. Las alertas requieren el escritorio abierto y conectado. Para cancelarlas, escribe RADAR BAJA."
              : "Tu celular está vinculado, pero no pude confirmar una ventana abierta. Comprueba el estado en Ajustes → WhatsApp de RADAR.";
        await context.reply(text);
      } catch {
        context.log("radar_role_status_failed");
        await context.reply("No pude comprobar tu vinculación. Inténtalo otra vez desde Ajustes → WhatsApp de RADAR.");
      }
      return;
    }
    if (command === "RADAR AYUDA" || command === "RADAR") {
      await context.reply("Soy RADAR. Aquí recibes resúmenes y eliges las oportunidades que te interesan. Las elegidas aparecerán en Guardadas cuando tu aplicación se conecte; allí puedes revisar bases, cotizar y preparar documentos. Escribe RADAR ESTADO para consultar tu vinculación o RADAR BAJA para cancelar alertas.");
      return;
    }
    if (/^RADAR\s+(ACTIVAR|BAJA)\b/i.test(command)) {
      // Pairing and revocation must be handled by the verified transport, never AI.
      await context.reply("No pude completar ese comando de vinculación. Abre Ajustes → WhatsApp de RADAR y comprueba el estado; genera un enlace nuevo si el anterior venció.");
      return;
    }
    await radarDialogue(context);
  }
}
