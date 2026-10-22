import { z } from "zod";
import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { fechaSchema, idSchema, invalido } from "@/acciones/validacion";
import { registrarEvento } from "@/datos/bitacora";
import { conSolicitudAbierta, fechasAtendidas, notasConAutor, recoleccionesDeCliente, solicitudesDeCliente, ultimaSolicitud } from "@/datos/cartera";
import { leerCartera, leerCliente } from "@/datos/clientes";
import { leerConfiguracion, leerConfiguracionCompleta } from "@/datos/configuracion";
import { decisionesDePropuestas } from "@/datos/propuestas";
import { faltantesDeCliente } from "@/dominio/clientes/completitud";
import { COLUMNAS_CSV, filaCsvDeCliente } from "@/dominio/clientes/csv";
import { motivosDeBloqueoCliente } from "@/dominio/clientes/habilitacion";
import { siguienteDiaOperacion } from "@/dominio/solicitudes/cola";
import { propuestasParaFecha, ritmoAprendido } from "@/dominio/solicitudes/propuestas";
import { fechaEnMexico } from "@/dominio/tiempo";
import { documentoCsv, inicioDentroDeVentana } from "@/indicadores";
import { numerosDeCliente } from "@/indicadores/cliente";
import { puede } from "@/seguridad/permisos";
import { aplicarFiltros, filtroSchema } from "./clientes.nucleo";
import { leerInstantanea } from "./instantanea";
import { estiloMapaUrl } from "./mapa";
import type { TipoNota } from "@/acciones/cartera.nucleo";
import type { TipoResiduo } from "@/dominio/clientes/tipos";
import type { Propuesta, Ritmo } from "@/dominio/solicitudes/propuestas";
import type { NumerosCliente } from "@/indicadores/cliente";

/** Plan CRM, §4.3 a §4.6 y §4.10. Se implementa en PC-4. */

export interface FiltrosCartera {
  texto?: string; residuo?: TipoResiduo; estado?: "completo" | "incompleto" | "habilitado" | "no_habilitado";
  sinUbicacion?: boolean; documentos?: "por_vencer" | "vencidos"; activos?: "activos" | "inactivos" | "todos";
}

export interface NotaVista { id: string; tipo: TipoNota; texto: string; autor: string; en: Date; corregida: boolean }
export interface HistorialCliente {
  solicitudes: { id: string; folio: string; fechaSolicitada: string; canal: string; estado: string; motivo: string | null }[];
  recolecciones: { fecha: string; placa: string; llegadaEn: Date | null; dentroDeHorario: boolean | null; estado: "completada" | "no_atendida"; motivo: string | null }[];
  pagina: number; hayMas: boolean;
}
/** Lo que agrega la ficha del Plan CRM (permiso clientes.ver). */
export interface FichaCartera { historial: HistorialCliente; numeros: NumerosCliente; notas: NotaVista[]; ritmo: Ritmo | null; puedeAnotar: boolean }

const TAMANO_PAGINA = 20;
const enteroSchema = z.coerce.number().int().min(1).max(10_000);

