/**
 * Plan 8: reacomodo (fases 2 y 4) y readmisión (fase 3) del motor 1.2.0.
 * Puro y determinista: los presupuestos se cuentan en evaluaciones de ruta, nunca en tiempo de reloj, y la única caché
 * vive dentro de una corrida.
 */
import { calcular, diagnosticoVacio, type Calculo } from "./calculo";
import { compararTexto } from "./orden";
import { crearTraslados } from "./traslados";
import type { DecisionReadmision, EntradaPlan, PosicionPlan, RestriccionesPlan, RutaPlan, SolicitudMotor, Traslados, UnidadMotor } from "./tipos";

/** Rutas recalculadas que puede gastar cada fase de reacomodo (§4.4). */
export const PRESUPUESTO_EVALUACIONES = 100_000;
/** Rutas recalculadas que puede gastar "mover una y meter" por cada pospuesta (§4.5). */
export const PRESUPUESTO_READMISION = 20_000;
/** Mejora mínima de km para contar como estricta: evita aceptar ruido de punto flotante. */
const EPSILON_KM = 1e-9;

const inicioEfectivo = (entrada: EntradaPlan, u: UnidadMotor) =>
  Math.max(entrada.instanteMin, u.libreDesdeMin, entrada.parametros.turnoInicioMin);

/** Tiempo muerto de una ruta: fin de descarga del último viaje − inicio efectivo − servicios. Sin viajes, 0. */
function tiempoMuertoDeRuta(entrada: EntradaPlan, u: UnidadMotor, ruta: RutaPlan, solicitudes: Map<string, SolicitudMotor>): number {
  const ultimo = ruta.viajes.at(-1);
  if (!ultimo) return 0;
  const servicios = ruta.viajes.reduce((suma, v) => suma + v.paradas.reduce((s, p) => s + solicitudes.get(p.solicitudId)!.tiempoServicioMin, 0), 0);
  return ultimo.finDescargaMin - inicioEfectivo(entrada, u) - servicios;
}

/**
 * Tiempo muerto por §4.2 de la especificación: por unidad, fin de descarga del último viaje − inicio efectivo
 * − servicios de sus paradas, con inicio efectivo = max(instanteMin, libreDesdeMin, turnoInicioMin). Suma de las unidades.
 * Comprende traslado con horas pico, espera y descargas; un regreso obligatorio con carga aporta su traslado y descarga.
 */
export function tiempoMuerto(entrada: EntradaPlan, rutas: RutaPlan[]): number {
  const unidades = new Map(entrada.unidades.map(u => [u.id, u]));
  const solicitudes = new Map(entrada.solicitudes.map(s => [s.id, s]));
  return rutas.reduce((suma, r) => suma + tiempoMuertoDeRuta(entrada, unidades.get(r.unidadId)!, r, solicitudes), 0);
}

interface Valor { tm: number; km: number }
const mejor = (a: Valor, b: Valor) => a.tm < b.tm || (a.tm === b.tm && a.km < b.km - EPSILON_KM);
const ids = (r: RutaPlan) => r.viajes.map(v => v.paradas.map(p => p.solicitudId));
const clave = (viajes: string[][]) => viajes.map(v => v.join(",")).join("/");

/** Una ruta cambiada: índice de la unidad (orden por id) y sus viajes nuevos. */
interface Cambio { i: number; viajes: string[][] }

/**
 * Contexto de una corrida de reacomodo o readmisión: unidades en orden canónico (por id), secuencias y valores vigentes,
 * protegidas (restricciones.admitidas) y una caché de rutas evaluadas que no sobrevive a la corrida.
 */
class Estado {
  readonly unidades: UnidadMotor[];
  secuencias: string[][][];
  rutas: RutaPlan[];
  valores: Valor[];
  readonly protegidas: Set<string>;
  private readonly admitidas: string[][][];
  private readonly cache = new Map<string, Valor | null>();

  constructor(readonly entrada: EntradaPlan, rutas: RutaPlan[], readonly solicitudes: Map<string, SolicitudMotor>,
    readonly t: Traslados, restricciones?: RestriccionesPlan) {
    this.unidades = [...entrada.unidades].sort((a, b) => compararTexto(a.id, b.id));
    const porUnidad = new Map(rutas.map(r => [r.unidadId, r]));
    if (porUnidad.size !== this.unidades.length || this.unidades.some(u => !porUnidad.has(u.id)))
      throw new Error("Reacomodo: una ruta por unidad");
    this.rutas = this.unidades.map(u => porUnidad.get(u.id)!);
    this.secuencias = this.rutas.map(ids);
    this.valores = this.rutas.map((r, i) => this.valorDe(i, r));
    this.admitidas = this.unidades.map(u => restricciones?.admitidas[u.id] ?? []);
    this.protegidas = new Set(this.admitidas.flat(2));
  }

