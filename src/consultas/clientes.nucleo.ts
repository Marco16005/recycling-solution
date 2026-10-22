import { z } from "zod";
import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { leerCartera, leerCliente } from "@/datos/clientes";
import { leerConfiguracion } from "@/datos/configuracion";
import { leerCatalogo } from "@/datos/flota";
import type { TipoDocumento } from "@/dominio/flota/tipos";
import { faltantesDeCliente, resumenK5, type Faltante, type ResumenK5 } from "@/dominio/clientes/completitud";
import { nombreNormalizado } from "@/dominio/clientes/csv";
import { motivosDeBloqueoCliente, type MotivoBloqueo } from "@/dominio/clientes/habilitacion";
import { TIPOS_RESIDUO, type ClienteGuardado, type TipoResiduo } from "@/dominio/clientes/tipos";
import { fechaEnMexico } from "@/dominio/tiempo";
import { puede } from "@/seguridad/permisos";
import { leerInstantanea } from "./instantanea";
import { estiloMapaUrl } from "./mapa";

export interface ClienteResumen {
  id: string;
  nombre: string;
  direccion: string | null;
  tipoResiduo: TipoResiduo | null;
  activo: boolean;
  faltantes: Faltante[];
  completo: boolean;
  motivosHoy: MotivoBloqueo[];
  /** Plan CRM: algún documento vence en 30 días o menos, o ya venció. */
  documentoPorVencer: boolean;
}

/** fecha: hoy en Ciudad de México. k5: sobre toda la cartera, sin importar el filtro. */
export interface ListadoClientes {
  fecha: string;
  k5: ResumenK5;
  clientes: ClienteResumen[];
  puedeEditar: boolean;
}

export interface FichaCliente {
  /** Catálogo de documentos de clientes, para elegir el tipo de cada documento. */
  catalogoDocumentos: TipoDocumento[];
  cliente: ClienteGuardado;
  faltantes: Faltante[];
  motivosHoy: MotivoBloqueo[];
  versionAvisoVigente: string;
  puedeEditar: boolean;
  estiloMapaUrl: string;
}

/** Lo que necesita la pantalla de alta. */
export interface ContextoAlta {
  estiloMapaUrl: string;
  versionAvisoVigente: string;
  catalogoDocumentos: TipoDocumento[];
}


const siNo = z.preprocess((v) => (v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : v), z.boolean());
/** Plan CRM, §4.10: filtros por URL; todos opcionales. */
export const filtroSchema = z.object({
  texto: z.string().max(100).optional(),
  residuo: z.enum(TIPOS_RESIDUO).optional(),
  estado: z.enum(["completo", "incompleto", "habilitado", "no_habilitado"]).optional(),
  sinUbicacion: siNo.optional(),
  documentos: z.enum(["por_vencer", "vencidos"]).optional(),
  activos: z.enum(["activos", "inactivos", "todos"]).optional(),
});

export const DIAS_POR_VENCER = 30;
const masDias = (fecha: string, dias: number) => new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const vencido = (d: ClienteGuardado["documentos"][number], fecha: string) => d.estado === "vencido" || (d.venceEl !== null && d.venceEl < fecha);
const porVencer = (d: ClienteGuardado["documentos"][number], fecha: string) =>
  !vencido(d, fecha) && d.venceEl !== null && d.venceEl <= masDias(fecha, DIAS_POR_VENCER);

/** Aplica los filtros de la cartera (lista, mapa y exportación comparten la regla). */
export function aplicarFiltros(cartera: ClienteGuardado[], filtros: z.output<typeof filtroSchema>, fecha: string, version: string): ClienteGuardado[] {
  const texto = nombreNormalizado(filtros.texto ?? "");
  return cartera.filter((c) => {
    if (texto && !nombreNormalizado(c.nombre).includes(texto)) return false;
    if (filtros.residuo && c.tipoResiduo !== filtros.residuo) return false;
    if (filtros.activos === "activos" && !c.activo) return false;
    if (filtros.activos === "inactivos" && c.activo) return false;
    if (filtros.sinUbicacion && c.lat !== null) return false;
    if (filtros.documentos === "por_vencer" && !c.documentos.some((d) => porVencer(d, fecha))) return false;
    if (filtros.documentos === "vencidos" && !c.documentos.some((d) => vencido(d, fecha))) return false;
    if (filtros.estado) {
      const completo = faltantesDeCliente(c, version).length === 0;
      const habilitado = motivosDeBloqueoCliente(c, fecha, version).length === 0;
      if (filtros.estado === "completo" && !completo) return false;
      if (filtros.estado === "incompleto" && completo) return false;
      if (filtros.estado === "habilitado" && !habilitado) return false;
      if (filtros.estado === "no_habilitado" && habilitado) return false;
    }
    return true;
  });
}

