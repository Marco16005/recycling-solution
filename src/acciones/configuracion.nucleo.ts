import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { actualizarConfiguracionSiVersion, leerConfiguracionCompleta } from "@/datos/configuracion";
import { erroresPorCampo } from "@/dominio/clientes/esquemas";
import { validarFranjas } from "@/motor";
import { permitir } from "./autorizacion";
import { camposDistintos } from "./cambios";
import type { Contexto, Resultado } from "./tipos";
import { invalido, versionSchema } from "./validacion";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Misma caja que los clientes: el patio está en México. */
const MEXICO = { latMin: 14.5, latMax: 32.8, lngMin: -118.5, lngMax: -86.5 };

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Plan 7: franjas de hora pico en HH:MM, sin encimarse; los traslados que caen en ellas tardan factor veces más. */
const horasPicoSchema = z
  .array(z.object({
    inicio: z.string().regex(HORA, "Usa el formato HH:MM"),
    fin: z.string().regex(HORA, "Usa el formato HH:MM"),
    factor: z.number().min(1, "El factor va de 1 a 3").max(3, "El factor va de 1 a 3"),
  }))
  .max(6, "Máximo 6 franjas")
  .refine((fs) => fs.every((f) => minutos(f.inicio) < minutos(f.fin)), "Cada franja debe terminar después de empezar")
  .refine((fs) => {
    const orden = [...fs].sort((a, b) => minutos(a.inicio) - minutos(b.inicio));
    return orden.every((f, i) => i === 0 || minutos(orden[i - 1].fin) <= minutos(f.inicio));
  }, "Las franjas de hora pico no deben encimarse")
  // La misma regla que aplica el motor; las anteriores dan el mensaje claro.
  .refine((fs) => validarFranjas(fs.map((f) => ({ inicioMin: minutos(f.inicio), finMin: minutos(f.fin), factor: f.factor }))) === null,
    "Revisa las franjas de hora pico");

const configuracionSchema = z
  .object({
    patioLat: z.number().min(MEXICO.latMin, "Latitud fuera de México").max(MEXICO.latMax, "Latitud fuera de México").nullable(),
    patioLng: z.number().min(MEXICO.lngMin, "Longitud fuera de México").max(MEXICO.lngMax, "Longitud fuera de México").nullable(),
    turnoInicio: z.string().regex(HORA, "Usa el formato HH:MM"),
    turnoFin: z.string().regex(HORA, "Usa el formato HH:MM"),
    velocidadKmh: z.number().min(5).max(120),
    factorCircuidad: z.number().min(1).max(3),
    descargaMin: z.number().int().min(0).max(240),
    cargaPorOmisionKg: z.number().int().min(1).max(60000),
    diasOperacion: z.array(z.number().int().min(0).max(6)).min(1, "Elige al menos un día de operación").max(7),
    diasParaAtrasada: z.number().int().min(1).max(30),
    /** Plan 7. Opcionales para quien no los envíe: se conserva lo guardado. */
    factorCamion: z.number().min(1, "El factor va de 1 a 3").max(3, "El factor va de 1 a 3").optional(),
    umbralAtrasoMin: z.number().int("Usa minutos enteros").min(1, "De 1 a 120 minutos").max(120, "De 1 a 120 minutos").optional(),
    horasPico: horasPicoSchema.optional(),
    /** Línea base (Plan 6): la del método actual viene del Documento Integrador; la de K2 se cronometra antes del piloto. */
    lineaBase: z
      .object({
        esperaMin: z.number().positive(),
        trasladoMin: z.number().positive(),
        cicloMin: z.number().positive(),
        k2Seg: z.number().positive("La mediana debe ser mayor que cero").max(3600).optional(),
        k2Muestra: z.number().int().min(1, "Indica cuántas capturas se cronometraron").optional(),
        k2Fecha: z.iso.date().optional(),
      })
      .refine((l) => (l.k2Seg === undefined) === (l.k2Muestra === undefined) && (l.k2Seg === undefined) === (l.k2Fecha === undefined), {
        path: ["k2Seg"], message: "La línea base de K2 lleva mediana, tamaño de muestra y fecha juntos",
      })
      .optional(),
  })
  .refine((c) => (c.patioLat === null) === (c.patioLng === null), { path: ["patioLat"], message: "Latitud y longitud se capturan juntas" })
  .refine((c) => c.turnoInicio < c.turnoFin, { path: ["turnoFin"], message: "El turno debe terminar después de empezar" })
  .refine((c) => new Set(c.diasOperacion).size === c.diasOperacion.length, { path: ["diasOperacion"], message: "Días repetidos" });

const CAMPOS = [
  "patioLat", "patioLng", "turnoInicio", "turnoFin", "velocidadKmh", "factorCircuidad", "descargaMin", "cargaPorOmisionKg",
  "diasOperacion", "diasParaAtrasada", "lineaBase", "factorCamion", "horasPico", "umbralAtrasoMin",
] as const;

/** Permiso configuracion.editar. entrada: ConfiguracionVista sin version, versionAvisoPrivacidad ni estiloMapaUrl. */
export async function guardarConfiguracion(ctx: Contexto, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ version: number }>> {
  const permiso = permitir(ctx, "configuracion.editar");
  if (!permiso.ok) return permiso;
  const version = versionSchema.safeParse(versionEsperada);
  if (!version.success) return invalido({ _: ["Falta la versión de la configuración"] });
  const validado = configuracionSchema.safeParse(entrada);
  if (!validado.success) return invalido(erroresPorCampo(validado.error));
  const datos = { ...validado.data, diasOperacion: [...validado.data.diasOperacion].sort((a, b) => a - b) };

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ version: number }>> => {
    const antes = await leerConfiguracionCompleta(tx);
    const nueva = await actualizarConfiguracionSiVersion(tx, version.data, datos, ctx.ahora);
    if (nueva === null) return { ok: false, error: "conflicto" };
    await registrarEvento(tx, { usuarioId: permiso.usuario.id, entidad: "configuracion", entidadId: null, accion: "actualizar", campos: camposDistintos(antes, { ...antes, ...datos }, CAMPOS) });
    return { ok: true, valor: { version: nueva } };
  });
}
