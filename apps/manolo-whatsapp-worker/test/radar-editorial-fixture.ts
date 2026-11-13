import type { RadarAlertWriter } from "../src/radar/presentation";

/** Deterministic provider stub for transport/consent tests, never used by production. */
export const editorialWriter: RadarAlertWriter = {
  draft: async alert => `Buscan ${alert.description.toLocaleLowerCase("es")}.`,
};
