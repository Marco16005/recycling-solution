import { insertarCliente } from "../../src/datos/clientes";
import { crearConexion } from "../../src/datos/conexion-base";
import { leerConfiguracionCompleta } from "../../src/datos/configuracion";
import { solicitudes } from "../../src/datos/esquema";
import { insertarMovimientoPrivacidad } from "../../src/datos/privacidad";
import { siguienteDiaOperacion } from "../../src/dominio/solicitudes/cola";
import { fechaEnMexico } from "../../src/dominio/tiempo";
import type { ClienteEntrada } from "../../src/dominio/clientes/esquemas";
import { buscarPorCorreo } from "../../src/seguridad/identidades";
import { nombreUnico } from "./datos";
import { USUARIOS_E2E } from "./sesion";

export interface ClienteCrm { id: string; nombre: string }
export interface CarteraCrm {
  /** Siguiente día de operación según la configuración de este momento: la fecha por omisión de las propuestas. */
  fechaPropuestas: string;
  /** Tres solicitudes atendidas cada 7 días; su fecha esperada es fechaPropuestas (motivo "ritmo"). */
  ritmo: ClienteCrm;
  /** Recurrencia fija en el día de la semana de fechaPropuestas (motivo "recurrencia"). */
  recurrencia: ClienteCrm;
  /** Un documento que vence en 10 días (filtro "documentos por vencer" e insignia). */
  documentoPorVencer: ClienteCrm;
  /** Sin latitud ni longitud (filtro "sin ubicación" y conteo del mapa). */
  sinUbicacion: ClienteCrm;
}

const PATIO = { lat: 20.62, lng: -100.3 };
const todoElDia = [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, horaInicio: "00:00", horaFin: "23:59" }));
const masDias = (fecha: string, dias: number) => new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/**
 * Plan CRM, PC-5. Siembra cuatro clientes sintéticos para el e2e del CRM: uno con ritmo aprendido, uno con recurrencia,
 * uno con un documento por vencer y uno sin ubicación. Todos habilitados todos los días (salvo el que no tiene ubicación),
 * con nombres únicos para no cruzarse con otras pruebas.
 */
export async function sembrarCarteraCrm(): Promise<CarteraCrm> {
  const { bd, cerrar } = crearConexion(process.env.DATABASE_URL ?? "", 1);
  try {
    const ahora = new Date();
    const hoy = fechaEnMexico(ahora);
    const config = await leerConfiguracionCompleta(bd);
    const fechaPropuestas = siguienteDiaOperacion(hoy, config.diasOperacion);
    const despachador = (await buscarPorCorreo(bd, USUARIOS_E2E.despachador))?.usuarioId;
    if (!despachador) throw new Error("Falta la semilla de usuarios");
    const sufijo = nombreUnico("").trim().slice(-6).toUpperCase();

    return await bd.transaction(async (tx) => {
      const crear = async (prefijo: string, cambios: Partial<ClienteEntrada>, desplazamiento: number): Promise<ClienteCrm> => {
        const nombre = nombreUnico(prefijo);
        const { id } = await insertarCliente(tx, {
          nombre, contactoNombre: "Contacto sintético", contactoTelefono: "4420000000", direccion: "Calle de prueba 1",
          lat: PATIO.lat + desplazamiento, lng: PATIO.lng + desplazamiento, tipoResiduo: "RME", material: "Cartón",
          tiposUnidadAdmitidos: ["doble_rodada", "rabon", "camioneta"], notasAcceso: null, tiempoServicioMin: 20, cargaEstimadaKg: 500,
          activo: true, ventanas: todoElDia, documentos: [], ...cambios,
        }, ahora);
        await insertarMovimientoPrivacidad(tx, { clienteId: id, versionAviso: config.versionAvisoPrivacidad, accion: "aceptado", medio: "papel", registradoPor: null, en: ahora });
        return { id, nombre };
      };
      const ritmo = await crear("CRM Ritmo", {}, 0.01);
      for (const [i, atras] of [21, 14, 7].entries()) {
        const fecha = masDias(fechaPropuestas, -atras);
        await tx.insert(solicitudes).values({
          folio: `S-CRM-${sufijo}-${i + 1}`, clienteId: ritmo.id, registradaEn: new Date(`${fecha}T13:00:00Z`), registradaPor: despachador,
          fechaSolicitada: fecha, proximaFechaElegible: fecha, canal: "telefono", estado: "atendida",
          capturaInicioEn: null, capturaFinEn: new Date(`${fecha}T13:00:00Z`), creadoEn: ahora, actualizadoEn: ahora,
        });
      }
      const dia = new Date(`${fechaPropuestas}T00:00:00Z`).getUTCDay();
      const recurrencia = await crear("CRM Recurrencia", { recurrencia: { tipo: "dias_semana", dias: [dia] } }, 0.015);
      const documentoPorVencer = await crear("CRM Documento", {
        documentos: [{ nombre: "Contrato de servicio", obligatorio: false, estado: "vigente", venceEl: masDias(hoy, 10) }],
      }, 0.02);
      const sinUbicacion = await crear("CRM Sin Pin", { lat: null, lng: null }, 0);
      return { fechaPropuestas, ritmo, recurrencia, documentoPorVencer, sinUbicacion };
    });
  } finally {
    await cerrar();
  }
}
