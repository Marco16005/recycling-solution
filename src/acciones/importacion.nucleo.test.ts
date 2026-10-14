import { beforeEach, describe, expect, it } from "vitest";
import type { BD } from "@/datos/bd";
import { bitacora, clientes, importaciones } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { clienteDePrueba } from "@/datos/pruebas/datos-ejemplo";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { guardarCliente } from "./clientes.nucleo";
import { analizarImportacion, confirmarImportacion } from "./importacion.nucleo";
import type { Contexto } from "./tipos";

const AHORA = new Date("2026-10-13T15:00:00Z");
const ENCABEZADO = "nombre,contacto,telefono,direccion,lat,lng,residuo,material,servicio_min,carga_kg";
const CSV_VALIDO = [ENCABEZADO, "Papelera Uno,Ana,4425550101,Calle 1,20.61,-100.28,RME,Cartón,60,900", "Cajas Dos,,,,,,RSU,,,"].join("\n");
const CSV_CON_ERROR = [ENCABEZADO, "Papelera Uno,,,,,,RME,,,", "X,,,,,,,,,"].join("\n");
const operacion = () => crypto.randomUUID();

describe("importación de clientes en dos pasos", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion | null = despachador): Contexto => ({ bd, usuario, ahora: AHORA });

  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
  });

  async function analizar(csv: string) {
    const r = await analizarImportacion(ctx(), csv);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.valor;
  }

  it("sin sesión, inactivo, operador y gerencia no pueden analizar ni confirmar", async () => {
    const casos: [UsuarioSesion | null, string][] = [
      [null, "no_autenticado"],
      [await usuarioDePrueba(bd, "despachador", false), "no_autenticado"],
      [await usuarioDePrueba(bd, "operador"), "no_autorizado"],
      [await usuarioDePrueba(bd, "gerencia"), "no_autorizado"],
    ];
    for (const [usuario, error] of casos) {
      expect(await analizarImportacion(ctx(usuario), CSV_VALIDO)).toEqual({ ok: false, error });
      expect(await confirmarImportacion(ctx(usuario), CSV_VALIDO, { operacionId: operacion(), huella: "h", aceptarDuplicados: false })).toEqual({ ok: false, error });
    }
  });

  it("rechaza entradas que no son texto u opciones incompletas", async () => {
    expect(await analizarImportacion(ctx(), { archivo: 1 })).toMatchObject({ ok: false, error: "invalido", campos: { archivo: expect.any(Array) } });
    expect(await confirmarImportacion(ctx(), 42, {})).toMatchObject({ ok: false, error: "invalido" });
    expect(await confirmarImportacion(ctx(), CSV_VALIDO, { operacionId: "x" })).toMatchObject({ ok: false, error: "invalido" });
  });

  it("analizar resume el archivo y no escribe nada", async () => {
    const resumen = await analizar(CSV_CON_ERROR);
    expect(resumen).toMatchObject({ registros: 2, validas: 1, muestra: [{ fila: 2, nombre: "Papelera Uno" }] });
    expect(resumen.errores).toEqual([expect.objectContaining({ fila: 3 })]);
    expect(await bd.select().from(clientes)).toEqual([]);
  });

  it("con un error en el archivo no importa ninguna fila", async () => {
    const { huella } = await analizar(CSV_CON_ERROR);
    const r = await confirmarImportacion(ctx(), CSV_CON_ERROR, { operacionId: operacion(), huella, aceptarDuplicados: false });
    expect(r).toMatchObject({ ok: false, error: "invalido", campos: { archivo: [expect.stringMatching(/^Fila 3/)] } });
    expect(await bd.select().from(clientes)).toEqual([]);
  });

  it("importa todo el archivo válido con una bitácora por cliente y el registro de la importación", async () => {
    const { huella } = await analizar(CSV_VALIDO);
    const operacionId = operacion();
    expect(await confirmarImportacion(ctx(), CSV_VALIDO, { operacionId, huella, aceptarDuplicados: false })).toEqual({ ok: true, valor: { importados: 2 } });
    expect(await bd.select().from(clientes)).toHaveLength(2);
    expect((await bd.select().from(bitacora)).filter((e) => e.accion === "importar")).toHaveLength(2);
    expect(await bd.select().from(importaciones)).toEqual([expect.objectContaining({ id: operacionId, importados: 2, usuarioId: despachador.id })]);
  });

  it("repetir la misma operación devuelve el mismo resultado sin duplicar", async () => {
    const { huella } = await analizar(CSV_VALIDO);
    const opciones = { operacionId: operacion(), huella, aceptarDuplicados: false };
    await confirmarImportacion(ctx(), CSV_VALIDO, opciones);
    expect(await confirmarImportacion(ctx(), CSV_VALIDO, opciones)).toEqual({ ok: true, valor: { importados: 2 } });
    expect(await bd.select().from(clientes)).toHaveLength(2);
  });

  it("los posibles duplicados exigen aceptación explícita", async () => {
    await guardarCliente(ctx(), null, null, clienteDePrueba({ nombre: "PAPELERA  uno" }));
    const resumen = await analizar(CSV_VALIDO);
    expect(resumen.posiblesDuplicados).toEqual([expect.objectContaining({ fila: 2, con: "cartera", nombreExistente: "PAPELERA  uno" })]);
    const sinAceptar = await confirmarImportacion(ctx(), CSV_VALIDO, { operacionId: operacion(), huella: resumen.huella, aceptarDuplicados: false });
    expect(sinAceptar).toMatchObject({ ok: false, error: "invalido", campos: { duplicados: [expect.stringMatching(/^Fila 2/)] } });
    const aceptando = await confirmarImportacion(ctx(), CSV_VALIDO, { operacionId: operacion(), huella: resumen.huella, aceptarDuplicados: true });
    expect(aceptando).toEqual({ ok: true, valor: { importados: 2 } });
  });

  it("si la cartera cambió entre analizar y confirmar, responde conflicto", async () => {
    const { huella } = await analizar(CSV_VALIDO);
    await guardarCliente(ctx(), null, null, clienteDePrueba({ nombre: "Cajas Dos" }));
    expect(await confirmarImportacion(ctx(), CSV_VALIDO, { operacionId: operacion(), huella, aceptarDuplicados: true })).toEqual({ ok: false, error: "conflicto" });
    expect(await bd.select().from(clientes)).toHaveLength(1);
  });
});
