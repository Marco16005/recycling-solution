import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { registrarEventoOperador } from "@/acciones/operador.nucleo";
import { generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "@/acciones/plan.nucleo";
import { generarReruteo } from "@/acciones/reruteo.nucleo";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { miRuta } from "@/consultas/operador.nucleo";
import type { BD } from "@/datos/bd";
import { instantaneasK5, jornadas as jornadasTabla, planes } from "@/datos/esquema";
import { leerDatosIndicadores, tomarInstantaneaK5 } from "@/datos/indicadores";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import {
  AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente, usuarioOperadorDe,
} from "@/datos/pruebas/escenario-plan";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { EventoEntrada, TipoEvento } from "@/dominio/operacion/tipos";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { csvDelRango, medidasDelRango, panel } from "./indicadores.nucleo";

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}
const a = (min: number) => new Date(AHORA_PLAN.getTime() + min * 60_000);
const at = a;

describe("extracción de los indicadores (Plan 6, I2)", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  let operador: UsuarioSesion;
  let jornadaId: string;
  const ctx = (usuario: UsuarioSesion, ahora = AHORA_PLAN): Contexto => ({ bd, usuario, ahora, reloj: () => ahora });

  /** Un día operado: dos paradas, la primera completada y la segunda no atendida; regreso y descarga con odómetro. */
  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
    await ponerPatio(bd);
    const j = await jornadaDisponible(bd, FECHA_PLAN, "IND001");
    jornadaId = j.jornadaId;
    operador = await usuarioOperadorDe(bd, j.operadorId);
    for (const [i, nombre] of ["Norte", "Centro"].entries()) {
      const c = await clienteHabilitado(bd, `Cartonera ${nombre}`, 0.01 * (i + 1));
      await solicitudPendiente(bd, c.id, despachador.id, FECHA_PLAN, new Date(AHORA_PLAN.getTime() - (2 - i) * 60_000));
    }
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    valor(await iniciarRevision(ctx(despachador), planId));
    const [p] = await bd.select({ version: planes.version }).from(planes).where(eq(planes.id, planId));
    valor(await validarPlanDelDia(ctx(despachador), planId, p.version, { requisitosConfirmados: true }));

    const viaje = valor(await miRuta(ctx(operador))).viajes[0];
    const r = { rutaId: viaje.rutaId, versionRuta: viaje.version };
    const [p1, p2] = viaje.paradas;
    const pasos: [TipoEvento, number, Partial<EventoEntrada>][] = [
      ["check_in", 55, {}],
      ["salida_patio", 60, { ...r, odometroKm: 1000 }],
      ["llegada", 75, { ...r, paradaId: p1.paradaId }],
      ["inicio_servicio", 80, { ...r, paradaId: p1.paradaId }],
      ["fin_servicio", 100, { ...r, paradaId: p1.paradaId }],
      ["no_atendida", 115, { ...r, paradaId: p2.paradaId, motivo: "Cerrado" }],
      ["regreso_patio", 130, { ...r, odometroKm: 1018 }],
      ["fin_descarga", 150, r],
    ];
    for (const [tipo, min, cambios] of pasos) {
      const e: EventoEntrada = {
        eventoId: randomUUID(), jornadaId, tipo, ocurridoEn: a(min).toISOString(), rutaId: null, paradaId: null, versionRuta: null,
        odometroKm: null, motivo: null, ...cambios,
      };
      expect(valor(await registrarEventoOperador(ctx(operador, a(min)), e)).resultado).toBe("aplicado");
    }
  });

  it("arma una recolección por parada cerrada, con la anterior en la secuencia y el prorrateo del viaje", async () => {
    const { recolecciones, viajes, conteos } = medidasDelRango(await leerDatosIndicadores(bd, FECHA_PLAN, FECHA_PLAN), "2026-10-16");
    expect(recolecciones).toHaveLength(2);
    const [primera, segunda] = recolecciones;
    expect(primera).toMatchObject({ estado: "completada", placa: "IND001", numeroViajeEnJornada: 1, completadasDelViaje: 1, ventanaInicio: "08:00", ventanaFin: "14:00" });
    expect(primera.anterior).toEqual({ tipo: "primera", salidaPatioEn: a(60) });
    expect(primera.llegadaEn).toEqual(a(75));
    expect(segunda).toMatchObject({ estado: "no_atendida", anterior: { tipo: "anterior", cierreEn: a(100) } });
    expect(primera.regresoMasDescargaMin).toBe(35); // descarga (150) − cierre de la última parada (115)
    expect(viajes).toEqual([expect.objectContaining({ odometroInicioKm: 1000, odometroFinKm: 1018, rendimientoKmL: 3.5 })]);
    expect(viajes[0].kmContrafactualCompletadas).toBeCloseTo(primera.kmContrafactual);
    expect(conteos.get(FECHA_PLAN)).toEqual({ noAtendidas: 1, omitidas: 0, pendientesAlCierre: 0 });
  });

  it("la instantánea de K5 se toma una vez por día", async () => {
    expect(await bd.transaction((tx) => tomarInstantaneaK5(tx, FECHA_PLAN, 2, 2, a(0), despachador.id))).toBe(true);
    expect(await bd.transaction((tx) => tomarInstantaneaK5(tx, FECHA_PLAN, 3, 1, a(10), despachador.id))).toBe(false);
    expect(await bd.select().from(instantaneasK5)).toEqual([expect.objectContaining({ fecha: FECHA_PLAN, activos: 2, completos: 2 })]);
  });

  it("el panel y el CSV exigen indicadores.ver y un rango de hasta 92 días", async () => {
    expect(await panel(ctx(operador), FECHA_PLAN, FECHA_PLAN)).toEqual({ ok: false, error: "no_autorizado" });
    expect(await csvDelRango(ctx(operador), FECHA_PLAN, FECHA_PLAN)).toEqual({ ok: false, error: "no_autorizado" });
    expect(await panel(ctx(despachador), "2026-01-01", "2026-10-15")).toMatchObject({ ok: false, error: "invalido" });
    expect(await panel(ctx(despachador), "2026-10-16", "2026-10-15")).toMatchObject({ ok: false, error: "invalido" });
  });
});

