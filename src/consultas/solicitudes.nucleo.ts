import { z } from "zod";
import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { fechaSchema } from "@/acciones/validacion";
import { leerCartera } from "@/datos/clientes";
import { leerConfiguracionCompleta } from "@/datos/configuracion";
import { leerSolicitudesParaCola } from "@/datos/solicitudes";
import { nombreNormalizado } from "@/dominio/clientes/csv";
import { motivosDeBloqueoCliente, type MotivoBloqueo } from "@/dominio/clientes/habilitacion";
import { colaDelDia } from "@/dominio/solicitudes/cola";
import type { ElementoCola } from "@/dominio/solicitudes/tipos";
import { fechaEnMexico } from "@/dominio/tiempo";
import { puede } from "@/seguridad/permisos";
import { leerInstantanea } from "./instantanea";

export type ElementoColaVista = ElementoCola & { cliente: { id: string; nombre: string; direccion: string | null } };
/** elementos: pendientes de cualquier fecha y cerradas cuya fecha solicitada es la consultada, en orden FIFO. */
export interface VistaCola {
  fecha: string; elementos: ElementoColaVista[];
  resumen: { listas: number; bloqueadas: number; atrasadas: number; futuras: number };
  puedeRegistrar: boolean; puedeCancelar: boolean;
}
export interface ClienteParaSolicitud {
  id: string; nombre: string; direccion: string | null; cargaEstimadaKg: number | null; motivosHoy: MotivoBloqueo[];
}

const MAX_SUGERENCIAS = 10;
const textoSchema = z.string().trim().min(1).max(60);

/** Permiso solicitudes.ver. fecha: "AAAA-MM-DD", o undefined para hoy. */
export async function colaDeSolicitudes(ctx: Contexto, fecha: unknown): Promise<Resultado<VistaCola>> {
  const permiso = permitir(ctx, "solicitudes.ver");
  if (!permiso.ok) return permiso;
  const dia = fecha === undefined ? fechaEnMexico(ctx.ahora) : fechaSchema.safeParse(fecha).data;
  if (dia === undefined) return { ok: false, error: "invalido", campos: { fecha: ["Fecha no válida"] } };

  const { config, solicitudes, cartera } = await leerInstantanea(ctx.bd, async (tx) => ({
    config: await leerConfiguracionCompleta(tx),
    solicitudes: await leerSolicitudesParaCola(tx, dia),
    cartera: await leerCartera(tx),
  }));
  const clientes = new Map(cartera.map((c) => [c.id, c]));
  const cola = colaDelDia(solicitudes, clientes, dia, config.versionAvisoPrivacidad, config.diasOperacion, config.diasParaAtrasada);
  const elementos = cola.map((e) => {
    const c = clientes.get(e.solicitud.clienteId)!;
    return { ...e, cliente: { id: c.id, nombre: c.nombre, direccion: c.direccion } };
  });
  return {
    ok: true,
    valor: {
      fecha: dia,
      elementos,
      resumen: {
        listas: elementos.filter((e) => e.estado === "lista").length,
        bloqueadas: elementos.filter((e) => e.estado === "bloqueada").length,
        atrasadas: elementos.filter((e) => e.atrasada).length,
        futuras: elementos.filter((e) => e.estado === "futura").length,
      },
      puedeRegistrar: puede(permiso.usuario, "solicitudes.registrar"),
      puedeCancelar: puede(permiso.usuario, "solicitudes.cancelar"),
    },
  };
}

/** Permiso solicitudes.registrar. Clientes activos cuyo nombre contiene el texto (sin acentos); máximo 10. */
export async function buscarClientesParaSolicitud(ctx: Contexto, texto: unknown): Promise<Resultado<ClienteParaSolicitud[]>> {
  const permiso = permitir(ctx, "solicitudes.registrar");
  if (!permiso.ok) return permiso;
  const validado = textoSchema.safeParse(texto);
  if (!validado.success) return { ok: true, valor: [] };
  const buscado = nombreNormalizado(validado.data);
  const hoy = fechaEnMexico(ctx.ahora);

  const { cartera, version } = await leerInstantanea(ctx.bd, async (tx) => ({
    cartera: await leerCartera(tx),
    version: (await leerConfiguracionCompleta(tx)).versionAvisoPrivacidad,
  }));
  return {
    ok: true,
    valor: cartera
      .filter((c) => c.activo && nombreNormalizado(c.nombre).includes(buscado))
      .slice(0, MAX_SUGERENCIAS)
      .map((c) => ({
        id: c.id, nombre: c.nombre, direccion: c.direccion, cargaEstimadaKg: c.cargaEstimadaKg,
        motivosHoy: motivosDeBloqueoCliente(c, hoy, version),
      })),
  };
}
