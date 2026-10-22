import { desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { BD } from "@/datos/bd";
import { leerConfiguracionCompleta } from "@/datos/configuracion";
import { bitacora } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { guardarConfiguracion } from "./configuracion.nucleo";
import type { Contexto } from "./tipos";

// Plan 7, P7-8: factor de camión, horas pico y umbral de atraso.

const AHORA = new Date("2026-10-15T15:00:00Z");
const base = {
  patioLat: 20.62, patioLng: -100.29, turnoInicio: "08:00", turnoFin: "16:00", velocidadKmh: 30, factorCircuidad: 1.4,
  descargaMin: 20, cargaPorOmisionKg: 1000, diasOperacion: [1, 2, 3, 4, 5, 6], diasParaAtrasada: 2,
  factorCamion: 1.2, umbralAtrasoMin: 15,
  horasPico: [{ inicio: "07:00", fin: "09:30", factor: 1.3 }, { inicio: "13:30", fin: "15:00", factor: 1.15 }],
};

describe("configuración de traslados del Plan 7", () => {
  let bd: BD;
  let admin: UsuarioSesion;
  const ctx = (): Contexto => ({ bd, usuario: admin, ahora: AHORA });
  beforeEach(async () => {
    bd = await crearBdPrueba();
    admin = await usuarioDePrueba(bd, "admin");
  });

  it("guarda factor de camión, horas pico y umbral, y la bitácora nombra los campos sin valores", async () => {
    const cambios = { ...base, factorCamion: 1.35, umbralAtrasoMin: 20, horasPico: [{ inicio: "06:30", fin: "09:00", factor: 1.4 }] };
    expect(await guardarConfiguracion(ctx(), 1, cambios)).toEqual({ ok: true, valor: { version: 2 } });
    const c = await leerConfiguracionCompleta(bd);
    expect(c).toMatchObject({ factorCamion: 1.35, umbralAtrasoMin: 20, horasPico: [{ inicio: "06:30", fin: "09:00", factor: 1.4 }] });
    const [renglon] = await bd.select().from(bitacora).where(eq(bitacora.entidad, "configuracion")).orderBy(desc(bitacora.en)).limit(1);
    expect(renglon.campos).toEqual(expect.arrayContaining(["factorCamion", "horasPico", "umbralAtrasoMin"]));
    expect(JSON.stringify(renglon)).not.toContain("1.35");
  });

  it("acepta los valores iniciales y una lista sin franjas", async () => {
    expect(await guardarConfiguracion(ctx(), 1, base)).toMatchObject({ ok: true });
    expect(await guardarConfiguracion(ctx(), 2, { ...base, horasPico: [] })).toMatchObject({ ok: true });
  });

  it.each([
    ["franjas encimadas", [{ inicio: "07:00", fin: "09:30", factor: 1.3 }, { inicio: "09:00", fin: "10:00", factor: 1.2 }], "Las franjas de hora pico no deben encimarse"],
    ["inicio igual al fin", [{ inicio: "07:00", fin: "07:00", factor: 1.3 }], "Cada franja debe terminar después de empezar"],
    ["fin antes del inicio", [{ inicio: "10:00", fin: "08:00", factor: 1.3 }], "Cada franja debe terminar después de empezar"],
    ["24:00 no es una hora", [{ inicio: "22:00", fin: "24:00", factor: 1.3 }], "Usa el formato HH:MM"],
    ["factor menor que 1", [{ inicio: "07:00", fin: "08:00", factor: 0.9 }], "El factor va de 1 a 3"],
    ["factor mayor que 3", [{ inicio: "07:00", fin: "08:00", factor: 3.5 }], "El factor va de 1 a 3"],
    ["siete franjas", Array.from({ length: 7 }, (_, i) => ({ inicio: `0${i}:00`, fin: `0${i}:30`, factor: 1.1 })), "Máximo 6 franjas"],
  ])("rechaza horas pico con %s", async (_n, horasPico, mensaje) => {
    const r = await guardarConfiguracion(ctx(), 1, { ...base, horasPico });
    expect(r).toMatchObject({ ok: false, error: "invalido" });
    expect(JSON.stringify(r)).toContain(mensaje);
  });

  it("rechaza factor de camión fuera de 1 a 3 y umbral fuera de 1 a 120", async () => {
    for (const factorCamion of [0.9, 3.1]) expect(await guardarConfiguracion(ctx(), 1, { ...base, factorCamion })).toMatchObject({ ok: false, error: "invalido", campos: { factorCamion: expect.any(Array) } });
    for (const umbralAtrasoMin of [0, 121, 7.5]) expect(await guardarConfiguracion(ctx(), 1, { ...base, umbralAtrasoMin })).toMatchObject({ ok: false, error: "invalido", campos: { umbralAtrasoMin: expect.any(Array) } });
  });
});

describe("tolerancia de readmisión del Plan 8", () => {
  let bd: BD;
  let admin: UsuarioSesion;
  const ctx = (): Contexto => ({ bd, usuario: admin, ahora: AHORA });
  beforeEach(async () => {
    bd = await crearBdPrueba();
    admin = await usuarioDePrueba(bd, "admin");
  });

  it("guardarConfiguracion acepta 0 y 60, rechaza 7.5 y 61, y la bitácora nombra toleranciaReadmisionMin sin su valor", async () => {
    expect(await guardarConfiguracion(ctx(), 1, { ...base, toleranciaReadmisionMin: 0 })).toEqual({ ok: true, valor: { version: 2 } });
    expect((await leerConfiguracionCompleta(bd)).toleranciaReadmisionMin).toBe(0);
    expect(await guardarConfiguracion(ctx(), 2, { ...base, toleranciaReadmisionMin: 47 })).toEqual({ ok: true, valor: { version: 3 } });
    const [renglon] = await bd.select().from(bitacora).where(eq(bitacora.entidad, "configuracion")).orderBy(desc(bitacora.en)).limit(1);
    expect(renglon.campos).toEqual(["toleranciaReadmisionMin"]);
    // Sin id, usuario ni fecha, que podrían contener "47" por azar.
    expect(JSON.stringify({ ...renglon, id: null, usuarioId: null, en: null })).not.toContain("47");
    expect(await guardarConfiguracion(ctx(), 3, { ...base, toleranciaReadmisionMin: 60 })).toMatchObject({ ok: true });
    for (const toleranciaReadmisionMin of [7.5, 61, -1]) {
      expect(await guardarConfiguracion(ctx(), 4, { ...base, toleranciaReadmisionMin }))
        .toMatchObject({ ok: false, error: "invalido", campos: { toleranciaReadmisionMin: expect.any(Array) } });
    }
    // Quien no lo envía conserva lo guardado.
    expect(await guardarConfiguracion(ctx(), 4, base)).toMatchObject({ ok: true });
    expect((await leerConfiguracionCompleta(bd)).toleranciaReadmisionMin).toBe(60);
  });
});
