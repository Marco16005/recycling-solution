import { describe, expect, it } from "vitest";
import { numerosDeCliente } from "./cliente";

// Plan CRM, §4.5, con valores a mano. Horas ISO en UTC; Ciudad de México es UTC−6.
const parada = (fecha: string, estado: string, inicioLocal: string | null) => ({
  fecha, estado, inicioServicioEn: inicioLocal ? new Date(`${fecha}T${inicioLocal}:00-06:00`).toISOString() : null,
  ventanaInicio: "08:00", ventanaFin: "12:00",
});

describe("numerosDeCliente", () => {
  it("3 completadas, 1 no atendida y 2 de 3 inicios en horario (uno llegó antes y esperó: cuenta) dan 66.7 % con muestra 3", () => {
    const n = numerosDeCliente({
      paradas: [
        parada("2026-10-01", "completada", "08:00"),   // justo al abrir: cuenta
        parada("2026-10-08", "completada", "12:30"),   // fuera
        parada("2026-10-15", "completada", "11:59"),   // dentro (había llegado antes y esperó)
        parada("2026-10-16", "no_atendida", null),
        parada("2026-06-01", "completada", "09:00"),   // fuera de los 90 días
      ],
      solicitudes: [
        { fechaSolicitada: "2026-10-01", estado: "atendida", vecesPospuesta: 1 },
        { fechaSolicitada: "2026-10-08", estado: "atendida", vecesPospuesta: 0 },
        { fechaSolicitada: "2026-10-15", estado: "atendida", vecesPospuesta: 2 },
        { fechaSolicitada: "2026-06-01", estado: "atendida", vecesPospuesta: 5 },
      ],
    }, "2026-10-21");
    expect(n).toEqual({
      completadas: 3, noAtendidas: 1, ultimaVisita: "2026-10-15",
      // El ritmo mira 180 días (incluye la de junio: diferencias 122, 7 y 7, mediana 7); los números, 90.
      ritmo: { dias: 7, ultima: "2026-10-15", muestra: 4 },
      vecesPospuesta: 3, dentroDeHorario: { porcentaje: 66.7, muestra: 3 },
    });
  });
  it("sin datos: ceros, nulos y muestra 0", () =>
    expect(numerosDeCliente({ paradas: [], solicitudes: [] }, "2026-10-21")).toEqual({
      completadas: 0, noAtendidas: 0, ultimaVisita: null, ritmo: null, vecesPospuesta: 0, dentroDeHorario: { porcentaje: null, muestra: 0 },
    }));
});
