import fc from "fast-check";
import { TIPOS_UNIDAD } from "@/dominio/clientes/tipos";
import { entrada, patio, solicitud, unidad } from "./ejemplos.test-datos";

const datosSolicitud = fc.record({
  x: fc.integer({ min: -50, max: 50 }), y: fc.integer({ min: -50, max: 50 }),
  carga: fc.integer({ min: 1, max: 14000 }), servicio: fc.integer({ min: 5, max: 120 }),
  registro: fc.integer({ min: 0, max: 59 }), tipo: fc.constantFrom(...TIPOS_UNIDAD),
  ventanas: fc.array(fc.tuple(fc.integer({ min: 450, max: 950 }), fc.integer({ min: 1, max: 180 })), { minLength: 1, maxLength: 3 }),
});
export const casos = fc.record({
  solicitudes: fc.array(datosSolicitud, { maxLength: 25 }),
  unidades: fc.array(fc.record({ tipo: fc.constantFrom(...TIPOS_UNIDAD),
    capacidad: fc.integer({ min: 1000, max: 8000 }), carga: fc.integer({ min: 0, max: 1000 }),
    libre: fc.integer({ min: 480, max: 650 }), x: fc.integer({ min: -20, max: 20 }),
  }), { maxLength: 5 }),
  instante: fc.integer({ min: 480, max: 700 }), semilla: fc.integer(),
}).map(datos => {
  const e = entrada(datos.solicitudes.map((s, i) => solicitud(`s${String(i).padStart(2, "0")}`, {
    registradaEn: `2026-10-14T07:${String(s.registro).padStart(2, "0")}:00-06:00`,
    ubicacion: { lat: patio.lat + s.x / 1000, lng: patio.lng + s.y / 1000 }, cargaKg: s.carga,
    tiempoServicioMin: s.servicio, tiposUnidadAdmitidos: [s.tipo],
    ventanas: s.ventanas.map(([inicioMin, duracion]) => ({ inicioMin, finMin: inicioMin + duracion })),
  })), datos.unidades.map((u, i) => unidad(`u${i}`, { tipo: u.tipo, capacidadKg: u.capacidad,
    cargaActualKg: u.carga, libreDesdeMin: u.libre, ubicacionInicial: { lat: patio.lat + u.x / 1000, lng: patio.lng },
  })));
  e.instanteMin = datos.instante;
  e.parametros.semilla = datos.semilla;
  e.parametros.capacidadMaximaPorTipoKg.torton = 12000;
  e.parametros.capacidadMaximaPorTipoKg.trailer = 12000;
  return e;
});
