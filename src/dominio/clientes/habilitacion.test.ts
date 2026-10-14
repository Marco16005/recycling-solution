import { describe, it } from "vitest";

describe("motivosDeBloqueoCliente (T3, Codex)", () => {
  it.todo("cada CodigoBloqueo por separado, en orden estable");
  it.todo("documento vigente que vence hoy no bloquea; el que venció ayer sí");
  it.todo("RP bloquea como residuo_peligroso y null como residuo_no_definido");
});

describe("diaSemanaDeFecha (T3, Codex)", () => {
  it.todo("domingo es 0 y sábado es 6, sin depender de la zona horaria del proceso");
});
