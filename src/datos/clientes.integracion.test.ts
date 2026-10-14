import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actualizarClienteSiVersion, insertarCliente, leerCliente } from "./clientes";
import { crearBasePostgres, type BasePostgres } from "./pruebas/postgres-prueba";
import { clienteDePrueba } from "./pruebas/datos-ejemplo";

const AHORA = new Date("2026-10-13T15:00:00Z");

describe("control de versión del cliente con Postgres real", () => {
  let base: BasePostgres;
  beforeAll(async () => {
    base = await crearBasePostgres();
  });
  afterAll(async () => base.cerrar());

  it("dos actualizaciones simultáneas con la misma versión: una gana y la otra recibe conflicto", async () => {
    const { id } = await base.bd.transaction((tx) => insertarCliente(tx, clienteDePrueba(), AHORA));
    const resultados = await Promise.all(
      ["Primera", "Segunda"].map((nombre) =>
        base.bd.transaction((tx) => actualizarClienteSiVersion(tx, id, 1, clienteDePrueba({ nombre }), AHORA)),
      ),
    );
    expect(resultados.map((r) => r.estado).sort()).toEqual(["actualizado", "conflicto"]);
    const leido = await leerCliente(base.bd, id);
    expect(leido?.version).toBe(2);
    const ganador = resultados[0].estado === "actualizado" ? "Primera" : "Segunda";
    expect(leido?.nombre).toBe(ganador);
  });
});
