import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATABASE_NAME = "whatsapp-webhook-meta-db";
const ROLE_OPTIONS = [
  { option: "2", label: "cat", value: "cat" },
  { option: "3", label: "quotes", value: "quotes" },
  { option: "4", label: "print-advisor", value: "print-advisor" },
  { option: "5", label: "store-designer", value: "store-designer" },
  { option: "6", label: "enterprise-advisor", value: "enterprise-advisor" },
];

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function executeD1(sql) {
  const args = [
    "d1",
    "execute",
    DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    sql.trim(),
  ];
  const wranglerEntry = path.join(ROOT_DIR, "node_modules", "wrangler", "bin", "wrangler.js");
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [wranglerEntry, ...args], {
      cwd: ROOT_DIR,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (error) {
    const details = error?.stderr ? `\n${error.stderr}` : "";
    throw new Error(`${error?.message ?? "Wrangler falló."}${details}`);
  }

  const firstBracket = stdout.indexOf("[");
  const lastBracket = stdout.lastIndexOf("]");
  if (firstBracket < 0 || lastBracket < firstBracket) {
    throw new Error("Wrangler no devolvió una respuesta JSON válida.");
  }

  const payload = JSON.parse(stdout.slice(firstBracket, lastBracket + 1));
  const firstResult = payload[0];
  if (!firstResult?.success) {
    throw new Error("D1 rechazó la operación.");
  }
  return firstResult.results ?? [];
}

async function listUsers() {
  return executeD1(`
    SELECT
      c.id,
      c.tenant_id,
      t.name AS tenant_name,
      c.whatsapp_user_id,
      COALESCE(NULLIF(c.display_name, ''), '') AS display_name,
      bc.role_key AS tenant_role,
      c.active_role_key,
      CASE
        WHEN c.active_role_key IS NULL OR c.active_role_key = '' THEN bc.role_key
        ELSE c.active_role_key
      END AS effective_role,
      COALESCE(qss.name, 'Se crea al cotizar') AS quote_scope_name,
      MAX(m.created_at) AS last_message_at,
      COUNT(m.id) AS message_count
    FROM contacts c
    INNER JOIN tenants t ON t.id = c.tenant_id
    INNER JOIN bot_configs bc ON bc.tenant_id = t.id
    LEFT JOIN quote_sequence_members qsm
      ON qsm.tenant_id = c.tenant_id AND qsm.contact_id = c.id
    LEFT JOIN quote_sequence_scopes qss ON qss.id = qsm.scope_id
    LEFT JOIN messages m ON m.conversation_id = c.tenant_id || ':' || c.whatsapp_user_id
    GROUP BY
      c.id,
      c.tenant_id,
      t.name,
      c.whatsapp_user_id,
      c.display_name,
      bc.role_key,
      c.active_role_key,
      qss.name
    ORDER BY last_message_at DESC, c.id DESC
  `);
}

function userLabel(user) {
  const name = user.display_name || "Sin nombre";
  const role = user.effective_role || user.tenant_role || "cat";
  const quoteScope = user.quote_scope_name || "Se crea al cotizar";
  const lastMessage = user.last_message_at
    ? new Date(user.last_message_at).toLocaleString("es-CO")
    : "sin mensajes";
  return `${name} | ${user.tenant_name} | rol: ${role} | cotizaciones: ${quoteScope} | mensajes: ${user.message_count} | último: ${lastMessage}`;
}

function printUsers(users) {
  console.clear();
  console.log("Manolo · usuarios de WhatsApp");
  console.log("=".repeat(72));

  if (users.length === 0) {
    console.log("Todavía no hay usuarios registrados en D1.");
    console.log("Escribe primero al número de WhatsApp de Manolo.");
    return;
  }

  users.forEach((user, index) => {
    console.log(`${index + 1}. ${userLabel(user)}`);
    console.log(`   WhatsApp ID: ${user.whatsapp_user_id}`);
  });
  console.log();
}

async function ask(readline, question, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await readline.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function chooseUser(readline, users) {
  if (users.length === 0) {
    return null;
  }

  const answer = await ask(readline, "Número de usuario (0 para cancelar)");
  const index = Number.parseInt(answer, 10);
  if (!Number.isInteger(index) || index <= 0 || index > users.length) {
    return null;
  }
  return users[index - 1];
}

async function renameUser(readline, users) {
  const user = await chooseUser(readline, users);
  if (!user) return;

  const name = await ask(
    readline,
    `Nombre para ${user.whatsapp_user_id} (vacío para quitarlo)`,
    user.display_name || "",
  );
  const value = name ? sqlString(name.slice(0, 120)) : "NULL";
  await executeD1(
    `UPDATE contacts SET display_name = ${value}, updated_at = CURRENT_TIMESTAMP WHERE id = ${Number(user.id)}`,
  );
  console.log("Nombre actualizado.");
}

async function setRole(readline, users) {
  const user = await chooseUser(readline, users);
  if (!user) return;

  console.log("1. Heredar rol del cliente (recomendado)");
  ROLE_OPTIONS.forEach(({ option, label }) => {
    console.log(`${option}. ${label}`);
  });
  const option = await ask(readline, "Rol");
  const selectedRole = ROLE_OPTIONS.find((roleOption) => roleOption.option === option);
  const role = selectedRole ? sqlString(selectedRole.value) : "NULL";

  await executeD1(
    `UPDATE contacts SET active_role_key = ${role}, updated_at = CURRENT_TIMESTAMP WHERE id = ${Number(user.id)}`,
  );
  console.log("Rol actualizado.");
}

async function listQuoteScopes(tenantId) {
  return executeD1(`
    SELECT
      qs.id,
      qs.name,
      qs.next_number,
      COUNT(DISTINCT qsm.contact_id) AS member_count,
      COUNT(DISTINCT qd.id) AS draft_count
    FROM quote_sequence_scopes qs
    LEFT JOIN quote_sequence_members qsm ON qsm.scope_id = qs.id
    LEFT JOIN quote_drafts qd ON qd.sequence_scope_id = qs.id
    WHERE qs.tenant_id = ${sqlString(tenantId)}
    GROUP BY qs.id, qs.name, qs.next_number
    ORDER BY qs.name
  `);
}

async function deleteEmptyQuoteScope(readline, tenantId, scopes) {
  const candidates = scopes.filter((scope) => Number(scope.member_count) === 0);

  if (candidates.length === 0) {
    console.log("No hay grupos huérfanos para eliminar.");
    return;
  }

  console.log("Grupos huérfanos:");
  candidates.forEach((scope, index) => {
    console.log(
      `${index + 1}. ${scope.name} | cotizaciones: ${scope.draft_count} | siguiente: ${scope.next_number}`,
    );
  });

  const option = await ask(readline, "Grupo a eliminar (0 para cancelar)");
  const selected = Number.parseInt(option, 10);
  if (!Number.isInteger(selected) || selected <= 0 || selected > candidates.length) {
    return;
  }

  const scope = candidates[selected - 1];
  console.log(`Se eliminará el grupo "${scope.name}".`);
  console.log(
    `Las ${scope.draft_count} cotizaciones asociadas se conservarán; solo se quitará su vínculo con este grupo.`,
  );
  console.log("Esta acción no se puede deshacer.");
  const confirmation = await ask(readline, "Escribe ELIMINAR para confirmar");
  if (confirmation !== "ELIMINAR") {
    console.log("Operación cancelada.");
    return;
  }

  await executeD1(`
    UPDATE quote_drafts
    SET sequence_scope_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${sqlString(tenantId)}
      AND sequence_scope_id = ${sqlString(scope.id)}
  `);
  await executeD1(`
    DELETE FROM quote_sequence_scopes
    WHERE id = ${sqlString(scope.id)}
      AND tenant_id = ${sqlString(tenantId)}
      AND NOT EXISTS (
        SELECT 1 FROM quote_sequence_members WHERE scope_id = quote_sequence_scopes.id
      )
  `);
  console.log("Grupo eliminado.");
}

async function setQuoteScope(readline, users) {
  const user = await chooseUser(readline, users);
  if (!user) return;

  const scopes = await listQuoteScopes(user.tenant_id);
  console.log(`Grupos de cotizaciones para ${user.tenant_name}:`);
  console.log("0. Crear un grupo nuevo");
  scopes.forEach((scope, index) => {
    console.log(
      `${index + 1}. ${scope.name} | miembros: ${scope.member_count} | borradores: ${scope.draft_count} | siguiente: ${scope.next_number}`,
    );
  });

  const option = await ask(readline, "Grupo (0 para crear, X para eliminar un grupo vacío)");
  if (option.toLowerCase() === "x") {
    await deleteEmptyQuoteScope(readline, user.tenant_id, scopes);
    return;
  }

  const selected = Number.parseInt(option, 10);
  let scopeId;

  if (selected === 0) {
    const name = await ask(readline, "Nombre del grupo", "Empresa");
    scopeId = `${user.tenant_id}:group:${randomUUID()}`;
    await executeD1(
      `INSERT INTO quote_sequence_scopes (id, tenant_id, name, next_number)
       VALUES (${sqlString(scopeId)}, ${sqlString(user.tenant_id)}, ${sqlString(name.slice(0, 120))}, 100)`,
    );
  } else if (Number.isInteger(selected) && selected > 0 && selected <= scopes.length) {
    scopeId = scopes[selected - 1].id;
  } else {
    return;
  }

  const maxRows = await executeD1(`
    SELECT COALESCE(MAX(CAST(quote_number AS INTEGER)), 99) AS max_number
    FROM quote_drafts
    WHERE tenant_id = ${sqlString(user.tenant_id)}
      AND quote_number IS NOT NULL
      AND (
        contact_id = ${Number(user.id)}
        OR contact_id IN (
          SELECT contact_id
          FROM quote_sequence_members
          WHERE scope_id = ${sqlString(scopeId)}
        )
      )
  `);
  const scopeRows = await executeD1(
    `SELECT next_number FROM quote_sequence_scopes WHERE id = ${sqlString(scopeId)} LIMIT 1`,
  );
  const maxHistorical = Number(maxRows[0]?.max_number ?? 99);
  const currentNext = Number(scopeRows[0]?.next_number ?? 100);
  const nextNumber = Math.max(currentNext, maxHistorical + 1, 100);

  await executeD1(
    `UPDATE quote_sequence_scopes
     SET next_number = ${nextNumber}, updated_at = CURRENT_TIMESTAMP
     WHERE id = ${sqlString(scopeId)}`,
  );
  await executeD1(
    `INSERT INTO quote_sequence_members (scope_id, tenant_id, contact_id)
     VALUES (${sqlString(scopeId)}, ${sqlString(user.tenant_id)}, ${Number(user.id)})
     ON CONFLICT (tenant_id, contact_id)
     DO UPDATE SET scope_id = excluded.scope_id`,
  );

  console.log(`Grupo de cotizaciones actualizado para ${user.display_name || user.whatsapp_user_id}.`);
  console.log(`Las nuevas cotizaciones usarán la secuencia desde ${nextNumber}.`);
}

async function deleteUser(readline, users) {
  const user = await chooseUser(readline, users);
  if (!user) return;

  console.log(`Se eliminará el contacto ${user.display_name || "Sin nombre"} (${user.whatsapp_user_id}).`);
  console.log("También se eliminarán su historial de WhatsApp, borradores de cotización y acciones pendientes.");
  console.log("Si pertenece a un grupo compartido, solo se quitará a este contacto del grupo.");
  console.log("Esta acción no se puede deshacer.");
  const confirmation = await ask(readline, "Escribe ELIMINAR para confirmar");
  if (confirmation !== "ELIMINAR") {
    console.log("Operación cancelada.");
    return;
  }

  await executeD1(`
    DELETE FROM contacts
    WHERE id = ${Number(user.id)}
      AND tenant_id = ${sqlString(user.tenant_id)}
  `);
  console.log("Usuario eliminado.");
}

async function main() {
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      const users = await listUsers();
      printUsers(users);
      console.log("[R]efrescar  [N]ombrar  [A]signar rol  [G]rupo de cotizaciones  [E]liminar usuario  [Q]uit");
      const action = (await ask(readline, "Acción")).toLowerCase();

      if (action === "q" || action === "quit" || action === "salir") {
        break;
      }
      if (action === "n" || action === "nombrar") {
        await renameUser(readline, users);
      } else if (action === "a" || action === "asignar") {
        await setRole(readline, users);
      } else if (action === "g" || action === "grupo" || action === "grupos") {
        await setQuoteScope(readline, users);
      } else if (action === "e" || action === "eliminar" || action === "borrar") {
        await deleteUser(readline, users);
      }

      if (action !== "r" && action !== "refrescar") {
        await readline.question("Presiona Enter para continuar...");
      }
    }
  } finally {
    readline.close();
  }
}

main().catch((error) => {
  console.error(`No se pudo abrir la TUI: ${error.message}`);
  process.exitCode = 1;
});
