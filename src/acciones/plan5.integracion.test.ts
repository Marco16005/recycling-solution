import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { miRuta } from "@/consultas/operador.nucleo";
import { eventosOperador, incidentes, paradas, planes } from "@/datos/esquema";
import {
  AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente, usuarioOperadorDe,
} from "@/datos/pruebas/escenario-plan";
import { crearBasePostgres, filasDe, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { EventoEntrada, TipoEvento } from "@/dominio/operacion/tipos";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { resolverIncidente } from "./operacion.nucleo";
import { registrarEventoOperador, reportarIncidente } from "./operador.nucleo";
import { generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "./plan.nucleo";
import { generarReruteo } from "./reruteo.nucleo";
import type { Contexto, Resultado } from "./tipos";

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}
const a = (min: number) => new Date(AHORA_PLAN.getTime() + min * 60_000);

describe("operación del día con Postgres real (concurrencia)", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  let operador: UsuarioSesion;
  let jornadaA: { unidadId: string; operadorId: string; jornadaId: string };
  let jornadaB: { unidadId: string; operadorId: string; jornadaId: string };
  const ctx = (usuario: UsuarioSesion, ahora = AHORA_PLAN): Contexto => ({ bd: base.bd, usuario, ahora, reloj: () => ahora });

  beforeEach(async () => {
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
    await ponerPatio(base.bd);
    jornadaA = await jornadaDisponible(base.bd, FECHA_PLAN, "CONA01", { capacidadKg: 1700 });
    jornadaB = await jornadaDisponible(base.bd, FECHA_PLAN, "CONB02", { capacidadKg: 1700 });
    operador = await usuarioOperadorDe(base.bd, jornadaA.operadorId);
    for (const [i, nombre] of ["Norte", "Centro", "Sur", "Oriente"].entries()) {
      const c = await clienteHabilitado(base.bd, `Cartonera ${nombre}`, 0.01 * (i + 1));
      await solicitudPendiente(base.bd, c.id, despachador.id, FECHA_PLAN, new Date(AHORA_PLAN.getTime() - (4 - i) * 60_000));
    }
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    valor(await iniciarRevision(ctx(despachador), planId));
    const [p] = await base.bd.select({ version: planes.version }).from(planes).where(eq(planes.id, planId));
    valor(await validarPlanDelDia(ctx(despachador), planId, p.version, { requisitosConfirmados: true }));
  });
  afterEach(async () => base.cerrar());

  const evento = (tipo: TipoEvento, ocurridoEn: Date, cambios: Partial<EventoEntrada> = {}): EventoEntrada => ({
    eventoId: randomUUID(), jornadaId: jornadaA.jornadaId, tipo, ocurridoEn: ocurridoEn.toISOString(),
    rutaId: null, paradaId: null, versionRuta: null, odometroKm: null, motivo: null, ...cambios,
  });

  it("el mismo evento enviado dos veces a la vez se aplica una sola vez", async () => {
    const e = evento("check_in", a(55));
    const resultados = await Promise.all([1, 2, 3].map(() => registrarEventoOperador(ctx(operador, a(56)), e)));
    const valores = resultados.map(valor);
    expect(valores.every((v) => v.resultado === "aplicado")).toBe(true);
    expect(valores.filter((v) => !v.repetido)).toHaveLength(1);
    expect(await base.bd.select().from(eventosOperador)).toHaveLength(1);
    const [j] = filasDe<{ v: number }>(await base.bd.execute(sql`SELECT version_operacion AS v FROM jornadas WHERE id = ${jornadaA.jornadaId}`));
    expect(j.v).toBe(1);
  });

  it("un evento y la validación de un re-ruteo a la vez: si el evento entra antes, el re-ruteo responde operacion_avanzo", async () => {
    const [planBase] = await base.bd.select().from(planes).where(eq(planes.estado, "validado"));
    const { planId } = valor(await generarReruteo(ctx(despachador, a(50)), planBase.id, planBase.version, { jornadasNoDisponibles: [jornadaB.jornadaId] }));
    valor(await iniciarRevision(ctx(despachador, a(50)), planId));
    const [p] = await base.bd.select().from(planes).where(eq(planes.id, planId));
    const [ev, validacion] = await Promise.all([
      registrarEventoOperador(ctx(operador, a(52)), evento("check_in", a(52))),
      validarPlanDelDia(ctx(despachador, a(52)), planId, p.version, { requisitosConfirmados: true }),
    ]);
    expect(valor(ev).resultado).toBe("aplicado");
    // Las dos se ordenan por el candado de la fecha: o la validación gana (y el evento se aplica después) o responde operacion_avanzo.
    if (!validacion.ok) expect(validacion).toMatchObject({ error: "conflicto", motivo: { codigo: "operacion_avanzo" } });
    const vigentes = filasDe<{ n: number }>(await base.bd.execute(sql`SELECT count(*)::int AS n FROM paradas WHERE vigente GROUP BY solicitud_id HAVING count(*) > 1`));
    expect(vigentes).toEqual([]);
  });

  it("cancelar por incidente y llegar a la misma parada a la vez: gana uno y el otro no la toca", async () => {
    const vista = valor(await miRuta(ctx(operador, a(50))));
    const viaje = vista.viajes[0];
    const r = { rutaId: viaje.rutaId, versionRuta: viaje.version };
    valor(await registrarEventoOperador(ctx(operador, a(55)), evento("check_in", a(55))));
    valor(await registrarEventoOperador(ctx(operador, a(60)), evento("salida_patio", a(60), { ...r, odometroKm: 10 })));
    const primera = viaje.paradas[0];
    const { id } = valor(await reportarIncidente(ctx(operador, a(61)), {
      eventoId: randomUUID(), jornadaId: jornadaA.jornadaId, tipo: "cliente_no_disponible", descripcion: "No abre", paradaId: primera.paradaId,
    }));
    const [inc] = await base.bd.select().from(incidentes).where(eq(incidentes.id, id));
    const [cancelacion, llegada] = await Promise.all([
      resolverIncidente(ctx(despachador, a(62)), id, inc.version, { accion: "cancelar" }),
      registrarEventoOperador(ctx(operador, a(62)), evento("llegada", a(62), { ...r, paradaId: primera.paradaId })),
    ]);
    const [p] = await base.bd.select().from(paradas).where(eq(paradas.id, primera.paradaId));
    if (cancelacion.ok) {
      expect(p).toMatchObject({ estado: "omitida", vigente: false });
      expect(valor(llegada).resultado).toBe("rechazado");
    } else {
      expect(p.estado).toBe("en_sitio");
      expect(valor(llegada).resultado).toBe("aplicado");
    }
  });
});
