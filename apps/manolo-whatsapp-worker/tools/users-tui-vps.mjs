import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { ContactAdminRepository } from "./users-tui/contact-admin-repository.mjs";
import { D1RoleMirror } from "./users-tui/d1-role-mirror.mjs";
import { SshPostgresGateway } from "./users-tui/ssh-postgres.mjs";
import { SshBridgeAdminGateway } from "./users-tui/ssh-bridge-admin.mjs";
import {
  createPalette,
  renderContactDetails,
  renderDashboard,
} from "./users-tui/ui.mjs";

const CHECK_MODE = process.argv.includes("--check");
const USE_COLOR = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
const palette = createPalette(USE_COLOR);

async function ask(readline, question) {
  return (await readline.question(`${question}: `)).trim();
}

async function pause(readline) {
  await readline.question(palette.dim("Presiona Enter para continuar..."));
}

async function askSecret(readline, outputState, question) {
  process.stdout.write(`${question}: `);
  outputState.muted = true;
  try {
    return (await readline.question("")).trim();
  } finally {
    outputState.muted = false;
    process.stdout.write("\n");
  }
}

function filterContacts(contacts, filter) {
  const query = filter.trim().toLocaleLowerCase("es");
  if (!query) return contacts;
  return contacts.filter((contact) => [
    contact.displayName,
    contact.whatsappUserId,
    contact.tenantName,
    contact.effectiveRoleLabel,
    contact.effectiveRoleKey,
  ].some((value) => String(value ?? "").toLocaleLowerCase("es").includes(query)));
}

async function chooseContact(readline, contacts, zeroLabel = "cancelar") {
  if (contacts.length === 0) return null;
  const answer = await ask(readline, `Número de contacto (0 para ${zeroLabel})`);
  const index = Number.parseInt(answer, 10);
  return Number.isInteger(index) && index > 0 && index <= contacts.length
    ? contacts[index - 1]
    : null;
}

async function renameContact(readline, repository, contacts) {
  const contact = await chooseContact(readline, contacts);
  if (!contact) return null;
  console.log(renderContactDetails(contact, USE_COLOR));
  const answer = await ask(
    readline,
    "Nuevo nombre (Enter conserva el actual; escribe - para quitarlo)",
  );
  if (!answer) return { kind: "ok", message: "El nombre no cambió." };
  const result = await repository.renameContact(contact, answer === "-" ? null : answer);
  if (!result.updated) throw new Error("El contacto ya no existe en PostgreSQL.");
  return { kind: "ok", message: "Nombre actualizado correctamente." };
}

async function assignRole(readline, repository, roleMirror, contacts, roles) {
  const contact = await chooseContact(readline, contacts);
  if (!contact) return null;
  console.log(renderContactDetails(contact, USE_COLOR));
  console.log();
  console.log(`${palette.yellow("0.")} Heredar el rol base de la empresa`);
  roles.forEach((role, index) => {
    console.log(`${palette.yellow(`${index + 1}.`)} ${role.label} ${palette.dim(`· ${role.description}`)}`);
  });
  const answer = await ask(readline, "Nuevo rol");
  const selected = Number.parseInt(answer, 10);
  if (!Number.isInteger(selected) || selected < 0 || selected > roles.length) {
    return { kind: "error", message: "Selección de rol inválida." };
  }
  const role = selected === 0 ? null : roles[selected - 1].key;
  const result = await repository.setContactRole(contact, role);
  if (!result.updated) throw new Error("No se pudo asignar el rol solicitado.");
  const label = role === null ? "rol base de la empresa" : roles[selected - 1].label;
  try {
    await roleMirror.mirror(contact, role);
  } catch (error) {
    return {
      kind: "error",
      message: `El rol principal cambió a ${label}, pero el fallback D1 quedó pendiente: ${error instanceof Error ? error.message : "error desconocido"}`,
    };
  }
  return {
    kind: "ok",
    message: result.changed ? `Rol cambiado a ${label}.` : `El contacto ya tenía ${label}.`,
  };
}