  total(): Valor {
    return this.valores.reduce((a, v) => ({ tm: a.tm + v.tm, km: a.km + v.km }), { tm: 0, km: 0 });
  }

  private valorDe(i: number, r: RutaPlan): Valor {
    return { tm: tiempoMuertoDeRuta(this.entrada, this.unidades[i], r, this.solicitudes), km: r.viajes.reduce((s, v) => s + v.km, 0) };
  }

  /** Comprobaciones que el cálculo de horarios no hace: viajes vacíos y protegidas (§4.4). El tipo lo revisa quien mueve. */
  estructuraValida({ i, viajes }: Cambio): boolean {
    const u = this.unidades[i];
    if (viajes.some((v, k) => v.length === 0 && !(k === 0 && u.cargaActualKg > 0))) return false;
    if (u.cargaActualKg > 0 && viajes.length === 0) return false;
    // Cada viaje admitido conserva su índice y el orden relativo de sus protegidas.
    return this.admitidas[i].every((protegidas, k) => {
      const viaje = viajes[k];
      if (!viaje) return false;
      let desde = 0;
      for (const id of protegidas) {
        const j = viaje.indexOf(id, desde);
        if (j < 0) return false;
        desde = j + 1;
      }
      return true;
    });
  }

  admite(i: number, id: string): boolean {
    return this.solicitudes.get(id)!.tiposUnidadAdmitidos.includes(this.unidades[i].tipo);
  }

  /** null si no es factible por capacidad, ventana o fin de turno. */
  evaluar({ i, viajes }: Cambio): Valor | null {
    const k = `${i}|${clave(viajes)}`;
    const guardado = this.cache.get(k);
    if (guardado !== undefined) return guardado;
    const c = calcular(this.entrada, this.unidades[i], viajes, this.solicitudes, this.t);
    const valor = "ruta" in c ? this.valorDe(i, c.ruta) : null;
    this.cache.set(k, valor);
    return valor;
  }

  /** Sin caché: con la causa del rechazo para el diagnóstico de la readmisión (nueva = la que se inserta). */
  intentar({ i, viajes }: Cambio, nueva: string): Valor | Extract<Calculo, { causa: unknown }> {
    const c = calcular(this.entrada, this.unidades[i], viajes, this.solicitudes, this.t, nueva);
    return "ruta" in c ? this.valorDe(i, c.ruta) : c;
  }

  aplicar(cambios: Cambio[]): void {
    for (const { i, viajes } of cambios) {
      const c = calcular(this.entrada, this.unidades[i], viajes, this.solicitudes, this.t);
      if (!("ruta" in c)) throw new Error("Reacomodo: un cambio aceptado dejó de ser factible");
      this.secuencias = this.secuencias.map((s, j) => j === i ? viajes : s);
      this.rutas = this.rutas.map((r, j) => j === i ? c.ruta : r);
      this.valores = this.valores.map((v, j) => j === i ? this.valorDe(i, c.ruta) : v);
    }
  }

  /** Quita n paradas desde la posición; un viaje que se vacía se elimina, salvo el regreso obligatorio con carga. */
  quitar(i: number, viaje: number, posicion: number, n: number): string[][] {
    const viajes = this.secuencias[i].map(v => [...v]);
    viajes[viaje].splice(posicion, n);
    if (viajes[viaje].length === 0 && !(viaje === 0 && this.unidades[i].cargaActualKg > 0)) viajes.splice(viaje, 1);
    return viajes;
  }
}

/** Inserta en el viaje (viajes.length = uno nuevo al final), sin mutar. */
function poner(viajes: string[][], viaje: number, posicion: number, nuevas: string[]): string[][] {
  if (viaje === viajes.length) return [...viajes.map(v => [...v]), [...nuevas]];
  return viajes.map((v, k) => k === viaje ? [...v.slice(0, posicion), ...nuevas, ...v.slice(posicion)] : [...v]);
}

const iguales = (a: string[][], b: string[][]) => clave(a) === clave(b) && a.length === b.length;

/** Una corrida de búsqueda: gasta presupuesto por ruta recalculada y guarda la mejor mejora estricta. */
class Busqueda {
  evaluaciones = 0;
  agotado = false;
  mejor: { cambios: Cambio[]; valor: Valor } | null = null;
  private readonly base: Valor;

