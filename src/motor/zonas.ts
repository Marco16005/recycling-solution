import type { Coordenada } from "./tipos";

/** Mulberry32: estado local de 32 bits, incluso para semilla cero. */
export function crearAleatorio(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let valor = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    valor ^= valor + Math.imul(valor ^ (valor >>> 7), 61 | valor);
    return ((valor ^ (valor >>> 14)) >>> 0) / 4294967296;
  };
}

/** Devuelve una zona por punto; el orden recibido determina los desempates. */
export function agruparZonas(coordenadas: Coordenada[], cantidad: number, patio: Coordenada, semilla: number): number[] {
  const k = Math.min(cantidad, coordenadas.length);
  if (k <= 0) return [];
  const rad = Math.PI / 180;
  const puntos = coordenadas.map(p => ({
    x: (p.lng - patio.lng) * rad * 6371.0088 * Math.cos(patio.lat * rad),
    y: (p.lat - patio.lat) * rad * 6371.0088,
  }));
  const cuadrado = (a: typeof puntos[number], b: typeof puntos[number]) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const azar = crearAleatorio(semilla);
  const elegidos = new Set<number>([Math.floor(azar() * puntos.length)]);
  const centros = [puntos[[...elegidos][0]]];
  while (centros.length < k) {
    const pesos = puntos.map(p => Math.min(...centros.map(c => cuadrado(p, c))));
    let umbral = azar() * pesos.reduce((a, b) => a + b, 0);
    let indice = puntos.findIndex((_, i) => !elegidos.has(i));
    for (let i = 0; i < puntos.length; i++) {
      umbral -= pesos[i];
      if (pesos[i] > 0 && umbral < 0) { indice = i; break; }
    }
    elegidos.add(indice);
    centros.push(puntos[indice]);
  }
  let zonas = puntos.map(() => -1);
  for (let vuelta = 0; vuelta < 100; vuelta++) {
    const nuevas = puntos.map(p => {
      let mejor = 0;
      for (let c = 1; c < k; c++) if (cuadrado(p, centros[c]) < cuadrado(p, centros[mejor])) mejor = c;
      return mejor;
    });
    const conteos = centros.map((_, c) => nuevas.filter(z => z === c).length);
    for (let c = 0; c < k; c++) {
      if (conteos[c]) continue;
      // Se mueve un punto de un grupo con más de uno: no crea otra zona vacía.
      let lejano = -1;
      let distancia = -1;
      for (let i = 0; i < puntos.length; i++) {
        const d = cuadrado(puntos[i], centros[nuevas[i]]);
        if (conteos[nuevas[i]] > 1 && d > distancia) { lejano = i; distancia = d; }
      }
      conteos[nuevas[lejano]]--;
      nuevas[lejano] = c;
      conteos[c]++;
    }
    for (let c = 0; c < k; c++) {
      const grupo = puntos.filter((_, i) => nuevas[i] === c);
      centros[c] = { x: grupo.reduce((s, p) => s + p.x, 0) / grupo.length, y: grupo.reduce((s, p) => s + p.y, 0) / grupo.length };
    }
    if (nuevas.every((z, i) => z === zonas[i])) return nuevas;
    zonas = nuevas;
  }
  return zonas;
}