async function showHistory(readline, repository, contacts) {
  const contact = await chooseContact(readline, contacts);
  if (!contact) return;
  const history = await repository.listRoleHistory(contact);
  console.log();
  console.log(renderContactDetails(contact, USE_COLOR));
  console.log();
  console.log(palette.cyan("Historial de roles"));
  if (history.length === 0) {
    console.log(palette.dim("  Todavía no hay cambios registrados."));
  } else {
    history.forEach((entry) => {
      const previous = entry.previousRoleLabel || entry.previousRoleKey || "rol base";
      const next = entry.newRoleLabel || entry.newRoleKey || "rol base";
      const date = new Date(entry.changedAt).toLocaleString("es-PE");
      console.log(`  ${palette.dim(date)}  ${previous} → ${palette.green(next)}`);
    });
  }
  await pause(readline);
}

async function inspectContact(readline, contacts) {
  const contact = await chooseContact(readline, contacts);
  if (!contact) return;
  console.log();
  console.log(renderContactDetails(contact, USE_COLOR));
  await pause(readline);
}

function printCompanies(companies) {
  if (companies.length === 0) {
    console.log(palette.dim("No hay empresas FacturaYa registradas."));
    return;
  }
  companies.forEach((company, index) => {
    const connection = company.lastConnectionStatus === "ok"
      ? palette.green("conexión OK")
      : company.lastConnectionStatus === "failed"
        ? palette.red("conexión fallida")
        : palette.dim("sin probar");
    console.log(
      `${palette.yellow(`${index + 1}.`)} ${company.legalName || company.name} · RUC ${company.ruc || "sin RUC"} · ${company.memberCount} usuario(s) · ${company.integrationStatus || "sin token"} · ${connection}`,
    );
  });
}

async function chooseCompany(readline, companies) {
  printCompanies(companies);
  const selected = Number.parseInt(await ask(readline, "Empresa (0 para cancelar)"), 10);
  return Number.isInteger(selected) && selected > 0 && selected <= companies.length
    ? companies[selected - 1]
    : null;
}

async function createCompany(readline, repository) {
  const id = await ask(readline, "ID interno (ej. empresa-acme)");
  const name = await ask(readline, "Nombre corto");
  const legalName = await ask(readline, "Razón social");
  const ruc = await ask(readline, "RUC");
  const address = await ask(readline, "Domicilio fiscal (opcional)");
  await repository.createFacturayaCompany({ id, name, legalName, ruc, address });
  return { kind: "ok", message: "Empresa creada. Ahora registra su token y autoriza al menos un teléfono." };
}

async function editCompany(readline, repository, companies) {
  const company = await chooseCompany(readline, companies);
  if (!company) return null;
  const name = await ask(readline, `Nombre corto [${company.name}]`);
  const legalName = await ask(readline, `Razón social [${company.legalName || ""}]`);
  const ruc = await ask(readline, `RUC [${company.ruc || ""}]`);
  const address = await ask(readline, `Domicilio fiscal [${company.address || ""}]`);
  await repository.updateFacturayaCompany(company, {
    name: name || company.name,
    legalName: legalName || company.legalName,
    ruc: ruc || company.ruc,
    address: address || company.address,
  });
  return { kind: "ok", message: "Datos fiscales actualizados." };
}

async function manageMember(readline, repository, companies, contacts, remove = false) {
  const company = await chooseCompany(readline, companies);
  if (!company) return null;
  contacts.forEach((contact, index) => {
    console.log(`${palette.yellow(`${index + 1}.`)} ${contact.displayName || "Sin nombre"} · ${contact.whatsappUserId}`);
  });
  if (!remove) console.log(`${palette.yellow("0.")} Autorizar un teléfono nuevo en formato E.164`);
  const contact = await chooseContact(
    readline,
    contacts,
    remove ? "cancelar" : "autorizar un teléfono nuevo",
  );
  if (!contact && !remove) {
    const phone = await ask(readline, "Teléfono con código de país (ej. +51999999999)");
    const displayName = await ask(readline, "Nombre del usuario (opcional)");
    const result = await repository.addFacturayaMemberByPhone(
      company,
      phone,
      displayName || null,
    );
    return result.updated
      ? { kind: "ok", message: "Teléfono normalizado y autorizado." }
      : { kind: "error", message: "No se encontró el canal Manolo activo." };
  }
  if (!contact) return null;
  const result = remove
    ? await repository.removeFacturayaMember(company, contact)
    : await repository.addFacturayaMember(company, contact);
  return result.updated
    ? { kind: "ok", message: remove ? "Teléfono retirado de la empresa." : "Teléfono autorizado con los permisos predeterminados." }
    : { kind: "error", message: "No se encontró el contacto solicitado." };
}