  constructor(private readonly estado: Estado, private readonly presupuesto: number, gastadas: number) {
    this.evaluaciones = gastadas;
    this.base = estado.total();
  }

  /** false si el presupuesto se agotó y hay que dejar de enumerar. */
  probar(cambios: Cambio[]): boolean {
    if (this.agotado) return false;
    if (cambios.length === 1 && iguales(cambios[0].viajes, this.estado.secuencias[cambios[0].i])) return true;
    if (!cambios.every(c => this.estado.estructuraValida(c))) return true;
    if (this.evaluaciones + cambios.length > this.presupuesto) { this.agotado = true; return false; }
    this.evaluaciones += cambios.length;
    let { tm, km } = this.base;
    for (const c of cambios) {
      const v = this.estado.evaluar(c);
      if (!v) return true;
      tm += v.tm - this.estado.valores[c.i].tm;
      km += v.km - this.estado.valores[c.i].km;
    }
    const valor = { tm, km };
    if (mejor(valor, this.mejor?.valor ?? this.base)) this.mejor = { cambios, valor };
    return true;
  }
}

interface Parada { i: number; viaje: number; posicion: number; id: string }
function paradas(estado: Estado): Parada[] {
  return estado.secuencias.flatMap((viajes, i) => viajes.flatMap((v, viaje) => v.map((id, posicion) => ({ i, viaje, posicion, id }))));
}

/** Destinos canónicos (unidad, viaje, posición) para insertar la cadena; viajes de la unidad origen ya sin ella. */
function insertarEnTodos(estado: Estado, b: Busqueda, origen: number, sinCadena: string[][], cadena: string[]): boolean {
  for (let w = 0; w < estado.unidades.length; w++) {
    if (w !== origen && !cadena.every(id => estado.admite(w, id))) continue;
    const base = w === origen ? sinCadena : estado.secuencias[w];
    for (let viaje = 0; viaje <= base.length; viaje++) {
      const largo = viaje === base.length ? 0 : base[viaje].length;
      for (let posicion = 0; posicion <= largo; posicion++) {
        const destino = poner(base, viaje, posicion, cadena);
        const cambios = w === origen ? [{ i: w, viajes: destino }] : [{ i: origen, viajes: sinCadena }, { i: w, viajes: destino }];
        if (!b.probar(cambios)) return false;
      }
    }
  }
  return true;
}

/** Vecindario 1: mover una parada a otra posición, de su viaje, de otro viaje, de otra unidad o a un viaje nuevo. */
function mover(estado: Estado, b: Busqueda): void {
  for (const p of paradas(estado)) {
    if (estado.protegidas.has(p.id)) continue;
    if (!insertarEnTodos(estado, b, p.i, estado.quitar(p.i, p.viaje, p.posicion, 1), [p.id])) return;
  }
}

/** Vecindario 2: intercambiar dos paradas de viajes distintos. */
function intercambiar(estado: Estado, b: Busqueda): void {
  const todas = paradas(estado).filter(p => !estado.protegidas.has(p.id));
  for (let x = 0; x < todas.length; x++) for (let y = x + 1; y < todas.length; y++) {
    const a = todas[x], c = todas[y];
    if (a.i === c.i && a.viaje === c.viaje) continue;
    if (a.i !== c.i && (!estado.admite(c.i, a.id) || !estado.admite(a.i, c.id))) continue;
    let cambios: Cambio[];
    if (a.i === c.i) {
      const viajes = estado.secuencias[a.i].map(v => [...v]);
      viajes[a.viaje][a.posicion] = c.id;
      viajes[c.viaje][c.posicion] = a.id;
      cambios = [{ i: a.i, viajes }];
    } else {
      const va = estado.secuencias[a.i].map(v => [...v]), vc = estado.secuencias[c.i].map(v => [...v]);
      va[a.viaje][a.posicion] = c.id;
      vc[c.viaje][c.posicion] = a.id;
      cambios = [{ i: a.i, viajes: va }, { i: c.i, viajes: vc }];
    }
    if (!b.probar(cambios)) return;
  }
}

/** Vecindario 3: mover una cadena de 2 o 3 paradas consecutivas (sin protegidas), conservando su orden. */
function moverCadena(estado: Estado, b: Busqueda): void {
  for (const n of [2, 3]) for (const [i, viajes] of estado.secuencias.entries()) for (const [viaje, v] of viajes.entries()) {
    for (let posicion = 0; posicion + n <= v.length; posicion++) {
      const cadena = v.slice(posicion, posicion + n);
      if (cadena.some(id => estado.protegidas.has(id))) continue;
      if (!insertarEnTodos(estado, b, i, estado.quitar(i, viaje, posicion, n), cadena)) return;
    }
  }
}

