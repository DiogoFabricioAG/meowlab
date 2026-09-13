const SAFE_NUMERIC_ID = /^\d+$/;
const SAFE_ROLE_KEY = /^[a-z][a-z0-9-]{0,119}$/;
const SAFE_TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const FACTURAYA_PERMISSIONS = new Set([
  "view_invoice",
  "create_invoice",
  "issue_invoice",
  "create_credit_note",
]);

export function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function parseJsonResult(output, operation) {
  const normalized = String(output).trim();
  if (!normalized) {
    throw new Error(`PostgreSQL no respondió durante: ${operation}.`);
  }
  try {
    return JSON.parse(normalized);
  } catch {
    throw new Error(`PostgreSQL devolvió datos inválidos durante: ${operation}.`);
  }
}

function numericId(value) {
  const id = String(value);
  if (!SAFE_NUMERIC_ID.test(id)) throw new Error("ID de contacto inválido.");
  return id;
}

function tenantId(value) {
  const id = String(value).trim();
  if (!SAFE_TENANT_ID.test(id)) throw new Error("ID de empresa inválido.");
  return id;
}

function normalizedRuc(value) {
  const ruc = String(value ?? "").replace(/\D/g, "");
  if (ruc && !/^\d{11}$/.test(ruc)) throw new Error("El RUC debe tener 11 dígitos.");
  return ruc || null;
}

function normalizedPermissions(values) {
  const permissions = [...new Set(values.map((value) => String(value).trim()))];
  if (permissions.some((permission) => !FACTURAYA_PERMISSIONS.has(permission))) {
    throw new Error("Se recibió un permiso FacturaYa no reconocido.");
  }
  return permissions;
}

function normalizedE164(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    throw new Error("El teléfono debe incluir código de país y tener formato E.164.");
  }
  return `+${digits}`;
}

export class ContactAdminRepository {
  constructor(gateway) {
    this.gateway = gateway;
  }

  async listContacts() {
    const output = await this.gateway.query(`
      SELECT COALESCE(json_agg(item), '[]'::json)::text
      FROM (
        SELECT json_build_object(
          'id', contact.id::text,
          'tenantId', contact.tenant_id,
          'tenantName', tenant.name,
          'whatsappUserId', contact.whatsapp_user_id,
          'displayName', COALESCE(contact.display_name, ''),
          'customRoleKey', contact_role.role_key,
          'effectiveRoleKey', COALESCE(contact_role.role_key, tenant_role.role_key, config.role_key),
          'effectiveRoleLabel', COALESCE(contact_role.label, tenant_role.label, config.role_key),
          'roleSource', CASE WHEN contact_role.role_key IS NULL THEN 'tenant' ELSE 'contact' END,
          'lastSeenAt', contact.last_seen_at,
          'createdAt', contact.created_at
          , 'activeFacturayaTenantId', active_company.id
          , 'activeFacturayaTenantName', COALESCE(active_company.legal_name, active_company.name)
          , 'activeFacturayaExpiresAt', active_session.expires_at
        ) AS item
        FROM whatsapp.contacts AS contact
        INNER JOIN whatsapp.tenants AS tenant
          ON tenant.id = contact.tenant_id
        INNER JOIN whatsapp.bot_configs AS config
          ON config.tenant_id = contact.tenant_id
        LEFT JOIN whatsapp.role_catalog AS contact_role
          ON contact_role.role_key = NULLIF(BTRIM(contact.active_role_key), '')
         AND contact_role.active = TRUE
        LEFT JOIN whatsapp.role_catalog AS tenant_role
          ON tenant_role.role_key = NULLIF(BTRIM(config.role_key), '')
         AND tenant_role.active = TRUE
        LEFT JOIN whatsapp.facturaya_sessions AS active_session
          ON active_session.channel_tenant_id = contact.tenant_id
         AND active_session.contact_id = contact.id
         AND active_session.expires_at > CURRENT_TIMESTAMP
        LEFT JOIN whatsapp.tenants AS active_company
          ON active_company.id = active_session.active_tenant_id
        ORDER BY COALESCE(contact.last_seen_at, contact.created_at) DESC, contact.id DESC
      ) AS contacts;
    `);
    return parseJsonResult(output, "listar contactos");
  }

