import { describe, expect, it, vi } from "vitest";
import { TenderTitles } from "../src/node/portal/tender-titles";

const cement = "ADQUISICIÓN DE CEMENTO PORTLAND TIPO I (42.5 KG) PARA EL POLIDEPORTIVO";
const concrete = "SUMINISTRO DE CONCRETO PREMEZCLADO PARA LA PAVIMENTACIÓN";

describe("Tender Cat display titles", () => {
  it("matches by key, shares concurrent generation and refreshes edited descriptions", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({
      "1": "Concreto premezclado para pavimentación", "0": "Cemento Portland tipo I de 42,5 kg para el polideportivo",
    }));
    const titles = new TenderTitles({ complete }, vi.fn());
    const [both, first] = await Promise.all([titles.forDescriptions([cement, concrete]), titles.forDescriptions([cement])]);
    expect(both).toEqual(["Cemento Portland tipo I de 42,5 kg para el polideportivo", "Concreto premezclado para pavimentación"]);
    expect(first).toEqual(both.slice(0, 1));
    expect(complete).toHaveBeenCalledTimes(1);
    await titles.forDescriptions([cement.replace("TIPO I", "TIPO IP")]);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("falls back on invented numbers, missing titles and unavailable AI", async () => {
    const complete = vi.fn().mockResolvedValueOnce('{"0":"Cemento de 50 kg"}').mockRejectedValueOnce(new Error("timeout"));
    const titles = new TenderTitles({ complete }, vi.fn());
    const result = await titles.forDescriptions([cement, concrete]);
    expect(result[0]).toContain("42.5");
    expect(result[0]).not.toContain("50");
    expect(result[1]).toMatch(/^Concreto/i);
    expect(await titles.forDescriptions(["IMPRESIÓN DE AFICHES"])).toEqual(["Impresión de afiches"]);
  });
});
