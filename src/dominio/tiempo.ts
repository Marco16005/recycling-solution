/** Fecha calendario "AAAA-MM-DD" en la zona horaria de operación (Ciudad de México). */
export function fechaEnMexico(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}