  async listAssignableRoles() {
    const output = await this.gateway.query(`
      SELECT COALESCE(json_agg(item), '[]'::json)::text
      FROM (
        SELECT json_build_object(
          'key', role_key,
          'label', label,
          'description', description
        ) AS item
        FROM whatsapp.role_catalog
        WHERE active = TRUE AND assignable = TRUE
        ORDER BY sort_order, label
      ) AS roles;
    `);
    return parseJsonResult(output, "listar roles");
  }

  async renameContact(contact, name) {
    const id = numericId(contact.id);
    const normalizedName = name?.trim().slice(0, 120) || null;
    const output = await this.gateway.query(`
      WITH updated AS (
        UPDATE whatsapp.contacts
        SET display_name = ${normalizedName === null ? "NULL" : sqlLiteral(normalizedName)},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
          AND tenant_id = ${sqlLiteral(contact.tenantId)}
        RETURNING id
      )
      SELECT json_build_object('updated', EXISTS(SELECT 1 FROM updated))::text;
    `);
    return parseJsonResult(output, "actualizar nombre");
  }

  async setContactRole(contact, roleKey) {
    const id = numericId(contact.id);
    if (roleKey !== null && !SAFE_ROLE_KEY.test(roleKey)) {
      throw new Error("La clave del rol no es válida.");
    }
    const requestedRole = roleKey === null
      ? "SELECT NULL::text AS role_key"
      : `SELECT role_key FROM whatsapp.role_catalog
         WHERE role_key = ${sqlLiteral(roleKey)}
           AND active = TRUE
           AND assignable = TRUE`;
    const output = await this.gateway.query(`
      WITH requested_role AS (
        ${requestedRole}
      ), previous_contact AS MATERIALIZED (
        SELECT id, tenant_id, active_role_key
        FROM whatsapp.contacts
        WHERE id = ${id}
          AND tenant_id = ${sqlLiteral(contact.tenantId)}
      ), updated AS (
        UPDATE whatsapp.contacts AS contact
        SET active_role_key = requested_role.role_key,
            updated_at = CURRENT_TIMESTAMP
        FROM previous_contact, requested_role
        WHERE contact.id = previous_contact.id
          AND contact.tenant_id = previous_contact.tenant_id
        RETURNING contact.id, contact.tenant_id, contact.active_role_key
      ), audit AS (
        INSERT INTO whatsapp.contact_role_audit (
          tenant_id,
          contact_id,
          previous_role_key,
          new_role_key,
          changed_by
        )
        SELECT
          updated.tenant_id,
          updated.id,
          previous_contact.active_role_key,
          updated.active_role_key,
          'users-tui'
        FROM updated
        INNER JOIN previous_contact ON previous_contact.id = updated.id
        WHERE previous_contact.active_role_key IS DISTINCT FROM updated.active_role_key
        RETURNING id
      )
      SELECT json_build_object(
        'updated', EXISTS(SELECT 1 FROM updated),
        'changed', EXISTS(SELECT 1 FROM audit),
        'roleKey', (SELECT active_role_key FROM updated LIMIT 1)
      )::text;
    `);
    return parseJsonResult(output, "actualizar rol");
  }

  async listRoleHistory(contact, limit = 10) {
    const id = numericId(contact.id);
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
    const output = await this.gateway.query(`
      SELECT COALESCE(json_agg(item), '[]'::json)::text
      FROM (
        SELECT json_build_object(
          'previousRoleKey', audit.previous_role_key,
          'previousRoleLabel', previous_role.label,
          'newRoleKey', audit.new_role_key,
          'newRoleLabel', new_role.label,
          'changedBy', audit.changed_by,
          'changedAt', audit.changed_at
        ) AS item
        FROM whatsapp.contact_role_audit AS audit
        LEFT JOIN whatsapp.role_catalog AS previous_role
          ON previous_role.role_key = audit.previous_role_key
        LEFT JOIN whatsapp.role_catalog AS new_role
          ON new_role.role_key = audit.new_role_key
        WHERE audit.contact_id = ${id}
          AND audit.tenant_id = ${sqlLiteral(contact.tenantId)}
        ORDER BY audit.changed_at DESC, audit.id DESC
        LIMIT ${safeLimit}
      ) AS history;
    `);
    return parseJsonResult(output, "consultar historial de roles");
  }

