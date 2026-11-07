/**
 * Plan de seguridad (hallazgos 2 y 5): límite de frecuencia por usuario para las acciones costosas. La aplicación corre en
 * un solo proceso (un contenedor web), así que basta un registro en memoria; si algún día corre en varios procesos, hay
 * que llevarlo a Postgres. Se reinicia con el contenedor: protege contra repeticiones, no es una cuota diaria.
 *
 * Las pruebas lo apagan con LIMITAR_ACCIONES=no (como AUTH_LIMITAR_INTENTOS), porque generan muchos planes seguidos con
 * el mismo usuario; limites.test.ts y plan-seguridad.integracion.test.ts lo prueban encendido.
 */
export interface Limite {
  maximo: number;
  ventanaMs: number;
}

/**
 * Por usuario. Un plan con el tope de entrada del motor tarda unos 6 s (plan-comun.ts) y bloquea el proceso mientras
 * calcula: 4 por minuto acotan lo que una cuenta puede ocupar. Un día normal genera uno o dos.
 */
export const LIMITES = {
  motor: { maximo: 4, ventanaMs: 60_000 },
  importar: { maximo: 20, ventanaMs: 60_000 },
  enlace: { maximo: 30, ventanaMs: 60_000 },
  /** Cambio de contraseña propio: con una sesión robada no se adivina la actual a ritmo libre, y scrypt cuesta CPU. */
  clave: { maximo: 5, ventanaMs: 60_000 },
} as const satisfies Record<string, Limite>;

export type AccionLimitada = keyof typeof LIMITES;

export const MENSAJE_LIMITE = "Hiciste esto demasiadas veces seguidas. Espera un minuto y vuelve a intentarlo.";

const MAXIMO_CLAVES = 10_000;

export class LimitadorDeFrecuencia {
  private readonly marcas = new Map<string, number[]>();

  /** true si se permite (y lo anota); false si ya se alcanzó el máximo dentro de la ventana. */
  intentar(clave: string, limite: Limite, ahoraMs: number): boolean {
    const vigentes = (this.marcas.get(clave) ?? []).filter((t) => t > ahoraMs - limite.ventanaMs);
    if (vigentes.length >= limite.maximo) {
      this.marcas.set(clave, vigentes);
      return false;
    }
    if (!this.marcas.has(clave) && this.marcas.size >= MAXIMO_CLAVES) this.marcas.delete(this.marcas.keys().next().value!);
    vigentes.push(ahoraMs);
    this.marcas.set(clave, vigentes);
    return true;
  }
}

const limitador = new LimitadorDeFrecuencia();

/** true si el usuario puede hacer la acción ahora; siempre true con LIMITAR_ACCIONES=no. */
export function dentroDelLimite(accion: AccionLimitada, usuarioId: string, ahora: Date): boolean {
  if (process.env.LIMITAR_ACCIONES === "no") return true;
  return limitador.intentar(`${accion}:${usuarioId}`, LIMITES[accion], ahora.getTime());
}
