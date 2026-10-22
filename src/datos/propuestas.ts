import { and, asc, eq, inArray } from "drizzle-orm";
import type { DecisionPropuesta } from "@/dominio/solicitudes/propuestas";
import type { BD, Tx } from "./bd";
import { propuestasRecoleccion } from "./esquema";

/** Plan CRM, §4.4: decisiones sobre propuestas de recolección. Una por cliente y fecha; solo se agregan. */

export interface NuevaDecision {
  clienteId: string; fecha: string; estado: DecisionPropuesta["estado"]; pospuestaHasta: string | null;
  solicitudId: string | null; nota: string | null; decididaPor: string;
}

export async function insertarDecisionPropuesta(tx: Tx, d: NuevaDecision, en: Date): Promise<string> {
  const [fila] = await tx.insert(propuestasRecoleccion).values({ ...d, decididaEn: en }).returning({ id: propuestasRecoleccion.id });
  return fila.id;
}

/** Decisiones por cliente, en orden de fecha. */
export async function decisionesDePropuestas(bd: BD | Tx, clienteIds: string[]): Promise<Map<string, DecisionPropuesta[]>> {
  const salida = new Map<string, DecisionPropuesta[]>();
  if (clienteIds.length === 0) return salida;
  const filas = await bd
    .select({ clienteId: propuestasRecoleccion.clienteId, fecha: propuestasRecoleccion.fecha, estado: propuestasRecoleccion.estado,
      pospuestaHasta: propuestasRecoleccion.pospuestaHasta })
    .from(propuestasRecoleccion)
    .where(inArray(propuestasRecoleccion.clienteId, clienteIds))
    .orderBy(asc(propuestasRecoleccion.fecha));
  for (const f of filas) salida.set(f.clienteId, [...(salida.get(f.clienteId) ?? []), { fecha: f.fecha, estado: f.estado, pospuestaHasta: f.pospuestaHasta }]);
  return salida;
}

/** La decisión de un cliente para una fecha, si ya la hay (para responder "ya confirmada"). */
export async function decisionDe(bd: BD | Tx, clienteId: string, fecha: string) {
  const [fila] = await bd.select().from(propuestasRecoleccion)
    .where(and(eq(propuestasRecoleccion.clienteId, clienteId), eq(propuestasRecoleccion.fecha, fecha)));
  return fila ?? null;
}
