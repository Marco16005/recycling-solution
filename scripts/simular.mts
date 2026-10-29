import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { admitir, generarPlan, tiempoMuerto } from "../src/motor/index";
import { crearAleatorio } from "../src/motor/zonas";
import type { EntradaPlan, Plan, SolicitudMotor } from "../src/motor/tipos";

// Plan 8, P8-6: los mismos 20 días sintéticos con el motor 1.1.0 (la admisión sola, `admitir`) y con el 1.2.0
// (admisión, reacomodo, readmisión y reacomodo final, `generarPlan`). Cada versión arrastra sus propias pospuestas.

const semilla = 20261014;
const azar = crearAleatorio(semilla);
const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
const patio = { lat: 20.62, lng: -100.27 };
const clientes = Array.from({ length: 100 }, (_, i) => {
  const radioKm = 15 * Math.sqrt(azar());
  const angulo = 2 * Math.PI * azar();
  const inicioMin = entero(480, 600);
  return {
    clienteId: `cliente-sintetico-${String(i + 1).padStart(2, "0")}`,
    ubicacion: { lat: patio.lat + radioKm * Math.sin(angulo) / 111.19508,
      lng: patio.lng + radioKm * Math.cos(angulo) / (111.19508 * Math.cos(patio.lat * Math.PI / 180)) },
    ventanas: [{ inicioMin, finMin: inicioMin + entero(120, 360) }],
    tiempoServicioMin: 66,
  };
});
const parametros: EntradaPlan["parametros"] = { patio, turnoInicioMin: 480, turnoFinMin: 960,
  velocidadKmh: 30, factorCircuidad: 1.3, descargaMin: 15, semilla, toleranciaReadmisionMin: 15,
  capacidadMaximaPorTipoKg: { doble_rodada: 8000, rabon: 0, camioneta: 0 } };

// Las solicitudes nuevas de cada día se generan una sola vez: las dos versiones ven exactamente las mismas.
const dias: { fecha: string; nuevas: SolicitudMotor[] }[] = [];
let consecutivo = 0;
// Calendario fijo en UTC para enumerar fechas, independiente de la zona del contenedor.
for (const calendario = new Date("2026-10-01T00:00:00Z"); dias.length < 20; calendario.setUTCDate(calendario.getUTCDate() + 1)) {
  if (calendario.getUTCDay() === 0) continue;
  const fecha = calendario.toISOString().slice(0, 10);
  dias.push({ fecha, nuevas: Array.from({ length: entero(50, 60) }, () => {
    consecutivo++;
    const id = `solicitud-${String(consecutivo).padStart(5, "0")}`;
    // Registradas en esta jornada antes del turno; los domingos no se generan solicitudes.
    const registro = `${fecha}T${String(entero(6, 7)).padStart(2, "0")}:${String(entero(0, 59)).padStart(2, "0")}:00-06:00`;
    return { ...clientes[entero(0, clientes.length - 1)], id, folio: id, registradaEn: registro,
      cargaKg: entero(300, 3000), tiposUnidadAdmitidos: ["doble_rodada" as const] };
  }) });
}

interface Fila {
  fecha: string; nuevas: number; arrastradas: number; atendidas: number; pospuestas: number; bloqueadas: number;
  readmitidas: number; alarga: number; tiempoMuerto: number; km: number; kmActual: number;
}
const vacia = (fecha: string): Fila => ({ fecha, nuevas: 0, arrastradas: 0, atendidas: 0, pospuestas: 0, bloqueadas: 0,
  readmitidas: 0, alarga: 0, tiempoMuerto: 0, km: 0, kmActual: 0 });

