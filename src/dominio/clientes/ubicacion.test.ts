import { describe, expect, it } from "vitest";
import { leerUbicacion } from "./ubicacion";

describe("leerUbicacion (Plan CRM, §4.2)", () => {
  it.each([
    ["20.62, -100.30"],
    ["20.62,-100.3"],
    ["https://maps.google.com/?q=20.62,-100.3"],
    ["Mi ubicación: https://maps.google.com/?q=20.62,-100.3 (WhatsApp)"],
    ["https://www.google.com/maps/@20.62,-100.3,17z"],
    ["https://www.google.com/maps/search/?api=1&query=20.62%2C-100.3"],
    ["https://www.google.com/maps/place/Cartonera/data=!4m6!3m5!1s0x0:0x0!8m2!3d20.62!4d-100.3"],
    ["https://maps.apple.com/?ll=20.62,-100.3&q=Cartonera"],
    ["geo:20.62,-100.3"],
  ])("reconoce %s", (texto) => expect(leerUbicacion(texto)).toEqual({ ok: true, lat: 20.62, lng: -100.3 }));

  it("con @ y !3d, manda la del lugar (!3d!4d)", () =>
    expect(leerUbicacion("https://www.google.com/maps/place/X/@20.70,-100.40,15z/data=!3d20.62!4d-100.3")).toEqual({ ok: true, lat: 20.62, lng: -100.3 }));

  it.each(["https://maps.app.goo.gl/abc123", "https://goo.gl/maps/abc123"])("marca %s como enlace corto", (texto) =>
    expect(leerUbicacion(texto)).toMatchObject({ ok: false, motivo: "enlace_corto" }));

  it("fuera de México", () => expect(leerUbicacion("40.4,-3.7")).toMatchObject({ ok: false, motivo: "fuera_de_mexico" }));

  it("un enlace de lugar sin coordenadas explica cómo copiarlas", () => {
    const r = leerUbicacion("https://www.google.com/maps/place/Cartonera+del+Bajio");
    expect(r).toMatchObject({ ok: false, motivo: "no_reconocido" });
    if (!r.ok) expect(r.mensaje).toContain("Compartir");
  });

  it.each(["", "hola", "20.62", "999,999"])("no reconoce %s", (texto) => expect(leerUbicacion(texto).ok).toBe(false));
});
