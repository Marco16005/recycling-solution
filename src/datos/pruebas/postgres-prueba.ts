import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { BD } from "../bd";
import { crearConexion } from "../conexion-base";
import { migrar } from "../migrar";

/** Solo se crean y borran bases con este nombre; el nombre se valida antes de ponerlo en SQL. */
const NOMBRE_PRUEBA = /^prueba_[0-9a-f]{16}$/;

export interface BasePostgres {
  nombre: string;
  /** Conexión como rs_app, el rol de la aplicación. */
  bd: BD;
  urlApp: string;
  urlMigrador: string;
  /** Ejecuta SQL como superusuario sobre esta base (para preparar fallas en las pruebas). */
  comoAdmin: (sentencia: string) => Promise<void>;
  cerrar: () => Promise<void>;
}

/** Renglones del resultado de `bd.execute` con node-postgres (el tipo genérico de BD no los expone). */
export function filasDe<T = Record<string, unknown>>(resultado: unknown): T[] {
  return (resultado as { rows: T[] }).rows;
}

function variable(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta ${nombre}: las pruebas de integración corren en el servicio integration`);
  return valor;
}

function urlDeBase(url: string, base: string): string {
  const u = new URL(url);
  u.pathname = `/${base}`;
  return u.toString();
}

async function conAdmin<T>(url: string, trabajo: (cliente: Client) => Promise<T>): Promise<T> {
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    return await trabajo(cliente);
  } finally {
    await cliente.end();
  }
}

/**
 * Crea una base desechable en el Postgres de pruebas, la migra como rs_migrador (con permisos) y conecta como rs_app.
 * Requiere PRUEBA_ADMIN_URL (superusuario; solo existe en compose.test.yaml), RS_MIGRADOR_PASSWORD y RS_APP_PASSWORD.
 */
export async function crearBasePostgres(opciones: { migrar?: boolean } = {}): Promise<BasePostgres> {
  const urlAdmin = variable("PRUEBA_ADMIN_URL");
  const nombre = `prueba_${randomBytes(8).toString("hex")}`;
  if (!NOMBRE_PRUEBA.test(nombre)) throw new Error("Nombre de base de prueba inválido");

  await conAdmin(urlAdmin, async (c) => {
    await c.query(`CREATE DATABASE "${nombre}" OWNER rs_migrador`);
    await c.query(`REVOKE ALL ON DATABASE "${nombre}" FROM PUBLIC`);
    await c.query(`GRANT CONNECT ON DATABASE "${nombre}" TO rs_app`);
  });

  const host = new URL(urlAdmin).host;
  const urlMigrador = `postgres://rs_migrador:${encodeURIComponent(variable("RS_MIGRADOR_PASSWORD"))}@${host}/${nombre}`;
  const urlApp = `postgres://rs_app:${encodeURIComponent(variable("RS_APP_PASSWORD"))}@${host}/${nombre}`;
  if (opciones.migrar !== false) await migrar(urlMigrador);

  const { bd, cerrar: cerrarApp } = crearConexion(urlApp, 4);
  return {
    nombre,
    bd,
    urlApp,
    urlMigrador,
    comoAdmin: (sentencia) => conAdmin(urlDeBase(urlAdmin, nombre), async (c) => void (await c.query(sentencia))),
    cerrar: async () => {
      await cerrarApp();
      if (!NOMBRE_PRUEBA.test(nombre)) return;
      await conAdmin(urlAdmin, async (c) => void (await c.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`)));
    },
  };
}