async function setPermissions(readline, repository, companies, contacts) {
  const company = await chooseCompany(readline, companies);
  if (!company) return null;
  contacts.forEach((contact, index) => {
    console.log(`${palette.yellow(`${index + 1}.`)} ${contact.displayName || "Sin nombre"} · ${contact.whatsappUserId}`);
  });
  const contact = await chooseContact(readline, contacts);
  if (!contact) return null;
  console.log("Permisos: 1 Ver comprobantes · 2 Crear borrador · 3 Emitir · 4 Nota de crédito");
  const selected = (await ask(readline, "Números separados por coma")).split(",").map((value) => value.trim());
  const mapping = {
    1: "view_invoice",
    2: "create_invoice",
    3: "issue_invoice",
    4: "create_credit_note",
  };
  const permissions = selected.map((value) => mapping[value]).filter(Boolean);
  const result = await repository.setFacturayaMemberPermissions(company, contact, permissions);
  return result.updated
    ? { kind: "ok", message: "Permisos actualizados." }
    : { kind: "error", message: "Primero autoriza el teléfono en esa empresa." };
}

async function setIntegration(readline, outputState, adminGateway, companies) {
  const company = await chooseCompany(readline, companies);
  if (!company) return null;
  const environment = (await ask(readline, "Ambiente beta o production")).toLowerCase();
  if (environment !== "beta" && environment !== "production") {
    return { kind: "error", message: "Ambiente inválido." };
  }
  const token = await askSecret(readline, outputState, "Token FacturaYa (entrada oculta)");
  const result = await adminGateway.execute({
    action: "set_integration",
    tenantId: company.id,
    token,
    environment,
    status: "active",
  });
  return result.ok
    ? { kind: "ok", message: "Token cifrado y guardado en el VPS." }
    : { kind: "error", message: `No se pudo guardar: ${result.error || "error desconocido"}` };
}

async function testIntegration(readline, adminGateway, companies) {
  const company = await chooseCompany(readline, companies);
  if (!company) return null;
  const result = await adminGateway.execute({ action: "test_connection", tenantId: company.id });
  return result.ok
    ? { kind: "ok", message: `Conexión FacturaYa correcta (${result.environment}).` }
    : { kind: "error", message: result.message || result.reason || result.error || "La conexión falló." };
}

async function toggleIntegration(readline, repository, companies) {
  const company = await chooseCompany(readline, companies);
  if (!company) return null;
  const status = company.integrationStatus === "active" ? "inactive" : "active";
  const result = await repository.setFacturayaIntegrationStatus(company, status);
  return result.updated
    ? { kind: "ok", message: `Integración ${status === "active" ? "activada" : "desactivada"}.` }
    : { kind: "error", message: "La empresa todavía no tiene una integración." };
}

async function facturayaCompaniesMenu(
  readline,
  outputState,
  repository,
  adminGateway,
  contacts,
) {
  let status = null;
  while (true) {
    const companies = await repository.listFacturayaCompanies();
    console.clear();
    console.log(palette.cyan("MANOLO · EMPRESAS FACTURAYA"));
    console.log(palette.dim("Tokens cifrados en el VPS; nunca se muestran en esta pantalla."));
    console.log();
    printCompanies(companies);
    if (status) console.log((status.kind === "ok" ? palette.green : palette.red)(status.message));
    console.log();
    console.log("[C] Crear  [E] Editar  [A] Autorizar teléfono  [X] Quitar teléfono");
    console.log("[P] Permisos  [T] Token  [V] Probar conexión  [I] Activar/desactivar  [Q] Volver");
    const action = (await ask(readline, "Acción")).toLowerCase();
    if (["q", "volver", "salir"].includes(action)) return;
    try {
      if (action === "c") status = await createCompany(readline, repository);
      else if (action === "e") status = await editCompany(readline, repository, companies);
      else if (action === "a") status = await manageMember(readline, repository, companies, contacts);
      else if (action === "x") status = await manageMember(readline, repository, companies, contacts, true);
      else if (action === "p") status = await setPermissions(readline, repository, companies, contacts);
      else if (action === "t") status = await setIntegration(readline, outputState, adminGateway, companies);
      else if (action === "v") status = await testIntegration(readline, adminGateway, companies);
      else if (action === "i") status = await toggleIntegration(readline, repository, companies);
      else status = { kind: "error", message: "Acción no reconocida." };
    } catch (error) {
      status = { kind: "error", message: error instanceof Error ? error.message : "La operación falló." };
    }
  }
}