/** Corre los 20 días con un motor y una flota; las pospuestas pasan al siguiente día conservando su registro. */
function simular(motor: (e: EntradaPlan) => Plan, unidadesFlota: number) {
  const unidades: EntradaPlan["unidades"] = Array.from({ length: unidadesFlota }, (_, i) => ({ id: `unidad-${String(i + 1).padStart(2, "0")}`,
    tipo: "doble_rodada", capacidadKg: 8000, ubicacionInicial: patio, libreDesdeMin: 480, cargaActualKg: 0 }));
  let pendientes: SolicitudMotor[] = [];
  const filas: Fila[] = [];
  for (const { fecha, nuevas } of dias) {
    const entrada: EntradaPlan = { fecha, instanteMin: 480, solicitudes: [...pendientes, ...nuevas], unidades, parametros };
    const plan = motor(entrada);
    const idsPendientes = new Set(plan.pospuestas.map(s => s.solicitudId));
    const arrastradas = pendientes.length;
    pendientes = entrada.solicitudes.filter(s => idsPendientes.has(s.id));
    const readmision = plan.reacomodo?.readmision ?? [];
    filas.push({ fecha, nuevas: nuevas.length, arrastradas, atendidas: plan.resumen.ruteadas, pospuestas: plan.resumen.pospuestas,
      bloqueadas: plan.resumen.bloqueadas, readmitidas: readmision.filter(d => d.resultado === "admitida").length,
      alarga: plan.pospuestas.filter(p => p.motivo === "alarga_la_jornada").length,
      tiempoMuerto: tiempoMuerto(entrada, plan.rutas), km: plan.resumen.km, kmActual: plan.resumen.kmMetodoActual });
  }
  const total = filas.reduce((t, f) => ({ ...t, nuevas: t.nuevas + f.nuevas, arrastradas: t.arrastradas + f.arrastradas,
    atendidas: t.atendidas + f.atendidas, pospuestas: t.pospuestas + f.pospuestas, bloqueadas: t.bloqueadas + f.bloqueadas,
    readmitidas: t.readmitidas + f.readmitidas, alarga: t.alarga + f.alarga, tiempoMuerto: t.tiempoMuerto + f.tiempoMuerto,
    km: t.km + f.km, kmActual: t.kmActual + f.kmActual }), vacia("TOTAL"));
  if (total.nuevas !== total.atendidas + total.bloqueadas + pendientes.length) throw new Error("La simulación perdió solicitudes");
  return { filas, total, pendientes: pendientes.length };
}

const ESCENARIOS = [
  { nombre: "Escenario del Documento Integrador (15 unidades)", clave: "di", unidades: 15 },
  { nombre: "Flota reducida (8 unidades)", clave: "flota8", unidades: 8 },
];
const formato = (n: number) => n.toFixed(2);
const mejora = (antes: number, despues: number) => antes === 0 ? "0.00" : formato((1 - despues / antes) * 100);
const columnas = ["escenario", "fecha", "nuevas", "atendidas_1_1", "atendidas_1_2", "pospuestas_1_1", "pospuestas_1_2",
  "readmitidas_1_2", "alarga_1_2", "tiempo_muerto_1_1", "tiempo_muerto_1_2", "km_1_1", "km_1_2", "km_metodo_actual_1_2"];
