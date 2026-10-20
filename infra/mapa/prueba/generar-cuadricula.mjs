// Mapa sintético propio para las pruebas del Plan 7 (sin datos de OpenStreetMap, sin licencia de por medio).
//   - Cuadrícula de calles residenciales de doble sentido: latitud 20.58 a 20.70 y longitud −100.34 a −100.22, cada 0.005°.
//     Cubre el patio de las pruebas (20.62, −100.30) y los clientes de e2e/ayudas (patio + 0.01·i).
//   - La fila de latitud 20.60 es de un solo sentido, hacia el este.
//   - Una isla de calles desconectada entre 20.75 y 20.77 (celdas sin ruta).
//   - Nada entre 20.71 y 20.74 (un pin ahí queda lejos de toda calle).
// Uso: node generar-cuadricula.mjs /mapa/prueba.osm
import { writeFileSync } from "node:fs";

const salida = process.argv[2];
if (!salida) throw new Error("Uso: node generar-cuadricula.mjs <salida.osm>");

const PASO = 0.005;
const nodos = [];
const vias = [];
let siguienteVia = 1;

function rejilla(base, latIni, lngIni, filas, columnas, unSentido = () => false) {
  const id = (f, c) => base + f * 1000 + c + 1;
  for (let f = 0; f < filas; f++)
    for (let c = 0; c < columnas; c++)
      nodos.push({ id: id(f, c), lat: latIni + f * PASO, lng: lngIni + c * PASO });
  for (let f = 0; f < filas; f++)
    vias.push({ id: siguienteVia++, nodos: Array.from({ length: columnas }, (_, c) => id(f, c)), unSentido: unSentido(latIni + f * PASO) });
  for (let c = 0; c < columnas; c++)
    vias.push({ id: siguienteVia++, nodos: Array.from({ length: filas }, (_, f) => id(f, c)), unSentido: false });
}

// 25 × 25 nodos; la fila 4 (20.60) va solo hacia el este (el orden de sus nodos).
rejilla(1_000_000, 20.58, -100.34, 25, 25, (lat) => Math.abs(lat - 20.6) < 1e-9);
// Isla: 5 × 5 nodos.
rejilla(2_000_000, 20.75, -100.3, 5, 5);

const fijo = (x) => x.toFixed(7);
const lineas = ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6" generator="recycling-solution prueba">'];
for (const n of nodos)
  lineas.push(`  <node id="${n.id}" version="1" timestamp="2026-01-01T00:00:00Z" lat="${fijo(n.lat)}" lon="${fijo(n.lng)}"/>`);
for (const v of vias) {
  lineas.push(`  <way id="${v.id}" version="1" timestamp="2026-01-01T00:00:00Z">`);
  for (const ref of v.nodos) lineas.push(`    <nd ref="${ref}"/>`);
  lineas.push('    <tag k="highway" v="residential"/>');
  lineas.push(`    <tag k="name" v="Calle de prueba ${v.id}"/>`);
  if (v.unSentido) lineas.push('    <tag k="oneway" v="yes"/>');
  lineas.push("  </way>");
}
lineas.push("</osm>", "");
writeFileSync(salida, lineas.join("\n"));
console.log(`Mapa de prueba: ${nodos.length} nodos, ${vias.length} calles → ${salida}`);
