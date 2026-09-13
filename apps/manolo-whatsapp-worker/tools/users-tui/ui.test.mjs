import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatRelativeTime,
  maskWhatsAppId,
  renderDashboard,
  truncate,
} from "./ui.mjs";

describe("users TUI presentation", () => {
  it("masks long WhatsApp IDs in the table", () => {
    assert.equal(maskWhatsAppId("51923790280"), "•••• 790280");
  });

  it("truncates labels without exceeding the requested width", () => {
    assert.equal(truncate("Asesor empresarial", 10), "Asesor em…");
  });

  it("renders names, roles and inherited-role labels", () => {
    const output = renderDashboard([{
      id: "1",
      tenantId: "manolo",
      tenantName: "Manolo",
      whatsappUserId: "51923790280",
      displayName: "Diogo",
      effectiveRoleKey: "cat",
      effectiveRoleLabel: "Gato Manolo",
      roleSource: "tenant",
      lastSeenAt: null,
    }], { useColor: false, terminalWidth: 110 });

    assert.match(output, /Diogo/);
    assert.match(output, /Gato Manolo \(base\)/);
    assert.match(output, /VPS PostgreSQL/);
  });

  it("formats recent activity in Spanish", () => {
    assert.equal(
      formatRelativeTime("2026-08-25T10:00:00.000Z", Date.parse("2026-08-25T10:05:00.000Z")),
      "hace 5 min",
    );
  });
});