const lineasCsv: string[] = [columnas.join(",")];
const secciones: string[] = [];
const resumenes: string[] = [];
for (const escenario of ESCENARIOS) {
  const v11 = simular(e => admitir(e), escenario.unidades);
  const v12 = simular(e => generarPlan(e), escenario.unidades);
  const filas = [...v11.filas.map((f, i) => [f, v12.filas[i]] as const), [v11.total, v12.total] as const];
  const valores = ([a, b]: readonly [Fila, Fila]) => [a.fecha, a.nuevas, a.atendidas, b.atendidas, a.pospuestas, b.pospuestas,
    b.readmitidas, b.alarga, a.tiempoMuerto, b.tiempoMuerto, formato(a.km), formato(b.km), formato(b.kmActual)];
  for (const par of filas) lineasCsv.push([escenario.clave, ...valores(par)].join(","));
  const t11 = v11.total, t12 = v12.total;
  resumenes.push([
    `- **${escenario.nombre}:** atendidas ${t11.atendidas} → ${t12.atendidas} (${t12.atendidas - t11.atendidas >= 0 ? "+" : ""}${t12.atendidas - t11.atendidas});`,
    `pendientes únicas al cierre ${v11.pendientes} → ${v12.pendientes}; tiempo muerto ${t11.tiempoMuerto} → ${t12.tiempoMuerto} min`,
    `(${mejora(t11.tiempoMuerto, t12.tiempoMuerto)} % menos); km ${formato(t11.km)} → ${formato(t12.km)} (${mejora(t11.km, t12.km)} % menos);`,
    `${t12.readmitidas} readmitidas y ${t12.alarga} decisiones de "alarga la jornada".`,
  ].join(" "));
  secciones.push([
    `## ${escenario.nombre}`,
    ``,
    `| Fecha | Nuevas | Atendidas 1.1.0 | Atendidas 1.2.0 | Pospuestas 1.1.0 | Pospuestas 1.2.0 | Readmitidas | Alarga la jornada | Tiempo muerto 1.1.0 (min) | Tiempo muerto 1.2.0 (min) | km 1.1.0 | km 1.2.0 | km método actual |`,
    `| ${Array.from({ length: 13 }, () => "---").join(" | ")} |`,
    ...filas.map(par => `| ${valores(par).join(" | ")} |`),
    ``,
    [
      `Conservación en las dos versiones: nuevas = atendidas + bloqueadas + pendientes únicas al cierre`,
      `(${v11.pendientes} con 1.1.0 y ${v12.pendientes} con 1.2.0). Las pospuestas del total suman decisiones por día:`,
      `una solicitud puede aparecer varios días. Cada versión arrastra sus propias pospuestas, así que desde el segundo día`,
      `las entradas de las dos versiones pueden diferir.`,
    ].join(" "),
  ].join("\n"));
}
const csv = lineasCsv.join("\n") + "\n";
const markdown = [
  `# Simulación del motor: 1.1.0 (admisión) contra 1.2.0 (con reacomodo)`,
  ``,
  [
    `Datos exclusivamente sintéticos. Semilla: ${semilla}. Veinte días de operación, de lunes a sábado, del ${dias[0].fecha}`,
    `al ${dias.at(-1)!.fecha}; los domingos no se opera ni se generan solicitudes. Cien clientes dentro de un radio de 15 km`,
    `de un patio hipotético en El Marqués, ventanas de 2 a 6 horas, servicio de 66 min, cargas de 300 a 3000 kg y unidades`,
    `doble rodada de 8000 kg. Cada día se agregan 50 a 60 solicitudes registradas antes del turno; las mismas en las dos`,
    `versiones. Turno 08:00–16:00, velocidad 30 km/h, circuidad 1.3, descarga de 15 min y tolerancia de 15 min por parada`,
    `extra.`,
  ].join(" "),
  ``,
  [
    `**1.1.0** es la admisión del Plan 3 sola (FIFO con agrupación k-means). **1.2.0** agrega el reacomodo (búsqueda local`,
    `por vecindarios), la readmisión de las pospuestas en orden de llegada con la tolerancia y un reacomodo final, sin que`,
    `ninguna unidad termine más de la tolerancia después en un reacomodo. El tiempo muerto suma, por unidad, traslado,`,
    `espera y descargas (sin el servicio). Son resultados **simulados** con tiempos estimados, no ahorro observado.`,
  ].join(" "),
  ``,
  `## Resumen`,
  ``,
  ...resumenes,
  ``,
  ...secciones.flatMap(s => [s, ""]),
  [
    `Reproducir dentro del contenedor del proyecto: \`npx --no-install tsx scripts/simular.mts\`. CSV:`,
    `[resultados.csv](./resultados.csv).`,
  ].join(" "),
  ``,
].join("\n");
const destino = new URL("../docs/simulacion/", import.meta.url);
await mkdir(destino, { recursive: true });
await writeFile(new URL("resultados.csv", destino), csv, "utf8");
await writeFile(new URL("resultados.md", destino), markdown, "utf8");
console.log(`Simulación escrita en ${fileURLToPath(destino)}.\n${resumenes.join("\n")}`);