/** Vecindario 4: invertir un tramo dentro de un viaje (sin protegidas). */
function invertir(estado: Estado, b: Busqueda): void {
  for (const [i, viajes] of estado.secuencias.entries()) for (const [viaje, v] of viajes.entries()) {
    for (let desde = 0; desde < v.length; desde++) for (let hasta = desde + 1; hasta < v.length; hasta++) {
      if (v.slice(desde, hasta + 1).some(id => estado.protegidas.has(id))) continue;
      const nuevos = viajes.map(x => [...x]);
      nuevos[viaje] = [...v.slice(0, desde), ...v.slice(desde, hasta + 1).reverse(), ...v.slice(hasta + 1)];
      if (!b.probar([{ i, viajes: nuevos }])) return;
    }
  }
}

const VECINDARIOS = [mover, intercambiar, moverCadena, invertir];

/**
 * Fases 2 y 4 (§4.4): descenso por vecindarios. Del primer vecindario con alguna mejora estricta de (tiempo muerto, km)
 * se aplica la mejor (la primera en el orden canónico si empatan) y se vuelve a empezar. Termina cuando ninguno mejora
 * o se agota el presupuesto; si se agota a mitad de un vecindario, se aplica la mejor mejora encontrada hasta ahí.
 * rutas: una por unidad. No muta sus argumentos.
 */
export function reacomodar(entrada: EntradaPlan, rutas: RutaPlan[], solicitudes: Map<string, SolicitudMotor>,
  restricciones: RestriccionesPlan | undefined, presupuesto: number): { rutas: RutaPlan[]; movimientos: number; evaluaciones: number } {
  const estado = new Estado(entrada, rutas, solicitudes, crearTraslados(entrada), restricciones);
  let evaluaciones = 0, movimientos = 0;
  for (;;) {
    let aplicado = false, agotado = false;
    for (const vecindario of VECINDARIOS) {
      const b = new Busqueda(estado, presupuesto, evaluaciones);
      vecindario(estado, b);
      evaluaciones = b.evaluaciones;
      agotado = b.agotado;
      if (b.mejor) {
        estado.aplicar(b.mejor.cambios);
        movimientos++;
        aplicado = true;
        break;
      }
      if (agotado) break;
    }
    if (agotado || !aplicado) break;
  }
  return { rutas: estado.rutas, movimientos, evaluaciones };
}

/**
 * Fase 3 (§4.5): readmisión de las pospuestas sin cupo de la fase 1, en orden FIFO, sobre el estado vigente.
 * 1. Inserción directa exhaustiva: la de menor Δ de tiempo muerto total dentro de la tolerancia (desempate canónico).
 * 2. Si no hubo, "mover una y meter": mover una parada no protegida a otra posición factible y después insertar, con Δ
 *    conjunto ≤ tolerancia y el presupuesto propio por pospuesta. La inserción se prueba en las unidades que tocó el
 *    movimiento: en las demás el estado no cambió y la directa ya se probó (estructura interna, §5).
 * 3. Si no hubo lugar: "sin_cupo" sin ninguna directa factible, o "alarga_la_jornada" con el Δ mínimo de las directas.
 * evaluaciones cuenta todas las rutas recalculadas de la fase.
 */
