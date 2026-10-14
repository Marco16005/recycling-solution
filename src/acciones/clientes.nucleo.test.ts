import { beforeEach, describe, expect, it } from "vitest";
import type { BD } from "@/datos/bd";
import { bitacora, clientes, documentosCliente, ventanasCliente } from "@/datos/esquema";
import { leerCliente } from "@/datos/clientes";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { clienteDePrueba } from "@/datos/pruebas/datos-ejemplo";
import { hacerFallarBitacora, usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { guardarCliente, registrarPrivacidad } from "./clientes.nucleo";
import type { Contexto } from "./tipos";

const AHORA = new Date("2026-10-13T15:00:00Z");
const NO_EXISTE = "00000000-0000-4000-8000-000000000000";

describe("acciones de clientes", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion | null): Contexto => ({ bd, usuario, ahora: AHORA });

  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
  });

  async function crear(cambios = {}) {
    const r = await guardarCliente(ctx(despachador), null, null, clienteDePrueba(cambios));
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.valor;
  }

  describe("permisos", () => {
    it("sin sesión, inactivo, operador y gerencia no pueden guardar ni registrar privacidad", async () => {
      const { id } = await crear();
      const casos: [UsuarioSesion | null, string][] = [
        [null, "no_autenticado"],
        [await usuarioDePrueba(bd, "despachador", false), "no_autenticado"],
        [await usuarioDePrueba(bd, "operador"), "no_autorizado"],
        [await usuarioDePrueba(bd, "gerencia"), "no_autorizado"],
      ];
      for (const [usuario, error] of casos) {
        expect(await guardarCliente(ctx(usuario), null, null, clienteDePrueba())).toEqual({ ok: false, error });
        expect(await registrarPrivacidad(ctx(usuario), id, { accion: "aceptado", medio: "papel", versionAviso: "2026-10", movimientoAnteriorId: null })).toEqual({ ok: false, error });
      }
      expect(await bd.select().from(clientes)).toHaveLength(1);
    });

    it("admin sí puede", async () => {
      const admin = await usuarioDePrueba(bd, "admin");
      expect((await guardarCliente(ctx(admin), null, null, clienteDePrueba())).ok).toBe(true);
    });
  });

  describe("guardarCliente", () => {
    it("crea con versión 1 y la bitácora solo guarda nombres de campos", async () => {
      const { id, version } = await crear();
      expect(version).toBe(1);
      const eventos = await bd.select().from(bitacora);
      expect(eventos).toEqual([expect.objectContaining({ usuarioId: despachador.id, entidad: "cliente", entidadId: id, accion: "crear" })]);
      expect(eventos[0].campos).toContain("contactoTelefono");
      const texto = JSON.stringify(eventos);
      for (const valor of ["Laura Méndez", "442 555 0101", "Cartonera del Bajío", "Av. del Marqués"]) expect(texto).not.toContain(valor);
    });

    it("actualiza con la versión correcta y registra solo lo que cambió", async () => {
      const { id } = await crear();
      const r = await guardarCliente(ctx(despachador), id, 1, clienteDePrueba({ nombre: "Cartonera del Bajío Norte" }));
      expect(r).toEqual({ ok: true, valor: { id, version: 2 } });
      const [, actualizacion] = await bd.select().from(bitacora).orderBy(bitacora.en, bitacora.accion);
      expect(actualizacion).toMatchObject({ accion: "actualizar", campos: ["nombre"] });
    });

    it("con una versión vieja responde conflicto y no cambia nada", async () => {
      const { id } = await crear();
      await guardarCliente(ctx(despachador), id, 1, clienteDePrueba({ nombre: "Primero" }));
      expect(await guardarCliente(ctx(despachador), id, 1, clienteDePrueba({ nombre: "Segundo" }))).toEqual({ ok: false, error: "conflicto" });
      expect(await leerCliente(bd, id)).toMatchObject({ nombre: "Primero", version: 2 });
    });

    it("valida id, versión y entrada", async () => {
      const { id } = await crear();
      expect(await guardarCliente(ctx(despachador), "no-es-uuid", 1, clienteDePrueba())).toEqual({ ok: false, error: "no_encontrado" });
      expect(await guardarCliente(ctx(despachador), NO_EXISTE, 1, clienteDePrueba())).toEqual({ ok: false, error: "no_encontrado" });
      expect(await guardarCliente(ctx(despachador), null, 3, clienteDePrueba())).toMatchObject({ ok: false, error: "invalido" });
      expect(await guardarCliente(ctx(despachador), id, null, clienteDePrueba())).toMatchObject({ ok: false, error: "invalido" });
      expect(await guardarCliente(ctx(despachador), id, 1, "texto")).toMatchObject({ ok: false, error: "invalido" });
      expect(await guardarCliente(ctx(despachador), null, null, { ...clienteDePrueba(), nombre: "" })).toMatchObject({
        ok: false,
        error: "invalido",
        campos: { nombre: expect.any(Array) },
      });
    });

    it("si falla la bitácora no queda ni cliente ni ventanas ni documentos", async () => {
      await hacerFallarBitacora(bd);
      await expect(guardarCliente(ctx(despachador), null, null, clienteDePrueba())).rejects.toThrow();
      for (const tabla of [clientes, ventanasCliente, documentosCliente]) expect(await bd.select().from(tabla)).toEqual([]);
    });
  });

  describe("registrarPrivacidad", () => {
    const aceptar = (movimientoAnteriorId: string | null, versionAviso = "2026-10") => ({ accion: "aceptado", medio: "papel", versionAviso, movimientoAnteriorId });

    it("registra el movimiento con la versión vigente y quién lo hizo", async () => {
      const { id } = await crear();
      const r = await registrarPrivacidad(ctx(despachador), id, aceptar(null));
      expect(r).toMatchObject({ ok: true, valor: { privacidad: { accion: "aceptado", versionAviso: "2026-10", medio: "papel" } } });
      expect((await leerCliente(bd, id))?.privacidad?.accion).toBe("aceptado");
      expect(await bd.select().from(bitacora)).toContainEqual(expect.objectContaining({ accion: "privacidad_aceptado", campos: ["privacidad"] }));
    });

    it("responde conflicto si otro registró antes o si la versión del aviso cambió", async () => {
      const { id } = await crear();
      const primero = await registrarPrivacidad(ctx(despachador), id, aceptar(null));
      if (!primero.ok) throw new Error("debió registrar");
      expect(await registrarPrivacidad(ctx(despachador), id, aceptar(null))).toEqual({ ok: false, error: "conflicto" });
      expect(await registrarPrivacidad(ctx(despachador), id, aceptar(primero.valor.privacidad.id, "2025-01"))).toEqual({ ok: false, error: "conflicto" });
      const retiro = { ...aceptar(primero.valor.privacidad.id), accion: "retirado" };
      expect((await registrarPrivacidad(ctx(despachador), id, retiro)).ok).toBe(true);
    });

    it("valida el cliente y la entrada", async () => {
      expect(await registrarPrivacidad(ctx(despachador), NO_EXISTE, aceptar(null))).toEqual({ ok: false, error: "no_encontrado" });
      expect(await registrarPrivacidad(ctx(despachador), "x", aceptar(null))).toEqual({ ok: false, error: "no_encontrado" });
      const { id } = await crear();
      expect(await registrarPrivacidad(ctx(despachador), id, { accion: "quizá" })).toMatchObject({ ok: false, error: "invalido" });
    });
  });
});
