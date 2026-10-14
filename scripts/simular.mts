import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generarPlan } from "../src/motor/index";
import { crearAleatorio } from "../src/motor/zonas";
import type { EntradaPlan, SolicitudMotor } from "../src/motor/tipos";

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
const unidades: EntradaPlan["unidades"] = Array.from({ length: 15 }, (_, i) => ({ id: `unidad-${i + 1}`,
  tipo: "doble_rodada", capacidadKg: 8000, ubicacionInicial: patio, libreDesdeMin: 480, cargaActualKg: 0 }));
const parametros: EntradaPlan["parametros"] = { patio, turnoInicioMin: 480, turnoFinMin: 960,
  velocidadKmh: 30, factorCircuidad: 1.3, descargaMin: 15, semilla,
  capacidadMaximaPorTipoKg: { doble_rodada: 8000, rabon: 0, camioneta: 0 } };
const ahorro = (motor: number, actual: number) => actual === 0 ? 0 : (1 - motor / actual) * 100;
const formato = (n: number) => n.toFixed(2);
let pendientes: SolicitudMotor[] = [];
let consecutivo = 0;
const filas: { fecha: string; nuevas: number; arrastradas: number; ruteadas: number; pospuestas: number; bloqueadas: number;
  km: number; kmActual: number; minutos: number; minutosActual: number; viajes: number[] }[] = [];

// Calendario fijo en UTC para enumerar fechas, independiente de la zona del contenedor.
const calendario = new Date("2026-10-01T00:00:00Z");
for (; filas.length < 20; calendario.setUTCDate(calendario.getUTCDate() + 1)) {
  if (calendario.getUTCDay() === 0) continue;
  const fecha = calendario.toISOString().slice(0, 10);
  const arrastradas = pendientes.length;
  const cantidad = entero(50, 60);
  const nuevas: SolicitudMotor[] = Array.from({ length: cantidad }, () => {
    consecutivo++;
    const id = `solicitud-${String(consecutivo).padStart(5, "0")}`;
    // Registradas en esta jornada antes del turno; los domingos no se generan solicitudes.
    const registro = `${fecha}T${String(entero(6, 7)).padStart(2, "0")}:${String(entero(0, 59)).padStart(2, "0")}:00-06:00`;
    return { ...clientes[entero(0, clientes.length - 1)], id, folio: id, registradaEn: registro,
      cargaKg: entero(300, 3000), tiposUnidadAdmitidos: ["doble_rodada"] };
  });
  const solicitudes = [...pendientes, ...nuevas];
  const plan = generarPlan({ fecha, instanteMin: 480, solicitudes, unidades, parametros });
  const idsPendientes = new Set(plan.pospuestas.map(s => s.solicitudId));
  pendientes = solicitudes.filter(s => idsPendientes.has(s.id));
  filas.push({ fecha, nuevas: cantidad, arrastradas, ruteadas: plan.resumen.ruteadas,
    pospuestas: plan.resumen.pospuestas, bloqueadas: plan.resumen.bloqueadas,
    km: plan.resumen.km, kmActual: plan.resumen.kmMetodoActual,
    minutos: plan.resumen.minutosTraslado, minutosActual: plan.resumen.minutosTrasladoMetodoActual,
    viajes: unidades.map(u => plan.rutas.find(r => r.unidadId === u.id)?.viajes.length ?? 0) });
}
const total = filas.reduce((t, f) => ({ ...t, nuevas: t.nuevas + f.nuevas, arrastradas: t.arrastradas + f.arrastradas,
  ruteadas: t.ruteadas + f.ruteadas, pospuestas: t.pospuestas + f.pospuestas, bloqueadas: t.bloqueadas + f.bloqueadas,
  km: t.km + f.km, kmActual: t.kmActual + f.kmActual, minutos: t.minutos + f.minutos, minutosActual: t.minutosActual + f.minutosActual,
  viajes: t.viajes.map((v, i) => v + f.viajes[i]),
}), { fecha: "TOTAL", nuevas: 0, arrastradas: 0, ruteadas: 0, pospuestas: 0, bloqueadas: 0,
  km: 0, kmActual: 0, minutos: 0, minutosActual: 0, viajes: unidades.map(() => 0) });
