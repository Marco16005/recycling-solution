/* eslint-disable @typescript-eslint/no-unused-vars -- Contratos pendientes de implementar en I1 (Codex). */
import type { ConteosK3, Medida, RecoleccionMedida, ViajeMedido } from "./tipos";

export type * from "./tipos";

export function k1(r: RecoleccionMedida[]): { espera: Medida; traslado: Medida } {
  throw new Error("pendiente");
}
export function k2(capturasSeg: number[], lineaBaseSeg: number | null): Medida {
  throw new Error("pendiente");
}
export function k3(r: RecoleccionMedida[], conteos: ConteosK3): Medida & ConteosK3 {
  throw new Error("pendiente");
}
export function k4(v: ViajeMedido[], simulado: { km: number; kmMetodoActual: number }[]): {
  kmReales: Medida; kmContrafactual: number; litros: number | null; ahorroObservado: Medida; ahorroSimulado: Medida;
} {
  throw new Error("pendiente");
}
export function k5(
  actual: { activos: number; completos: number },
  serie: { fecha: string; activos: number; completos: number }[],
): Medida & { serie: { fecha: string; valor: number }[] } {
  throw new Error("pendiente");
}
export function k6(planes: { tipo: "inicial" | "re_ruteo"; generadoEn: Date; revisionIniciadaEn: Date | null; validadoEn: Date }[]):
  Record<"inicial" | "re_ruteo", { demora: Medida; trabajoActivo: Medida }> & { metaMin: 5 } {
  throw new Error("pendiente");
}
export function k7(e: { duracionMs: number; resultado: "ok" | "error" | "tiempo_agotado" }[]): {
  mediana: Medida; maximo: number | null; errores: number; agotadas: number;
} {
  throw new Error("pendiente");
}
export function ciclo(r: RecoleccionMedida[]): Medida {
  throw new Error("pendiente");
}
/** Con BOM, encabezados en español y celdas vacías para los faltantes. */
export function csv(r: RecoleccionMedida[]): string {
  throw new Error("pendiente");
}
