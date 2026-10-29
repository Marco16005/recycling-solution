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
/** Plan 8: si la entrada no la trae (entradas de pruebas y anteriores a la 0010), la de la configuración por omisión. */
export const TOLERANCIA_POR_OMISION_MIN = 15;

/** La tolerancia de la entrada, validada: entero de 0 a 60. */
export function toleranciaDe(entrada: EntradaPlan): number {
  const t = entrada.parametros.toleranciaReadmisionMin ?? TOLERANCIA_POR_OMISION_MIN;
  if (!Number.isInteger(t) || t < 0 || t > 60) throw new Error("Tolerancia de readmisión inválida");
  return t;
}

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

/** tm: tiempo muerto; km; fin: fin de descarga del último viaje (sin viajes, el inicio efectivo). */
interface Valor { tm: number; km: number; fin: number }
const mejor = (a: Valor, b: Valor) => a.tm < b.tm || (a.tm === b.tm && a.km < b.km - EPSILON_KM);
const ids = (r: RutaPlan) => r.viajes.map(v => v.paradas.map(p => p.solicitudId));
const clave = (viajes: string[][]) => viajes.map(v => v.join(",")).join("/");

/** Una ruta cambiada: índice de la unidad (orden por id) y sus viajes nuevos. */
interface Cambio { i: number; viajes: string[][] }
/** Un cambio con su ruta ya calculada: aplicarlo no vuelve a calcular. */
interface CambioCalculado extends Cambio { ruta: RutaPlan }

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

  /** Solo tm y km cuentan para el objetivo. */
  total(): Valor {
    return this.valores.reduce((a, v) => ({ tm: a.tm + v.tm, km: a.km + v.km, fin: 0 }), { tm: 0, km: 0, fin: 0 });
  }

  /**
   * Decisión del usuario (2026-10-29): en un reacomodo ninguna unidad termina más de la tolerancia después que al
   * empezar la fase. null en la readmisión, que se rige por el Δ de tiempo muerto.
   */
  limites: number[] | null = null;
  fijarLimites(tolerancia: number): void {
    this.limites = this.valores.map(v => v.fin + tolerancia);
  }

  private valorDe(i: number, r: RutaPlan): Valor {
    return { tm: tiempoMuertoDeRuta(this.entrada, this.unidades[i], r, this.solicitudes), km: r.viajes.reduce((s, v) => s + v.km, 0),
      fin: r.viajes.at(-1)?.finDescargaMin ?? inicioEfectivo(this.entrada, this.unidades[i]) };
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

  /** El valor ya calculado en esta corrida (null si no era factible), o undefined si nunca se calculó. */
  enCache({ i, viajes }: Cambio): Valor | null | undefined {
    return this.cache.get(`${i}|${clave(viajes)}`);
  }

  /**
   * Recalcula la ruta (una evaluación: quien llama la cuenta). nueva: la que se inserta, para el diagnóstico.
   * Devuelve la ruta con su valor, o la causa si no es factible por capacidad, ventana o fin de turno.
   */
  calcularCambio(c: Cambio, nueva?: string): { valor: Valor; ruta: RutaPlan } | Extract<Calculo, { causa: unknown }> {
    const r = calcular(this.entrada, this.unidades[c.i], c.viajes, this.solicitudes, this.t, nueva);
    const resultado = "ruta" in r ? { valor: this.valorDe(c.i, r.ruta), ruta: r.ruta } : r;
    this.cache.set(`${c.i}|${clave(c.viajes)}`, "ruta" in r ? (resultado as { valor: Valor }).valor : null);
    return resultado;
  }

  /** Aplica rutas ya calculadas, sin volver a calcular. */
  aplicar(cambios: CambioCalculado[]): void {
    for (const { i, viajes, ruta } of cambios) {
      this.secuencias = this.secuencias.map((s, j) => j === i ? viajes : s);
      this.rutas = this.rutas.map((r, j) => j === i ? ruta : r);
      this.valores = this.valores.map((v, j) => j === i ? this.valorDe(i, ruta) : v);
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

/**
 * Presupuesto de una fase: evaluaciones = rutas recalculadas de verdad (§4.4). Un valor que ya está en la caché de la
 * corrida no cuesta; nunca se rebasa el presupuesto.
 */
class Presupuesto {
  agotado = false;
  constructor(readonly limite: number, public evaluaciones = 0) {}
  /** Cuenta una evaluación si cabe; si no, marca agotado. */
  gastar(): boolean {
    if (this.evaluaciones + 1 > this.limite) { this.agotado = true; return false; }
    this.evaluaciones++;
    return true;
  }
  /** Valor del cambio desde la caché o recalculando (con su ruta); "agotado" si ya no cabe una evaluación más. */
  valor(estado: Estado, c: Cambio): { valor: Valor; ruta?: RutaPlan } | null | "agotado" {
    const guardado = estado.enCache(c);
    if (guardado !== undefined) return guardado && { valor: guardado };
    if (!this.gastar()) return "agotado";
    const r = estado.calcularCambio(c);
    return "ruta" in r ? r : null;
  }
  /** Rutas para aplicar los cambios: las que vinieron de la caché se recalculan (cuentan). null si ya no caben. */
  rutas(estado: Estado, cambios: Cambio[], calculadas: (RutaPlan | undefined)[]): CambioCalculado[] | null {
    const listos: CambioCalculado[] = [];
    for (const [k, c] of cambios.entries()) {
      let ruta = calculadas[k];
      if (!ruta) {
        if (!this.gastar()) return null;
        const r = estado.calcularCambio(c);
        if (!("ruta" in r)) throw new Error("Reacomodo: un valor guardado dejó de ser factible");
        ruta = r.ruta;
      }
      listos.push({ ...c, ruta });
    }
    return listos;
  }
}

/** Un vecindario: guarda la mejor mejora estricta, con sus rutas listas para aplicar. */
class Busqueda {
  mejor: { cambios: CambioCalculado[]; valor: Valor } | null = null;
  private readonly base: Valor;

  constructor(private readonly estado: Estado, readonly presupuesto: Presupuesto) {
    this.base = estado.total();
  }

  get agotado(): boolean { return this.presupuesto.agotado; }

  /** false si el presupuesto se agotó y hay que dejar de enumerar. */
  probar(cambios: Cambio[]): boolean {
    if (this.agotado) return false;
    if (cambios.length === 1 && iguales(cambios[0].viajes, this.estado.secuencias[cambios[0].i])) return true;
    if (!cambios.every(c => this.estado.estructuraValida(c))) return true;
    let { tm, km } = this.base;
    const calculadas: (RutaPlan | undefined)[] = [];
    // El fin de cada ruta tocada no puede pasar su límite de la fase (estado.limites).
    for (const c of cambios) {
      const v = this.presupuesto.valor(this.estado, c);
      if (v === "agotado") return false;
      if (!v) return true;
      if (this.estado.limites && v.valor.fin > this.estado.limites[c.i]) return true;
      calculadas.push(v.ruta);
      tm += v.valor.tm - this.estado.valores[c.i].tm;
      km += v.valor.km - this.estado.valores[c.i].km;
    }
    const valor = { tm, km, fin: 0 };
    if (!mejor(valor, this.mejor?.valor ?? this.base)) return true;
    const listos = this.presupuesto.rutas(this.estado, cambios, calculadas);
    if (!listos) return false;
    this.mejor = { cambios: listos, valor };
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

/**
 * Vecindario 3: mover una cadena de 2 o 3 paradas consecutivas (sin protegidas), conservando su orden.
 * Orden canónico: unidad, viaje y posición de inicio; después el largo (2 antes que 3); después el destino.
 */
function moverCadena(estado: Estado, b: Busqueda): void {
  for (const [i, viajes] of estado.secuencias.entries()) for (const [viaje, v] of viajes.entries()) {
    for (let posicion = 0; posicion < v.length; posicion++) for (const n of [2, 3]) {
      if (posicion + n > v.length) continue;
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
 * Ninguna unidad termina más de la tolerancia de la entrada después que en las rutas recibidas (decisión del usuario).
 * rutas: una por unidad. No muta sus argumentos.
 */
export function reacomodar(entrada: EntradaPlan, rutas: RutaPlan[], solicitudes: Map<string, SolicitudMotor>,
  restricciones: RestriccionesPlan | undefined, presupuesto: number): { rutas: RutaPlan[]; movimientos: number; evaluaciones: number } {
  const estado = new Estado(entrada, rutas, solicitudes, crearTraslados(entrada), restricciones);
  estado.fijarLimites(toleranciaDe(entrada));
  const gasto = new Presupuesto(presupuesto);
  let movimientos = 0;
  for (;;) {
    let aplicado = false;
    for (const vecindario of VECINDARIOS) {
      const b = new Busqueda(estado, gasto);
      vecindario(estado, b);
      if (b.mejor) {
        estado.aplicar(b.mejor.cambios);
        movimientos++;
        aplicado = true;
        break;
      }
      if (gasto.agotado) break;
    }
    if (gasto.agotado || !aplicado) break;
  }
  return { rutas: estado.rutas, movimientos, evaluaciones: gasto.evaluaciones };
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
    // 1. Inserción directa: exhaustiva y fuera del presupuesto (como la admisión); cada ruta calculada cuenta.
    let directa: { cambio: CambioCalculado; delta: number; posicion: PosicionPlan } | null = null;
    for (let i = 0; i < estado.unidades.length; i++) {
      if (!estado.admite(i, id)) continue;
      const base = estado.secuencias[i];
      for (let viaje = 0; viaje <= base.length; viaje++) {
        const largo = viaje === base.length ? 0 : base[viaje].length;
        for (let lugar = 0; lugar <= largo; lugar++) {
          const cambio = { i, viajes: poner(base, viaje, lugar, [id]) };
          evaluaciones++;
          const r = estado.calcularCambio(cambio, id);
          if (!("ruta" in r)) {
            diagnostico[r.causa]++;
            if (r.afectaAOtra) diagnostico.afectaAOtra++;
            continue;
          }
          const delta = r.valor.tm - estado.valores[i].tm;
          deltaMinimo = Math.min(deltaMinimo, delta);
          if (delta <= tolerancia && (!directa || delta < directa.delta))
            directa = { cambio: { ...cambio, ruta: r.ruta }, delta, posicion: posicion(i, viaje, lugar) };
        }
      }
    }
    if (directa) {
      estado.aplicar([directa.cambio]);
      decisiones.push({ solicitudId: id, resultado: "admitida", posicion: directa.posicion, deltaMin: directa.delta, movida: null, rutasAntes });
      continue;
    }

    // 2. "Mover una y meter", con su propio presupuesto por pospuesta.
    const gasto = new Presupuesto(presupuesto);
    let mejor: { cambios: CambioCalculado[]; delta: number; posicion: PosicionPlan;
      movida: { solicitudId: string; de: PosicionPlan; a: PosicionPlan } } | null = null;
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
            const valores: { valor: Valor; ruta?: RutaPlan }[] = [];
            for (const c of movimiento) {
              const v = gasto.valor(estado, c);
              if (v === "agotado") break buscar;
              if (!v) break;
              valores.push(v);
            }
            if (valores.length < movimiento.length) continue;
            const deltaMovimiento = movimiento.reduce((s, c, k) => s + valores[k].valor.tm - estado.valores[c.i].tm, 0);
            for (const [k, c] of movimiento.entries()) {
              if (!estado.admite(c.i, id)) continue;
              for (let viaje2 = 0; viaje2 <= c.viajes.length; viaje2++) {
                const largo2 = viaje2 === c.viajes.length ? 0 : c.viajes[viaje2].length;
                for (let lugar2 = 0; lugar2 <= largo2; lugar2++) {
                  const insercion = { i: c.i, viajes: poner(c.viajes, viaje2, lugar2, [id]) };
                  if (!estado.estructuraValida(insercion)) continue;
                  const v = gasto.valor(estado, insercion);
                  if (v === "agotado") break buscar;
                  if (!v) continue;
                  const delta = deltaMovimiento + v.valor.tm - valores[k].valor.tm;
                  if (delta > tolerancia || (mejor && delta >= mejor.delta)) continue;
                  const cambios = movimiento.map((m, j) => j === k ? insercion : m);
                  const listos = gasto.rutas(estado, cambios, cambios.map((_, j) => j === k ? v.ruta : valores[j].ruta));
                  if (!listos) break buscar;
                  mejor = { cambios: listos, delta, posicion: posicion(c.i, viaje2, lugar2),
                    movida: { solicitudId: p.id, de: posicion(p.i, p.viaje, p.posicion), a: posicion(w, viaje, lugar) } };
                }
              }
            }
          }
        }
      }
    }
    evaluaciones += gasto.evaluaciones;
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
