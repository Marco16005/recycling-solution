import { beforeEach, describe, expect, it } from "vitest";
import type { BD } from "./bd";
import { actualizarClienteSiVersion, insertarCliente, leerCartera, leerCliente, nombresDeCartera } from "./clientes";
import { leerConfiguracion } from "./configuracion";
import { insertarMovimientoPrivacidad, ultimoMovimientoPrivacidad } from "./privacidad";
import { crearBdPrueba } from "./pruebas/bd-prueba";
import { clienteDePrueba } from "./pruebas/datos-ejemplo";

const AHORA = new Date("2026-10-13T15:00:00Z");

describe("repositorio de clientes", () => {
  let bd: BD;
  beforeEach(async () => {
    bd = await crearBdPrueba();
  });

  it("guarda y lee un cliente con ventanas y documentos; empieza en la versión 1", async () => {
    const { id, version } = await bd.transaction((tx) => insertarCliente(tx, clienteDePrueba(), AHORA));
    expect(version).toBe(1);
    const leido = await leerCliente(bd, id);
    expect(leido).toMatchObject({ id, version: 1, nombre: "Cartonera del Bajío", privacidad: null });
    expect(leido?.ventanas).toEqual([{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }]);
    expect(leido?.documentos).toEqual([{ nombre: "SUA vigente", obligatorio: true, estado: "vigente", venceEl: "2026-12-31" }]);
  });

  it("actualiza solo con la versión esperada y sube la versión", async () => {
    const { id } = await bd.transaction((tx) => insertarCliente(tx, clienteDePrueba(), AHORA));
    const cambio = clienteDePrueba({ nombre: "Cartonera del Bajío Norte", ventanas: [] });
    expect(await bd.transaction((tx) => actualizarClienteSiVersion(tx, id, 1, cambio, AHORA))).toEqual({ estado: "actualizado", version: 2 });
    expect(await bd.transaction((tx) => actualizarClienteSiVersion(tx, id, 1, cambio, AHORA))).toEqual({ estado: "conflicto" });
    expect(
      await bd.transaction((tx) => actualizarClienteSiVersion(tx, "00000000-0000-4000-8000-000000000000", 1, cambio, AHORA)),
    ).toEqual({ estado: "no_encontrado" });
    const leido = await leerCliente(bd, id);
    expect(leido).toMatchObject({ version: 2, nombre: "Cartonera del Bajío Norte", ventanas: [] });
  });

  it("el último movimiento de privacidad es el de mayor secuencia, aunque tengan el mismo instante", async () => {
    const { id } = await bd.transaction((tx) => insertarCliente(tx, clienteDePrueba(), AHORA));
    const { versionAvisoPrivacidad } = await leerConfiguracion(bd);
    const base = { clienteId: id, versionAviso: versionAvisoPrivacidad, medio: "papel" as const, registradoPor: null, en: AHORA };
    await bd.transaction((tx) => insertarMovimientoPrivacidad(tx, { ...base, accion: "aceptado" }));
    const retiro = await bd.transaction((tx) => insertarMovimientoPrivacidad(tx, { ...base, accion: "retirado" }));
    expect(await ultimoMovimientoPrivacidad(bd, id)).toEqual(retiro);
    expect((await leerCliente(bd, id))?.privacidad).toEqual(retiro);
  });

  it("la cartera trae a todos, ordenados por nombre, cada uno con lo suyo", async () => {
    await bd.transaction((tx) => insertarCliente(tx, clienteDePrueba({ nombre: "Zeta Papel", documentos: [] }), AHORA));
    await bd.transaction((tx) => insertarCliente(tx, clienteDePrueba({ nombre: "Alfa Cartón" }), AHORA));
    const cartera = await leerCartera(bd);
    expect(cartera.map((c) => c.nombre)).toEqual(["Alfa Cartón", "Zeta Papel"]);
    expect(cartera.map((c) => c.documentos.length)).toEqual([1, 0]);
    expect((await nombresDeCartera(bd)).map((c) => c.nombre)).toEqual(["Alfa Cartón", "Zeta Papel"]);
  });

  it("la configuración inicial existe con la versión del aviso", async () => {
    expect(await leerConfiguracion(bd)).toEqual({ versionAvisoPrivacidad: "2026-10" });
  });
});
