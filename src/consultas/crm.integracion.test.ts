import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agregarNota } from "@/acciones/cartera.nucleo";
import { confirmarPropuestas, posponerPropuesta } from "@/acciones/propuestas.nucleo";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { actualizarClienteSiVersion, leerCliente } from "@/datos/clientes";
import { bitacora, documentosCliente, solicitudes } from "@/datos/esquema";
import { clienteHabilitado, ponerPatio, solicitudPendiente } from "@/datos/pruebas/escenario-plan";
import { crearBasePostgres, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import { aEntrada } from "@/dominio/clientes/formulario";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { csvDeCartera, fichaCartera, mapaCartera, propuestasDeRecoleccion } from "./cartera.nucleo";
import { listarClientes } from "./clientes.nucleo";
import { panel } from "./indicadores.nucleo";

// Plan CRM, PC-4. AHORA: miércoles 2026-10-21, 09:00 en Ciudad de México.
const AHORA = new Date("2026-10-21T15:00:00Z");
function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}

describe("consultas del Plan CRM", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  let gerencia: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion = despachador, ahora = AHORA): Contexto => ({ bd: base.bd, usuario, ahora, reloj: () => ahora });
  let habilitado: string;
  let incompleto: string;
  let sinUbicacion: string;

  beforeEach(async () => {
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
    gerencia = await usuarioDePrueba(base.bd, "gerencia");
    await ponerPatio(base.bd);
    habilitado = (await clienteHabilitado(base.bd, "Cartonera Completa", 0.01)).id;
    incompleto = (await clienteHabilitado(base.bd, "Cartonera Sin Residuo", 0.02, { tipoResiduo: null })).id;
    sinUbicacion = (await clienteHabilitado(base.bd, "Cartonera Sin Pin", 0, { lat: null, lng: null })).id;
    // Un documento obligatorio de la completa vence en 10 días.
    await base.bd.insert(documentosCliente).values({ clienteId: habilitado, nombre: "Contrato", obligatorio: false, estado: "vigente", venceEl: "2026-10-31" });
  });
  afterEach(async () => base.cerrar());

  const ids = (r: { clientes: { id: string }[] }) => r.clientes.map((c) => c.id).sort();

  it("filtra por estado, ubicación, residuo y documentos; combina con texto; K5 no cambia", async () => {
    const todos = valor(await listarClientes(ctx(), {}));
    expect(valor(await listarClientes(ctx(), { estado: "incompleto" })).clientes.map((c) => c.id).sort()).toEqual([incompleto, sinUbicacion].sort());
    expect(ids(valor(await listarClientes(ctx(), { sinUbicacion: true })))).toEqual([sinUbicacion]);
    expect(ids(valor(await listarClientes(ctx(), { estado: "habilitado" })))).toEqual([habilitado]);
    expect(ids(valor(await listarClientes(ctx(), { documentos: "por_vencer" })))).toEqual([habilitado]);
    expect(ids(valor(await listarClientes(ctx(), { residuo: "RME", texto: "sin pin" })))).toEqual([sinUbicacion]);
    expect(valor(await listarClientes(ctx(), { estado: "incompleto" })).k5).toEqual(todos.k5);
    expect(todos.clientes.find((c) => c.id === habilitado)!.documentoPorVencer).toBe(true);
    expect(await listarClientes(ctx(), { estado: "raro" })).toMatchObject({ ok: false, error: "invalido" });
  });

  it("la ficha trae historial, números, notas en su última versión y ritmo", async () => {
    const s = await solicitudPendiente(base.bd, habilitado, despachador.id, "2026-10-22");
    // Cada nota con su propia hora: el orden es por hora (más reciente primero).
    const minuto = (n: number) => new Date(AHORA.getTime() + n * 60_000);
    const { id } = valor(await agregarNota(ctx(despachador, minuto(1)), habilitado, { tipo: "llamada", texto: "Martes" }));
    valor(await agregarNota(ctx(despachador, minuto(2)), habilitado, { tipo: "llamada", texto: "Miércoles", corrigeA: id }));
    valor(await agregarNota(ctx(despachador, minuto(3)), habilitado, { tipo: "acuerdo", texto: "Precio fijo" }));
    const f = valor(await fichaCartera(ctx(), habilitado));
    expect(f.historial.solicitudes.map((x) => x.id)).toEqual([s]);
    expect(f.historial.recolecciones).toEqual([]);
    expect(f.notas.map((n) => [n.texto, n.corregida])).toEqual([["Precio fijo", false], ["Miércoles", true]]);
    expect(f.numeros).toMatchObject({ completadas: 0, ritmo: null });
    expect(f.puedeAnotar).toBe(true);
    expect(valor(await fichaCartera(ctx(gerencia), habilitado)).puedeAnotar).toBe(false);
  });

  it("propuestas para el siguiente día de operación por omisión, con ritmo aprendido y posposición vencida", async () => {
    // Ritmo semanal: atendidas el 1, 8 y 15 de octubre → esperada el 22 (jueves, mañana).
    for (const fecha of ["2026-10-01", "2026-10-08", "2026-10-15"]) {
      const sid = await solicitudPendiente(base.bd, habilitado, despachador.id, fecha, new Date(`${fecha}T13:00:00Z`));
      await base.bd.update(solicitudes).set({ estado: "atendida" }).where(eq(solicitudes.id, sid));
    }
    const r = valor(await propuestasDeRecoleccion(ctx()));
    expect(r.fecha).toBe("2026-10-22");
    expect(r.propuestas).toEqual([expect.objectContaining({ clienteId: habilitado, motivos: ["ritmo"], fechaEsperada: "2026-10-22", nombre: "Cartonera Completa", ultimaSolicitud: "2026-10-15" })]);
    valor(await posponerPropuesta(ctx(), "2026-10-22", habilitado, 2));
    expect(valor(await propuestasDeRecoleccion(ctx(), "2026-10-23")).propuestas).toEqual([]);
    expect(valor(await propuestasDeRecoleccion(ctx(), "2026-10-24")).propuestas[0]?.motivos).toEqual(["ritmo", "pospuesta"]);
    valor(await confirmarPropuestas(ctx(), "2026-10-24", [habilitado]));
    expect(valor(await propuestasDeRecoleccion(ctx(), "2026-10-26")).propuestas).toEqual([]);
  });

  it("la recurrencia fija propone los días que tocan", async () => {
    const cliente = (await leerCliente(base.bd, incompleto))!;
    await base.bd.transaction((tx) => actualizarClienteSiVersion(tx, incompleto, cliente.version,
      { ...aEntrada(cliente), tipoResiduo: "RME", recurrencia: { tipo: "dias_semana", dias: [4] } }, AHORA));
    expect(valor(await propuestasDeRecoleccion(ctx(), "2026-10-22")).propuestas.map((p) => [p.clienteId, p.motivos])).toEqual([[incompleto, ["recurrencia"]]]);
    expect(valor(await propuestasDeRecoleccion(ctx(), "2026-10-23")).propuestas).toEqual([]);
  });

  it("el mapa da puntos con estado y cuenta los que no tienen ubicación", async () => {
    const m = valor(await mapaCartera(ctx(), {}));
    expect(m.sinUbicacion).toBe(1);
    expect(Object.fromEntries(m.puntos.map((p) => [p.clienteId, p.estado]))).toEqual({ [habilitado]: "completo_habilitado", [incompleto]: "incompleto" });
    expect(valor(await mapaCartera(ctx(), { estado: "incompleto" })).puntos.map((p) => p.clienteId)).toEqual([incompleto]);
  });

  it("exportar: solo con clientes.exportar, CSV de la plantilla con filtros, y queda en la bitácora sin valores", async () => {
    expect(await csvDeCartera(ctx(gerencia), {})).toEqual({ ok: false, error: "no_autorizado" });
    const { contenido, nombre } = valor(await csvDeCartera(ctx(), { estado: "incompleto" }));
    expect(nombre).toMatch(/^cartera-2026-10-21\.csv$/);
    const filas = contenido.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(filas[0].startsWith("id,nombre,contacto,telefono")).toBe(true);
    expect(filas[0].endsWith(",completa,habilitada_hoy")).toBe(true);
    expect(filas).toHaveLength(3);
    const [renglon] = await base.bd.select().from(bitacora).where(and(eq(bitacora.entidad, "cartera"), eq(bitacora.accion, "exportar_clientes")));
    expect(renglon.campos).toEqual(["filtros"]);
    expect(JSON.stringify(renglon)).not.toContain("Cartonera");
  });

  it("K2 del panel deja fuera las solicitudes de canal propuesta y las reporta aparte", async () => {
    await solicitudPendiente(base.bd, habilitado, despachador.id, "2026-10-21", AHORA);   // captura manual: 60 s (escenario-plan)
    await base.bd.execute(sql`UPDATE solicitudes SET captura_inicio_en = ${new Date(AHORA.getTime() - 120_000)} WHERE cliente_id = ${habilitado}`);
    // Incompleto (sin residuo): no es elegible y no deja decisión.
    expect(valor(await confirmarPropuestas(ctx(), "2026-10-22", [incompleto])).noElegibles).toEqual([{ clienteId: incompleto, motivo: "no_habilitado" }]);
    await base.bd.execute(sql`UPDATE clientes SET tipo_residuo = 'RME' WHERE id = ${incompleto}`);
    valor(await confirmarPropuestas(ctx(), "2026-10-22", [incompleto]));
    const p = valor(await panel(ctx(gerencia), "2026-10-21", "2026-10-21"));
    expect(p.k2.muestra).toBe(1);
    expect(p.k2Propuestas).toMatchObject({ muestra: 1, valor: 0 });
  });
});
