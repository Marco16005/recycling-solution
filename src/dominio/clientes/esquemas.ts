import { z } from "zod";
import { ACCIONES_PRIVACIDAD, ESTADOS_DOCUMENTO, MEDIOS_PRIVACIDAD, TIPOS_RESIDUO, TIPOS_UNIDAD } from "./tipos";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const TELEFONO = /^[0-9+() -]+$/;

function telefonoValido(valor: string): boolean {
  const digitos = valor.replace(/\D/g, "").length;
  return TELEFONO.test(valor) && digitos >= 10 && digitos <= 15;
}

/** Caja que contiene a México; atrapa coordenadas invertidas o capturadas en otro país. */
const MEXICO = { latMin: 14.5, latMax: 32.8, lngMin: -118.5, lngMax: -86.5 };

export const ventanaSchema = z
  .object({
    diaSemana: z.number().int().min(0).max(6),
    horaInicio: z.string().regex(HORA, "Usa el formato HH:MM"),
    horaFin: z.string().regex(HORA, "Usa el formato HH:MM"),
  })
  .refine((v) => v.horaInicio < v.horaFin, {
    message: "La hora de inicio debe ser anterior a la de fin (una ventana no puede cruzar la medianoche)",
    path: ["horaFin"],
  });

export const documentoSchema = z.object({
  tipoDocumentoId: z.string().trim().min(1, "Selecciona un tipo o usa nombre libre").nullable().default(null),
  nombre: z.string().trim().min(1, "Escribe el nombre del documento").max(120),
  obligatorio: z.boolean(),
  estado: z.enum(ESTADOS_DOCUMENTO),
  venceEl: z.iso.date("Usa una fecha real con formato AAAA-MM-DD").nullable(),
});

/** Plan CRM: contacto adicional; el teléfono se valida igual que el del contacto principal. */
export const contactoSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre del contacto").max(120),
  puesto: z.string().trim().max(80).nullable(),
  telefono: z.string().trim().refine(telefonoValido, "Teléfono no válido").nullable(),
  correo: z.email("Correo no válido").trim().toLowerCase().max(160).nullable(),
});

/** Plan CRM: día fijo opcional para proponer recolecciones. */
export const recurrenciaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("dias_semana"), dias: z.array(z.number().int().min(0).max(6)).min(1, "Elige al menos un día").max(7)
    .refine((d) => new Set(d).size === d.length, "Días repetidos") }),
  z.object({ tipo: z.literal("cada_n_dias"), cadaDias: z.number().int().min(2, "De 2 a 90 días").max(90, "De 2 a 90 días"),
    desde: z.iso.date("Fecha no válida") }),
]);

export const clienteSchema = z
  .object({
    nombre: z.string().trim().min(2, "Escribe el nombre del cliente").max(160),
    contactoNombre: z.string().trim().max(120).nullable(),
    contactoTelefono: z.string().trim().refine(telefonoValido, "Teléfono no válido").nullable(),
    // Plan CRM: con valor por omisión, para que las entradas anteriores sigan siendo válidas.
    contactoCorreo: z.email("Correo no válido").trim().toLowerCase().max(160).nullable().default(null),
    contactoPuesto: z.string().trim().max(80).nullable().default(null),
    contactosAdicionales: z.array(contactoSchema).max(10, "Máximo 10 contactos adicionales").default([]),
    recurrencia: recurrenciaSchema.nullable().default(null),
    direccion: z.string().trim().max(300).nullable(),
    lat: z.number().min(MEXICO.latMin, "Latitud fuera de México").max(MEXICO.latMax, "Latitud fuera de México").nullable(),
    lng: z.number().min(MEXICO.lngMin, "Longitud fuera de México").max(MEXICO.lngMax, "Longitud fuera de México").nullable(),
    tipoResiduo: z.enum(TIPOS_RESIDUO).nullable(),
    material: z.string().trim().max(120).nullable(),
    tiposUnidadAdmitidos: z.array(z.enum(TIPOS_UNIDAD)).max(TIPOS_UNIDAD.length),
    notasAcceso: z.string().trim().max(500).nullable(),
    tiempoServicioMin: z.number().int().min(5).max(480),
    cargaEstimadaKg: z.number().int().min(0).max(40000).nullable(),
    activo: z.boolean(),
    ventanas: z.array(ventanaSchema).max(21),
    documentos: z.array(documentoSchema).max(30),
  })
  .superRefine((c, ctx) => {
    if ((c.lat === null) !== (c.lng === null)) {
      ctx.addIssue({ code: "custom", path: ["lat"], message: "Latitud y longitud se capturan juntas" });
    }
    const porDia = new Map<number, { inicio: string; fin: string }[]>();
    for (const v of c.ventanas) {
      const lista = porDia.get(v.diaSemana) ?? [];
      lista.push({ inicio: v.horaInicio, fin: v.horaFin });
      porDia.set(v.diaSemana, lista);
    }
    for (const lista of porDia.values()) {
      lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
      for (let i = 1; i < lista.length; i++) {
        if (lista[i].inicio < lista[i - 1].fin) {
          ctx.addIssue({ code: "custom", path: ["ventanas"], message: "Hay ventanas que se traslapan en el mismo día" });
          return;
        }
      }
    }
  });

/** La entrada admite documentos anteriores sin tipo; el esquema siempre devuelve tipoDocumentoId, incluso null. */
export type ClienteEntrada = z.input<typeof clienteSchema>;

/**
 * Movimiento del aviso de privacidad que captura el despachador.
 * versionAviso: la versión que vio. movimientoAnteriorId: id del último movimiento que vio, o null si no había.
 */
export const privacidadSchema = z.object({
  accion: z.enum(ACCIONES_PRIVACIDAD),
  medio: z.enum(MEDIOS_PRIVACIDAD),
  versionAviso: z.string().trim().min(1).max(40),
  movimientoAnteriorId: z.uuid().nullable(),
});

export type PrivacidadEntrada = z.infer<typeof privacidadSchema>;

/** Convierte los errores de Zod en { "campo.subcampo": ["mensaje", …] } para mostrarlos en el formulario. */
export function erroresPorCampo(error: z.ZodError): Record<string, string[]> {
  const salida: Record<string, string[]> = {};
  for (const problema of error.issues) {
    const campo = problema.path.join(".") || "_";
    (salida[campo] ??= []).push(problema.message);
  }
  return salida;
}
