import { beforeEach, describe, expect, it } from "vitest";
import type { Contexto, Resultado } from "@/acciones/tipos";
import type { BD } from "@/datos/bd";
import { leerConfiguracion } from "@/datos/configuracion";
import { insertarMovimientoPrivacidad } from "@/datos/privacidad";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import {
  AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente, usuarioOperadorDe,
} from "@/datos/pruebas/escenario-plan";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import {
  evaluarPreparacion, fechaLegible, obtenerPreparacion, type ClavePunto, type DatosPreparacion, type Preparacion, type PuntoPreparacion,
} from "./preparacion.nucleo";

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}
function punto(p: Preparacion, clave: ClavePunto): PuntoPreparacion {
  const encontrado = p.puntos.find((x) => x.clave === clave);
  if (!encontrado) throw new Error(`sin punto ${clave}: ${p.puntos.map((x) => x.clave).join(", ")}`);
  return encontrado;
}

/** Sábado 2026-11-21; patio marcado; lunes a sábado; turno hasta las 16:00; sin jornadas ni solicitudes. */
function datos(cambios: Partial<DatosPreparacion> = {}): DatosPreparacion {
  return {
    fecha: "2026-11-21", hoy: "2026-11-21", minutoActual: 8 * 60,
    config: { patioLat: 20.62, patioLng: -100.3, diasOperacion: [1, 2, 3, 4, 5, 6], turnoFin: "16:00", versionAvisoPrivacidad: "2026-10", diasParaAtrasada: 2 },
    solicitudes: [], clientes: [], jornadas: [], unidades: [], operadores: [], catalogoUnidad: [], catalogoOperador: [],
    ...cambios,
  };
}

describe("lista Antes de generar: reglas (2026-11-21)", () => {
  it("fecha en palabras", () => {
    expect(fechaLegible("2026-11-21")).toBe("sábado 21 de noviembre");
    expect(fechaLegible("2026-01-04")).toBe("domingo 4 de enero");
  });

  it("sin patio: falta, con el enlace a Configuración", () => {
    const p = evaluarPreparacion(datos({ config: { ...datos().config, patioLat: null, patioLng: null } }));
    expect(punto(p, "patio")).toMatchObject({ estado: "falta", enlace: { href: "/admin/configuracion" } });
    expect(p.listo).toBe(false);
  });

  it("una fecha pasada falta y lleva a hoy", () => {
    const p = evaluarPreparacion(datos({ fecha: "2026-11-20" }));
    expect(punto(p, "dia")).toMatchObject({ estado: "falta", enlace: { href: "/despacho/plan?fecha=2026-11-21" } });
  });

  it("un domingo no se opera: propone el lunes siguiente", () => {
    const p = evaluarPreparacion(datos({ fecha: "2026-11-22" }));
    expect(punto(p, "dia")).toMatchObject({
      estado: "falta",
      detalle: "El domingo 22 de noviembre no es día de operación. El siguiente es el lunes 23 de noviembre.",
      enlace: { href: "/despacho/plan?fecha=2026-11-23", texto: "Planear el lunes 23 de noviembre" },
    });
    expect(p.puntos.some((x) => x.clave === "turno")).toBe(false);
  });

  it("turno de hoy: completo, corto (menos de 3 h con el margen de revisión) y terminado", () => {
    expect(punto(evaluarPreparacion(datos({ minutoActual: 8 * 60 })), "turno")).toMatchObject({ estado: "bien", detalle: "Quedan 7 h 50 min de turno (termina a las 16:00)." });
    const corto = punto(evaluarPreparacion(datos({ minutoActual: 13 * 60 })), "turno");
    expect(corto.estado).toBe("aviso");
    expect(corto.detalle).toContain("Quedan 2 h 50 min de turno");
    expect(corto.enlace?.href).toBe("/despacho/plan?fecha=2026-11-23");
    expect(punto(evaluarPreparacion(datos({ minutoActual: 15 * 60 + 55 })), "turno").estado).toBe("falta");
  });

  it("una fecha futura no revisa el turno de hoy", () => {
    expect(evaluarPreparacion(datos({ fecha: "2026-11-23" })).puntos.some((x) => x.clave === "turno")).toBe(false);
  });

  it("sin jornadas ni solicitudes: faltan las dos, con su pantalla", () => {
    const p = evaluarPreparacion(datos());
    expect(punto(p, "camiones")).toMatchObject({ estado: "falta", enlace: { href: "/despacho/jornada?fecha=2026-11-21" } });
    expect(punto(p, "solicitudes")).toMatchObject({ estado: "falta", enlace: { href: "/despacho/solicitudes?fecha=2026-11-21" } });
    expect(p.puntos.some((x) => x.clave === "tipos")).toBe(false);
    expect(p).toMatchObject({ listo: false, faltan: 2 });
  });
});

