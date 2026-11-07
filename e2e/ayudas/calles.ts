import { eq } from "drizzle-orm";
import { insertarCliente } from "../../src/datos/clientes";
import { crearConexion } from "../../src/datos/conexion-base";
import { jornadas, paradas, planes, rutas, solicitudes } from "../../src/datos/esquema";
import { insertarOperador, insertarUnidad } from "../../src/datos/flota";
import { insertarJornada } from "../../src/datos/jornadas";
import type { TiemposRuta } from "../../src/dominio/operacion/tipos";
import type { VersionesPlan } from "../../src/dominio/plan/tipos";
import { fechaEnMexico } from "../../src/dominio/tiempo";
import type { EntradaPlan, Plan } from "../../src/motor";
import { buscarPorCorreo } from "../../src/seguridad/identidades";
import { nombreUnico } from "./datos";
import { USUARIOS_E2E } from "./sesion";

export interface JornadaAtrasada { fecha: string; folio: string; placa: string }

const PATIO = { lat: 20.62, lng: -100.3 };

/**
 * Plan 7, P7-10. Siembra un plan validado de HACE DOS DÍAS (las otras ayudas usan hoy, ayer y mañana, y cada fecha admite
 * un solo validado) con una jornada que hizo check-in y salió del patio a las 08:00, pero nunca llegó a su única parada
 * (ventana 08:00–09:00). Como el reloj de la prueba ya pasó, el seguimiento de esa fecha proyecta la llegada a "ahora" y
 * muestra la parada en riesgo y el viaje fuera de turno. La entrada y el resultado son coherentes para que el plan se pueda
 * abrir en /despacho/plan?fecha=…; no pasaron por el motor (no se validan de nuevo).
 */
