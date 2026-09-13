import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ContactAdminRepository,
  parseJsonResult,
  sqlLiteral,
} from "./contact-admin-repository.mjs";

describe("ContactAdminRepository", () => {
  it("escapes SQL string literals", () => {
    assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
  });

  it("parses the single JSON value emitted by psql", () => {
    assert.deepEqual(parseJsonResult('[{"id":"1"}]', "prueba"), [{ id: "1" }]);
  });

  it("writes only catalog-backed role keys and records an audit", async () => {
    let capturedSql = "";
    const repository = new ContactAdminRepository({
      query: async (sql) => {
        capturedSql = sql;
        return '{"updated":true,"changed":true,"roleKey":"quotes"}';
      },
    });

    const result = await repository.setContactRole(
      { id: "7", tenantId: "manolo" },
      "quotes",
    );

    assert.equal(result.changed, true);
    assert.match(capturedSql, /role_catalog/);
    assert.match(capturedSql, /contact_role_audit/);
    assert.match(capturedSql, /tenant_id = 'manolo'/);
  });

  it("rejects unsafe contact IDs before querying", async () => {
    const repository = new ContactAdminRepository({
      query: async () => {
        throw new Error("should not run");
      },
    });

    await assert.rejects(
      repository.renameContact({ id: "1; DROP TABLE", tenantId: "manolo" }, "Ana"),
      /ID de contacto inválido/,
    );
  });

  it("creates tenant memberships with allow-listed permissions", async () => {
    let capturedSql = "";
    const repository = new ContactAdminRepository({
      query: async (sql) => {
        capturedSql = sql;
        return '{"updated":true}';
      },
    });

    const result = await repository.addFacturayaMember(
      { id: "company-a" },
      { id: "7" },
      ["view_invoice", "issue_invoice"],
    );

    assert.equal(result.updated, true);
    assert.match(capturedSql, /tenant_members/);
    assert.match(capturedSql, /company-a/);
    assert.match(capturedSql, /issue_invoice/);
  });

  it("rejects unknown FacturaYa permissions", async () => {
    const repository = new ContactAdminRepository({ query: async () => "{}" });
    await assert.rejects(
      repository.setFacturayaMemberPermissions(
        { id: "company-a" },
        { id: "7" },
        ["read_every_tenant"],
      ),
      /permiso FacturaYa no reconocido/,
    );
  });

  it("normalizes a new authorized phone to E.164", async () => {
    let capturedSql = "";
    const repository = new ContactAdminRepository({
      query: async (sql) => {
        capturedSql = sql;
        return '{"updated":true}';
      },
    });

    await repository.addFacturayaMemberByPhone(
      { id: "company-a" },
      "51999999999",
      "Ana",
    );

    assert.match(capturedSql, /\+51999999999/);
    assert.match(capturedSql, /tenant_members/);
  });
});
