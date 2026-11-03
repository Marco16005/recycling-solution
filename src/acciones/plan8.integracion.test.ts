import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paradas, planes, rutas } from "@/datos/esquema";
import { estadoDeJornada, leerJornadaOperacion } from "@/datos/operacion";
import type { PlanGuardado } from "@/datos/planes";
import {
  AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente, usuarioOperadorDe,
} from "@/datos/pruebas/escenario-plan";
import { crearBasePostgres, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { EventoEntrada, TipoEvento } from "@/dominio/operacion/tipos";
import { validarPlan } from "@/motor";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { registrarEventoOperador } from "./operador.nucleo";
import { generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "./plan.nucleo";
import { generarReruteo } from "./reruteo.nucleo";
import type { Contexto, Resultado } from "./tipos";

// Plan 8, P8-4: re-ruteos con el reacomodo activo, OSRM real (mapa sintético) y las horas pico de la configuración.
// AHORA_PLAN es 07:00 en Ciudad de México.

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}
const a = (min: number) => new Date(AHORA_PLAN.getTime() + min * 60_000);

describe("re-ruteo con reacomodo (Plan 8)", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  let A: { unidadId: string; operadorId: string; jornadaId: string };
  let B: { unidadId: string; operadorId: string; jornadaId: string };
  const ctx = (usuario: UsuarioSesion, ahora = AHORA_PLAN): Contexto => ({ bd: base.bd, usuario, ahora, reloj: () => ahora });

  /** Dos unidades de 900 kg (una parada de 800 kg por viaje) y cuatro solicitudes cerca del patio: dos viajes por unidad. */
  beforeEach(async () => {
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
    await ponerPatio(base.bd);
    A = await jornadaDisponible(base.bd, FECHA_PLAN, "REUA01", { capacidadKg: 900 });
    B = await jornadaDisponible(base.bd, FECHA_PLAN, "REUB02", { capacidadKg: 900 });
    for (const [i, nombre] of ["Norte", "Centro", "Sur", "Oriente"].entries()) {
      const c = await clienteHabilitado(base.bd, `Cartonera ${nombre}`, 0.01 * (i + 1));
      await solicitudPendiente(base.bd, c.id, despachador.id, FECHA_PLAN, a(-(4 - i)));
    }
  });
  afterEach(async () => { operadores.clear(); await base.cerrar(); });

  const plan = async (id: string) => (await base.bd.select().from(planes).where(eq(planes.id, id)))[0] as unknown as PlanGuardado & { versionMotor: string };
  async function validar(id: string, ahora = AHORA_PLAN) {
    valor(await iniciarRevision(ctx(despachador, ahora), id));
    return validarPlanDelDia(ctx(despachador, ahora), id, (await plan(id)).version, { requisitosConfirmados: true });
  }
  async function generarYValidar() {
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    valor(await validar(planId));
    return planId;
  }
  const rutasDe = (jornadaId: string) => base.bd.select().from(rutas).where(eq(rutas.jornadaId, jornadaId)).orderBy(asc(rutas.salidaEstimada));
  const paradasDe = (rutaId: string) => base.bd.select().from(paradas).where(eq(paradas.rutaId, rutaId)).orderBy(asc(paradas.secuencia));
  const vigente = async () => (await base.bd.select().from(planes).where(eq(planes.estado, "validado")))[0];
  /** Un usuario por operador: usuarioOperadorDe lo crea, así que se guarda. */
  const operadores = new Map<string, UsuarioSesion>();
  async function operar(jornada: typeof A, tipo: TipoEvento, ocurridoEn: Date, cambios: Partial<EventoEntrada> = {}) {
    if (!operadores.has(jornada.jornadaId)) operadores.set(jornada.jornadaId, await usuarioOperadorDe(base.bd, jornada.operadorId));
    const operador = operadores.get(jornada.jornadaId)!;
    valor(await registrarEventoOperador(ctx(operador, ocurridoEn), {
      eventoId: randomUUID(), jornadaId: jornada.jornadaId, tipo, ocurridoEn: ocurridoEn.toISOString(), rutaId: null, paradaId: null,
      versionRuta: null, odometroKm: null, motivo: null, ...cambios,
    }));
  }
  async function salirConElPrimerViaje(jornada: typeof A, salida: Date) {
    const [primera] = await rutasDe(jornada.jornadaId);
    await operar(jornada, "check_in", new Date(salida.getTime() - 5 * 60_000));
    await operar(jornada, "salida_patio", salida, { rutaId: primera.id, versionRuta: primera.version, odometroKm: 1000 });
    return primera;
  }
  /** La propuesta es 1.2.0, el motor la valida con sus restricciones y las protegidas siguen en su lugar en S2 y S4. */
  async function comprobar(planId: string) {
    const p = await plan(planId);
    expect(p.versionMotor).toBe("1.2.0");
    const reacomodo = p.resultado.reacomodo!;
    expect(reacomodo).toBeDefined();
    const admitidas = p.restricciones?.admitidas ?? {};
    expect(validarPlan(p.entrada, p.resultado, { restricciones: { admitidas } })).toEqual([]);
    for (const rutasFase of [reacomodo.rutasReacomodadas, p.resultado.rutas]) for (const [unidadId, viajes] of Object.entries(admitidas)) {
      const ruta = rutasFase.find((r) => r.unidadId === unidadId)!;
      viajes.forEach((ids, k) => expect(ruta.viajes[k].paradas.map((x) => x.solicitudId).filter((id) => ids.includes(id))).toEqual(ids));
    }
    return p;
  }

  it("re-ruteo que libera un viaje completo: el reacomodo puede moverlo y las protegidas no se tocan", async () => {
    await generarYValidar();
    const [, segunda] = await rutasDe(A.jornadaId);
    await salirConElPrimerViaje(A, a(60));
    const liberadas = (await paradasDe(segunda.id)).map((p) => p.solicitudId);
    const base0 = await vigente();
    const { planId } = valor(await generarReruteo(ctx(despachador, a(65)), base0.id, base0.version, { jornadasNoDisponibles: [], liberadas }));
    const p = await comprobar(planId);
    const ruteadas = p.resultado.rutas.flatMap((r) => r.viajes.flatMap((v) => v.paradas.map((x) => x.solicitudId)));
    for (const id of liberadas) expect([...ruteadas, ...p.resultado.pospuestas.map((x) => x.solicitudId)]).toContain(id);
    valor(await validar(planId, a(65)));
  });

  it("re-ruteos encadenados: avería de B y después liberar lo que quedó reasignado; cada propuesta valida", async () => {
    await generarYValidar();
    await salirConElPrimerViaje(B, a(60));
    const base0 = await vigente();
    const { planId: r1 } = valor(await generarReruteo(ctx(despachador, a(65)), base0.id, base0.version, { jornadasNoDisponibles: [B.jornadaId] }));
    await comprobar(r1);
    valor(await validar(r1, a(65)));
    const estadoB = await estadoDeJornada(base.bd, (await leerJornadaOperacion(base.bd, B.jornadaId))!);
    const movida = estadoB.viajes.flatMap((v) => v.paradas).find((p) => !p.vigente && p.estado === "reasignada")!.solicitudId;
    const base1 = await vigente();
    const { planId: r2 } = valor(await generarReruteo(ctx(despachador, a(70)), base1.id, base1.version,
      { jornadasNoDisponibles: [B.jornadaId], liberadas: [movida] }));
    await comprobar(r2);
    valor(await validar(r2, a(70)));
  });

  it("avería con viaje en curso: lo pendiente de A se reubica en B y la propuesta valida con el reacomodo", async () => {
    await generarYValidar();
    await salirConElPrimerViaje(A, a(60));
    const pendientesA = (await Promise.all((await rutasDe(A.jornadaId)).map((r) => paradasDe(r.id)))).flat().map((p) => p.solicitudId);
    const base0 = await vigente();
    const { planId } = valor(await generarReruteo(ctx(despachador, a(65)), base0.id, base0.version, { jornadasNoDisponibles: [A.jornadaId] }));
    const p = await comprobar(planId);
    const deB = p.resultado.rutas.find((r) => r.unidadId === B.jornadaId)!.viajes.flatMap((v) => v.paradas.map((x) => x.solicitudId));
    const pospuestas = p.resultado.pospuestas.map((x) => x.solicitudId);
    for (const id of pendientesA) expect([...deB, ...pospuestas, ...(p.restricciones?.congeladas ?? [])]).toContain(id);
    valor(await validar(planId, a(65)));
  });

  it("frontera_vencida con el reloj avanzando durante la revisión, también con reacomodo", async () => {
    await generarYValidar();
    await salirConElPrimerViaje(A, a(60));
    const base0 = await vigente();
    const { planId } = valor(await generarReruteo(ctx(despachador, a(65)), base0.id, base0.version, { jornadasNoDisponibles: [B.jornadaId] }));
    await comprobar(planId);
    valor(await iniciarRevision(ctx(despachador, a(65)), planId));
    const r = await validarPlanDelDia(ctx(despachador, a(110)), planId, (await plan(planId)).version, { requisitosConfirmados: true });
    expect(r).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "frontera_vencida" } });
  });
});