describe("extracción con re-ruteo: cuenta lo hecho en el plan reemplazado y no lo reasignado", () => {
  it("el viaje en curso de A se completa en el plan base; las paradas reubicadas de B no cuentan como recolecciones", async () => {
    const bd = await crearBdPrueba();
    const despachador = await usuarioDePrueba(bd, "despachador");
    const ctx = (usuario: UsuarioSesion, ahora = AHORA_PLAN): Contexto => ({ bd, usuario, ahora, reloj: () => ahora });
    await ponerPatio(bd);
    const a = await jornadaDisponible(bd, FECHA_PLAN, "REA001", { capacidadKg: 1700 });
    await jornadaDisponible(bd, FECHA_PLAN, "REB002", { capacidadKg: 1700 });
    const jornadaB = (await bd.select().from(jornadasTabla)).find((j) => j.id !== a.jornadaId)!.id;
    const operadorA = await usuarioOperadorDe(bd, a.operadorId);
    for (const [i, nombre] of ["Norte", "Centro", "Sur", "Oriente"].entries()) {
      const c = await clienteHabilitado(bd, `Cartonera ${nombre}`, 0.01 * (i + 1));
      await solicitudPendiente(bd, c.id, despachador.id, FECHA_PLAN, new Date(AHORA_PLAN.getTime() - (4 - i) * 60_000));
    }
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    valor(await iniciarRevision(ctx(despachador), planId));
    const [p0] = await bd.select({ version: planes.version }).from(planes).where(eq(planes.id, planId));
    valor(await validarPlanDelDia(ctx(despachador), planId, p0.version, { requisitosConfirmados: true }));

    const viaje = valor(await miRuta(ctx(operadorA))).viajes[0];
    const r = { rutaId: viaje.rutaId, versionRuta: viaje.version };
    const enviar = async (tipo: TipoEvento, min: number, cambios: Partial<EventoEntrada> = {}) =>
      expect(valor(await registrarEventoOperador(ctx(operadorA, at(min)), {
        eventoId: randomUUID(), jornadaId: a.jornadaId, tipo, ocurridoEn: at(min).toISOString(), rutaId: null, paradaId: null,
        versionRuta: null, odometroKm: null, motivo: null, ...cambios,
      })).resultado).toBe("aplicado");
    await enviar("check_in", 55);
    await enviar("salida_patio", 60, { ...r, odometroKm: 100 });

    const [base] = await bd.select().from(planes).where(eq(planes.estado, "validado"));
    const { planId: reruteo } = valor(await generarReruteo(ctx(despachador, at(65)), base.id, base.version, { jornadasNoDisponibles: [jornadaB] }));
    valor(await iniciarRevision(ctx(despachador, at(65)), reruteo));
    const [p1] = await bd.select({ version: planes.version }).from(planes).where(eq(planes.id, reruteo));
    valor(await validarPlanDelDia(ctx(despachador, at(66)), reruteo, p1.version, { requisitosConfirmados: true }));

    // A termina su viaje en curso, que quedó congelado en el plan base (ahora reemplazado).
    let t = 70;
    for (const p of viaje.paradas) {
      await enviar("llegada", (t += 5), { ...r, paradaId: p.paradaId });
      await enviar("inicio_servicio", (t += 5), { ...r, paradaId: p.paradaId });
      await enviar("fin_servicio", (t += 5), { ...r, paradaId: p.paradaId });
    }

    const datos = await leerDatosIndicadores(bd, FECHA_PLAN, FECHA_PLAN);
    expect(datos.planes.map((p) => p.tipo).sort()).toEqual(["inicial", "re_ruteo"]);
    const { recolecciones, conteos } = medidasDelRango(datos, "2026-10-16");
    expect(recolecciones.map((x) => x.viajeId)).toEqual([viaje.rutaId, viaje.rutaId]);
    expect(recolecciones.every((x) => x.estado === "completada")).toBe(true);
    expect(conteos.get(FECHA_PLAN)?.omitidas ?? 0).toBe(0);
  });
});