export async function fichaCartera(ctx: Contexto, clienteId: unknown, pagina?: unknown): Promise<Resultado<FichaCartera>> {
  const permiso = permitir(ctx, "clientes.ver");
  if (!permiso.ok) return permiso;
  const id = idSchema.safeParse(clienteId);
  if (!id.success) return { ok: false, error: "no_encontrado" };
  const p = pagina === undefined ? 1 : enteroSchema.safeParse(pagina).data;
  if (p === undefined) return invalido({ pagina: ["Página no válida"] });
  const hoy = fechaEnMexico(ctx.ahora);
  const datos = await leerInstantanea(ctx.bd, async (tx) => ({
    cliente: await leerCliente(tx, id.data),
    solicitudes: await solicitudesDeCliente(tx, id.data),
    recolecciones: await recoleccionesDeCliente(tx, id.data),
    notas: await notasConAutor(tx, id.data),
  }));
  if (!datos.cliente) return { ok: false, error: "no_encontrado" };
  const desde = (p - 1) * TAMANO_PAGINA;
  const corregidas = new Set(datos.notas.map((n) => n.corrigeA).filter((x): x is string => x !== null));
  const numeros = numerosDeCliente({
    paradas: datos.recolecciones.map((r) => ({ fecha: r.fecha, estado: r.estado, inicioServicioEn: r.inicioServicioEn?.toISOString() ?? null,
      ventanaInicio: r.ventanaInicio.slice(0, 5), ventanaFin: r.ventanaFin.slice(0, 5) })),
    solicitudes: datos.solicitudes.map((s) => ({ fechaSolicitada: s.fechaSolicitada, estado: s.estado, vecesPospuesta: s.vecesPospuesta })),
  }, hoy);
  return {
    ok: true,
    valor: {
      historial: {
        solicitudes: datos.solicitudes.slice(desde, desde + TAMANO_PAGINA).map((s) => ({ id: s.id, folio: s.folio, fechaSolicitada: s.fechaSolicitada,
          canal: s.canal, estado: s.estado, motivo: s.motivoCancelacion ?? (s.vecesPospuesta > 0 ? `Pospuesta ${s.vecesPospuesta} vez(es)` : null) })),
        recolecciones: datos.recolecciones.slice(desde, desde + TAMANO_PAGINA).map((r) => ({ fecha: r.fecha, placa: r.placa, llegadaEn: r.llegadaEn,
          dentroDeHorario: r.estado === "completada" && r.inicioServicioEn ? inicioDentroDeVentana(r.inicioServicioEn, r.ventanaInicio.slice(0, 5), r.ventanaFin.slice(0, 5)) : null,
          estado: r.estado as "completada" | "no_atendida", motivo: r.motivoNoAtendida })),
        pagina: p,
        hayMas: Math.max(datos.solicitudes.length, datos.recolecciones.length) > desde + TAMANO_PAGINA,
      },
      numeros,
      // La última versión de cada nota; las corregidas por otra no se muestran.
      notas: datos.notas.filter((n) => !corregidas.has(n.id)).map((n) => ({ id: n.id, tipo: n.tipo, texto: n.texto, autor: n.autor, en: n.en, corregida: n.corrigeA !== null })),
      ritmo: numeros.ritmo,
      puedeAnotar: puede(permiso.usuario, "clientes.editar"),
    },
  };
}

