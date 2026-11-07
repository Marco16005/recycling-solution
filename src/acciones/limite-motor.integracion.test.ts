// Corre con las de integración (un archivo a la vez): mide el motor con el tope de entrada y no debe competir por CPU.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BD } from "@/datos/bd";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente } from "@/datos/pruebas/escenario-plan";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import { generarPlan } from "@/motor";
import { crearAleatorio } from "@/motor/zonas";
import type { EntradaPlan, SolicitudMotor } from "@/motor/tipos";
import { LIMITES, MENSAJE_LIMITE } from "@/seguridad/limites";
import { excesoDeEntrada, LIMITE_MOTOR_MS, MAXIMO_SOLICITUDES_MOTOR, MAXIMO_UNIDADES_MOTOR } from "./plan-comun";
import { generarPlanDelDia } from "./plan.nucleo";

// Plan de seguridad, hallazgos 2 y 5.

/** Entrada sintética del tamaño pedido, con clientes alrededor del patio como en scripts/simular.mts. */
function entradaDe(solicitudes: number, unidades: number): EntradaPlan {
  const azar = crearAleatorio(7);
  const entero = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1));
  const patio = { lat: 20.62, lng: -100.27 };
  const clientes = Array.from({ length: 110 }, (_, i) => {
    const r = 15 * Math.sqrt(azar()), t = 2 * Math.PI * azar(), inicio = entero(480, 600);
    return { clienteId: `c${i}`, ubicacion: { lat: patio.lat + r * Math.sin(t) / 111.2, lng: patio.lng + r * Math.cos(t) / 104 },
      ventanas: [{ inicioMin: inicio, finMin: inicio + entero(120, 360) }], tiempoServicioMin: 30 };
  });
  const lista: SolicitudMotor[] = Array.from({ length: solicitudes }, (_, k) => ({ ...clientes[entero(0, 109)], id: `s${k}`, folio: `s${k}`,
    registradaEn: `2026-11-05T07:${String(k % 60).padStart(2, "0")}:00-06:00`, cargaKg: entero(300, 3000), tiposUnidadAdmitidos: ["doble_rodada"] }));
  return {
    fecha: "2026-11-05", instanteMin: 480, solicitudes: lista,
    unidades: Array.from({ length: unidades }, (_, i) => ({ id: `u${i}`, tipo: "doble_rodada" as const, capacidadKg: 8000, ubicacionInicial: patio, libreDesdeMin: 480, cargaActualKg: 0 })),
    parametros: { patio, turnoInicioMin: 480, turnoFinMin: 960, velocidadKmh: 30, factorCircuidad: 1.3, descargaMin: 15, semilla: 1,
      toleranciaReadmisionMin: 15, capacidadMaximaPorTipoKg: { doble_rodada: 8000, rabon: 0, camioneta: 0, torton: 0, trailer: 0 } },
  };
}

describe("tope de entrada del motor", () => {
  it("acepta hasta el tope y rechaza con mensaje al pasarlo", () => {
    const vacias = (n: number) => Array.from({ length: n }, () => ({}) as never);
    expect(excesoDeEntrada({ solicitudes: vacias(MAXIMO_SOLICITUDES_MOTOR), unidades: vacias(MAXIMO_UNIDADES_MOTOR) })).toBeNull();
    expect(excesoDeEntrada({ solicitudes: vacias(MAXIMO_SOLICITUDES_MOTOR + 1), unidades: vacias(1) })).toContain(`hasta ${MAXIMO_SOLICITUDES_MOTOR}`);
    expect(excesoDeEntrada({ solicitudes: vacias(1), unidades: vacias(MAXIMO_UNIDADES_MOTOR + 1) })).toContain(`${MAXIMO_UNIDADES_MOTOR} unidades`);
  });

  it("con el tope, el motor termina muy por debajo del límite de tiempo", () => {
    const inicio = performance.now();
    generarPlan(entradaDe(MAXIMO_SOLICITUDES_MOTOR, MAXIMO_UNIDADES_MOTOR));
    // Medido: ~6 s. Si el motor se vuelve más lento, hay que bajar el tope.
    expect(performance.now() - inicio).toBeLessThan(LIMITE_MOTOR_MS * 2 / 3);
  }, 60_000);
});

describe("límite de frecuencia al generar el plan", () => {
  let bd: BD;
  const anterior = process.env.LIMITAR_ACCIONES;
  beforeEach(async () => {
    process.env.LIMITAR_ACCIONES = "si";
    bd = await crearBdPrueba();
    await ponerPatio(bd);
    await jornadaDisponible(bd, FECHA_PLAN, "LIMITE1");
  });
  afterEach(() => {
    if (anterior === undefined) delete process.env.LIMITAR_ACCIONES;
    else process.env.LIMITAR_ACCIONES = anterior;
  });

  it("después del máximo por minuto, rechaza sin correr el motor", async () => {
    const despachador = await usuarioDePrueba(bd, "despachador");
    const c = await clienteHabilitado(bd, "Cartonera Límite", 0.01);
    await solicitudPendiente(bd, c.id, despachador.id, FECHA_PLAN);
    const ctx = { bd, usuario: despachador, ahora: AHORA_PLAN };
    for (let i = 0; i < LIMITES.motor.maximo; i++) {
      expect((await generarPlanDelDia(ctx, FECHA_PLAN)).ok, `intento ${i + 1}`).toBe(true);
    }
    expect(await generarPlanDelDia(ctx, FECHA_PLAN)).toEqual({ ok: false, error: "invalido", campos: { _: [MENSAJE_LIMITE] } });
  });
});
