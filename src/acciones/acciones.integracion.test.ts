import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertarCliente, tomarCandadoDeNombres } from "@/datos/clientes";
import { clientes, documentosCliente, ventanasCliente } from "@/datos/esquema";
import { crearBasePostgres, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { clienteDePrueba } from "@/datos/pruebas/datos-ejemplo";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { guardarCliente } from "./clientes.nucleo";
import { analizarImportacion, confirmarImportacion } from "./importacion.nucleo";
import type { Contexto } from "./tipos";

const AHORA = new Date("2026-10-13T15:00:00Z");
const CSV = [
  "nombre,contacto,telefono,direccion,lat,lng,residuo,material,servicio_min,carga_kg",
  "Papelera Concurrente,,,,,,RME,,,",
  "Cajas Concurrentes,,,,,,RSU,,,",
].join("\n");

describe("acciones con Postgres real", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  const ctx = (): Contexto => ({ bd: base.bd, usuario: despachador, ahora: AHORA });

  beforeAll(async () => {
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
  });
  afterAll(async () => base.cerrar());

  it("si rs_app no puede escribir en la bitácora, guardar un cliente no deja nada", async () => {
    await base.comoAdmin("REVOKE INSERT ON bitacora FROM rs_app");
    try {
      await expect(guardarCliente(ctx(), null, null, clienteDePrueba())).rejects.toThrow();
    } finally {
      await base.comoAdmin("GRANT INSERT ON bitacora TO rs_app");
    }
    for (const tabla of [clientes, ventanasCliente, documentosCliente]) expect(await base.bd.select().from(tabla)).toEqual([]);
  });

  async function huella(): Promise<string> {
    const r = await analizarImportacion(ctx(), CSV);
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.valor.huella;
  }

  it("dos confirmaciones simultáneas de la misma operación importan una sola vez", async () => {
    const opciones = { operacionId: crypto.randomUUID(), huella: await huella(), aceptarDuplicados: false };
    const [a, b] = await Promise.all([confirmarImportacion(ctx(), CSV, opciones), confirmarImportacion(ctx(), CSV, opciones)]);
    expect([a, b]).toEqual([{ ok: true, valor: { importados: 2 } }, { ok: true, valor: { importados: 2 } }]);
    expect(await base.bd.select().from(clientes)).toHaveLength(2);
  });

  it("dos operaciones distintas del mismo archivo a la vez: la segunda ve los duplicados y responde conflicto", async () => {
    await base.comoAdmin("DELETE FROM bitacora; DELETE FROM importaciones; DELETE FROM clientes");
    const h = await huella();
    const resultados = await Promise.all(
      [crypto.randomUUID(), crypto.randomUUID()].map((operacionId) =>
        confirmarImportacion(ctx(), CSV, { operacionId, huella: h, aceptarDuplicados: true }),
      ),
    );
    expect(resultados).toContainEqual({ ok: true, valor: { importados: 2 } });
    expect(resultados).toContainEqual({ ok: false, error: "conflicto" });
    expect(await base.bd.select().from(clientes)).toHaveLength(2);
  });

  /** Abre una transacción que toma el candado de nombres y la mantiene abierta hasta que se llame a soltar(). */
  function transaccionRetenida(trabajo: Parameters<typeof base.bd.transaction>[0]) {
    let soltar!: () => void;
    const liberada = new Promise<void>((resolver) => (soltar = resolver));
    let avisarTomado!: () => void;
    const tomado = new Promise<void>((resolver) => (avisarTomado = resolver));
    const terminada = base.bd.transaction(async (tx) => {
      await tomarCandadoDeNombres(tx);
      await trabajo(tx);
      avisarTomado();
      await liberada;
    });
    return { tomado, soltar, terminada };
  }

  it("una alta manual con el mismo nombre, a media importación, hace que la confirmación responda conflicto", async () => {
    await base.comoAdmin("DELETE FROM bitacora; DELETE FROM importaciones; DELETE FROM clientes");
    const h = await huella();
    const alta = transaccionRetenida((tx) => insertarCliente(tx, clienteDePrueba({ nombre: "Papelera Concurrente" }), AHORA));
    await alta.tomado;
    const confirmacion = confirmarImportacion(ctx(), CSV, { operacionId: crypto.randomUUID(), huella: h, aceptarDuplicados: true });
    alta.soltar();
    await alta.terminada;
    expect(await confirmacion).toEqual({ ok: false, error: "conflicto" });
    expect(await base.bd.select().from(clientes)).toHaveLength(1);
  });

  it("guardarCliente espera a que termine una escritura de nombres en curso", async () => {
    await base.comoAdmin("DELETE FROM bitacora; DELETE FROM importaciones; DELETE FROM clientes");
    const importacion = transaccionRetenida(async () => undefined);
    await importacion.tomado;
    let terminado = false;
    const guardado = guardarCliente(ctx(), null, null, clienteDePrueba({ nombre: "Alta en espera" })).then((r) => {
      terminado = true;
      return r;
    });
    await new Promise((resolver) => setTimeout(resolver, 300));
    expect(terminado).toBe(false);
    importacion.soltar();
    await importacion.terminada;
    expect(await guardado).toMatchObject({ ok: true });
  });
});
