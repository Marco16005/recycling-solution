import { and, eq, sql } from "drizzle-orm";
import { generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "../../src/acciones/plan.nucleo";
import type { Contexto } from "../../src/acciones/tipos";
import { insertarCliente } from "../../src/datos/clientes";
import { crearConexion } from "../../src/datos/conexion-base";
import { leerConfiguracion } from "../../src/datos/configuracion";
import { configuracion, documentosOperador, jornadas, operadores, planes, solicitudes, unidades, usuarios } from "../../src/datos/esquema";
import { insertarOperador, insertarUnidad, registrarEntregaAvisoSiVersion } from "../../src/datos/flota";
import { insertarJornada } from "../../src/datos/jornadas";
import { insertarMovimientoPrivacidad } from "../../src/datos/privacidad";
import { insertarSolicitud } from "../../src/datos/solicitudes";
import { fechaEnMexico } from "../../src/dominio/tiempo";
import { buscarPorCorreo } from "../../src/seguridad/identidades";
import { nombreUnico } from "./datos";
import { USUARIOS_E2E } from "./sesion";

export interface DiaOperador {
  fecha: string;
  /** Jornada de operador@e2e.local. */
  jornadaId: string;
  /** Otra jornada del día, sin usuario: la que se marca no disponible para re-rutear. */
  otraJornadaId: string;
  placa: string;
  otraPlaca: string;
  /** Las cuatro solicitudes del día, en orden FIFO. */
  folios: string[];
  /**
   * Tablero del día (2026-11-21): un tercer camión, torton y sin usuario, con dos clientes que solo admiten torton. El
   * motor no puede mezclarlo con los dos camiones doble rodada, así que el reparto de la prueba del operador no cambia.
   */
  tableroJornadaId: string;
  tableroPlaca: string;
}

const PATIO = { lat: 20.62, lng: -100.3 };
const todoElDia = [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, horaInicio: "00:00", horaFin: "23:59" }));
const vigente = (tipoDocumentoId: string) => ({ tipoDocumentoId, obligatorio: true, estado: "vigente" as const, venceEl: "2030-12-31", notas: null });
const DOCS_UNIDAD = ["tarjeta_circulacion", "poliza_responsabilidad_civil", "verificacion_vehicular", "registro_transporte_rme"].map(vigente);

/** El día que ya preparó otra prueba de esta corrida (las pruebas corren una tras otra y comparten la base), o null. */
async function diaYaPreparado(bd: ReturnType<typeof crearConexion>["bd"], fecha: string): Promise<DiaOperador | null> {
  const delDia = await bd.select({ jornadaId: jornadas.id, placa: unidades.placa }).from(jornadas)
    .innerJoin(unidades, eq(unidades.id, jornadas.unidadId)).where(eq(jornadas.fecha, fecha));
  const tablero = delDia.find((j) => j.placa.startsWith("TAB"));
  if (!tablero) return null;
  const sufijo = tablero.placa.slice(3);
  const de = (prefijo: string) => delDia.find((j) => j.placa === `${prefijo}${sufijo}`);
  const ope = de("OPE"), otr = de("OTR");
  if (!ope || !otr) return null;
  const filas = await bd.select({ folio: solicitudes.folio }).from(solicitudes).where(sql`${solicitudes.folio} like ${`S-OPE-${sufijo}-%`}`);
  return {
    fecha, jornadaId: ope.jornadaId, otraJornadaId: otr.jornadaId, placa: ope.placa, otraPlaca: otr.placa,
    folios: filas.map((f) => f.folio).sort(), tableroJornadaId: tablero.jornadaId, tableroPlaca: tablero.placa,
  };
}

/**
 * Prepara HOY un plan validado listo para operar, a cualquier hora de la corrida: turno y ventanas de 00:00 a 23:59 y
 * todos los días de operación. Dos unidades pequeñas (dos solicitudes cada una): la de operador@e2e.local y otra sin
 * usuario; y un torton para el tablero del día. Idempotente en la corrida: si ya lo preparó otro archivo de prueba,
 * devuelve ese mismo día.
 */
