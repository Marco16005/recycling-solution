import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { fechaSchema } from "@/acciones/validacion";
import { leerCatalogo, leerOperadores, leerUnidades } from "@/datos/flota";
import { leerJornadas, type JornadaGuardada } from "@/datos/jornadas";
import { motivosNoDisponibleOperador, motivosNoDisponibleUnidad } from "@/dominio/flota/disponibilidad";
import type { MotivoNoDisponible } from "@/dominio/flota/tipos";
import { fechaEnMexico } from "@/dominio/tiempo";
import { puede } from "@/seguridad/permisos";
import { resumenOperador, resumenUnidad, type OperadorResumen, type UnidadResumen } from "./flota.nucleo";
import { leerInstantanea } from "./instantanea";

export type { JornadaGuardada };

export type FilaJornada = JornadaGuardada & { unidad: UnidadResumen; operador: OperadorResumen };
export interface NoDisponible { tipo: "unidad" | "operador"; id: string; nombre: string; motivos: MotivoNoDisponible[] }
/** libres: activos, disponibles en la fecha y sin jornada ese día. */
export interface VistaJornada {
  fecha: string; jornadas: FilaJornada[]; unidadesLibres: UnidadResumen[]; operadoresLibres: OperadorResumen[];
  noDisponibles: NoDisponible[]; puedeGestionar: boolean;
}

/** Permiso flota.ver. fecha: "AAAA-MM-DD", o undefined para hoy en Ciudad de México. */
export async function obtenerJornada(ctx: Contexto, fecha: unknown): Promise<Resultado<VistaJornada>> {
  const permiso = permitir(ctx, "flota.ver");
  if (!permiso.ok) return permiso;
  const dia = fecha === undefined ? fechaEnMexico(ctx.ahora) : fechaSchema.safeParse(fecha).data;
  if (dia === undefined) return { ok: false, error: "invalido", campos: { fecha: ["Fecha no válida"] } };

  const datos = await leerInstantanea(ctx.bd, async (tx) => ({
    catalogoUnidad: await leerCatalogo(tx, "unidad"),
    catalogoOperador: await leerCatalogo(tx, "operador"),
    unidades: await leerUnidades(tx),
    operadores: await leerOperadores(tx),
    jornadas: await leerJornadas(tx, dia),
  }));
  const unidadesPorId = new Map(datos.unidades.map((u) => [u.id, u]));
  const operadoresPorId = new Map(datos.operadores.map((o) => [o.id, o]));
  const conJornada = new Set(datos.jornadas.flatMap((j) => [j.unidadId, j.operadorId]));

  const noDisponibles: NoDisponible[] = [];
  const unidadesLibres: UnidadResumen[] = [];
  for (const u of datos.unidades.filter((x) => x.activo)) {
    const motivos = motivosNoDisponibleUnidad(u, datos.catalogoUnidad, dia);
    if (motivos.length > 0) noDisponibles.push({ tipo: "unidad", id: u.id, nombre: u.placa, motivos });
    else if (!conJornada.has(u.id)) unidadesLibres.push(resumenUnidad(u));
  }
  const operadoresLibres: OperadorResumen[] = [];
  for (const o of datos.operadores.filter((x) => x.activo)) {
    const motivos = motivosNoDisponibleOperador(o, datos.catalogoOperador, dia);
    if (motivos.length > 0) noDisponibles.push({ tipo: "operador", id: o.id, nombre: o.nombre, motivos });
    else if (!conJornada.has(o.id)) operadoresLibres.push(resumenOperador(o));
  }

  return {
    ok: true,
    valor: {
      fecha: dia,
      jornadas: datos.jornadas.map((j) => ({
        ...j,
        unidad: resumenUnidad(unidadesPorId.get(j.unidadId)!),
        operador: resumenOperador(operadoresPorId.get(j.operadorId)!),
      })),
      unidadesLibres,
      operadoresLibres,
      noDisponibles,
      puedeGestionar: puede(permiso.usuario, "jornada.gestionar"),
    },
  };
}
