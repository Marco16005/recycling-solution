import { createHash } from "node:crypto";
import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { insertarCliente, nombresDeCartera } from "@/datos/clientes";
import { buscarImportacion, registrarImportacion, tomarCandadoDeImportacion } from "@/datos/importaciones";
import {
  analizarClientesCsv, posiblesDuplicados, type ErrorDeImportacion, type PosibleDuplicado,
} from "@/dominio/clientes/csv";
import { permitir } from "./autorizacion";
import { camposCambiados } from "./cambios";
import type { Contexto, Resultado } from "./tipos";

/** muestra: las primeras 20 filas válidas. huella: del contenido y de los duplicados; se devuelve al confirmar. */
export interface ResumenImportacion {
  registros: number;
  validas: number;
  errores: ErrorDeImportacion[];
  posiblesDuplicados: PosibleDuplicado[];
  muestra: { fila: number; nombre: string; direccion: string | null }[];
  huella: string;
}

const TAMANO_MUESTRA = 20;

const opcionesSchema = z.object({
  operacionId: z.uuid(),
  huella: z.string().min(1).max(200),
  aceptarDuplicados: z.boolean(),
});

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");

/** Cambia si cambia el archivo o la lista de posibles duplicados (por ejemplo, porque alguien agregó un cliente). */
function huellaDe(csv: string, duplicados: PosibleDuplicado[]): string {
  return sha256(JSON.stringify({ contenido: sha256(csv), duplicados }));
}

const noEsTexto = (): { ok: false; error: "invalido"; campos: Record<string, string[]> } => ({
  ok: false,
  error: "invalido",
  campos: { archivo: ["El archivo debe enviarse como texto"] },
});

const describirError = (e: ErrorDeImportacion) => (e.fila === null ? e.mensajes.join("; ") : `Fila ${e.fila}: ${e.mensajes.join("; ")}`);

const describirDuplicado = (d: PosibleDuplicado) =>
  d.con === "archivo"
    ? `Fila ${d.fila}: "${d.nombre}" se repite en la fila ${d.otraFila}`
    : `Fila ${d.fila}: "${d.nombre}" se parece a "${d.nombreExistente}", que ya está en la cartera`;

/** Analiza el CSV sin escribir nada. Permiso clientes.importar. */
export async function analizarImportacion(ctx: Contexto, csv: unknown): Promise<Resultado<ResumenImportacion>> {
  const permiso = permitir(ctx, "clientes.importar");
  if (!permiso.ok) return permiso;
  if (typeof csv !== "string") return noEsTexto();

  const analisis = analizarClientesCsv(csv);
  const duplicados = posiblesDuplicados(analisis.validas, await nombresDeCartera(ctx.bd));
  return {
    ok: true,
    valor: {
      registros: analisis.registros,
      validas: analisis.validas.length,
      errores: analisis.errores,
      posiblesDuplicados: duplicados,
      muestra: analisis.validas
        .slice(0, TAMANO_MUESTRA)
        .map(({ fila, entrada }) => ({ fila, nombre: entrada.nombre, direccion: entrada.direccion })),
      huella: huellaDe(csv, duplicados),
    },
  };
}

/**
 * opciones: { operacionId: uuid; huella: string; aceptarDuplicados: boolean }.
 * Si operacionId ya se confirmó, devuelve el mismo resultado sin escribir. Si no, toma el candado de importación,
 * vuelve a analizar dentro de la transacción y escribe todo el lote o nada.
 * Huella distinta: "conflicto". Con errores: "invalido" con campos.archivo.
 * Con duplicados sin aceptarDuplicados: "invalido" con campos.duplicados.
 */
export async function confirmarImportacion(
  ctx: Contexto,
  csv: unknown,
  opciones: unknown,
): Promise<Resultado<{ importados: number }>> {
  const permiso = permitir(ctx, "clientes.importar");
  if (!permiso.ok) return permiso;
  if (typeof csv !== "string") return noEsTexto();
  const validadas = opcionesSchema.safeParse(opciones);
  if (!validadas.success) return { ok: false, error: "invalido", campos: { _: ["Faltan los datos de la confirmación"] } };
  const { operacionId, huella, aceptarDuplicados } = validadas.data;
  const usuarioId = permiso.usuario.id;

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ importados: number }>> => {
    await tomarCandadoDeImportacion(tx);
    const previa = await buscarImportacion(tx, operacionId);
    if (previa !== null) {
      return previa.huella === huella ? { ok: true, valor: { importados: previa.importados } } : { ok: false, error: "conflicto" };
    }

    const analisis = analizarClientesCsv(csv);
    const duplicados = posiblesDuplicados(analisis.validas, await nombresDeCartera(tx));
    if (huellaDe(csv, duplicados) !== huella) return { ok: false, error: "conflicto" };
    if (analisis.errores.length > 0) {
      return { ok: false, error: "invalido", campos: { archivo: analisis.errores.map(describirError) } };
    }
    if (analisis.validas.length === 0) {
      return { ok: false, error: "invalido", campos: { archivo: ["El archivo no tiene clientes"] } };
    }
    if (duplicados.length > 0 && !aceptarDuplicados) {
      return { ok: false, error: "invalido", campos: { duplicados: duplicados.map(describirDuplicado) } };
    }

    for (const { entrada } of analisis.validas) {
      const { id } = await insertarCliente(tx, entrada, ctx.ahora);
      await registrarEvento(tx, { usuarioId, entidad: "cliente", entidadId: id, accion: "importar", campos: camposCambiados(null, entrada) });
    }
    await registrarImportacion(tx, { id: operacionId, usuarioId, huella, importados: analisis.validas.length, en: ctx.ahora });
    return { ok: true, valor: { importados: analisis.validas.length } };
  });
}
