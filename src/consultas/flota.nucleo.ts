import { z } from "zod";
import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { leerConfiguracion } from "@/datos/configuracion";
import { leerCatalogo, leerOperador, leerOperadores, leerUnidad, leerUnidades } from "@/datos/flota";
import { nombreNormalizado } from "@/dominio/clientes/csv";
import type { TipoUnidad } from "@/dominio/clientes/tipos";
import {
  documentosPorVencer, motivosNoDisponibleOperador, motivosNoDisponibleUnidad, normalizarPlaca,
} from "@/dominio/flota/disponibilidad";
import type {
  DocumentoRegistrado, MotivoNoDisponible, OperadorGuardado, TipoDocumento, UnidadGuardada,
} from "@/dominio/flota/tipos";
import { fechaEnMexico } from "@/dominio/tiempo";
import { puede } from "@/seguridad/permisos";
import { leerInstantanea } from "./instantanea";

export interface UnidadResumen { id: string; placa: string; numeroEconomico: string | null; tipo: TipoUnidad; capacidadKg: number; activo: boolean }
export interface OperadorResumen { id: string; nombre: string; activo: boolean }

/** motivos y porVencer se calculan para la fecha de la consulta (hoy en Ciudad de México); porVencer: 30 días. */
export type FilaUnidad = UnidadGuardada & { motivos: MotivoNoDisponible[]; porVencer: DocumentoRegistrado[] };
export type FilaOperador = OperadorGuardado & { motivos: MotivoNoDisponible[]; porVencer: DocumentoRegistrado[] };

export interface ListadoUnidades { fecha: string; unidades: FilaUnidad[]; catalogo: TipoDocumento[]; puedeEditar: boolean }
export interface ListadoOperadores { fecha: string; operadores: FilaOperador[]; catalogo: TipoDocumento[]; puedeEditar: boolean }
export interface FichaUnidad { fecha: string; unidad: FilaUnidad; catalogo: TipoDocumento[]; puedeEditar: boolean }
export interface FichaOperador {
  fecha: string; operador: FilaOperador; catalogo: TipoDocumento[]; puedeEditar: boolean; versionAvisoVigente: string;
}
/** Para las pantallas de alta: el catálogo de la entidad y, en operadores, la versión vigente del aviso. */
export interface ContextoAltaFlota { catalogoUnidad: TipoDocumento[]; catalogoOperador: TipoDocumento[]; versionAvisoVigente: string }

const DIAS_POR_VENCER = 30;
const idSchema = z.uuid();
const filtroUnidadesSchema = z.object({ texto: z.string().max(60).optional(), incluirInactivas: z.boolean().optional() });
const filtroOperadoresSchema = z.object({ texto: z.string().max(60).optional(), incluirInactivos: z.boolean().optional() });

export const resumenUnidad = (u: UnidadGuardada): UnidadResumen => ({
  id: u.id, placa: u.placa, numeroEconomico: u.numeroEconomico, tipo: u.tipo, capacidadKg: u.capacidadKg, activo: u.activo,
});
export const resumenOperador = (o: OperadorGuardado): OperadorResumen => ({ id: o.id, nombre: o.nombre, activo: o.activo });

function filaUnidad(u: UnidadGuardada, catalogo: TipoDocumento[], fecha: string): FilaUnidad {
  return { ...u, motivos: motivosNoDisponibleUnidad(u, catalogo, fecha), porVencer: documentosPorVencer(u.documentos, fecha, DIAS_POR_VENCER) };
}

function filaOperador(o: OperadorGuardado, catalogo: TipoDocumento[], fecha: string): FilaOperador {
  return { ...o, motivos: motivosNoDisponibleOperador(o, catalogo, fecha), porVencer: documentosPorVencer(o.documentos, fecha, DIAS_POR_VENCER) };
}

/** Permiso flota.ver. filtro: { texto?: string; incluirInactivas?: boolean }; texto busca en placa y número económico. */
export async function listarUnidades(ctx: Contexto, filtro: unknown): Promise<Resultado<ListadoUnidades>> {
  const permiso = permitir(ctx, "flota.ver");
  if (!permiso.ok) return permiso;
  const validado = filtroUnidadesSchema.safeParse(filtro ?? {});
  if (!validado.success) return { ok: false, error: "invalido", campos: { texto: ["Búsqueda no válida"] } };
  const fecha = fechaEnMexico(ctx.ahora);
  const texto = normalizarPlaca(validado.data.texto ?? "");

  const { catalogo, todas } = await leerInstantanea(ctx.bd, async (tx) => ({
    catalogo: await leerCatalogo(tx, "unidad"),
    todas: await leerUnidades(tx),
  }));
  const unidades = todas
    .filter((u) => validado.data.incluirInactivas || u.activo)
    .filter((u) => texto === "" || u.placa.includes(texto) || normalizarPlaca(u.numeroEconomico ?? "").includes(texto))
    .map((u) => filaUnidad(u, catalogo, fecha));
  return { ok: true, valor: { fecha, unidades, catalogo, puedeEditar: puede(permiso.usuario, "flota.editar") } };
}

