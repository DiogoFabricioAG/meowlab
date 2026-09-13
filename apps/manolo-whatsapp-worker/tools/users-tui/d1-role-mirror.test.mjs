import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { D1RoleMirror } from "./d1-role-mirror.mjs";

describe("D1RoleMirror", () => {
  it("mirrors the authoritative PostgreSQL role by stable contact identity", async () => {
    let receivedArgs = [];
    const mirror = new D1RoleMirror({
      runner: async (args) => {
        receivedArgs = args;
        return {
          stdout: JSON.stringify([
            { success: true, results: [] },
            { success: true, results: [{ active_role_key: "print-advisor" }] },
          ]),
        };
      },
    });

    await assert.doesNotReject(mirror.mirror({
      tenantId: "manolo",
      whatsappUserId: "51999999999",
    }, "print-advisor"));
    assert.deepEqual(receivedArgs.slice(0, 3), [
      "d1",
      "execute",
      "whatsapp-webhook-meta-db",
    ]);
    assert.match(receivedArgs.at(-1), /whatsapp_user_id = '51999999999'/);
  });

  it("supports inheriting the tenant role", async () => {
    const mirror = new D1RoleMirror({
      runner: async () => ({
        stdout: JSON.stringify([
          { success: true, results: [] },
          { success: true, results: [{ active_role_key: null }] },
        ]),
      }),
    });

    await assert.doesNotReject(mirror.mirror({
      tenantId: "manolo",
      whatsappUserId: "51999999999",
    }, null));
  });
});