/** Insignia de la lista: algún documento vence en 30 días o menos, o ya venció. */
export const tieneDocumentoPorVencer = (c: ClienteGuardado, fecha: string) => c.documentos.some((d) => porVencer(d, fecha) || vencido(d, fecha));
const idSchema = z.uuid();


/** Permiso clientes.ver. filtro: FiltrosCartera; la búsqueda ignora mayúsculas, acentos y signos. K5 es de toda la cartera. */
export async function listarClientes(ctx: Contexto, filtro: unknown): Promise<Resultado<ListadoClientes>> {
  const permiso = permitir(ctx, "clientes.ver");
  if (!permiso.ok) return permiso;
  const validado = filtroSchema.safeParse(filtro ?? {});
  if (!validado.success) return { ok: false, error: "invalido", campos: { filtros: ["Filtro no válido"] } };
  const fecha = fechaEnMexico(ctx.ahora);

  const { version, cartera } = await leerInstantanea(ctx.bd, async (tx) => ({
    version: (await leerConfiguracion(tx)).versionAvisoPrivacidad,
    cartera: await leerCartera(tx),
  }));
  const encontrados = aplicarFiltros(cartera, validado.data, fecha, version);

  return {
    ok: true,
    valor: {
      fecha,
      k5: resumenK5(cartera, version),
      puedeEditar: puede(permiso.usuario, "clientes.editar"),
      clientes: encontrados.map((c) => {
        const faltantes = faltantesDeCliente(c, version);
        return {
          id: c.id,
          nombre: c.nombre,
          direccion: c.direccion,
          tipoResiduo: c.tipoResiduo,
          activo: c.activo,
          faltantes,
          completo: faltantes.length === 0,
          motivosHoy: motivosDeBloqueoCliente(c, fecha, version),
          documentoPorVencer: tieneDocumentoPorVencer(c, fecha),
        };
      }),
    },
  };
}

/** Permiso clientes.ver. */
export async function obtenerFicha(ctx: Contexto, id: unknown): Promise<Resultado<FichaCliente>> {
  const permiso = permitir(ctx, "clientes.ver");
  if (!permiso.ok) return permiso;
  const valido = idSchema.safeParse(id);
  if (!valido.success) return { ok: false, error: "no_encontrado" };

  const { version, cliente, catalogoDocumentos } = await leerInstantanea(ctx.bd, async (tx) => ({
    version: (await leerConfiguracion(tx)).versionAvisoPrivacidad,
    cliente: await leerCliente(tx, valido.data),
    catalogoDocumentos: await leerCatalogo(tx, "cliente"),
  }));
  if (cliente === null) return { ok: false, error: "no_encontrado" };
  return {
    ok: true,
    valor: {
      catalogoDocumentos,
      cliente,
      faltantes: faltantesDeCliente(cliente, version),
      motivosHoy: motivosDeBloqueoCliente(cliente, fechaEnMexico(ctx.ahora), version),
      versionAvisoVigente: version,
      puedeEditar: puede(permiso.usuario, "clientes.editar"),
      estiloMapaUrl: estiloMapaUrl(),
    },
  };
}

/** Permiso clientes.editar. */
export async function obtenerContextoAlta(ctx: Contexto): Promise<Resultado<ContextoAlta>> {
  const permiso = permitir(ctx, "clientes.editar");
  if (!permiso.ok) return permiso;
  return leerInstantanea(ctx.bd, async (tx) => ({
    ok: true as const,
    valor: {
      estiloMapaUrl: estiloMapaUrl(),
      versionAvisoVigente: (await leerConfiguracion(tx)).versionAvisoPrivacidad,
      catalogoDocumentos: await leerCatalogo(tx, "cliente"),
    },
  }));
}