  async listFacturayaCompanies() {
    const output = await this.gateway.query(`
      SELECT COALESCE(json_agg(item), '[]'::json)::text
      FROM (
        SELECT json_build_object(
          'id', tenant.id,
          'name', tenant.name,
          'legalName', tenant.legal_name,
          'ruc', tenant.ruc,
          'address', tenant.address,
          'status', tenant.status,
          'memberCount', COUNT(member.contact_id)::integer,
          'integrationStatus', integration.status,
          'environment', integration.environment,
          'lastConnectionCheck', integration.last_connection_check,
          'lastConnectionStatus', integration.last_connection_status,
          'lastConnectionError', integration.last_connection_error
        ) AS item
        FROM whatsapp.tenants AS tenant
        LEFT JOIN whatsapp.tenant_members AS member
          ON member.tenant_id = tenant.id
         AND member.status = 'active'
        LEFT JOIN whatsapp.tenant_integrations AS integration
          ON integration.tenant_id = tenant.id
         AND integration.provider = 'facturaya'
        WHERE integration.id IS NOT NULL
           OR tenant.ruc IS NOT NULL
           OR EXISTS (
             SELECT 1 FROM whatsapp.tenant_members AS any_member
             WHERE any_member.tenant_id = tenant.id
           )
        GROUP BY tenant.id, integration.id
        ORDER BY COALESCE(tenant.legal_name, tenant.name), tenant.id
      ) AS companies;
    `);
    return parseJsonResult(output, "listar empresas FacturaYa");
  }

  async createFacturayaCompany(input) {
    const id = tenantId(input.id);
    const name = String(input.name ?? "").trim().slice(0, 160);
    const legalName = String(input.legalName ?? "").trim().slice(0, 255);
    const ruc = normalizedRuc(input.ruc);
    const address = String(input.address ?? "").trim().slice(0, 500);
    if (!name || !legalName || !ruc) {
      throw new Error("ID, nombre, razón social y RUC son obligatorios.");
    }
    const output = await this.gateway.query(`
      INSERT INTO whatsapp.tenants (
        id, name, legal_name, ruc, address, status
      ) VALUES (
        ${sqlLiteral(id)},
        ${sqlLiteral(name)},
        ${sqlLiteral(legalName)},
        ${sqlLiteral(ruc)},
        ${address ? sqlLiteral(address) : "NULL"},
        'active'
      )
      RETURNING json_build_object('created', true, 'id', id)::text;
    `);
    return parseJsonResult(output, "crear empresa FacturaYa");
  }

  async updateFacturayaCompany(company, input) {
    const id = tenantId(company.id);
    const name = String(input.name ?? company.name ?? "").trim().slice(0, 160);
    const legalName = String(input.legalName ?? company.legalName ?? "").trim().slice(0, 255);
    const ruc = normalizedRuc(input.ruc ?? company.ruc);
    const address = String(input.address ?? company.address ?? "").trim().slice(0, 500);
    if (!name || !legalName || !ruc) throw new Error("Nombre, razón social y RUC son obligatorios.");
    const output = await this.gateway.query(`
      WITH updated AS (
        UPDATE whatsapp.tenants
        SET name = ${sqlLiteral(name)},
            legal_name = ${sqlLiteral(legalName)},
            ruc = ${sqlLiteral(ruc)},
            address = ${address ? sqlLiteral(address) : "NULL"},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${sqlLiteral(id)}
        RETURNING id
      )
      SELECT json_build_object('updated', EXISTS(SELECT 1 FROM updated))::text;
    `);
    return parseJsonResult(output, "editar empresa FacturaYa");
  }

  async addFacturayaMember(company, contact, permissions = [...FACTURAYA_PERMISSIONS]) {
    const companyId = tenantId(company.id);
    const contactId = numericId(contact.id);
    const normalized = normalizedPermissions(permissions);
    const output = await this.gateway.query(`
      WITH valid_contact AS (
        SELECT id, display_name FROM whatsapp.contacts WHERE id = ${contactId}
      ), inserted AS (
        INSERT INTO whatsapp.tenant_members (
          tenant_id, contact_id, display_name, permissions, status
        )
        SELECT
          ${sqlLiteral(companyId)},
          id,
          display_name,
          ${sqlLiteral(JSON.stringify(normalized))}::jsonb,
          'active'
        FROM valid_contact
        ON CONFLICT (tenant_id, contact_id)
        DO UPDATE SET display_name = EXCLUDED.display_name,
                      permissions = EXCLUDED.permissions,
                      status = 'active',
                      updated_at = CURRENT_TIMESTAMP
        RETURNING contact_id
      )
      SELECT json_build_object('updated', EXISTS(SELECT 1 FROM inserted))::text;
    `);
    return parseJsonResult(output, "autorizar contacto en empresa");
  }

