import { test } from "node:test";
import assert from "node:assert/strict";
import { createSshConnectionConfig, sshConnectionArgs } from "./ssh-config.mjs";
import { createSshPostgresConfig, SshPostgresGateway } from "./ssh-postgres.mjs";
import { SshBridgeAdminGateway } from "./ssh-bridge-admin.mjs";

test("uses meowlab and OpenSSH configuration without forcing a local key", () => {
  const config = createSshConnectionConfig({});
  assert.deepEqual(config, { host: "meowlab", keyPath: null });
  const args = sshConnectionArgs(config);
  assert.equal(args.at(-1), "meowlab");
  assert.equal(args.includes("-i"), false);
  assert.ok(args.includes("BatchMode=yes"));
  assert.ok(args.includes("ConnectTimeout=10"));
});

test("preserves explicit host and key overrides, including spaces in a key path", () => {
  const config = createSshConnectionConfig({ MANOLO_VPS_HOST: " admin@custom-vps ",
    MANOLO_VPS_SSH_KEY: " C:/SSH Keys/custom.key " });
  assert.equal(config.host, "admin@custom-vps");
  assert.deepEqual(sshConnectionArgs(config).slice(0, 2), ["-i", "C:/SSH Keys/custom.key"]);
});

test("blank overrides use the alias and SSH config", () => {
  assert.deepEqual(createSshConnectionConfig({ MANOLO_VPS_HOST: " ", MANOLO_VPS_SSH_KEY: " " }),
    { host: "meowlab", keyPath: null });
});

test("PostgreSQL and company administration share the same defaults", () => {
  const postgres = new SshPostgresGateway(createSshPostgresConfig({}));
  const bridge = new SshBridgeAdminGateway({});
  assert.equal(postgres.config.host, bridge.host);
  assert.equal(postgres.config.keyPath, bridge.keyPath);
  assert.equal(postgres.config.container, "manolo-platform-postgres-1");
  assert.equal(bridge.container, "manolo-platform-bridge-1");
});

test("rejects SSH options and shell syntax in a host", () => {
  for (const host of ["-oProxyCommand=bad", "host; command", "host with spaces", "$(command)"]) {
    assert.throws(() => new SshPostgresGateway({ host, keyPath: null, container: "postgres" }));
    assert.throws(() => new SshBridgeAdminGateway({ MANOLO_VPS_HOST: host }));
  }
});
