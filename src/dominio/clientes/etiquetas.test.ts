import { expect, it } from "vitest";
import { ETIQUETA_ACCION_PRIVACIDAD, ETIQUETA_CANAL, ETIQUETA_ESTADO_SOLICITUD, ETIQUETA_NO_DISPONIBLE } from "./etiquetas";
import { CANALES, ESTADOS_SOLICITUD } from "../solicitudes/tipos";

it("expresa aviso dado a conocer sin oposición y revocación del consentimiento", () => {
  expect(ETIQUETA_ACCION_PRIVACIDAD.aceptado).toBe("Aviso dado a conocer sin oposición");
  expect(ETIQUETA_ACCION_PRIVACIDAD.retirado).toBe("Consentimiento revocado");
});
it("tiene etiquetas para todos los canales, estados y motivos de disponibilidad", () => {
  expect(Object.keys(ETIQUETA_CANAL)).toEqual([...CANALES]);
  expect(Object.keys(ETIQUETA_ESTADO_SOLICITUD)).toEqual([...ESTADOS_SOLICITUD]);
  expect(Object.keys(ETIQUETA_NO_DISPONIBLE)).toEqual(["inactivo", "documento_faltante", "documento_no_vigente", "aviso_no_entregado"]);
});
