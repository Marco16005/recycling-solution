import { eq, isNull, sql } from "drizzle-orm";
import { insertarCliente } from "../../src/datos/clientes";
import { crearConexion } from "../../src/datos/conexion-base";
import { leerConfiguracion } from "../../src/datos/configuracion";
import { configuracion, solicitudes } from "../../src/datos/esquema";
import { insertarOperador, insertarUnidad, registrarEntregaAvisoSiVersion } from "../../src/datos/flota";
import { insertarJornada } from "../../src/datos/jornadas";
import { insertarMovimientoPrivacidad } from "../../src/datos/privacidad";
import { insertarSolicitud } from "../../src/datos/solicitudes";
import { siguienteDiaOperacion } from "../../src/dominio/solicitudes/cola";
import { fechaEnMexico } from "../../src/dominio/tiempo";
import { buscarPorCorreo } from "../../src/seguridad/identidades";
import { nombreUnico } from "./datos";
import { USUARIOS_E2E } from "./sesion";

export interface EscenarioPlan {
  /** Siguiente día de operación después de hoy: el plan no depende de la hora a la que corra la prueba. */
  fecha: string;
  clientes: { id: string; nombre: string }[];
  /** En el mismo orden que clientes; registradas en ese orden (FIFO). */
  folios: string[];
  placa: string;
  operador: string;
  /** Cliente que exige la inducción de seguridad (requisito que depende del operador). */
  clienteConInduccion: string;
}

const PATIO = { lat: 20.62, lng: -100.3 };
const ventanas = [1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, horaInicio: "08:00", horaFin: "14:00" }));

/**
 * Prepara en la base de pruebas, como lo harían el administrador y el despachador: patio (si falta), tres clientes
 * habilitados cerca del patio (uno exige inducción), una unidad y un operador disponibles con jornada en la fecha y
 * tres solicitudes pendientes para esa fecha. Todo con nombres únicos.
 */
export async function prepararEscenarioPlan(): Promise<EscenarioPlan> {
  const { bd, cerrar } = crearConexion(process.env.DATABASE_URL ?? "", 1);
  try {
    const ahora = new Date();
    const fecha = siguienteDiaOperacion(fechaEnMexico(ahora), [1, 2, 3, 4, 5, 6]);
    await bd
      .update(configuracion)
      .set({ patioLat: PATIO.lat, patioLng: PATIO.lng, version: sql`${configuracion.version} + 1` })
      .where(isNull(configuracion.patioLat));
    const { versionAvisoPrivacidad } = await leerConfiguracion(bd);
    const despachador = (await buscarPorCorreo(bd, USUARIOS_E2E.despachador))?.usuarioId;
    if (!despachador) throw new Error("Falta el despachador de la semilla");
    const sufijo = nombreUnico("").trim();
    const placa = `E2E${sufijo.slice(-6).toUpperCase()}`;
    const operador = `Operador plan ${sufijo}`;

    return await bd.transaction(async (tx) => {
      const clientes: { id: string; nombre: string }[] = [];
      for (const [i, prefijo] of ["Plan Norte", "Plan Centro", "Plan Sur"].entries()) {
        const nombre = nombreUnico(prefijo);
        const c = await insertarCliente(
          tx,
          {
            nombre, contactoNombre: null, contactoTelefono: null, direccion: `Calle ${i + 1}, El Marqués, Qro.`,
            lat: PATIO.lat + 0.01 * (i + 1), lng: PATIO.lng + 0.01 * (i + 1), tipoResiduo: "RME", material: "Cartón",
            tiposUnidadAdmitidos: ["doble_rodada"], notasAcceso: null, tiempoServicioMin: 20, cargaEstimadaKg: 800, activo: true, ventanas,
            documentos: i === 0
              ? [{ nombre: "Inducción de seguridad", obligatorio: true, estado: "vigente", venceEl: "2030-12-31", tipoDocumentoId: "induccion_seguridad_cliente" }]
              : [],
          },
          ahora,
        );
        await insertarMovimientoPrivacidad(tx, { clienteId: c.id, versionAviso: versionAvisoPrivacidad, accion: "aceptado", medio: "papel", registradoPor: null, en: ahora });
        clientes.push({ id: c.id, nombre });
      }

      const vigente = (tipoDocumentoId: string) => ({ tipoDocumentoId, obligatorio: true, estado: "vigente" as const, venceEl: "2030-12-31", notas: null });
      const unidad = await insertarUnidad(
        tx,
        {
          placa, numeroEconomico: null, tipo: "doble_rodada", capacidadKg: 8000, rendimientoKmL: 3.5, activo: true, notas: null,
          documentos: ["tarjeta_circulacion", "poliza_responsabilidad_civil", "verificacion_vehicular", "registro_transporte_rme"].map(vigente),
        },
        ahora,
      );
      const op = await insertarOperador(tx, { nombre: operador, telefono: null, activo: true, documentos: [vigente("licencia_conducir")] }, ahora);
      await registrarEntregaAvisoSiVersion(tx, op.id, op.version, versionAvisoPrivacidad, ahora);
      await insertarJornada(tx, { fecha, unidadId: unidad.id, operadorId: op.id, disponibleDesde: "08:00", notas: null }, ahora);

      const folios: string[] = [];
      for (const [i, c] of clientes.entries()) {
        const folio = `S-E2E-${sufijo}-${i + 1}`;
        const registradaEn = new Date(ahora.getTime() + i * 1000);
        await insertarSolicitud(tx, {
          folio, clienteId: c.id, registradaEn, registradaPor: despachador, fechaSolicitada: fecha, canal: "telefono",
          cargaEstimadaKg: null, notas: null, capturaInicioEn: null, capturaFinEn: registradaEn,
        });
        folios.push(folio);
      }
      return { fecha, clientes, folios, placa, operador, clienteConInduccion: clientes[0].nombre };
    });
  } finally {
    await cerrar();
  }
}

/** Estado de una solicitud por folio, para comprobar lo que la pantalla no muestra. */
export async function estadoDeSolicitud(folio: string): Promise<{ estado: string; proximaFechaElegible: string; vecesPospuesta: number }> {
  const { bd, cerrar } = crearConexion(process.env.DATABASE_URL ?? "", 1);
  try {
    const [s] = await bd
      .select({ estado: solicitudes.estado, proximaFechaElegible: solicitudes.proximaFechaElegible, vecesPospuesta: solicitudes.vecesPospuesta })
      .from(solicitudes)
      .where(eq(solicitudes.folio, folio));
    if (!s) throw new Error(`No existe la solicitud ${folio}`);
    return s;
  } finally {
    await cerrar();
  }
}