export async function prepararDiaOperador(): Promise<DiaOperador> {
  const { bd, cerrar } = crearConexion(process.env.DATABASE_URL ?? "", 1);
  try {
    const ahora = new Date();
    const fecha = fechaEnMexico(ahora);
    const previo = await diaYaPreparado(bd, fecha);
    if (previo) return previo;
    await bd
      .update(configuracion)
      .set({
        patioLat: PATIO.lat, patioLng: PATIO.lng, turnoInicio: "00:00", turnoFin: "23:59",
        diasOperacion: sql`'{0,1,2,3,4,5,6}'::smallint[]`, version: sql`${configuracion.version} + 1`,
      })
      .where(eq(configuracion.id, 1));
    const { versionAvisoPrivacidad } = await leerConfiguracion(bd);
    const despachador = await buscarPorCorreo(bd, USUARIOS_E2E.despachador);
    const operadorUsuario = await buscarPorCorreo(bd, USUARIOS_E2E.operador);
    if (!despachador?.usuarioId || !operadorUsuario?.usuarioId) throw new Error("Falta la semilla de usuarios");
    const [ficha] = await bd.select({ operadorId: usuarios.operadorId }).from(usuarios).where(eq(usuarios.id, operadorUsuario.usuarioId));
    const operadorId = ficha.operadorId!;
    const sufijo = nombreUnico("").trim().slice(-6).toUpperCase();
    const placa = `OPE${sufijo}`;
    const otraPlaca = `OTR${sufijo}`;
    const tableroPlaca = `TAB${sufijo}`;

    const { jornadaId, otraJornadaId, folios, tableroJornadaId } = await bd.transaction(async (tx) => {
      // La ficha del operador de la semilla queda disponible: licencia vigente y aviso entregado.
      await tx.delete(documentosOperador).where(eq(documentosOperador.operadorId, operadorId));
      await tx.insert(documentosOperador).values({ operadorId, ...vigente("licencia_conducir") });
      const [op] = await tx.select({ version: operadores.version }).from(operadores).where(eq(operadores.id, operadorId));
      await registrarEntregaAvisoSiVersion(tx, operadorId, op.version, versionAvisoPrivacidad, ahora);

      const unidad = await insertarUnidad(tx, { placa, numeroEconomico: null, tipo: "doble_rodada", capacidadKg: 1700, rendimientoKmL: 3.5, activo: true, notas: null, documentos: DOCS_UNIDAD }, ahora);
      const otraUnidad = await insertarUnidad(tx, { placa: otraPlaca, numeroEconomico: null, tipo: "doble_rodada", capacidadKg: 1700, rendimientoKmL: 3.5, activo: true, notas: null, documentos: DOCS_UNIDAD }, ahora);
      const otro = await insertarOperador(tx, { nombre: `Operador sin usuario ${sufijo}`, telefono: null, activo: true, documentos: [vigente("licencia_conducir")] }, ahora);
      await registrarEntregaAvisoSiVersion(tx, otro.id, otro.version, versionAvisoPrivacidad, ahora);
      const jornadaId = await insertarJornada(tx, { fecha, unidadId: unidad.id, operadorId, disponibleDesde: "00:00", notas: null }, ahora);
      const otraJornadaId = await insertarJornada(tx, { fecha, unidadId: otraUnidad.id, operadorId: otro.id, disponibleDesde: "00:00", notas: null }, ahora);
      const torton = await insertarUnidad(tx, { placa: tableroPlaca, numeroEconomico: null, tipo: "torton", capacidadKg: 8000, rendimientoKmL: 3, activo: true, notas: null, documentos: DOCS_UNIDAD }, ahora);
      const operadorTablero = await insertarOperador(tx, { nombre: `Operador tablero ${sufijo}`, telefono: null, activo: true, documentos: [vigente("licencia_conducir")] }, ahora);
      await registrarEntregaAvisoSiVersion(tx, operadorTablero.id, operadorTablero.version, versionAvisoPrivacidad, ahora);
      const tableroJornadaId = await insertarJornada(tx, { fecha, unidadId: torton.id, operadorId: operadorTablero.id, disponibleDesde: "00:00", notas: null }, ahora);
      // Un nombre largo a propósito: tablero.spec comprueba que la tarjeta del camión no se sale del teléfono.
      for (const [i, prefijo] of ["Tablero Poniente", "Tablero Bajío Comercializadora de Cartón y Papel Reciclado del Centro de Querétaro"].entries()) {
        const c = await insertarCliente(tx, {
          nombre: nombreUnico(prefijo), contactoNombre: null, contactoTelefono: null, direccion: `Calle ${i + 10}, El Marqués, Qro.`,
          lat: PATIO.lat - 0.01 * (i + 1), lng: PATIO.lng - 0.01 * (i + 1), tipoResiduo: "RME", material: "Cartón",
          tiposUnidadAdmitidos: ["torton"], notasAcceso: null, tiempoServicioMin: 15, cargaEstimadaKg: 800, activo: true,
          ventanas: todoElDia, documentos: [],
        }, ahora);
        await insertarMovimientoPrivacidad(tx, { clienteId: c.id, versionAviso: versionAvisoPrivacidad, accion: "aceptado", medio: "papel", registradoPor: null, en: ahora });
        const registradaEn = new Date(ahora.getTime() - (2 - i) * 1000);
        await insertarSolicitud(tx, {
          folio: `S-TAB-${sufijo}-${i + 1}`, clienteId: c.id, registradaEn, registradaPor: despachador.usuarioId!, fechaSolicitada: fecha, canal: "telefono",
          cargaEstimadaKg: null, notas: null, capturaInicioEn: null, capturaFinEn: registradaEn,
        });
      }

      const folios: string[] = [];
      for (const [i, prefijo] of ["Operación Norte", "Operación Centro", "Operación Sur", "Operación Oriente"].entries()) {
        const c = await insertarCliente(tx, {
          nombre: nombreUnico(prefijo), contactoNombre: null, contactoTelefono: null, direccion: `Calle ${i + 1}, El Marqués, Qro.`,
          lat: PATIO.lat + 0.01 * (i + 1), lng: PATIO.lng + 0.01 * (i + 1), tipoResiduo: "RME", material: "Cartón",
          tiposUnidadAdmitidos: ["doble_rodada"], notasAcceso: "Tocar en caseta", tiempoServicioMin: 15, cargaEstimadaKg: 800, activo: true,
          ventanas: todoElDia, documentos: [],
        }, ahora);
        await insertarMovimientoPrivacidad(tx, { clienteId: c.id, versionAviso: versionAvisoPrivacidad, accion: "aceptado", medio: "papel", registradoPor: null, en: ahora });
        const folio = `S-OPE-${sufijo}-${i + 1}`;
        const registradaEn = new Date(ahora.getTime() - (4 - i) * 1000);
        await insertarSolicitud(tx, {
          folio, clienteId: c.id, registradaEn, registradaPor: despachador.usuarioId!, fechaSolicitada: fecha, canal: "telefono",
          cargaEstimadaKg: null, notas: null, capturaInicioEn: null, capturaFinEn: registradaEn,
        });
        folios.push(folio);
      }
      return { jornadaId, otraJornadaId, folios, tableroJornadaId };
    });

    // El plan del día se genera y valida como lo haría el despachador.
    const ctx: Contexto = { bd, usuario: { id: despachador.usuarioId, nombre: "E2E despachador", rol: "despachador", activo: true }, ahora: new Date() };
    const generado = await generarPlanDelDia(ctx, fecha);
    if (!generado.ok) throw new Error(`No se generó el plan de hoy: ${JSON.stringify(generado)}`);
    await iniciarRevision(ctx, generado.valor.planId);
    const [p] = await bd.select({ version: planes.version }).from(planes).where(eq(planes.id, generado.valor.planId));
    const validado = await validarPlanDelDia({ ...ctx, ahora: new Date(), reloj: () => new Date() }, generado.valor.planId, p.version, { requisitosConfirmados: true });
    if (!validado.ok) throw new Error(`No se validó el plan de hoy: ${JSON.stringify(validado)}`);
    const [j] = await bd.select({ id: jornadas.id }).from(jornadas).where(and(eq(jornadas.id, jornadaId), eq(jornadas.fecha, fecha)));
    if (!j) throw new Error("No quedó la jornada del operador");
    return { fecha, jornadaId, otraJornadaId, placa, otraPlaca, folios, tableroJornadaId, tableroPlaca };
  } finally {
    await cerrar();
  }
}
