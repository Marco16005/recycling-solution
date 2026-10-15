import { registrarEvento } from "@/datos/bitacora";
import { leerConfiguracion } from "@/datos/configuracion";
import {
  actualizarOperadorSiVersion, actualizarUnidadSiVersion, insertarOperador, insertarUnidad, leerCatalogo, leerOperador,
  leerUnidad, registrarEntregaAvisoSiVersion, unidadesConPlacaONumero,
} from "@/datos/flota";
import { erroresPorCampo } from "@/dominio/clientes/esquemas";
import { operadorSchema, unidadSchema } from "@/dominio/flota/esquemas";
import type { AplicaDocumento, DocumentoRegistrado, OperadorEntrada, UnidadEntrada } from "@/dominio/flota/tipos";
import type { Tx } from "@/datos/bd";
import { permitir } from "./autorizacion";
import { camposDistintos } from "./cambios";
import type { Contexto, Resultado } from "./tipos";
import { esDuplicado, invalido, validarIdYVersion, versionSchema, idSchema } from "./validacion";

const CAMPOS_UNIDAD = ["placa", "numeroEconomico", "tipo", "capacidadKg", "rendimientoKmL", "activo", "notas", "documentos"] as const;
const CAMPOS_OPERADOR = ["nombre", "telefono", "activo", "documentos"] as const;

/** Los documentos deben ser de tipos del catálogo que aplican a la entidad. */
async function tiposAjenos(tx: Tx, docs: DocumentoRegistrado[], aplicaA: AplicaDocumento): Promise<string[]> {
  const validos = new Set((await leerCatalogo(tx, aplicaA)).map((t) => t.id));
  return docs.filter((d) => !validos.has(d.tipoDocumentoId)).map((d) => d.tipoDocumentoId);
}

const comoEntradaUnidad = (u: UnidadEntrada): UnidadEntrada => ({
  placa: u.placa, numeroEconomico: u.numeroEconomico, tipo: u.tipo, capacidadKg: u.capacidadKg,
  rendimientoKmL: u.rendimientoKmL, activo: u.activo, notas: u.notas, documentos: u.documentos,
});
const comoEntradaOperador = (o: OperadorEntrada): OperadorEntrada => ({
  nombre: o.nombre, telefono: o.telefono, activo: o.activo, documentos: o.documentos,
});

/**
 * Crea (id y versionEsperada null) o actualiza una unidad con sus documentos. Permiso flota.editar.
 * entrada: UnidadEntrada (unidadSchema). Placa o número económico repetidos: invalido con campos.placa o campos.numeroEconomico.
 */
export async function guardarUnidad(ctx: Contexto, id: unknown, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ id: string; version: number }>> {
  const permiso = permitir(ctx, "flota.editar");
  if (!permiso.ok) return permiso;
  const ids = validarIdYVersion(id, versionEsperada);
  if (!ids.ok) return ids;
  const validado = unidadSchema.safeParse(entrada);
  if (!validado.success) return invalido(erroresPorCampo(validado.error));
  const datos = comoEntradaUnidad(validado.data);
  const usuarioId = permiso.usuario.id;

  try {
    return await ctx.bd.transaction(async (tx): Promise<Resultado<{ id: string; version: number }>> => {
      const ajenos = await tiposAjenos(tx, datos.documentos, "unidad");
      if (ajenos.length > 0) return invalido({ documentos: [`Tipos de documento que no aplican a unidades: ${ajenos.join(", ")}`] });
      const repetidas = await unidadesConPlacaONumero(tx, datos.placa, datos.numeroEconomico, ids.id);
      if (repetidas.some((r) => r.placa === datos.placa)) return invalido({ placa: ["Ya hay una unidad con esa placa"] });
      if (repetidas.length > 0) return invalido({ numeroEconomico: ["Ya hay una unidad con ese número económico"] });

      if (ids.id === null) {
        const nueva = await insertarUnidad(tx, datos, ctx.ahora);
        await registrarEvento(tx, { usuarioId, entidad: "unidad", entidadId: nueva.id, accion: "crear", campos: camposDistintos(null, datos, CAMPOS_UNIDAD) });
        return { ok: true, valor: nueva };
      }
      const antes = await leerUnidad(tx, ids.id);
      if (antes === null) return { ok: false, error: "no_encontrado" };
      const r = await actualizarUnidadSiVersion(tx, ids.id, ids.version!, datos, ctx.ahora);
      if (r.estado !== "actualizado") return { ok: false, error: r.estado };
      await registrarEvento(tx, {
        usuarioId, entidad: "unidad", entidadId: ids.id, accion: "actualizar",
        campos: camposDistintos(comoEntradaUnidad(antes), datos, CAMPOS_UNIDAD),
      });
      return { ok: true, valor: { id: ids.id, version: r.version } };
    });
  } catch (error) {
    if (esDuplicado(error)) return invalido({ placa: ["Ya hay una unidad con esa placa o número económico"] });
    throw error;
  }
}