/** Permiso flota.ver. filtro: { texto?: string; incluirInactivos?: boolean }; texto busca en el nombre sin acentos. */
export async function listarOperadores(ctx: Contexto, filtro: unknown): Promise<Resultado<ListadoOperadores>> {
  const permiso = permitir(ctx, "flota.ver");
  if (!permiso.ok) return permiso;
  const validado = filtroOperadoresSchema.safeParse(filtro ?? {});
  if (!validado.success) return { ok: false, error: "invalido", campos: { texto: ["Búsqueda no válida"] } };
  const fecha = fechaEnMexico(ctx.ahora);
  const texto = nombreNormalizado(validado.data.texto ?? "");

  const { catalogo, todos } = await leerInstantanea(ctx.bd, async (tx) => ({
    catalogo: await leerCatalogo(tx, "operador"),
    todos: await leerOperadores(tx),
  }));
  const operadores = todos
    .filter((o) => validado.data.incluirInactivos || o.activo)
    .filter((o) => texto === "" || nombreNormalizado(o.nombre).includes(texto))
    .map((o) => filaOperador(o, catalogo, fecha));
  return { ok: true, valor: { fecha, operadores, catalogo, puedeEditar: puede(permiso.usuario, "flota.editar") } };
}

/** Permiso flota.ver. */
export async function obtenerUnidad(ctx: Contexto, id: unknown): Promise<Resultado<FichaUnidad>> {
  const permiso = permitir(ctx, "flota.ver");
  if (!permiso.ok) return permiso;
  const valido = idSchema.safeParse(id);
  if (!valido.success) return { ok: false, error: "no_encontrado" };
  const fecha = fechaEnMexico(ctx.ahora);
  const { catalogo, unidad } = await leerInstantanea(ctx.bd, async (tx) => ({
    catalogo: await leerCatalogo(tx, "unidad"),
    unidad: await leerUnidad(tx, valido.data),
  }));
  if (unidad === null) return { ok: false, error: "no_encontrado" };
  return { ok: true, valor: { fecha, unidad: filaUnidad(unidad, catalogo, fecha), catalogo, puedeEditar: puede(permiso.usuario, "flota.editar") } };
}

/** Permiso flota.ver. */
export async function obtenerOperador(ctx: Contexto, id: unknown): Promise<Resultado<FichaOperador>> {
  const permiso = permitir(ctx, "flota.ver");
  if (!permiso.ok) return permiso;
  const valido = idSchema.safeParse(id);
  if (!valido.success) return { ok: false, error: "no_encontrado" };
  const fecha = fechaEnMexico(ctx.ahora);
  const { catalogo, operador, version } = await leerInstantanea(ctx.bd, async (tx) => ({
    catalogo: await leerCatalogo(tx, "operador"),
    operador: await leerOperador(tx, valido.data),
    version: (await leerConfiguracion(tx)).versionAvisoPrivacidad,
  }));
  if (operador === null) return { ok: false, error: "no_encontrado" };
  return {
    ok: true,
    valor: {
      fecha,
      operador: filaOperador(operador, catalogo, fecha),
      catalogo,
      puedeEditar: puede(permiso.usuario, "flota.editar"),
      versionAvisoVigente: version,
    },
  };
}

/** Permiso flota.editar. */
export async function contextoAltaFlota(ctx: Contexto): Promise<Resultado<ContextoAltaFlota>> {
  const permiso = permitir(ctx, "flota.editar");
  if (!permiso.ok) return permiso;
  return leerInstantanea(ctx.bd, async (tx) => ({
    ok: true as const,
    valor: {
      catalogoUnidad: await leerCatalogo(tx, "unidad"),
      catalogoOperador: await leerCatalogo(tx, "operador"),
      versionAvisoVigente: (await leerConfiguracion(tx)).versionAvisoPrivacidad,
    },
  }));
}
