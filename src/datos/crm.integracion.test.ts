import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actualizarClienteSiVersion, insertarCliente, leerCliente } from "./clientes";
import { insertarDecisionPropuesta, decisionesDePropuestas } from "./propuestas";
import { insertarNota, notasDeCliente } from "./notas";
import { clienteDePrueba } from "./pruebas/datos-ejemplo";
import { crearBasePostgres, filasDe, type BasePostgres } from "./pruebas/postgres-prueba";
import { usuarioDePrueba } from "./pruebas/usuarios-prueba";

// Plan CRM, PC-1: migración 0009 con Postgres real.

const AHORA = new Date("2026-10-21T15:00:00Z");

async function errorDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    const causa = (error as { cause?: { message?: string } }).cause;
    return causa?.message ?? String(error);
  }
  return "sin error";
}

describe("modelo del Plan CRM con Postgres real (migración 0009)", () => {
  let base: BasePostgres;
  let usuarioId: string;
  let clienteId: string;

  beforeAll(async () => {
    base = await crearBasePostgres();
    usuarioId = (await usuarioDePrueba(base.bd, "despachador")).id;
    clienteId = (await base.bd.transaction((tx) => insertarCliente(tx, clienteDePrueba(), AHORA))).id;
  });
  afterAll(async () => base.cerrar());

  it("un cliente guarda y lee correo, puesto, contactos adicionales y recurrencia; los anteriores quedan vacíos", async () => {
    expect(await leerCliente(base.bd, clienteId)).toMatchObject({ contactoCorreo: null, contactoPuesto: null, contactosAdicionales: [], recurrencia: null });
    const cambios = {
      ...clienteDePrueba(), contactoCorreo: "almacen@ejemplo.test", contactoPuesto: "Almacén",
      contactosAdicionales: [{ nombre: "Compras Sintético", puesto: "Compras", telefono: "4421234567", correo: null }],
      recurrencia: { tipo: "dias_semana" as const, dias: [2, 5] },
    };
    expect(await base.bd.transaction((tx) => actualizarClienteSiVersion(tx, clienteId, 1, cambios, AHORA))).toEqual({ estado: "actualizado", version: 2 });
    expect(await leerCliente(base.bd, clienteId)).toMatchObject({
      contactoCorreo: "almacen@ejemplo.test", contactoPuesto: "Almacén",
      contactosAdicionales: cambios.contactosAdicionales, recurrencia: { tipo: "dias_semana", dias: [2, 5] },
    });
  });

  it("las notas se agregan y se leen en orden; rs_app no puede cambiarlas ni borrarlas", async () => {
    const primera = await base.bd.transaction((tx) => insertarNota(tx, { clienteId, tipo: "llamada", texto: "Pide recolección el martes", autor: usuarioId, corrigeA: null }, AHORA));
    await base.bd.transaction((tx) => insertarNota(tx, { clienteId, tipo: "llamada", texto: "Pide recolección el miércoles", autor: usuarioId, corrigeA: primera }, new Date(AHORA.getTime() + 60_000)));
    const notas = await notasDeCliente(base.bd, clienteId);
    expect(notas.map((n) => [n.texto, n.corrigeA])).toEqual([["Pide recolección el miércoles", primera], ["Pide recolección el martes", null]]);
    expect(await errorDe(base.bd.execute(sql`UPDATE notas_cliente SET texto = 'x'`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`DELETE FROM notas_cliente`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`INSERT INTO notas_cliente (cliente_id, tipo, texto, autor, en) VALUES (${clienteId}, 'otro', ${"x".repeat(1001)}, ${usuarioId}, now())`))).toMatch(/notas_cliente_texto/);
  });

  it("una sola decisión por cliente y fecha, sin UPDATE ni DELETE para rs_app", async () => {
    await base.bd.transaction((tx) => insertarDecisionPropuesta(tx, { clienteId, fecha: "2026-10-22", estado: "pospuesta", pospuestaHasta: "2026-10-29", solicitudId: null, nota: null, decididaPor: usuarioId }, AHORA));
    expect(await errorDe(base.bd.transaction((tx) => insertarDecisionPropuesta(tx, { clienteId, fecha: "2026-10-22", estado: "descartada", pospuestaHasta: null, solicitudId: null, nota: null, decididaPor: usuarioId }, AHORA)))).toMatch(/propuestas_recoleccion_cliente_fecha/);
    expect(await decisionesDePropuestas(base.bd, [clienteId])).toEqual(new Map([[clienteId, [{ fecha: "2026-10-22", estado: "pospuesta", pospuestaHasta: "2026-10-29" }]]]));
    expect(await errorDe(base.bd.execute(sql`UPDATE propuestas_recoleccion SET nota = 'x'`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`DELETE FROM propuestas_recoleccion`))).toMatch(/permission denied/);
  });

  it("el canal propuesta existe en la base", async () => {
    const filas = filasDe<{ v: string }>(await base.bd.execute(sql`SELECT unnest(enum_range(NULL::canal_solicitud))::text AS v`));
    expect(filas.map((f) => f.v)).toContain("propuesta");
  });
});
