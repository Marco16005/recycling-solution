import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { registrarEventoOperador } from "@/acciones/operador.nucleo";
import { generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "@/acciones/plan.nucleo";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { miRuta } from "@/consultas/operador.nucleo";
import type { BD } from "@/datos/bd";
import { instantaneasK5, planes } from "@/datos/esquema";
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
    expect(await bd.transaction((tx) => tomarInstantaneaK5(tx, FECHA_PLAN, 2, 2, a(0)))).toBe(true);
    expect(await bd.transaction((tx) => tomarInstantaneaK5(tx, FECHA_PLAN, 3, 1, a(10)))).toBe(false);
    expect(await bd.select().from(instantaneasK5)).toEqual([expect.objectContaining({ fecha: FECHA_PLAN, activos: 2, completos: 2 })]);
  });

  it("el panel y el CSV exigen indicadores.ver y un rango de hasta 92 días", async () => {
    expect(await panel(ctx(operador), FECHA_PLAN, FECHA_PLAN)).toEqual({ ok: false, error: "no_autorizado" });
    expect(await csvDelRango(ctx(operador), FECHA_PLAN, FECHA_PLAN)).toEqual({ ok: false, error: "no_autorizado" });
    expect(await panel(ctx(despachador), "2026-01-01", "2026-10-15")).toMatchObject({ ok: false, error: "invalido" });
    expect(await panel(ctx(despachador), "2026-10-16", "2026-10-15")).toMatchObject({ ok: false, error: "invalido" });
  });
});
