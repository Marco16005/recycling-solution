import type { Coordenada, EntradaPlan, Plan } from "./tipos";

export type * from "./tipos";

/** Plan del día o re-ruteo (con unidades que ya descuentan lo congelado). Lanza error si hay solicitudes repetidas. */
export function generarPlan(entrada: EntradaPlan): Plan {
  void entrada;
  throw new Error("pendiente: Plan 3 (Codex)");
}

/** [] si el plan cumple todas las propiedades del Plan 3 §5; cada texto explica una violación. */
export function validarPlan(entrada: EntradaPlan, plan: Plan): string[] {
  void entrada;
  void plan;
  throw new Error("pendiente: Plan 3 (Codex)");
}

/** Haversine multiplicado por el factor de circuidad. */
export function distanciaKm(a: Coordenada, b: Coordenada, factorCircuidad: number): number {
  void a;
  void b;
  void factorCircuidad;
  throw new Error("pendiente: Plan 3 (Codex)");
}

/** Minutos enteros, redondeando hacia arriba. */
export function minutosDeTraslado(km: number, velocidadKmh: number): number {
  void km;
  void velocidadKmh;
  throw new Error("pendiente: Plan 3 (Codex)");
}
