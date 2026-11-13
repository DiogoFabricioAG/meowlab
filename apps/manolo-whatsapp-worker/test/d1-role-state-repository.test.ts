import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { D1RoleStateRepository } from "../src/adapters/roles/d1-role-state-repository";
import { RoleStateStorageError } from "../src/roles/state";

async function contact() {
  const row = await env.DB.prepare(
    "INSERT INTO contacts (tenant_id, whatsapp_user_id) VALUES ('test-quotes', ?1) RETURNING id",
  ).bind(`checkpoint-${crypto.randomUUID()}`).first<{ id: number }>();
  return row!.id;
}

describe("D1 checkpoint writes", () => {
  it("distinguishes storage unavailability from a stale checkpoint", async () => {
    const unavailable = new D1RoleStateRepository(null);
    await expect(unavailable.getForUpdate("test", 1, "enterprise-advisor")).rejects.toBeInstanceOf(RoleStateStorageError);
    await expect(unavailable.compareAndSet("test", 1, "enterprise-advisor", null, "new")).rejects.toBeInstanceOf(RoleStateStorageError);
  });

  it("reports an actual database rejection as storage_error instead of conflict", async () => {
    const repository = new D1RoleStateRepository(env.DB);
    const id = await contact();
    await expect(repository.compareAndSet("nonexistent-tenant", id, "enterprise-advisor", null, "new")).rejects.toBeInstanceOf(RoleStateStorageError);
    expect(await repository.getForUpdate("test-quotes", id, "enterprise-advisor")).toBeNull();
  });

  it("allows only one concurrent initial checkpoint", async () => {
    const repository = new D1RoleStateRepository(env.DB);
    const id = await contact();
    const results = await Promise.all([
      repository.compareAndSet("test-quotes", id, "enterprise-advisor", null, '{"revision":1}'),
      repository.compareAndSet("test-quotes", id, "enterprise-advisor", null, '{"revision":2}'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("rejects stale updates and deletions without changing the latest checkpoint", async () => {
    const repository = new D1RoleStateRepository(env.DB);
    const id = await contact();
    const initial = '{"revision":1}';
    const latest = '{"revision":2}';
    expect(await repository.compareAndSet("test-quotes", id, "enterprise-advisor", null, initial)).toBe(true);
    expect(await repository.compareAndSet("test-quotes", id, "enterprise-advisor", initial, latest)).toBe(true);
    expect(await repository.compareAndSet("test-quotes", id, "enterprise-advisor", initial, '{"revision":3}')).toBe(false);
    expect(await repository.compareAndSet("test-quotes", id, "enterprise-advisor", initial, null)).toBe(false);
    expect(await repository.get("test-quotes", id, "enterprise-advisor")).toBe(latest);
    expect(await repository.compareAndSet("test-quotes", id, "enterprise-advisor", latest, null)).toBe(true);
    expect(await repository.get("test-quotes", id, "enterprise-advisor")).toBeNull();
  });

  it("isolates checkpoints by contact, tenant and role", async () => {
    const repository = new D1RoleStateRepository(env.DB);
    const first = await contact();
    const second = await contact();
    expect(await repository.compareAndSet("test-quotes", first, "enterprise-advisor", null, "checkpoint")).toBe(true);
    expect(await repository.compareAndSet("test-quotes", second, "enterprise-advisor", "checkpoint", "other")).toBe(false);
    expect(await repository.compareAndSet("other-tenant", first, "enterprise-advisor", "checkpoint", "other")).toBe(false);
    expect(await repository.compareAndSet("test-quotes", first, "quotes", "checkpoint", "other")).toBe(false);
    expect(await repository.get("test-quotes", first, "enterprise-advisor")).toBe("checkpoint");
  });
});
