import { z } from "zod";
import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { leerCartera, leerCliente } from "@/datos/clientes";
import { leerConfiguracion } from "@/datos/configuracion";
import { faltantesDeCliente, resumenK5, type Faltante, type ResumenK5 } from "@/dominio/clientes/completitud";
import { nombreNormalizado } from "@/dominio/clientes/csv";
import { motivosDeBloqueoCliente, type MotivoBloqueo } from "@/dominio/clientes/habilitacion";
import type { ClienteGuardado, TipoResiduo } from "@/dominio/clientes/tipos";
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
}

/** fecha: hoy en Ciudad de México. k5: sobre toda la cartera, sin importar el filtro. */
export interface ListadoClientes {
  fecha: string;
  k5: ResumenK5;
  clientes: ClienteResumen[];
  puedeEditar: boolean;
}

export interface FichaCliente {
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
}


const filtroSchema = z.object({ texto: z.string().max(100).optional() });
const idSchema = z.uuid();


/** Permiso clientes.ver. filtro: { texto?: string }; la búsqueda ignora mayúsculas, acentos y signos. */
export async function listarClientes(ctx: Contexto, filtro: unknown): Promise<Resultado<ListadoClientes>> {
  const permiso = permitir(ctx, "clientes.ver");
  if (!permiso.ok) return permiso;
  const validado = filtroSchema.safeParse(filtro ?? {});
  if (!validado.success) return { ok: false, error: "invalido", campos: { texto: ["Búsqueda no válida"] } };
  const texto = nombreNormalizado(validado.data.texto ?? "");
  const fecha = fechaEnMexico(ctx.ahora);

  const { version, cartera } = await leerInstantanea(ctx.bd, async (tx) => ({
    version: (await leerConfiguracion(tx)).versionAvisoPrivacidad,
    cartera: await leerCartera(tx),
  }));
  const encontrados = texto === "" ? cartera : cartera.filter((c) => nombreNormalizado(c.nombre).includes(texto));

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

  const { version, cliente } = await leerInstantanea(ctx.bd, async (tx) => ({
    version: (await leerConfiguracion(tx)).versionAvisoPrivacidad,
    cliente: await leerCliente(tx, valido.data),
  }));
  if (cliente === null) return { ok: false, error: "no_encontrado" };
  return {
    ok: true,
    valor: {
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
  const { versionAvisoPrivacidad } = await leerConfiguracion(ctx.bd);
  return { ok: true, valor: { estiloMapaUrl: estiloMapaUrl(), versionAvisoVigente: versionAvisoPrivacidad } };
}