  async addFacturayaMemberByPhone(
    company,
    phone,
    displayName = null,
    permissions = [...FACTURAYA_PERMISSIONS],
    channelTenantId = "manolo",
  ) {
    const companyId = tenantId(company.id);
    const channelId = tenantId(channelTenantId);
    const phoneE164 = normalizedE164(phone);
    const whatsappUserId = phoneE164.slice(1);
    const name = String(displayName ?? "").trim().slice(0, 120) || null;
    const normalized = normalizedPermissions(permissions);
    const output = await this.gateway.query(`
      WITH valid_channel AS (
        SELECT tenant.id
        FROM whatsapp.tenants AS tenant
        INNER JOIN whatsapp.whatsapp_numbers AS number
          ON number.tenant_id = tenant.id
         AND number.active = TRUE
        WHERE tenant.id = ${sqlLiteral(channelId)}
          AND tenant.status = 'active'
        LIMIT 1
      ), upserted_contact AS (
        INSERT INTO whatsapp.contacts AS target (
          tenant_id,
          whatsapp_user_id,
          display_phone,
          phone_e164,
          display_name,
          updated_at
        )
        SELECT
          id,
          ${sqlLiteral(whatsappUserId)},
          ${sqlLiteral(phoneE164)},
          ${sqlLiteral(phoneE164)},
          ${name ? sqlLiteral(name) : "NULL"},
          CURRENT_TIMESTAMP
        FROM valid_channel
        ON CONFLICT (tenant_id, whatsapp_user_id)
        DO UPDATE SET phone_e164 = EXCLUDED.phone_e164,
                      display_phone = EXCLUDED.display_phone,
                      display_name = COALESCE(EXCLUDED.display_name, target.display_name),
                      updated_at = CURRENT_TIMESTAMP
        RETURNING id, display_name
      ), inserted AS (
        INSERT INTO whatsapp.tenant_members (
          tenant_id, contact_id, display_name, permissions, status
        )
        SELECT
          ${sqlLiteral(companyId)},
          id,
          display_name,
          ${sqlLiteral(JSON.stringify(normalized))}::jsonb,
          'active'
        FROM upserted_contact
        ON CONFLICT (tenant_id, contact_id)
        DO UPDATE SET display_name = EXCLUDED.display_name,
                      permissions = EXCLUDED.permissions,
                      status = 'active',
                      updated_at = CURRENT_TIMESTAMP
        RETURNING contact_id
      )
      SELECT json_build_object('updated', EXISTS(SELECT 1 FROM inserted))::text;
    `);
    return parseJsonResult(output, "autorizar teléfono E.164 en empresa");
  }

  async removeFacturayaMember(company, contact) {
    const companyId = tenantId(company.id);
    const contactId = numericId(contact.id);
    const output = await this.gateway.query(`
      WITH updated AS (
        UPDATE whatsapp.tenant_members
        SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${sqlLiteral(companyId)}
          AND contact_id = ${contactId}
        RETURNING contact_id
      )
      SELECT json_build_object('updated', EXISTS(SELECT 1 FROM updated))::text;
    `);
    return parseJsonResult(output, "quitar contacto de empresa");
  }

  async setFacturayaMemberPermissions(company, contact, permissions) {
    const companyId = tenantId(company.id);
    const contactId = numericId(contact.id);
    const normalized = normalizedPermissions(permissions);
    const output = await this.gateway.query(`
      WITH updated AS (
        UPDATE whatsapp.tenant_members
        SET permissions = ${sqlLiteral(JSON.stringify(normalized))}::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${sqlLiteral(companyId)}
          AND contact_id = ${contactId}
          AND status = 'active'
        RETURNING contact_id
      )
      SELECT json_build_object('updated', EXISTS(SELECT 1 FROM updated))::text;
    `);
    return parseJsonResult(output, "asignar permisos FacturaYa");
  }

  async setFacturayaIntegrationStatus(company, status) {
    const companyId = tenantId(company.id);
    if (status !== "active" && status !== "inactive") {
      throw new Error("Estado de integración inválido.");
    }
    const output = await this.gateway.query(`
      WITH updated AS (
        UPDATE whatsapp.tenant_integrations
        SET status = ${sqlLiteral(status)}, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${sqlLiteral(companyId)}
          AND provider = 'facturaya'
        RETURNING id
      )
      SELECT json_build_object('updated', EXISTS(SELECT 1 FROM updated))::text;
    `);
    return parseJsonResult(output, "cambiar estado de integración");
  }
}
