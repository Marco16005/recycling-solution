import { expect, it } from "vitest";
import { fechaEnMexico } from "./tiempo";

it("usa la fecha de Ciudad de México, no la de UTC", () => {
  // 03:00 UTC del día 8 son las 21:00 del día 7 en Ciudad de México (UTC−6)
  expect(fechaEnMexico(new Date("2026-10-08T03:00:00Z"))).toBe("2026-10-07");
  expect(fechaEnMexico(new Date("2026-10-08T18:00:00Z"))).toBe("2026-10-08");
});