async function runCheck(repository) {
  const [contacts, roles] = await Promise.all([
    repository.listContacts(),
    repository.listAssignableRoles(),
  ]);
  console.log("connection=ok");
  console.log(`contacts=${contacts.length}`);
  console.log(`assignable_roles=${roles.length}`);
  console.log(`custom_role_contacts=${contacts.filter((contact) => contact.roleSource === "contact").length}`);
}

async function main() {
  const repository = new ContactAdminRepository(new SshPostgresGateway());
  const adminGateway = new SshBridgeAdminGateway();
  const roleMirror = new D1RoleMirror({
    enabled: process.env.MANOLO_D1_ROLE_MIRROR !== "false",
  });
  if (CHECK_MODE) {
    await runCheck(repository);
    return;
  }

  const outputState = { muted: false };
  const maskedOutput = new Writable({
    write(chunk, _encoding, callback) {
      if (!outputState.muted) process.stdout.write(chunk);
      callback();
    },
  });
  const readline = createInterface({ input: process.stdin, output: maskedOutput, terminal: true });
  let filter = "";
  let status = null;
  try {
    while (true) {
      const [allContacts, roles] = await Promise.all([
        repository.listContacts(),
        repository.listAssignableRoles(),
      ]);
      const contacts = filterContacts(allContacts, filter);
      console.clear();
      console.log(renderDashboard(contacts, {
        filter,
        status,
        terminalWidth: process.stdout.columns || 110,
        useColor: USE_COLOR,
      }));
      status = null;
      console.log();
      console.log("[A] Cambiar rol   [N] Nombrar   [V] Ver contacto   [H] Historial");
      console.log("[E] Empresas FacturaYa   [B] Buscar   [L] Limpiar   [R] Refrescar   [Q] Salir");
      const action = (await ask(readline, "Acción")).toLowerCase();
      if (["q", "quit", "salir"].includes(action)) break;

      try {
        if (["a", "rol", "asignar"].includes(action)) {
          status = await assignRole(
            readline,
            repository,
            roleMirror,
            contacts,
            roles,
          );
        } else if (["n", "nombre", "nombrar"].includes(action)) {
          status = await renameContact(readline, repository, contacts);
        } else if (["v", "ver"].includes(action)) {
          await inspectContact(readline, contacts);
        } else if (["h", "historial"].includes(action)) {
          await showHistory(readline, repository, contacts);
        } else if (["e", "empresa", "empresas"].includes(action)) {
          await facturayaCompaniesMenu(
            readline,
            outputState,
            repository,
            adminGateway,
            allContacts,
          );
        } else if (["b", "buscar"].includes(action)) {
          filter = await ask(readline, "Buscar por nombre, número, empresa o rol");
        } else if (["l", "limpiar"].includes(action)) {
          filter = "";
        } else if (!["r", "refrescar"].includes(action)) {
          status = { kind: "error", message: "Acción no reconocida." };
        }
      } catch (error) {
        status = {
          kind: "error",
          message: error instanceof Error ? error.message : "La operación falló.",
        };
      }
    }
  } finally {
    readline.close();
  }
}

main().catch((error) => {
  console.error(palette.red("No se pudo abrir Manolo Control."));
  console.error(error instanceof Error ? error.message : String(error));
  console.error(palette.dim("Verifica que el VPS esté encendido y que tu llave SSH siga disponible."));
  process.exitCode = 1;
});
