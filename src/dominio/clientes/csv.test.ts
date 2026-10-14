import { describe, it } from "vitest";

describe("analizarClientesCsv (T3, Codex)", () => {
  it.todo("BOM, punto y coma, coma decimal y renglones vacíos");
  it.todo("campo multilínea: la fila reportada es la de Excel");
  it.todo("comillas sin cerrar, columnas de más y encabezado repetido");
  it.todo("más de 2000 registros o más de 1 MB en bytes UTF-8");
});

describe("posiblesDuplicados (T3, Codex)", () => {
  it.todo('"Cartonera  Núñez S.A." y "cartonera nunez sa" son el mismo nombre normalizado');
});
