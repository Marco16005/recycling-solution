import { beforeEach, describe, expect, it } from "vitest";
import { listarOperadores, listarUnidades, obtenerOperador } from "@/consultas/flota.nucleo";
import { obtenerJornada } from "@/consultas/jornada.nucleo";
import type { BD } from "@/datos/bd";
import { bitacora } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { operadorDePrueba, unidadDePrueba } from "@/datos/pruebas/flota-ejemplo";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { guardarOperador, guardarUnidad, registrarEntregaAviso } from "./flota.nucleo";
import { asignarJornada, quitarJornada } from "./jornada.nucleo";
import type { Contexto } from "./tipos";

const AHORA = new Date("2026-10-14T15:00:00Z");

describe("flota y jornada", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion | null = despachador): Contexto => ({ bd, usuario, ahora: AHORA });

  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
  });

  async function unidad(cambios = {}) {
    const r = await guardarUnidad(ctx(), null, null, unidadDePrueba(cambios));
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.valor;
  }
  async function operadorConAviso(cambios = {}) {
    const r = await guardarOperador(ctx(), null, null, operadorDePrueba(cambios));
    if (!r.ok) throw new Error(JSON.stringify(r));
    const aviso = await registrarEntregaAviso(ctx(), r.valor.id, r.valor.version);
    if (!aviso.ok) throw new Error(JSON.stringify(aviso));
    return { id: r.valor.id, version: aviso.valor.version };
  }

  it("gerencia consulta la flota pero no la edita; operador ni la consulta", async () => {
    const gerencia = await usuarioDePrueba(bd, "gerencia");
    expect(await guardarUnidad(ctx(gerencia), null, null, unidadDePrueba())).toEqual({ ok: false, error: "no_autorizado" });
    expect(await listarUnidades(ctx(gerencia), {})).toMatchObject({ ok: true, valor: { puedeEditar: false } });
    expect(await listarUnidades(ctx(await usuarioDePrueba(bd, "operador")), {})).toEqual({ ok: false, error: "no_autorizado" });
  });

  it("una unidad sin un documento obligatorio aparece no disponible con el motivo", async () => {
    await unidad({ placa: "SIN-DOC 1", documentos: unidadDePrueba().documentos.slice(1) });
    const r = await listarUnidades(ctx(), {});
    if (!r.ok) throw new Error("debió listar");
    expect(r.valor.unidades[0]).toMatchObject({ placa: "SINDOC1", motivos: [{ codigo: "documento_faltante" }] });
  });

  it("rechaza placa repetida, tipos de documento de otra entidad y versiones viejas; deja bitácora", async () => {
    const { id } = await unidad();
    expect(await guardarUnidad(ctx(), null, null, unidadDePrueba({ placa: "qro-1234" }))).toMatchObject({ ok: false, error: "invalido", campos: { placa: expect.any(Array) } });
    const ajeno = unidadDePrueba({ placa: "OTRA1", documentos: [{ tipoDocumentoId: "licencia_conducir", obligatorio: true, estado: "vigente", venceEl: "2027-01-01", notas: null }] });
    expect(await guardarUnidad(ctx(), null, null, ajeno)).toMatchObject({ ok: false, error: "invalido", campos: { documentos: expect.any(Array) } });
    expect(await guardarUnidad(ctx(), id, 1, unidadDePrueba({ capacidadKg: 9000 }))).toEqual({ ok: true, valor: { id, version: 2 } });
    expect(await guardarUnidad(ctx(), id, 1, unidadDePrueba({ capacidadKg: 7000 }))).toEqual({ ok: false, error: "conflicto" });
    const eventos = await bd.select().from(bitacora);
    expect(eventos.map((e) => [e.entidad, e.accion])).toEqual([["unidad", "crear"], ["unidad", "actualizar"]]);
    expect(eventos[1].campos).toEqual(["capacidadKg"]);
  });

  it("un operador sin aviso entregado no está disponible; al entregarlo sí", async () => {
    const r = await guardarOperador(ctx(), null, null, operadorDePrueba());
    if (!r.ok) throw new Error("alta");
    const antes = await obtenerOperador(ctx(), r.valor.id);
    expect(antes.ok && antes.valor.operador.motivos.map((m) => m.codigo)).toEqual(["aviso_no_entregado"]);
    await registrarEntregaAviso(ctx(), r.valor.id, r.valor.version);
    const despues = await listarOperadores(ctx(), {});
    expect(despues.ok && despues.valor.operadores[0]).toMatchObject({ motivos: [], avisoVersion: "2026-10" });
  });

  it("la jornada solo acepta unidades y operadores disponibles, una vez por día", async () => {
    const u = await unidad();
    const o = await operadorConAviso();
    const bloqueada = await unidad({ placa: "BLOQ1", documentos: [] });
    const base = { fecha: "2026-10-15", disponibleDesde: "08:00", notas: null };

    expect(await asignarJornada(ctx(), { ...base, unidadId: bloqueada.id, operadorId: o.id })).toMatchObject({ ok: false, error: "invalido", campos: { unidadId: expect.any(Array) } });
    const asignada = await asignarJornada(ctx(), { ...base, unidadId: u.id, operadorId: o.id });
    expect(asignada.ok).toBe(true);
    expect(await asignarJornada(ctx(), { ...base, unidadId: u.id, operadorId: o.id })).toMatchObject({ ok: false, error: "invalido" });

    const vista = await obtenerJornada(ctx(), "2026-10-15");
    if (!vista.ok) throw new Error("vista");
    expect(vista.valor.jornadas).toHaveLength(1);
    expect(vista.valor.unidadesLibres).toEqual([]);
    expect(vista.valor.noDisponibles.map((n) => n.nombre)).toEqual(["BLOQ1"]);

    const jornada = vista.valor.jornadas[0];
    expect(await quitarJornada(ctx(), jornada.id, jornada.version + 1)).toEqual({ ok: false, error: "conflicto" });
    expect(await quitarJornada(ctx(), jornada.id, jornada.version)).toEqual({ ok: true, valor: null });
  });

  it("gerencia ve la jornada pero no la gestiona", async () => {
    const gerencia = await usuarioDePrueba(bd, "gerencia");
    expect(await obtenerJornada(ctx(gerencia), undefined)).toMatchObject({ ok: true, valor: { fecha: "2026-10-14", puedeGestionar: false } });
    expect(await asignarJornada(ctx(gerencia), {})).toEqual({ ok: false, error: "no_autorizado" });
  });
});
