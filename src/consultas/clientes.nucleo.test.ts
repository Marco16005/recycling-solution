import { beforeEach, describe, expect, it } from "vitest";
import { guardarCliente, registrarPrivacidad } from "@/acciones/clientes.nucleo";
import type { Contexto } from "@/acciones/tipos";
import type { BD } from "@/datos/bd";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { clienteDePrueba } from "@/datos/pruebas/datos-ejemplo";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { listarClientes, obtenerContextoAlta, obtenerFicha } from "./clientes.nucleo";

// Martes 13 de octubre de 2026, 9:00 en Ciudad de México.
const AHORA = new Date("2026-10-13T15:00:00Z");

describe("consultas de clientes", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  let completoId: string;
  const ctx = (usuario: UsuarioSesion | null = despachador): Contexto => ({ bd, usuario, ahora: AHORA });

  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
    const completo = await guardarCliente(ctx(), null, null, clienteDePrueba({ nombre: "Cartonera Núñez", ventanas: [{ diaSemana: 2, horaInicio: "08:00", horaFin: "12:00" }] }));
    if (!completo.ok) throw new Error("alta");
    completoId = completo.valor.id;
    await registrarPrivacidad(ctx(), completoId, { accion: "aceptado", medio: "papel", versionAviso: "2026-10", movimientoAnteriorId: null });
    await guardarCliente(ctx(), null, null, clienteDePrueba({ nombre: "Papelera Sin Aviso" }));
  });

  it("lista con faltantes y motivos de hoy; K5 sobre toda la cartera aunque haya búsqueda", async () => {
    const todos = await listarClientes(ctx(), {});
    if (!todos.ok) throw new Error("debió listar");
    expect(todos.valor).toMatchObject({ fecha: "2026-10-13", k5: { activos: 2, completos: 1, porcentaje: 50 }, puedeEditar: true });
    const completo = todos.valor.clientes.find((c) => c.id === completoId)!;
    expect(completo).toMatchObject({ completo: true, faltantes: [], motivosHoy: [] });
    const sinAviso = todos.valor.clientes.find((c) => c.nombre === "Papelera Sin Aviso")!;
    expect(sinAviso.faltantes).toEqual(["aviso_privacidad"]);
    expect(sinAviso.motivosHoy.map((m) => m.codigo)).toEqual(["sin_aviso_privacidad", "sin_ventana_ese_dia"]);

    const filtrado = await listarClientes(ctx(), { texto: "nunez" });
    if (!filtrado.ok) throw new Error("debió listar");
    expect(filtrado.valor.clientes.map((c) => c.nombre)).toEqual(["Cartonera Núñez"]);
    expect(filtrado.valor.k5).toEqual(todos.valor.k5);
  });

  it("gerencia consulta sin poder editar; operador y sin sesión no", async () => {
    const gerencia = await usuarioDePrueba(bd, "gerencia");
    expect(await listarClientes(ctx(gerencia), {})).toMatchObject({ ok: true, valor: { puedeEditar: false } });
    expect(await obtenerFicha(ctx(gerencia), completoId)).toMatchObject({ ok: true, valor: { puedeEditar: false } });
    expect(await obtenerContextoAlta(ctx(gerencia))).toEqual({ ok: false, error: "no_autorizado" });
    expect(await listarClientes(ctx(await usuarioDePrueba(bd, "operador")), {})).toEqual({ ok: false, error: "no_autorizado" });
    expect(await listarClientes(ctx(null), {})).toEqual({ ok: false, error: "no_autenticado" });
    expect(await obtenerFicha(ctx(await usuarioDePrueba(bd, "gerencia", false)), completoId)).toEqual({ ok: false, error: "no_autenticado" });
  });

  it("la ficha trae al cliente con su privacidad, la versión vigente y el estilo del mapa", async () => {
    const ficha = await obtenerFicha(ctx(), completoId);
    expect(ficha).toMatchObject({
      ok: true,
      valor: { cliente: { id: completoId, version: 1, privacidad: { accion: "aceptado" } }, faltantes: [], versionAvisoVigente: "2026-10", puedeEditar: true },
    });
    expect(ficha.ok && ficha.valor.estiloMapaUrl).toMatch(/^https:\/\//);
    expect(await obtenerFicha(ctx(), "no-es-uuid")).toEqual({ ok: false, error: "no_encontrado" });
    expect(await obtenerFicha(ctx(), "00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "no_encontrado" });
  });

  it("el contexto de alta da la versión del aviso al despachador", async () => {
    expect(await obtenerContextoAlta(ctx())).toMatchObject({ ok: true, valor: { versionAvisoVigente: "2026-10" } });
  });

  it("rechaza filtros mal formados", async () => {
    expect(await listarClientes(ctx(), { texto: 5 })).toMatchObject({ ok: false, error: "invalido" });
  });
});
