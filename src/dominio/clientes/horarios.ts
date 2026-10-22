import type { Ventana } from "./tipos";

/** Plan CRM, §4.1: "lun-vie 08:00-14:00; sab 09:00-12:00" ↔ ventanas. Días: lun mar mie jue vie sab dom, con o sin acento. */

const DIAS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;
const AYUDA = "usa, por ejemplo, lun-vie 08:00-14:00; sab 09:00-12:00";
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Sin retroceso: el horario se busca solo al final de la franja; el texto de los días se toma de lo anterior. */
const FINAL = /(\d{2}:\d{2}) ?- ?(\d{2}:\d{2})$/;
/** Límites de largo antes de leer (un CSV viene de fuera). */
export const MAXIMO_HORARIOS = 300;
const MAXIMO_FRANJA = 80;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const indiceDia = (s: string) => DIAS.indexOf(s as (typeof DIAS)[number]);

export function leerHorarios(texto: string): { ok: true; ventanas: Ventana[] } | { ok: false; mensaje: string } {
  const limpio = texto.trim();
  if (limpio === "") return { ok: true, ventanas: [] };
  const error = (franja: string) => ({ ok: false as const, mensaje: `Horario no reconocido: '${franja.slice(0, 40)}'; ${AYUDA}` });
  if (limpio.length > MAXIMO_HORARIOS) return { ok: false, mensaje: `Horario demasiado largo (máximo ${MAXIMO_HORARIOS} caracteres); ${AYUDA}` };
  const ventanas: Ventana[] = [];
  for (const franjaCruda of limpio.split(";")) {
    const franja = franjaCruda.trim().replace(/\s+/g, " ");
    if (franja === "") continue;
    if (franja.length > MAXIMO_FRANJA) return error(franja);
    const final = FINAL.exec(franja);
    const diasTexto = final ? franja.slice(0, final.index).trim() : "";
    if (!final || diasTexto === "") return error(franja);
    const [, inicio, fin] = final;
    if (!HORA.test(inicio) || !HORA.test(fin) || inicio >= fin) return error(franja);
    const dias = new Set<number>();
    for (const pieza of sinAcentos(diasTexto).split(",").map((p) => p.trim()).filter(Boolean)) {
      const rango = pieza.split("-").map((p) => p.trim());
      if (rango.length > 2) return error(franja);
      const [desde, hasta] = [indiceDia(rango[0]), indiceDia(rango[rango.length - 1])];
      if (desde < 0 || hasta < 0) return error(franja);
      // lun-dom recorre de lunes a domingo pasando por el fin de semana.
      for (let d = desde; ; d = (d + 1) % 7) { dias.add(d); if (d === hasta) break; }
    }
    if (dias.size === 0) return error(franja);
    for (const diaSemana of dias) ventanas.push({ diaSemana, horaInicio: inicio, horaFin: fin });
  }
  ventanas.sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio));
  return { ok: true, ventanas };
}

/** Agrupa días consecutivos con el mismo horario: lun-vie 08:00-14:00; sab 09:00-12:00. */
export function escribirHorarios(ventanas: Ventana[]): string {
  const porHorario = new Map<string, number[]>();
  for (const v of ventanas) {
    const clave = `${v.horaInicio}-${v.horaFin}`;
    porHorario.set(clave, [...(porHorario.get(clave) ?? []), v.diaSemana]);
  }
  const franjas: { primerDia: number; texto: string }[] = [];
  for (const [horario, diasCrudos] of porHorario) {
    // Lunes primero y domingo al final, como se escribe en México.
    const dias = [...new Set(diasCrudos)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const grupos: number[][] = [];
    for (const d of dias) {
      const ultimo = grupos.at(-1);
      if (ultimo && (ultimo.at(-1)! + 1) % 7 === d && d !== 1) ultimo.push(d);
      else grupos.push([d]);
    }
    const textoDias = grupos.map((g) => (g.length >= 3 ? `${DIAS[g[0]]}-${DIAS[g.at(-1)!]}` : g.map((d) => DIAS[d]).join(", "))).join(", ");
    franjas.push({ primerDia: (dias[0] + 6) % 7, texto: `${textoDias} ${horario}` });
  }
  return franjas.sort((a, b) => a.primerDia - b.primerDia).map((f) => f.texto).join("; ");
}
