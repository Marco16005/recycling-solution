import { insertarCliente } from "../../src/datos/clientes";
import { crearConexion } from "../../src/datos/conexion-base";
import { planes, paradas, rutas, solicitudes } from "../../src/datos/esquema";
import { insertarOperador, insertarUnidad } from "../../src/datos/flota";
import { insertarJornada } from "../../src/datos/jornadas";
import { fechaEnMexico } from "../../src/dominio/tiempo";
import { buscarPorCorreo } from "../../src/seguridad/identidades";
import { nombreUnico } from "./datos";
import { USUARIOS_E2E } from "./sesion";

export interface DiaOperado { fecha: string; folios: [string, string]; placa: string }

/**
 * Siembra en la base un día de AYER ya operado, con datos exclusivos y horas conocidas, para comprobar el panel y el CSV
 * con valores calculados a mano (Plan 6, I4). Es un día pasado para que nada de las otras pruebas (que operan hoy o
 * mañana) se mezcle en el rango; el flujo real de eventos lo cubren las pruebas de operación y e2e/operador.spec.ts.
 *
 * Un viaje, dos paradas completadas (horas de Ciudad de México):
 * disponible 08:00, asignada 08:10, salida 08:20 (odómetro 1000), regreso 10:30 (1030), descarga 10:45.
 * P1: ventana 08:30–09:00, llegada 08:35, inicio 08:40, fin 09:00. P2: ventana 09:00–12:00, llegada 09:20, inicio 09:25, fin 09:45.
 * Plan con resumen simulado: 20 km contra 40 del método actual. Contrafactual 10 km por parada.
 */
export async function sembrarDiaOperado(): Promise<DiaOperado> {
  const { bd, cerrar } = crearConexion(process.env.DATABASE_URL ?? "", 1);
  try {
    const hoy = fechaEnMexico(new Date());
    const ayer = new Date(Date.parse(`${hoy}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const h = (hhmm: string) => new Date(`${ayer}T${hhmm}:00-06:00`);
    const despachador = (await buscarPorCorreo(bd, USUARIOS_E2E.despachador))?.usuarioId;
    if (!despachador) throw new Error("Falta la semilla de usuarios");
    const sufijo = nombreUnico("").trim().slice(-6).toUpperCase();
    const placa = `IND${sufijo}`;

    const folios = await bd.transaction(async (tx) => {
      const unidad = await insertarUnidad(tx, { placa, numeroEconomico: null, tipo: "doble_rodada", capacidadKg: 8000, rendimientoKmL: 3, activo: true, notas: null, documentos: [] }, h("07:00"));
      const operador = await insertarOperador(tx, { nombre: `Operador indicadores ${sufijo}`, telefono: null, activo: true, documentos: [] }, h("07:00"));
      const jornadaId = await insertarJornada(tx, { fecha: ayer, unidadId: unidad.id, operadorId: operador.id, disponibleDesde: "08:00", notas: null }, h("07:00"));
      const [plan] = await tx.insert(planes).values({
        fecha: ayer, estado: "validado", generadoEn: h("07:30"), generadoPor: despachador, revisionIniciadaEn: h("07:32"),
        validadoEn: h("07:36"), validadoPor: despachador, requisitosConfirmadosEn: h("07:36"), semilla: 1, versionMotor: "1.0.0",
        entrada: {} as never, versiones: {},
        resultado: { resumen: { ruteadas: 2, pospuestas: 0, bloqueadas: 0, km: 20, minutosTraslado: 40, kmMetodoActual: 40, minutosTrasladoMetodoActual: 80 } } as never,
      }).returning({ id: planes.id });
      const [ruta] = await tx.insert(rutas).values({
        planId: plan.id, jornadaId, numeroViaje: 1, salidaEstimada: h("08:20"), regresoEstimado: h("10:30"), finDescargaEstimado: h("10:45"),
        cargaKg: 1600, kmEstimados: 20, kmContrafactual: 20, rendimientoKmLUsado: 3, disponibleParaSalirEn: h("08:00"), asignadaEn: h("08:10"),
        salidaPatioEn: h("08:20"), regresoPatioEn: h("10:30"), descargaFinEn: h("10:45"), odometroInicioKm: 1000, odometroFinKm: 1030,
      }).returning({ id: rutas.id });
      const folios: string[] = [];
      const visitas = [
        { ventana: ["08:30", "09:00"], llegada: "08:35", inicio: "08:40", fin: "09:00" },
        { ventana: ["09:00", "12:00"], llegada: "09:20", inicio: "09:25", fin: "09:45" },
      ];
      for (const [i, v] of visitas.entries()) {
        const cliente = await insertarCliente(tx, {
          nombre: nombreUnico(`Indicadores ${i + 1}`), contactoNombre: null, contactoTelefono: null, direccion: null, lat: 20.62, lng: -100.3,
          tipoResiduo: "RME", material: null, tiposUnidadAdmitidos: ["doble_rodada"], notasAcceso: null, tiempoServicioMin: 20,
          cargaEstimadaKg: 800, activo: true, ventanas: [], documentos: [],
        }, h("07:00"));
        const folio = `S-IND-${sufijo}-${i + 1}`;
        const [s] = await tx.insert(solicitudes).values({
          folio, clienteId: cliente.id, registradaEn: h("07:00"), registradaPor: despachador, fechaSolicitada: ayer, proximaFechaElegible: ayer,
          canal: "telefono", estado: "atendida", capturaInicioEn: h("06:59"), capturaFinEn: h("07:00"), creadoEn: h("07:00"), actualizadoEn: h("07:00"),
        }).returning({ id: solicitudes.id });
        await tx.insert(paradas).values({
          rutaId: ruta.id, solicitudId: s.id, secuencia: i + 1, ventanaInicio: v.ventana[0], ventanaFin: v.ventana[1],
          llegadaEstimada: h(v.llegada), inicioEstimado: h(v.inicio), finEstimado: h(v.fin), esperaMin: 0, cargaKg: 800,
          kmDesdeAnterior: 5, kmContrafactual: 10, vigente: true, estado: "completada",
          llegadaEn: h(v.llegada), inicioServicioEn: h(v.inicio), finServicioEn: h(v.fin), cierreEn: h(v.fin),
        });
        folios.push(folio);
      }
      return folios as [string, string];
    });
    return { fecha: ayer, folios, placa };
  } finally {
    await cerrar();
  }
}