if (total.nuevas !== total.ruteadas + total.bloqueadas + pendientes.length) throw new Error("La simulación perdió solicitudes");
const columnas = ["fecha", "nuevas", "arrastradas", "ruteadas", "pospuestas", "bloqueadas", "km_motor", "km_actual",
  "ahorro_km_pct", "minutos_motor", "minutos_actual", "ahorro_minutos_pct", ...unidades.map(u => `viajes_${u.id}`)];
const valores = (f: typeof total) => [f.fecha, f.nuevas, f.arrastradas, f.ruteadas, f.pospuestas, f.bloqueadas,
  formato(f.km), formato(f.kmActual), formato(ahorro(f.km, f.kmActual)), f.minutos, f.minutosActual,
  formato(ahorro(f.minutos, f.minutosActual)), ...f.viajes];
const csv = [columnas.join(","), ...[...filas, total].map(f => valores(f).join(","))].join("\n") + "\n";
const markdown = `# Simulación del motor 1.0.0

Datos exclusivamente sintéticos. Semilla: ${semilla}. Escenario del Documento Integrador: veinte días de operación, de lunes a sábado, del ${filas[0].fecha} al ${filas.at(-1)!.fecha}; los domingos no se opera ni se generan solicitudes. Cien clientes dentro de un radio de 15 km de un patio hipotético en El Marqués, ventanas de 2 a 6 horas, servicio de 66 min, cargas de 300 a 3000 kg y quince unidades doble rodada de 8000 kg. Cada día de operación se agregan 50 a 60 solicitudes registradas ese mismo día antes del turno; las pospuestas se vuelven a intentar conservando su registro y ventanas. Turno 08:00–16:00, velocidad 30 km/h, circuidad 1.3 y descarga de 15 min.

Es un ahorro **simulado**, con tiempos estimados; no constituye ahorro observado ni evidencia de cumplimiento de K4. Se comparan las mismas solicitudes atendidas: un viaje redondo patio–cliente–patio por cada una en el método actual. La comparación no demuestra que el método actual pudiera atenderlas todas dentro del turno. Los minutos de traslado excluyen servicio, espera y descarga, y se redondean hacia arriba por tramo.

| Fecha | Nuevas | Arrastradas | Ruteadas | Pospuestas | Bloqueadas | km motor | km actual | Ahorro km % | min motor | min actual | Ahorro min % | ${unidades.map(u => `Viajes ${u.id}`).join(" | ")} |
| ${columnas.map(() => "---").join(" | ")} |
${[...filas, total].map(f => `| ${valores(f).join(" | ")} |`).join("\n")}

Las pospuestas del total (${total.pospuestas}) cuentan decisiones por jornada: una solicitud puede aparecer varios días. Quedan **${pendientes.length} solicitudes únicas pendientes** al terminar la jornada de operación 20. Conservación: ${total.nuevas} nuevas = ${total.ruteadas} atendidas + ${total.bloqueadas} bloqueadas + ${pendientes.length} pendientes. Los porcentajes totales se calculan sobre las sumas, no promediando porcentajes diarios. Se informa el saldo de pendientes sin eliminar solicitudes difíciles ni suponer de antemano que la flota cubrirá toda la demanda.

Reproducir dentro del contenedor del proyecto: \`npx --no-install tsx scripts/simular.mts\`. CSV: [resultados.csv](./resultados.csv).
`;
const destino = new URL("../docs/simulacion/", import.meta.url);
await mkdir(destino, { recursive: true });
await writeFile(new URL("resultados.csv", destino), csv, "utf8");
await writeFile(new URL("resultados.md", destino), markdown, "utf8");
console.log(`Simulación escrita en ${fileURLToPath(destino)}; ${total.ruteadas} atendidas y ${pendientes.length} pendientes únicas.`);
