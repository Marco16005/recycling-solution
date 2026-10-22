import { beforeEach, describe, expect, it } from "vitest";
import { buscarClientesParaSolicitud, colaDeSolicitudes } from "@/consultas/solicitudes.nucleo";
import type { BD } from "@/datos/bd";
import { solicitudes } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { clienteDePrueba } from "@/datos/pruebas/datos-ejemplo";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { guardarCliente, registrarPrivacidad } from "./clientes.nucleo";
import { cancelarSolicitud, registrarSolicitud, reprogramarSolicitud } from "./solicitudes.nucleo";
import type { Contexto } from "./tipos";

// Miércoles 14 de octubre de 2026, 9:00 en Ciudad de México.
const AHORA = new Date("2026-10-14T15:00:00Z");

describe("solicitudes", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  let clienteId: string;
  const ctx = (usuario: UsuarioSesion | null = despachador, ahora = AHORA): Contexto => ({ bd, usuario, ahora });
  const entrada = (cambios = {}) => ({ clienteId, fechaSolicitada: "2026-10-14", canal: "telefono", cargaEstimadaKg: null, notas: null, capturaInicioEn: new Date("2026-10-14T14:59:30Z"), ...cambios });

  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
    const c = await guardarCliente(ctx(), null, null, clienteDePrueba({ ventanas: [{ diaSemana: 3, horaInicio: "08:00", horaFin: "12:00" }] }));
    if (!c.ok) throw new Error("cliente");
    clienteId = c.valor.id;
  });

  it("registra con folio consecutivo del día y guarda inicio y fin de captura", async () => {
    expect(await registrarSolicitud(ctx(), entrada())).toMatchObject({ ok: true, valor: { folio: "S-20261014-001" } });
    // Otra fecha: para la misma, el cliente ya tiene una abierta (Plan CRM).
    expect(await registrarSolicitud(ctx(), entrada({ fechaSolicitada: "2026-10-15" }))).toMatchObject({ ok: true, valor: { folio: "S-20261014-002" } });
    const [s] = await bd.select().from(solicitudes).limit(1);
    expect(s).toMatchObject({ registradaEn: AHORA, capturaFinEn: AHORA, proximaFechaElegible: "2026-10-14", registradaPor: despachador.id });
  });

  it("rechaza fechas pasadas, clientes inactivos o inexistentes y roles sin permiso", async () => {
    expect(await registrarSolicitud(ctx(), entrada({ fechaSolicitada: "2026-10-13" }))).toMatchObject({ ok: false, error: "invalido", campos: { fechaSolicitada: expect.any(Array) } });
    expect(await registrarSolicitud(ctx(), entrada({ clienteId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, error: "invalido", campos: { clienteId: expect.any(Array) } });
    const gerencia = await usuarioDePrueba(bd, "gerencia");
    expect(await registrarSolicitud(ctx(gerencia), entrada())).toEqual({ ok: false, error: "no_autorizado" });
    expect(await colaDeSolicitudes(ctx(gerencia), undefined)).toMatchObject({ ok: true, valor: { puedeRegistrar: false } });
  });

  it("la cola muestra bloqueada por el aviso y lista al registrarlo, sin cambiar su hora de registro", async () => {
    await registrarSolicitud(ctx(), entrada());
    const antes = await colaDeSolicitudes(ctx(), undefined);
    if (!antes.ok) throw new Error("cola");
    expect(antes.valor.elementos[0]).toMatchObject({ estado: "bloqueada", motivos: [{ codigo: "sin_aviso_privacidad" }] });
    await registrarPrivacidad(ctx(), clienteId, { accion: "aceptado", medio: "papel", versionAviso: "2026-10", movimientoAnteriorId: null });
    const despues = await colaDeSolicitudes(ctx(), undefined);
    if (!despues.ok) throw new Error("cola");
    expect(despues.valor.elementos[0]).toMatchObject({ estado: "lista", motivos: [], solicitud: { registradaEn: AHORA } });
    expect(despues.valor.resumen).toEqual({ listas: 1, bloqueadas: 0, atrasadas: 0, futuras: 0 });
  });

  it("dos días de operación después, la solicitud aparece atrasada", async () => {
    await registrarSolicitud(ctx(), entrada());
    const viernes = new Date("2026-10-16T15:00:00Z");
    const cola = await colaDeSolicitudes(ctx(despachador, viernes), undefined);
    expect(cola.ok && cola.valor.elementos[0]).toMatchObject({ diasDeAtraso: 2, atrasada: true });
  });

  it("cancelar y reprogramar solo pendientes, con versión, sin tocar la hora de registro", async () => {
    const r = await registrarSolicitud(ctx(), entrada());
    if (!r.ok) throw new Error("alta");
    expect(await reprogramarSolicitud(ctx(), r.valor.id, 1, "2026-10-20")).toEqual({ ok: true, valor: null });
    expect(await cancelarSolicitud(ctx(), r.valor.id, 1, "Cliente llamó")).toEqual({ ok: false, error: "conflicto" });
    expect(await cancelarSolicitud(ctx(), r.valor.id, 2, "x")).toMatchObject({ ok: false, error: "invalido", campos: { motivo: expect.any(Array) } });
    expect(await cancelarSolicitud(ctx(), r.valor.id, 2, "Cliente llamó")).toEqual({ ok: true, valor: null });
    expect(await reprogramarSolicitud(ctx(), r.valor.id, 3, "2026-10-21")).toMatchObject({ ok: false, error: "invalido" });
    const [s] = await bd.select().from(solicitudes);
    expect(s).toMatchObject({ estado: "cancelada", fechaSolicitada: "2026-10-20", registradaEn: AHORA, motivoCancelacion: "Cliente llamó" });
  });

  it("el buscador encuentra clientes sin acentos y devuelve sus motivos de hoy", async () => {
    const r = await buscarClientesParaSolicitud(ctx(), "bajio");
    expect(r).toMatchObject({ ok: true, valor: [{ nombre: "Cartonera del Bajío", motivosHoy: [{ codigo: "sin_aviso_privacidad" }] }] });
    expect(await buscarClientesParaSolicitud(ctx(), "")).toEqual({ ok: true, valor: [] });
  });
});