/** Igual que guardarUnidad. entrada: OperadorEntrada (operadorSchema). */
export async function guardarOperador(ctx: Contexto, id: unknown, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ id: string; version: number }>> {
  const permiso = permitir(ctx, "flota.editar");
  if (!permiso.ok) return permiso;
  const ids = validarIdYVersion(id, versionEsperada);
  if (!ids.ok) return ids;
  const validado = operadorSchema.safeParse(entrada);
  if (!validado.success) return invalido(erroresPorCampo(validado.error));
  const datos = comoEntradaOperador(validado.data);
  const usuarioId = permiso.usuario.id;

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ id: string; version: number }>> => {
    const ajenos = await tiposAjenos(tx, datos.documentos, "operador");
    if (ajenos.length > 0) return invalido({ documentos: [`Tipos de documento que no aplican a operadores: ${ajenos.join(", ")}`] });
    if (ids.id === null) {
      const nuevo = await insertarOperador(tx, datos, ctx.ahora);
      await registrarEvento(tx, { usuarioId, entidad: "operador", entidadId: nuevo.id, accion: "crear", campos: camposDistintos(null, datos, CAMPOS_OPERADOR) });
      return { ok: true, valor: nuevo };
    }
    const antes = await leerOperador(tx, ids.id);
    if (antes === null) return { ok: false, error: "no_encontrado" };
    const r = await actualizarOperadorSiVersion(tx, ids.id, ids.version!, datos, ctx.ahora);
    if (r.estado !== "actualizado") return { ok: false, error: r.estado };
    await registrarEvento(tx, {
      usuarioId, entidad: "operador", entidadId: ids.id, accion: "actualizar",
      campos: camposDistintos(comoEntradaOperador(antes), datos, CAMPOS_OPERADOR),
    });
    return { ok: true, valor: { id: ids.id, version: r.version } };
  });
}

/** Registra que se entregó al operador la versión vigente del aviso de privacidad, con la fecha de hoy. Permiso flota.editar. */
export async function registrarEntregaAviso(ctx: Contexto, operadorId: unknown, versionEsperada: unknown): Promise<Resultado<{ version: number }>> {
  const permiso = permitir(ctx, "flota.editar");
  if (!permiso.ok) return permiso;
  const id = idSchema.safeParse(operadorId);
  if (!id.success) return { ok: false, error: "no_encontrado" };
  const version = versionSchema.safeParse(versionEsperada);
  if (!version.success) return invalido({ _: ["Falta la versión del operador"] });
  const usuarioId = permiso.usuario.id;

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ version: number }>> => {
    const { versionAvisoPrivacidad } = await leerConfiguracion(tx);
    const r = await registrarEntregaAvisoSiVersion(tx, id.data, version.data, versionAvisoPrivacidad, ctx.ahora);
    if (r.estado !== "actualizado") return { ok: false, error: r.estado };
    await registrarEvento(tx, { usuarioId, entidad: "operador", entidadId: id.data, accion: "entregar_aviso", campos: ["avisoVersion", "avisoEntregadoEn"] });
    return { ok: true, valor: { version: r.version } };
  });
}
