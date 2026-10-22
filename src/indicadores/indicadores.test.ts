import { describe, expect, it } from "vitest";
import { celda, ciclo, csv, k1, k2, k3, k4, k5, k6, k7, type RecoleccionMedida } from "./index";

/** 2026-10-15 en Ciudad de México (UTC−6): "08:00" → 14:00Z. */
const h = (hhmm: string, seg = 0) => new Date(`2026-10-15T${String(Number(hhmm.slice(0, 2)) + 6).padStart(2, "0")}:${hhmm.slice(3)}:${String(seg).padStart(2, "0")}Z`);

/**
 * Un viaje con dos completadas y una no atendida, a mano:
 * - disponible 08:00, asignado 08:10 → espera del viaje 10 min, prorrateada entre 2 completadas = 5 min.
 * - salida 08:20; P1 llega 08:35 (traslado 15), inicia 08:40 (ventana 08:30–09:00), termina 09:00 (servicio 25).
 * - P2 no atendida, cierra 09:20.
 * - P3 llega 09:40 (traslado desde el cierre de P2 = 20), inicia 09:45 (ventana 10:00–11:00: empezó antes de abrir, fuera),
 *   termina 10:05 (servicio 25).
 * - regreso y descarga 30 min tras el último cierre → 15 min por completada.
 */
function viaje(): RecoleccionMedida[] {
  const base = {
    fecha: "2026-10-15", placa: "ABC123", viajeId: "v1", numeroViajeEnJornada: 1, asignadaEn: h("08:10"), disponibleParaSalirEn: h("08:00"),
    completadasDelViaje: 2, regresoMasDescargaMin: 30, kmContrafactual: 10,
  };
  return [
    { ...base, folio: "F1", cliente: "Cartonera, S.A.", estado: "completada", llegadaEn: h("08:35"), inicioServicioEn: h("08:40"), finServicioEn: h("09:00"),
      ventanaInicio: "08:30", ventanaFin: "09:00", anterior: { tipo: "primera", salidaPatioEn: h("08:20") } },
    { ...base, folio: "F2", cliente: "Papelera", estado: "no_atendida", llegadaEn: h("09:15"), inicioServicioEn: null, finServicioEn: null,
      ventanaInicio: "08:00", ventanaFin: "12:00", anterior: { tipo: "anterior", cierreEn: h("09:00") } },
    { ...base, folio: "F3", cliente: "Empaques \"Sur\"", estado: "completada", llegadaEn: h("09:40"), inicioServicioEn: h("09:45"), finServicioEn: h("10:05"),
      ventanaInicio: "10:00", ventanaFin: "11:00", anterior: { tipo: "anterior", cierreEn: h("09:20") } },
  ];
}

