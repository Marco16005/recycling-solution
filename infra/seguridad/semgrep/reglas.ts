// Casos de prueba de reglas.yaml: `semgrep --test --config infra/seguridad/semgrep/reglas.yaml infra/seguridad/semgrep`.
// No se compila (tsconfig no incluye infra/).
import type { Contexto } from "@/acciones/tipos";
// ruleid: rs-pantalla-importa-datos
import { leerClientes } from "@/datos/clientes";
// ruleid: rs-pantalla-importa-datos
import type { Tx } from "@/datos/bd";
// ok: rs-pantalla-importa-datos
import { listarClientes } from "@/consultas/clientes";

// ruleid: rs-nucleo-sin-permiso
export async function sinPermiso(ctx: Contexto): Promise<void> {
  await leerClientes(ctx.bd);
}

// ok: rs-nucleo-sin-permiso
export async function conPermiso(ctx: Contexto): Promise<void> {
  const permiso = permitir(ctx, "clientes.ver");
  if (!permiso.ok) return;
  await leerClientes(ctx.bd);
}

// ok: rs-nucleo-sin-permiso
export async function conPermisoDirecto(ctx: Contexto): Promise<boolean> {
  if (!permitir(ctx, "clientes.ver").ok) return false;
  return true;
}

export function relojes(instante: Date, semilla: () => number) {
  // ruleid: rs-dominio-impuro
  const a = Date.now();
  // ruleid: rs-dominio-impuro
  const b = new Date();
  // ruleid: rs-dominio-impuro
  const c = Math.random();
  // ok: rs-dominio-impuro
  const d = new Date(instante.getTime());
  // ok: rs-dominio-impuro
  const e = semilla();
  return [a, b, c, d, e, listarClientes];
}