export function readmitir(entrada: EntradaPlan, rutas: RutaPlan[], solicitudes: Map<string, SolicitudMotor>,
  restricciones: RestriccionesPlan | undefined, pospuestasFifo: string[], tolerancia: number, presupuesto: number):
  { rutas: RutaPlan[]; decisiones: DecisionReadmision[]; evaluaciones: number } {
  const estado = new Estado(entrada, rutas, solicitudes, crearTraslados(entrada), restricciones);
  const decisiones: DecisionReadmision[] = [];
  let evaluaciones = 0;
  const posicion = (i: number, viaje: number, lugar: number): PosicionPlan =>
    ({ unidadId: estado.unidades[i].id, viaje: viaje + 1, secuencia: lugar + 1 });

  for (const id of pospuestasFifo) {
    const rutasAntes = estado.rutas;
    const diagnostico = diagnosticoVacio();
    let deltaMinimo = Infinity;
    let directa: { cambio: Cambio; delta: number; posicion: PosicionPlan } | null = null;
    for (let i = 0; i < estado.unidades.length; i++) {
      if (!estado.admite(i, id)) continue;
      const base = estado.secuencias[i];
      for (let viaje = 0; viaje <= base.length; viaje++) {
        const largo = viaje === base.length ? 0 : base[viaje].length;
        for (let lugar = 0; lugar <= largo; lugar++) {
          const cambio = { i, viajes: poner(base, viaje, lugar, [id]) };
          evaluaciones++;
          const r = estado.intentar(cambio, id);
          if ("causa" in r) {
            diagnostico[r.causa]++;
            if (r.afectaAOtra) diagnostico.afectaAOtra++;
            continue;
          }
          const delta = r.tm - estado.valores[i].tm;
          deltaMinimo = Math.min(deltaMinimo, delta);
          if (delta <= tolerancia && (!directa || delta < directa.delta)) directa = { cambio, delta, posicion: posicion(i, viaje, lugar) };
        }
      }
    }
    if (directa) {
      estado.aplicar([directa.cambio]);
      decisiones.push({ solicitudId: id, resultado: "admitida", posicion: directa.posicion, deltaMin: directa.delta, movida: null, rutasAntes });
      continue;
    }

    let gastadas = 0;
    let mejor: { cambios: Cambio[]; delta: number; posicion: PosicionPlan; movida: { solicitudId: string; de: PosicionPlan; a: PosicionPlan } } | null = null;
    buscar: for (const p of paradas(estado)) {
      if (estado.protegidas.has(p.id)) continue;
      const sinParada = estado.quitar(p.i, p.viaje, p.posicion, 1);
      for (let w = 0; w < estado.unidades.length; w++) {
        if (w !== p.i && !estado.admite(w, p.id)) continue;
        const base = w === p.i ? sinParada : estado.secuencias[w];
        for (let viaje = 0; viaje <= base.length; viaje++) {
          const largo = viaje === base.length ? 0 : base[viaje].length;
          for (let lugar = 0; lugar <= largo; lugar++) {
            const destino = poner(base, viaje, lugar, [p.id]);
            const movimiento: Cambio[] = w === p.i ? [{ i: w, viajes: destino }] : [{ i: p.i, viajes: sinParada }, { i: w, viajes: destino }];
            if (movimiento.length === 1 && iguales(destino, estado.secuencias[p.i])) continue;
            if (!movimiento.every(c => estado.estructuraValida(c))) continue;
            if (gastadas + movimiento.length > presupuesto) break buscar;
            gastadas += movimiento.length;
            const valores = movimiento.map(c => estado.evaluar(c));
            if (valores.some(v => v === null)) continue;
            const deltaMovimiento = movimiento.reduce((s, c, k) => s + valores[k]!.tm - estado.valores[c.i].tm, 0);
            for (const [k, c] of movimiento.entries()) {
              if (!estado.admite(c.i, id)) continue;
              for (let viaje2 = 0; viaje2 <= c.viajes.length; viaje2++) {
                const largo2 = viaje2 === c.viajes.length ? 0 : c.viajes[viaje2].length;
                for (let lugar2 = 0; lugar2 <= largo2; lugar2++) {
                  const insercion = { i: c.i, viajes: poner(c.viajes, viaje2, lugar2, [id]) };
                  if (!estado.estructuraValida(insercion)) continue;
                  if (gastadas + 1 > presupuesto) break buscar;
                  gastadas++;
                  const v = estado.evaluar(insercion);
                  if (!v) continue;
                  const delta = deltaMovimiento + v.tm - valores[k]!.tm;
                  if (delta <= tolerancia && (!mejor || delta < mejor.delta)) mejor = {
                    cambios: movimiento.map((m, j) => j === k ? insercion : m), delta, posicion: posicion(c.i, viaje2, lugar2),
                    movida: { solicitudId: p.id, de: posicion(p.i, p.viaje, p.posicion), a: posicion(w, viaje, lugar) },
                  };
                }
              }
            }
          }
        }
      }
    }
    evaluaciones += gastadas;
    if (mejor) {
      estado.aplicar(mejor.cambios);
      decisiones.push({ solicitudId: id, resultado: "admitida", posicion: mejor.posicion, deltaMin: mejor.delta, movida: mejor.movida, rutasAntes });
    } else if (Number.isFinite(deltaMinimo)) {
      decisiones.push({ solicitudId: id, resultado: "pospuesta", motivo: "alarga_la_jornada", diagnostico: { ...diagnostico, deltaMinimoMin: deltaMinimo }, rutasAntes });
    } else {
      decisiones.push({ solicitudId: id, resultado: "pospuesta", motivo: "sin_cupo", diagnostico, rutasAntes });
    }
  }
  return { rutas: estado.rutas, decisiones, evaluaciones };
}
