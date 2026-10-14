import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { actualizarClienteSiVersion, bloquearCliente, insertarCliente, leerCliente } from "@/datos/clientes";
import { leerConfiguracion } from "@/datos/configuracion";
import { insertarMovimientoPrivacidad, ultimoMovimientoPrivacidad } from "@/datos/privacidad";
import { clienteSchema, erroresPorCampo, privacidadSchema } from "@/dominio/clientes/esquemas";
import { aEntrada } from "@/dominio/clientes/formulario";
import type { EstadoPrivacidad } from "@/dominio/clientes/tipos";
import { permitir } from "./autorizacion";
import { camposCambiados } from "./cambios";
import type { Contexto, Resultado } from "./tipos";

const idSchema = z.uuid();
const versionSchema = z.number().int().positive();

/**
 * Crea (id null, versionEsperada null) o actualiza un cliente. Permiso clientes.editar.
 * Si la versión no coincide responde "conflicto" y no escribe nada. Cliente, ventanas, documentos y bitácora van en una transacción.
 */
export async function guardarCliente(
  ctx: Contexto,
  id: unknown,
  versionEsperada: unknown,
  entrada: unknown,
): Promise<Resultado<{ id: string; version: number }>> {
  const permiso = permitir(ctx, "clientes.editar");
  if (!permiso.ok) return permiso;

  if (id !== null && !idSchema.safeParse(id).success) return { ok: false, error: "no_encontrado" };
  if (id === null && versionEsperada !== null) {
    return { ok: false, error: "invalido", campos: { _: ["Un cliente nuevo no lleva versión"] } };
  }
  const version = versionSchema.safeParse(versionEsperada);
  if (id !== null && !version.success) {
    return { ok: false, error: "invalido", campos: { _: ["Falta la versión de la ficha que se editó"] } };
  }
  const validado = clienteSchema.safeParse(entrada);
  if (!validado.success) return { ok: false, error: "invalido", campos: erroresPorCampo(validado.error) };
  const datos = validado.data;
  const usuarioId = permiso.usuario.id;

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ id: string; version: number }>> => {
    if (id === null) {
      const nuevo = await insertarCliente(tx, datos, ctx.ahora);
      await registrarEvento(tx, { usuarioId, entidad: "cliente", entidadId: nuevo.id, accion: "crear", campos: camposCambiados(null, datos) });
      return { ok: true, valor: nuevo };
    }
    const clienteId = id as string;
    const antes = await leerCliente(tx, clienteId);
    if (antes === null) return { ok: false, error: "no_encontrado" };
    const resultado = await actualizarClienteSiVersion(tx, clienteId, version.data!, datos, ctx.ahora);
    if (resultado.estado !== "actualizado") return { ok: false, error: resultado.estado };
    await registrarEvento(tx, {
      usuarioId,
      entidad: "cliente",
      entidadId: clienteId,
      accion: "actualizar",
      campos: camposCambiados(aEntrada(antes), datos),
    });
    return { ok: true, valor: { id: clienteId, version: resultado.version } };
  });
}

/**
 * Agrega un movimiento del aviso de privacidad. Permiso clientes.editar.
 * "conflicto" si la versión del aviso ya no es la vigente o si el último movimiento no es el que vio el despachador.
 */
export async function registrarPrivacidad(
  ctx: Contexto,
  clienteId: unknown,
  entrada: unknown,
): Promise<Resultado<{ privacidad: EstadoPrivacidad }>> {
  const permiso = permitir(ctx, "clientes.editar");
  if (!permiso.ok) return permiso;
  const id = idSchema.safeParse(clienteId);
  if (!id.success) return { ok: false, error: "no_encontrado" };
  const validado = privacidadSchema.safeParse(entrada);
  if (!validado.success) return { ok: false, error: "invalido", campos: erroresPorCampo(validado.error) };
  const datos = validado.data;
  const usuarioId = permiso.usuario.id;

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ privacidad: EstadoPrivacidad }>> => {
    if (!(await bloquearCliente(tx, id.data))) return { ok: false, error: "no_encontrado" };
    const { versionAvisoPrivacidad } = await leerConfiguracion(tx);
    const ultimo = await ultimoMovimientoPrivacidad(tx, id.data);
    if (datos.versionAviso !== versionAvisoPrivacidad || (ultimo?.id ?? null) !== datos.movimientoAnteriorId) {
      return { ok: false, error: "conflicto" };
    }
    const privacidad = await insertarMovimientoPrivacidad(tx, {
      clienteId: id.data,
      versionAviso: versionAvisoPrivacidad,
      accion: datos.accion,
      medio: datos.medio,
      registradoPor: usuarioId,
      en: ctx.ahora,
    });
    await registrarEvento(tx, { usuarioId, entidad: "cliente", entidadId: id.data, accion: `privacidad_${datos.accion}`, campos: ["privacidad"] });
    return { ok: true, valor: { privacidad } };
  });
}