export async function sembrarJornadaAtrasada(): Promise<JornadaAtrasada> {
  const { bd, cerrar } = crearConexion(process.env.DATABASE_URL ?? "", 1);
  try {
    const hoy = fechaEnMexico(new Date());
    const fecha = new Date(Date.parse(`${hoy}T12:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
    const h = (hhmm: string) => new Date(`${fecha}T${hhmm}:00-06:00`);
    const despachador = (await buscarPorCorreo(bd, USUARIOS_E2E.despachador))?.usuarioId;
    if (!despachador) throw new Error("Falta la semilla de usuarios");
    const sufijo = nombreUnico("").trim().slice(-6).toUpperCase();
    const placa = `ATR${sufijo}`;
    const folio = `S-ATR-${sufijo}`;
    const ubicacion = { lat: PATIO.lat + 0.01, lng: PATIO.lng + 0.01 };

    await bd.transaction(async (tx) => {
      const unidad = await insertarUnidad(tx, { placa, numeroEconomico: null, tipo: "doble_rodada", capacidadKg: 8000, rendimientoKmL: 3, activo: true, notas: null, documentos: [] }, h("07:00"));
      const operador = await insertarOperador(tx, { nombre: `Operador atrasado ${sufijo}`, telefono: null, activo: true, documentos: [] }, h("07:00"));
      const jornadaId = await insertarJornada(tx, { fecha, unidadId: unidad.id, operadorId: operador.id, disponibleDesde: "08:00", notas: null }, h("07:00"));
      await tx.update(jornadas).set({ checkInEn: h("07:55") }).where(eq(jornadas.id, jornadaId));
      const cliente = await insertarCliente(tx, {
        nombre: nombreUnico("Cartonera atrasada"), contactoNombre: null, contactoTelefono: null, direccion: null, ...ubicacion,
        tipoResiduo: "RME", material: null, tiposUnidadAdmitidos: ["doble_rodada"], notasAcceso: null, tiempoServicioMin: 20,
        cargaEstimadaKg: 800, activo: true, ventanas: [], documentos: [],
      }, h("07:00"));
      const [s] = await tx.insert(solicitudes).values({
        folio, clienteId: cliente.id, registradaEn: h("06:00"), registradaPor: despachador, fechaSolicitada: fecha, proximaFechaElegible: fecha,
        canal: "telefono", estado: "en_ruta", capturaInicioEn: h("05:59"), capturaFinEn: h("06:00"), creadoEn: h("06:00"), actualizadoEn: h("08:00"),
      }).returning({ id: solicitudes.id });

      const ventana = { inicioMin: 480, finMin: 540 };
      const entrada: EntradaPlan = {
        fecha, instanteMin: 420,
        solicitudes: [{ id: s.id, folio, registradaEn: h("06:00").toISOString(), clienteId: cliente.id, ubicacion, ventanas: [ventana],
          tiempoServicioMin: 20, cargaKg: 800, tiposUnidadAdmitidos: ["doble_rodada"] }],
        unidades: [{ id: jornadaId, tipo: "doble_rodada", capacidadKg: 8000, ubicacionInicial: PATIO, libreDesdeMin: 480, cargaActualKg: 0 }],
        parametros: { patio: PATIO, turnoInicioMin: 480, turnoFinMin: 960, velocidadKmh: 30, factorCircuidad: 1.4, descargaMin: 20,
          capacidadMaximaPorTipoKg: { doble_rodada: 8000, rabon: 0, camioneta: 0, torton: 0, trailer: 0 }, semilla: 1, horasPico: [] },
      };
      const resultado: Plan = {
        versionMotor: "1.1.0",
        rutas: [{ unidadId: jornadaId, viajes: [{ numero: 1, salidaMin: 480, regresoPatioMin: 540, finDescargaMin: 560, cargaKg: 800, km: 6,
          paradas: [{ solicitudId: s.id, secuencia: 1, kmDesdeAnterior: 3, llegadaMin: 490, esperaMin: 0, inicioServicioMin: 490, finServicioMin: 510, ventana }] }] }],
        pospuestas: [], bloqueadas: [], traza: [],
        resumen: { ruteadas: 1, pospuestas: 0, bloqueadas: 0, km: 6, minutosTraslado: 20, kmMetodoActual: 6, minutosTrasladoMetodoActual: 20 },
      };
      const versiones: VersionesPlan = { solicitudes: {}, clientes: {}, jornadas: {}, unidades: {}, operadores: {}, configuracion: 1,
        traslados: { fuente: "aproximado", motivo: "sin_configurar", mapa: null, paresAproximados: 0 } };
      const [plan] = await tx.insert(planes).values({
        fecha, estado: "validado", generadoEn: h("07:00"), generadoPor: despachador, revisionIniciadaEn: h("07:05"), validadoEn: h("07:10"),
        validadoPor: despachador, requisitosConfirmadosEn: h("07:10"), semilla: 1, versionMotor: "1.1.0",
        entrada: entrada as never, versiones: versiones as never, resultado: resultado as never,
      }).returning({ id: planes.id });
      const tiempos: TiemposRuta = { puntos: ["patio", s.id], minLibres: [[0, 10], [10, 0]], horasPico: [], turnoFinMin: 960, descargaMin: 20 };
      const [ruta] = await tx.insert(rutas).values({
        planId: plan.id, jornadaId, numeroViaje: 1, salidaEstimada: h("08:00"), regresoEstimado: h("09:00"), finDescargaEstimado: h("09:20"),
        cargaKg: 800, kmEstimados: 6, kmContrafactual: 6, rendimientoKmLUsado: 3, disponibleParaSalirEn: h("08:00"), asignadaEn: h("07:10"),
        salidaPatioEn: h("08:00"), odometroInicioKm: 1000, tiempos,
      }).returning({ id: rutas.id });
      await tx.insert(paradas).values({
        rutaId: ruta.id, solicitudId: s.id, secuencia: 1, ventanaInicio: "08:00", ventanaFin: "09:00", llegadaEstimada: h("08:10"),
        inicioEstimado: h("08:10"), finEstimado: h("08:30"), esperaMin: 0, cargaKg: 800, kmDesdeAnterior: 3, kmContrafactual: 6,
        vigente: true, estado: "pendiente",
      });
    });
    return { fecha, folio, placa };
  } finally {
    await cerrar();
  }
}
