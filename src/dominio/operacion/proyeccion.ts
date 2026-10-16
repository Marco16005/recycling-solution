import type { EstadoJornada, OpcionesProyeccion, ProyeccionJornada } from "./tipos";

/** Pura (Plan 7, §4.3). turnoFinMin y descargaMin solo se usan en rutas sin tiempos. La implementa Codex en P7-3. */
export function proyectarJornada(estado: EstadoJornada, opciones: OpcionesProyeccion): ProyeccionJornada {
  void estado; void opciones;
  throw new Error("pendiente: P7-3");
}