export async function propuestasDeRecoleccion(ctx: Contexto, fecha?: unknown): Promise<Resultado<{ fecha: string;
  propuestas: (Propuesta & { nombre: string; ultimaSolicitud: string | null })[]; puedeConfirmar: boolean }>> {
  const permiso = permitir(ctx, "solicitudes.ver");
  if (!permiso.ok) return permiso;
  const hoy = fechaEnMexico(ctx.ahora);
  const pedida = fecha === undefined ? null : (fechaSchema.safeParse(fecha).data ?? undefined);
  if (pedida === undefined || (pedida !== null && pedida < hoy)) return invalido({ fecha: ["Elige hoy o una fecha posterior"] });
  return leerInstantanea(ctx.bd, async (tx) => {
    const config = await leerConfiguracionCompleta(tx);
    const dia = pedida ?? siguienteDiaOperacion(hoy, config.diasOperacion);
    const activos = (await leerCartera(tx)).filter((c) => c.activo);
    const ids = activos.map((c) => c.id);
    const [atendidas, abiertas, decisiones, ultimas] = [await fechasAtendidas(tx, ids), await conSolicitudAbierta(tx, ids),
      await decisionesDePropuestas(tx, ids), await ultimaSolicitud(tx, ids)];
    const propuestas = propuestasParaFecha(dia, config.diasOperacion, activos.map((c) => ({
      clienteId: c.id, activo: c.activo, habilitadoEnFecha: motivosDeBloqueoCliente(c, dia, config.versionAvisoPrivacidad).length === 0,
      tieneSolicitudAbierta: abiertas.has(c.id), recurrencia: c.recurrencia, ritmo: ritmoAprendido(atendidas.get(c.id) ?? [], hoy),
      decisiones: decisiones.get(c.id) ?? [],
    })));
    const nombres = new Map(activos.map((c) => [c.id, c.nombre]));
    return {
      ok: true as const,
      valor: {
        fecha: dia,
        propuestas: propuestas.map((x) => ({ ...x, nombre: nombres.get(x.clienteId)!, ultimaSolicitud: ultimas.get(x.clienteId) ?? null }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
        puedeConfirmar: puede(permiso.usuario, "solicitudes.registrar"),
      },
    };
  });
}

export interface PuntoCartera { clienteId: string; nombre: string; lat: number; lng: number; estado: "completo_habilitado" | "incompleto" | "no_habilitado" }

export async function mapaCartera(ctx: Contexto, filtros: unknown):
  Promise<Resultado<{ puntos: PuntoCartera[]; sinUbicacion: number; estiloMapaUrl: string }>> {
  const permiso = permitir(ctx, "clientes.ver");
  if (!permiso.ok) return permiso;
  const f = filtroSchema.safeParse(filtros ?? {});
  if (!f.success) return invalido({ filtros: ["Filtro no válido"] });
  const fecha = fechaEnMexico(ctx.ahora);
  const { version, cartera } = await leerInstantanea(ctx.bd, async (tx) => ({
    version: (await leerConfiguracion(tx)).versionAvisoPrivacidad, cartera: await leerCartera(tx),
  }));
  const filtrados = aplicarFiltros(cartera, f.data, fecha, version);
  const puntos: PuntoCartera[] = filtrados.filter((c) => c.lat !== null && c.lng !== null).map((c) => ({
    clienteId: c.id, nombre: c.nombre, lat: c.lat!, lng: c.lng!,
    estado: faltantesDeCliente(c, version).length > 0 ? "incompleto"
      : motivosDeBloqueoCliente(c, fecha, version).length > 0 ? "no_habilitado" : "completo_habilitado",
  }));
  return { ok: true, valor: { puntos, sinUbicacion: filtrados.length - puntos.length, estiloMapaUrl: estiloMapaUrl() } };
}

/** Plan CRM, §4.9: exportación con las columnas de la plantilla (permiso clientes.exportar). Queda en la bitácora. */
export async function csvDeCartera(ctx: Contexto, filtros: unknown): Promise<Resultado<{ nombre: string; contenido: string }>> {
  const permiso = permitir(ctx, "clientes.exportar");
  if (!permiso.ok) return permiso;
  const f = filtroSchema.safeParse(filtros ?? {});
  if (!f.success) return invalido({ filtros: ["Filtro no válido"] });
  const fecha = fechaEnMexico(ctx.ahora);
  return ctx.bd.transaction(async (tx) => {
    const version = (await leerConfiguracion(tx)).versionAvisoPrivacidad;
    const filtrados = aplicarFiltros(await leerCartera(tx), f.data, fecha, version);
    await registrarEvento(tx, { usuarioId: permiso.usuario.id, entidad: "cartera", entidadId: null, accion: "exportar_clientes", campos: ["filtros"] });
    const filas = filtrados.map((c) => {
      const fila = filaCsvDeCliente(c);
      return [c.id, ...COLUMNAS_CSV.map((col) => fila[col]),
        faltantesDeCliente(c, version).length === 0, motivosDeBloqueoCliente(c, fecha, version).length === 0];
    });
    return { ok: true as const, valor: { nombre: `cartera-${fecha}.csv`, contenido: documentoCsv(["id", ...COLUMNAS_CSV, "completa", "habilitada_hoy"], filas) } };
  });
}

/** Fila de ejemplo de la plantilla: datos sintéticos, en el orden de COLUMNAS_CSV. */
const EJEMPLO: Record<(typeof COLUMNAS_CSV)[number], string> = {
  nombre: "Cartonera de Ejemplo", contacto: "Ana Ejemplo", telefono: "4420000000", direccion: "Av. Ejemplo 100, El Marqués",
  lat: "20.62", lng: "-100.3", residuo: "RME", material: "Cartón", servicio_min: "30", carga_kg: "800",
  horarios: "lun-vie 08:00-14:00; sab 09:00-12:00", tipos_unidad: "doble_rodada|rabon", notas_acceso: "Registrarse en caseta",
  ubicacion: "", correo: "ana@ejemplo.test", puesto: "Almacén",
};

/** Plan CRM, §4.1: plantilla para importar (permiso clientes.importar), con la misma forma que la exportación. */
export async function plantillaCsv(ctx: Contexto): Promise<Resultado<{ nombre: string; contenido: string }>> {
  const permiso = permitir(ctx, "clientes.importar");
  if (!permiso.ok) return permiso;
  return { ok: true, valor: { nombre: "plantilla-clientes.csv", contenido: documentoCsv(COLUMNAS_CSV, [COLUMNAS_CSV.map((c) => EJEMPLO[c])]) } };
}