describe("indicadores (valores calculados a mano)", () => {
  it("K1: espera prorrateada y traslado desde la salida o desde el cierre de la anterior", () => {
    const r = k1(viaje());
    expect(r.espera).toEqual({ valor: 5, muestra: 2 });
    expect(r.traslado).toEqual({ valor: (15 + 20) / 2, muestra: 2 });
  });

  it("K1: asignar antes de la disponibilidad es espera 0; sin hora de la anterior, el traslado falta", () => {
    const [p] = viaje();
    expect(k1([{ ...p, asignadaEn: h("07:50") }]).espera).toEqual({ valor: 0, muestra: 1 });
    expect(k1([{ ...p, anterior: { tipo: "anterior", cierreEn: null } }]).traslado).toEqual({ valor: null, muestra: 0 });
  });

  it("K2: mediana de las capturas contra su línea base", () => {
    expect(k2([30, 10, 20, 50], 120)).toEqual({ valor: 25, muestra: 4, lineaBase: 120 });
    expect(k2([], null)).toEqual({ valor: null, muestra: 0 });
  });

  it("K3: llegar antes y esperar cuenta; empezar antes de abrir o después del cierre exacto, no", () => {
    const conteos = { noAtendidas: 1, omitidas: 0, pendientesAlCierre: 0 };
    expect(k3(viaje(), conteos)).toEqual({ valor: 50, muestra: 2, ...conteos });
    const [p1] = viaje(); // ventana 08:30–09:00
    const con = (hhmm: string, seg = 0) => k3([{ ...p1, inicioServicioEn: h(hhmm, seg) }], conteos).valor;
    expect(con("08:30")).toBe(100);
    expect(con("08:29", 59)).toBe(0);
    expect(con("09:00")).toBe(100);
    expect(con("09:00", 1)).toBe(0);
  });

  it("K4: km por odómetro contra el contrafactual de las completadas; litros con el rendimiento; ahorro simulado aparte", () => {
    const r = k4(
      [
        { viajeId: "v1", odometroInicioKm: 1000, odometroFinKm: 1030, rendimientoKmL: 3, kmContrafactualCompletadas: 40 },
        { viajeId: "v2", odometroInicioKm: null, odometroFinKm: 1100, rendimientoKmL: 3, kmContrafactualCompletadas: 99 },
      ],
      [{ km: 60, kmMetodoActual: 100 }],
    );
    expect(r.kmReales).toEqual({ valor: 30, muestra: 1 });
    expect(r.kmContrafactual).toBe(40);
    expect(r.litros).toBe(10);
    expect(r.ahorroObservado).toEqual({ valor: 25, muestra: 1 });
    expect(r.ahorroSimulado).toEqual({ valor: 40, muestra: 1 });
  });

  it("K5: el valor actual en vivo; la serie con huecos donde no hubo instantánea", () => {
    expect(k5({ activos: 80, completos: 60 }, [{ fecha: "2026-10-13", activos: 80, completos: 40 }, { fecha: "2026-10-15", activos: 80, completos: 60 }]))
      .toEqual({ valor: 75, muestra: 80, serie: [{ fecha: "2026-10-13", valor: 50 }, { fecha: "2026-10-15", valor: 75 }] });
    expect(k5({ activos: 0, completos: 0 }, []).valor).toBeNull();
  });

  it("K6: demora total y trabajo activo, iniciales y re-ruteos por separado", () => {
    const r = k6([
      { tipo: "inicial", generadoEn: h("07:00"), revisionIniciadaEn: h("07:20"), validadoEn: h("07:24") },
      { tipo: "inicial", generadoEn: h("07:00"), revisionIniciadaEn: null, validadoEn: h("07:10") },
      { tipo: "re_ruteo", generadoEn: h("11:00"), revisionIniciadaEn: h("11:01"), validadoEn: h("11:03") },
    ]);
    expect(r.inicial).toEqual({ demora: { valor: 17, muestra: 2 }, trabajoActivo: { valor: 4, muestra: 1 } });
    expect(r.re_ruteo).toEqual({ demora: { valor: 3, muestra: 1 }, trabajoActivo: { valor: 2, muestra: 1 } });
    expect(r.metaMin).toBe(5);
  });

  it("K7: mediana y máximo de las corridas correctas; fallidas y agotadas aparte", () => {
    expect(k7([
      { duracionMs: 4, resultado: "ok" }, { duracionMs: 2, resultado: "ok" }, { duracionMs: 9, resultado: "ok" },
      { duracionMs: 1, resultado: "error" }, { duracionMs: 31000, resultado: "tiempo_agotado" },
    ])).toEqual({ mediana: { valor: 4, muestra: 3 }, maximo: 9, errores: 1, agotadas: 1 });
  });

  it("ciclo: espera + traslado + servicio + regreso y descarga prorrateados, solo con todos los tramos", () => {
    // P1: 5 + 15 + 25 + 15 = 60; P3: 5 + 20 + 25 + 15 = 65.
    expect(ciclo(viaje())).toEqual({ valor: 62.5, muestra: 2 });
    const [p1] = viaje();
    expect(ciclo([{ ...p1, regresoMasDescargaMin: null }])).toEqual({ valor: null, muestra: 0 });
  });

  it("CSV: BOM, encabezados, una fila por recolección, comillas cuando hacen falta y celdas vacías", () => {
    const texto = csv(viaje());
    expect(texto.startsWith("﻿fecha,folio,cliente,placa,viaje,estado,")).toBe(true);
    const filas = texto.slice(1).trimEnd().split("\r\n");
    expect(filas).toHaveLength(4);
    expect(filas[1]).toBe('2026-10-15,F1,"Cartonera, S.A.",ABC123,1,completada,5,15,25,15,60,si,10');
    expect(filas[2]).toBe("2026-10-15,F2,Papelera,ABC123,1,no atendida,,,,,,,10");
    expect(filas[3]).toBe('2026-10-15,F3,"Empaques ""Sur""",ABC123,1,completada,5,20,25,15,65,no,10');
  });

  it("CSV: un nombre que empieza como fórmula se neutraliza para que Excel no lo ejecute", () => {
    const [p1] = viaje();
    for (const nombre of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUMA(A1)"]) {
      const fila = csv([{ ...p1, cliente: nombre }]).slice(1).split("\r\n")[1];
      expect(fila.split(",")[2].replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csv([{ ...p1, folio: "=F1" }]).slice(1).split("\r\n")[1].startsWith("2026-10-15,'=F1,")).toBe(true);
    // Plan CRM: un número puro no es fórmula; "-1+1" sí.
    expect(celda("-100.3")).toBe("-100.3");
    expect(celda("-1+1")).toBe("'-1+1");
    expect(celda("+52 442")).toBe("'+52 442");
    // Revisión de Codex: un apóstrofo inicial también se protege, para que la importación quite solo el de la exportación.
    expect(celda("'Los Pinos'")).toBe("''Los Pinos'");
    expect(celda("Los 'Pinos'")).toBe("Los 'Pinos'");
  });
});
