import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Tx } from "@/datos/bd";
import { bloquearCliente } from "@/datos/clientes";
import { ejecucionesMotor, paradas, planes, rutas, solicitudes, unidades } from "@/datos/esquema";
import { insertarJornada } from "@/datos/jornadas";
import { tomarCandadoDeCatalogoFlota, tomarCandadoDeFecha } from "@/datos/planes";
import { insertarMovimientoPrivacidad } from "@/datos/privacidad";
import { AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente } from "@/datos/pruebas/escenario-plan";
import { crearBasePostgres, filasDe, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { operadorDePrueba } from "@/datos/pruebas/flota-ejemplo";
import { insertarOperador } from "@/datos/flota";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { asignarJornada } from "./jornada.nucleo";
import { generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "./plan.nucleo";
import { cancelarSolicitud } from "./solicitudes.nucleo";
import type { Contexto, Resultado } from "./tipos";

const D1 = FECHA_PLAN; // jueves (hoy en AHORA_PLAN)
const D2 = "2026-10-16"; // viernes
const confirmar = { requisitosConfirmados: true };
const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}

/** Una transacción que hace su trabajo y queda abierta hasta soltar(): para comprobar quién espera a quién. */
function retenida(base: BasePostgres, trabajo: (tx: Tx) => Promise<unknown>) {
  let soltar!: () => void;
  const liberada = new Promise<void>((r) => (soltar = r));
  let avisar!: () => void;
  const lista = new Promise<void>((r) => (avisar = r));
  const terminada = base.bd.transaction(async (tx) => {
    await trabajo(tx);
    avisar();
    await liberada;
  });
  return { lista, soltar, terminada };
}

function vigilar<T>(promesa: Promise<T>) {
  const estado = { terminada: false };
  return { estado, resultado: promesa.finally(() => (estado.terminada = true)) };
}

describe("plan del día con Postgres real (concurrencia)", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  let solicitudIds: string[];
  const ctx = (): Contexto => ({ bd: base.bd, usuario: despachador, ahora: AHORA_PLAN });

  beforeEach(async () => {
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
    await ponerPatio(base.bd);
    solicitudIds = [];
    for (const [i, nombre] of ["Cartonera Norte", "Papelera Centro"].entries()) {
      const c = await clienteHabilitado(base.bd, nombre, 0.01 * (i + 1));
      solicitudIds.push(await solicitudPendiente(base.bd, c.id, despachador.id, D1, new Date(AHORA_PLAN.getTime() - (2 - i) * 60_000)));
    }
  });
  afterEach(async () => base.cerrar());

  async function propuesta(fecha: string): Promise<{ planId: string; version: number }> {
    const { planId } = valor(await generarPlanDelDia(ctx(), fecha));
    valor(await iniciarRevision(ctx(), planId));
    const [p] = await base.bd.select({ version: planes.version }).from(planes).where(eq(planes.id, planId));
    return { planId, version: p.version };
  }

  /** Invariantes que deben quedar siempre: a lo sumo una parada vigente por solicitud y nada a medias. */
  async function comprobarConsistencia() {
    const vigentes = filasDe<{ solicitud_id: string; n: number }>(
      await base.bd.execute(sql`SELECT solicitud_id, count(*)::int AS n FROM paradas WHERE vigente GROUP BY solicitud_id`),
    );
    expect(vigentes.every((v) => v.n === 1)).toBe(true);
    for (const s of await base.bd.select().from(solicitudes)) {
      const tieneParada = vigentes.some((v) => v.solicitud_id === s.id);
      expect(s.estado === "programada").toBe(tieneParada);
      if (s.estado === "programada") expect(s.vecesPospuesta).toBe(0);
    }
    const sinPlanValidado = filasDe(
      await base.bd.execute(sql`SELECT r.id FROM rutas r JOIN planes p ON p.id = r.plan_id WHERE p.estado <> 'validado'`),
    );
    expect(sinPlanValidado).toEqual([]);
  }

  it("dos planes de fechas distintas con las mismas solicitudes ruteadas: uno gana y el otro recibe el motivo", async () => {
    await jornadaDisponible(base.bd, D1, "UNO001");
    await jornadaDisponible(base.bd, D2, "DOS002");
    const a = await propuesta(D1);
    const b = await propuesta(D2);
    const resultados = await Promise.all([
      validarPlanDelDia(ctx(), a.planId, a.version, confirmar),
      validarPlanDelDia(ctx(), b.planId, b.version, confirmar),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "solicitud_asignada" } });
    expect((await base.bd.select().from(planes)).filter((p) => p.estado === "validado")).toHaveLength(1);
    await comprobarConsistencia();
  });

  it("una fecha rutea y otra pospone las mismas solicitudes a la vez: nunca quedan programadas y pospuestas", async () => {
    await jornadaDisponible(base.bd, D1, "UNO001");
    const a = await propuesta(D1);
    const b = await propuesta(D2); // sin jornadas: todo pospuesto
    const resultados = await Promise.all([
      validarPlanDelDia(ctx(), a.planId, a.version, confirmar),
      validarPlanDelDia(ctx(), b.planId, b.version, confirmar),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toMatchObject({ ok: false, error: "conflicto" });
    await comprobarConsistencia();
  });

  it("dos fechas posponen las mismas solicitudes a la vez: se posponen una sola vez", async () => {
    // Una unidad activa en el catálogo (con jornada otro día): sin ella, la carga sería físicamente imposible (bloqueada).
    await jornadaDisponible(base.bd, "2026-10-20", "OTRO03");
    const a = await propuesta(D1);
    const b = await propuesta(D2);
    const resultados = await Promise.all([
      validarPlanDelDia(ctx(), a.planId, a.version, confirmar),
      validarPlanDelDia(ctx(), b.planId, b.version, confirmar),
    ]);
    expect(resultados.filter((r) => r.ok)).toEqual([{ ok: true, valor: { programadas: 0, pospuestas: 2 } }]);
    expect(resultados.find((r) => !r.ok)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "datos_cambiaron" } });
    expect((await base.bd.select().from(solicitudes)).map((s) => s.vecesPospuesta)).toEqual([1, 1]);
    await comprobarConsistencia();
  });

  it("cancelar una solicitud mientras se valida: gana una de las dos y no queda una parada de una cancelada", async () => {
    await jornadaDisponible(base.bd, D1, "UNO001");
    const a = await propuesta(D1);
    const [r1] = await Promise.all([
      validarPlanDelDia(ctx(), a.planId, a.version, confirmar),
      cancelarSolicitud(ctx(), solicitudIds[0], 1, "El cliente ya no tiene material"),
    ]);
    const [s] = await base.bd.select().from(solicitudes).where(eq(solicitudes.id, solicitudIds[0]));
    if (r1.ok) expect(s.estado).toBe("programada");
    else expect(s.estado).toBe("cancelada");
    await comprobarConsistencia();
  });

  it("una generación que terminó después de un ajuste no reemplaza la propuesta vigente y su ejecución queda registrada", async () => {
    await jornadaDisponible(base.bd, D1, "UNO001");
    const vigente = await propuesta(D1);
    // Otra operación de la fecha (como un ajuste) toma el candado y cambia la propuesta mientras el motor calcula.
    const ajuste = retenida(base, async (tx) => {
      await tomarCandadoDeFecha(tx, D1);
      await tx.update(planes).set({ version: sql`${planes.version} + 1` }).where(eq(planes.id, vigente.planId));
    });
    await ajuste.lista;
    const generacion = vigilar(generarPlanDelDia(ctx(), D1));
    await pausa(300);
    expect(generacion.estado.terminada).toBe(false);
    ajuste.soltar();
    await ajuste.terminada;
    expect(await generacion.resultado).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "generacion_adelantada" } });
    expect((await base.bd.select().from(planes)).map((p) => [p.id, p.estado])).toEqual([[vigente.planId, "propuesto"]]);
    const ejecuciones = await base.bd.select().from(ejecucionesMotor);
    expect(ejecuciones.map((e) => [e.resultado, e.planId])).toEqual(expect.arrayContaining([["ok", vigente.planId], ["ok", null]]));
  });

  it("si el cliente retira su consentimiento mientras se valida, la validación lo espera y responde cliente_no_habilitado", async () => {
    await jornadaDisponible(base.bd, D1, "UNO001");
    const a = await propuesta(D1);
    const [s] = await base.bd.select().from(solicitudes).where(eq(solicitudes.id, solicitudIds[0]));
    const retiro = retenida(base, async (tx) => {
      await bloquearCliente(tx, s.clienteId);
      await insertarMovimientoPrivacidad(tx, { clienteId: s.clienteId, versionAviso: "2026-10", accion: "retirado", medio: "papel", registradoPor: despachador.id, en: AHORA_PLAN });
    });
    await retiro.lista;
    const validacion = vigilar(validarPlanDelDia(ctx(), a.planId, a.version, confirmar));
    await pausa(300);
    expect(validacion.estado.terminada).toBe(false);
    retiro.soltar();
    await retiro.terminada;
    expect(await validacion.resultado).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "cliente_no_habilitado" } });
    expect(await base.bd.select().from(rutas)).toEqual([]);
  });

  it("si se edita la capacidad de la flota mientras se valida, la validación espera y responde capacidades_cambiaron", async () => {
    await jornadaDisponible(base.bd, D1, "UNO001");
    // Una unidad activa que no trabaja ese día: no está en las versiones, pero sí en la capacidad máxima por tipo.
    const { unidadId } = await jornadaDisponible(base.bd, D2, "DOS002");
    const a = await propuesta(D1);
    const edicion = retenida(base, async (tx) => {
      await tomarCandadoDeCatalogoFlota(tx, "exclusivo");
      await tx.update(unidades).set({ capacidadKg: 15000, version: sql`${unidades.version} + 1` }).where(eq(unidades.id, unidadId));
    });
    await edicion.lista;
    const validacion = vigilar(validarPlanDelDia(ctx(), a.planId, a.version, confirmar));
    await pausa(300);
    expect(validacion.estado.terminada).toBe(false);
    edicion.soltar();
    await edicion.terminada;
    expect(await validacion.resultado).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "capacidades_cambiaron" } });
    expect(await base.bd.select().from(paradas)).toEqual([]);
  });

  it("una jornada nueva de la fecha, asignada mientras se valida, hace que la validación responda datos_cambiaron", async () => {
    await jornadaDisponible(base.bd, D1, "UNO001");
    const otra = await jornadaDisponible(base.bd, D2, "DOS002");
    const a = await propuesta(D1);
    const asignacion = retenida(base, async (tx) => {
      await tomarCandadoDeFecha(tx, D1);
      const operador = await insertarOperador(tx, operadorDePrueba({ nombre: "Operador extra" }), AHORA_PLAN);
      await insertarJornada(tx, { fecha: D1, unidadId: otra.unidadId, operadorId: operador.id, disponibleDesde: "09:00", notas: null }, AHORA_PLAN);
    });
    await asignacion.lista;
    const validacion = vigilar(validarPlanDelDia(ctx(), a.planId, a.version, confirmar));
    await pausa(300);
    expect(validacion.estado.terminada).toBe(false);
    asignacion.soltar();
    await asignacion.terminada;
    expect(await validacion.resultado).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "datos_cambiaron" } });
  });

  it("validar y asignar una jornada de la misma fecha a la vez nunca termina en interbloqueo", async () => {
    await jornadaDisponible(base.bd, D1, "UNO001");
    const libre = await jornadaDisponible(base.bd, D2, "DOS002");
    const a = await propuesta(D1);
    const [validacion, asignacion] = await Promise.all([
      validarPlanDelDia(ctx(), a.planId, a.version, confirmar),
      asignarJornada(ctx(), { fecha: D1, unidadId: libre.unidadId, operadorId: libre.operadorId, disponibleDesde: "09:00", notas: null }),
    ]);
    // Cualquiera puede ir primero; lo que no puede pasar es un 40P01 (lanzaría en vez de responder).
    expect(validacion.ok || validacion.error === "conflicto").toBe(true);
    expect(asignacion.ok || asignacion.error === "invalido").toBe(true);
    await comprobarConsistencia();
  });
});
