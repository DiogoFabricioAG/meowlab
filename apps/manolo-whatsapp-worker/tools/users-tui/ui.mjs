const ANSI_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export function createPalette(enabled = true) {
  const wrap = (code) => (value) => enabled
    ? `\u001B[${code}m${value}\u001B[0m`
    : String(value);
  return {
    cyan: wrap("36"),
    dim: wrap("2"),
    green: wrap("32"),
    magenta: wrap("35"),
    red: wrap("31"),
    white: wrap("97"),
    yellow: wrap("33"),
  };
}

export function visibleLength(value) {
  return String(value).replace(ANSI_PATTERN, "").length;
}

export function truncate(value, width) {
  const text = String(value ?? "");
  if (text.length <= width) return text;
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}

function pad(value, width) {
  const text = truncate(value, width);
  return `${text}${" ".repeat(Math.max(0, width - visibleLength(text)))}`;
}

export function maskWhatsAppId(value) {
  const text = String(value ?? "");
  if (text.length <= 6) return text;
  return `•••• ${text.slice(-6)}`;
}

export function formatRelativeTime(value, now = Date.now()) {
  if (!value) return "sin actividad";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "fecha inválida";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return "ahora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return new Date(timestamp).toLocaleDateString("es-PE");
}

function border(width, left, fill, right) {
  return `${left}${fill.repeat(width - 2)}${right}`;
}

function framedLine(content, width) {
  const available = width - 4;
  return `│ ${pad(content, available)} │`;
}

function tableRow(values, widths) {
  return `│ ${values.map((value, index) => pad(value, widths[index])).join(" │ ")} │`;
}

function tableSeparator(widths, left, middle, right) {
  return `${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`;
}

export function renderDashboard(
  contacts,
  {
    filter = "",
    status = null,
    terminalWidth = 110,
    useColor = true,
  } = {},
) {
  const palette = createPalette(useColor);
  const width = Math.max(78, Math.min(118, terminalWidth - 1));
  const customRoles = contacts.filter((contact) => contact.roleSource === "contact").length;
  const activeToday = contacts.filter((contact) => {
    const timestamp = Date.parse(contact.lastSeenAt ?? "");
    return Number.isFinite(timestamp) && Date.now() - timestamp <= 86_400_000;
  }).length;
  const tenants = new Set(contacts.map((contact) => contact.tenantId)).size;
  const compact = width < 100;
  const widths = compact
    ? [2, 12, 10, 14, 9, 12]
    : [3, 20, 14, 22, 16, 15];

  const lines = [
    palette.cyan(border(width, "╭", "─", "╮")),
    palette.cyan(framedLine("MANOLO · CONTROL DE USUARIOS", width)),
    palette.cyan(framedLine("VPS PostgreSQL · conexión privada por SSH", width)),
    palette.cyan(border(width, "╰", "─", "╯")),
    "",
    `${palette.white(`Contactos ${contacts.length}`)}   ${palette.magenta(`Rol propio ${customRoles}`)}   ${palette.green(`Activos hoy ${activeToday}`)}   ${palette.dim(`Empresas ${tenants}`)}`,
  ];

  if (filter) lines.push(palette.yellow(`Filtro activo: “${filter}”`));
  if (status) {
    const formatter = status.kind === "error" ? palette.red : palette.green;
    lines.push(formatter(`${status.kind === "error" ? "!" : "✓"} ${status.message}`));
  }
  lines.push("");

  if (contacts.length === 0) {
    lines.push(palette.dim("No hay contactos que coincidan con la vista actual."));
    return lines.join("\n");
  }

  lines.push(tableSeparator(widths, "┌", "┬", "┐"));
  lines.push(tableRow(["N°", "Nombre", "WhatsApp", "Rol efectivo", "Empresa", "Actividad"], widths));
  lines.push(tableSeparator(widths, "├", "┼", "┤"));
  contacts.forEach((contact, index) => {
    const name = contact.displayName || "Sin nombre";
    const roleSuffix = contact.roleSource === "contact" ? "" : " (base)";
    lines.push(tableRow([
      String(index + 1),
      name,
      maskWhatsAppId(contact.whatsappUserId),
      `${contact.effectiveRoleLabel || contact.effectiveRoleKey}${roleSuffix}`,
      contact.tenantName,
      formatRelativeTime(contact.lastSeenAt),
    ], widths));
  });
  lines.push(tableSeparator(widths, "└", "┴", "┘"));
  return lines.join("\n");
}

export function renderContactDetails(contact, useColor = true) {
  const palette = createPalette(useColor);
  return [
    palette.cyan("Contacto seleccionado"),
    `  Nombre:   ${contact.displayName || "Sin nombre"}`,
    `  WhatsApp: ${contact.whatsappUserId}`,
    `  Empresa:  ${contact.tenantName} (${contact.tenantId})`,
    `  Rol:      ${contact.effectiveRoleLabel || contact.effectiveRoleKey}`,
    `  Origen:   ${contact.roleSource === "contact" ? "asignado al contacto" : "heredado de la empresa"}`,
    `  FacturaYa:${contact.activeFacturayaTenantName ? ` ${contact.activeFacturayaTenantName} (${contact.activeFacturayaTenantId})` : " sin empresa activa"}`,
    `  Expira:   ${contact.activeFacturayaExpiresAt ? new Date(contact.activeFacturayaExpiresAt).toLocaleString("es-PE") : "—"}`,
    `  Actividad:${contact.lastSeenAt ? ` ${new Date(contact.lastSeenAt).toLocaleString("es-PE")}` : " sin registro"}`,
  ].join("\n");
}