describe("lista Antes de generar: con datos guardados (2026-11-21)", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion): Contexto => ({ bd, usuario, ahora: AHORA_PLAN, reloj: () => AHORA_PLAN });

  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
  });

  it("sin patio marcado, lo dice antes que nada", async () => {
    const p = valor(await obtenerPreparacion(ctx(despachador), FECHA_PLAN));
    expect(p.puntos[0]).toMatchObject({ clave: "patio", estado: "falta" });
  });

  it("todo listo: patio, día, turno, camión, solicitud y tipo de camión", async () => {
    await ponerPatio(bd);
    const cliente = await clienteHabilitado(bd, "Cartonera Lista", 0.01);
    await jornadaDisponible(bd, FECHA_PLAN, "LIS001");
    await solicitudPendiente(bd, cliente.id, despachador.id, FECHA_PLAN);
    const p = valor(await obtenerPreparacion(ctx(despachador), FECHA_PLAN));
    expect(p.puntos.map((x) => [x.clave, x.estado])).toEqual([
      ["patio", "bien"], ["dia", "bien"], ["turno", "bien"], ["camiones", "bien"], ["solicitudes", "bien"], ["tipos", "bien"],
    ]);
    expect(p).toMatchObject({ listo: true, faltan: 0, avisos: 0 });
  });

  it("cliente sin aviso de privacidad: la solicitud queda bloqueada con su motivo y la ficha del cliente", async () => {
    await ponerPatio(bd);
    const cliente = await clienteHabilitado(bd, "Cartonera Sin Aviso", 0.01);
    const { versionAvisoPrivacidad } = await leerConfiguracion(bd);
    await bd.transaction((tx) => insertarMovimientoPrivacidad(tx, {
      clienteId: cliente.id, versionAviso: versionAvisoPrivacidad, accion: "retirado", medio: "papel", registradoPor: null, en: AHORA_PLAN,
    }));
    await jornadaDisponible(bd, FECHA_PLAN, "AVI001");
    await solicitudPendiente(bd, cliente.id, despachador.id, FECHA_PLAN);
    const p = valor(await obtenerPreparacion(ctx(despachador), FECHA_PLAN));
    const solicitudes = punto(p, "solicitudes");
    expect(solicitudes.estado).toBe("falta");
    expect(solicitudes.pendientes).toEqual([{
      texto: "Cartonera Sin Aviso (1 solicitud): Falta aviso vigente sin oposición del contacto",
      enlace: { href: `/despacho/clientes/${cliente.id}`, texto: "Abrir ficha del cliente" },
    }]);
    expect(p.listo).toBe(false);
  });

  it("una solicitud para otra fecha no cuenta como lista y se explica", async () => {
    await ponerPatio(bd);
    const cliente = await clienteHabilitado(bd, "Cartonera Futura", 0.01);
    await jornadaDisponible(bd, FECHA_PLAN, "FUT001");
    await solicitudPendiente(bd, cliente.id, despachador.id, "2026-10-16");
    const solicitudes = punto(valor(await obtenerPreparacion(ctx(despachador), FECHA_PLAN)), "solicitudes");
    expect(solicitudes.estado).toBe("falta");
    expect(solicitudes.pendientes.map((x) => x.texto)).toEqual(["1 solicitud es para una fecha posterior; aparecerá en el plan de ese día."]);
  });

  it("una unidad inactiva no se puede usar y lleva a su ficha", async () => {
    await ponerPatio(bd);
    const { unidadId } = await jornadaDisponible(bd, FECHA_PLAN, "INA001", { activo: false });
    const camiones = punto(valor(await obtenerPreparacion(ctx(despachador), FECHA_PLAN)), "camiones");
    expect(camiones.estado).toBe("falta");
    expect(camiones.pendientes).toEqual([{ texto: "Unidad INA001: Inactivo", enlace: { href: `/despacho/unidades/${unidadId}`, texto: "Abrir unidad" } }]);
  });

  it("un cliente que no admite ningún camión del día recibe un aviso", async () => {
    await ponerPatio(bd);
    const cliente = await clienteHabilitado(bd, "Cartonera Solo Tráiler", 0.01, { tiposUnidadAdmitidos: ["trailer"] });
    await jornadaDisponible(bd, FECHA_PLAN, "TIP001");
    await solicitudPendiente(bd, cliente.id, despachador.id, FECHA_PLAN);
    const p = valor(await obtenerPreparacion(ctx(despachador), FECHA_PLAN));
    expect(punto(p, "tipos")).toMatchObject({ estado: "aviso", pendientes: [{ texto: "Cartonera Solo Tráiler: admite Tráiler" }] });
    expect(p.listo).toBe(true);
  });

  it("permisos: gerencia la ve; un operador no", async () => {
    const gerencia = await usuarioDePrueba(bd, "gerencia");
    expect((await obtenerPreparacion(ctx(gerencia), FECHA_PLAN)).ok).toBe(true);
    const { operadorId } = await jornadaDisponible(bd, FECHA_PLAN, "PER001");
    expect(await obtenerPreparacion(ctx(await usuarioOperadorDe(bd, operadorId)), FECHA_PLAN)).toEqual({ ok: false, error: "no_autorizado" });
  });

  it("fecha no válida", async () => {
    expect(await obtenerPreparacion(ctx(despachador), "21/11/2026")).toEqual({ ok: false, error: "invalido", campos: { fecha: ["Fecha no válida"] } });
  });
});
