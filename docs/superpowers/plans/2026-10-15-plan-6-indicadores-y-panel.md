# Plan 6 — Indicadores y panel

- **Fecha:** 2026-10-15.
- **Revisión:** 1, borrador para revisión de Codex.
- **Especificación:**
  - §11: K1 a K7 y ciclo;
  - §6: contrato de captura;
  - §1: criterios de éxito;
  - §16: trazabilidad con el Documento Integrador.
- **Base:** Plan 5 terminado. Las funciones puras y sus pruebas pueden empezar antes, con datos sintéticos.
- **Ejecutan:** Codex (`src/indicadores`, el panel y el e2e) y Claude (extracción de datos, instantánea de K5, línea base de K2 y CSV).

## 1. Objetivo y aceptación

1. **Funciones puras.** Cada indicador es una función pura en `src/indicadores`, con prueba de valores calculados a mano. Cada una reporta su valor, el tamaño de muestra y, si aplica, la línea base.
2. **Panel de gerencia.** `/gerencia/panel` muestra, para un rango de fechas:
   - K1 a K7 y el tiempo de ciclo contra la línea base (espera 15, traslado 45 y ciclo 161 minutos; K2 con su línea base cronometrada);
   - la tendencia diaria;
   - el tamaño de muestra.

   El ahorro **simulado** (del plan) va separado del **observado** (odómetros).
3. **Exportación CSV.** Una fila por recolección atendida o no atendida, con las columnas para cartas X̄-R:
   - fecha, folio, unidad y viaje;
   - espera prorrateada, traslado, servicio y regreso más descarga prorrateado;
   - ciclo, dentro de la ventana, km contrafactual y estado.

   Abre en Excel en español: UTF-8 con BOM, separador `,` y punto decimal (se documenta). No contiene datos personales: lleva el nombre comercial del cliente, nunca el contacto ni el teléfono.
4. **Instantánea de K5.** Se guarda una vez al día (fecha, activos y completos) para ver la evolución.
5. **Línea base de K2.** Se captura en la configuración: mediana, tamaño de muestra y fecha de medición.
6. **Verificación.** `scripts/verificar-todo.sh` en verde, con un e2e que genera, valida y opera un día sintético y comprueba los indicadores del panel y el CSV.

## 2. Definiciones operativas (especificación §11, precisadas)

| # | Muestra | Fórmula |
|---|---|---|
| K1 espera | Recolecciones con `llegada_en` | Por viaje físico: `max(0, asignada_en − disponible_para_salir_en)` ÷ recolecciones del viaje |
| K1 traslado | Ídem | `llegada_en` − (`fin_servicio_en` de la parada **anterior en el tiempo** del mismo viaje físico, o `salida_patio_en` si es la primera) |
| K2 | Solicitudes con inicio y fin de captura | Mediana de `captura_fin_en − captura_inicio_en`, contra `linea_base.k2` |
| K3 | Paradas `completada` o `no_atendida` de planes validados o reemplazados | Numerador: completadas con `inicio_servicio_en ≤ ventana_fin`. Denominador: completadas más no atendidas. Las `reasignada` no cuentan, y las no atendidas se reportan aparte |
| K4 | Viajes físicos con odómetro de salida y de regreso | Km reales (`odómetro fin − odómetro inicio`, siguiendo `continua_ruta_id`) contra la suma de `km_contrafactual` de sus paradas `completada`. Litros = km ÷ `rendimiento_km_l_usado`. El ahorro simulado sale de `planes.resultado.resumen` |
| K5 | Cartera activa | Completos ÷ activos, hoy, y la serie diaria de instantáneas |
| K6 | Planes validados | Demora total `validado_en − generado_en` y trabajo activo `validado_en − revision_iniciada_en`, contra la meta de 5 minutos |
| K7 | `ejecuciones_motor` | Mediana y máximo de `duracion_ms`, con las fallidas y agotadas contadas aparte |
| Ciclo | Recolecciones completadas | Espera prorrateada + traslado + servicio (`fin_servicio_en − llegada_en`) + (regreso al patio y descarga del viaje) ÷ recolecciones del viaje |

- **Viaje físico:** una ruta más las que la continúan (`continua_ruta_id`, Plan 5).
- **Horas:** todas en Ciudad de México.
- **Valores faltantes:** un dato faltante excluye la recolección de ese indicador y no la cuenta como cero; el tamaño de muestra lo refleja.

## 3. Contratos

```ts
// src/indicadores/tipos.ts (Codex) — entradas planas que arma la consulta; sin acceso a datos
export interface RecoleccionMedida {
  fecha: string; folio: string; viajeFisicoId: string; estado: "completada" | "no_atendida";
  asignadaEn: Date; disponibleParaSalirEn: Date; salidaPatioEn: Date | null;
  llegadaEn: Date | null; inicioServicioEn: Date | null; finServicioEn: Date | null;
  ventanaFin: string; anteriorFinServicioEn: Date | null; // la anterior en el tiempo; null si es la primera
  recoleccionesDelViaje: number; regresoMasDescargaMin: number | null; kmContrafactual: number;
}
export interface ViajeMedido { viajeFisicoId: string; odometroInicioKm: number | null; odometroFinKm: number | null; rendimientoKmL: number; kmContrafactualAtendidas: number }
export interface Medida { valor: number | null; muestra: number; lineaBase?: number }
export function k1(r: RecoleccionMedida[]): { espera: Medida; traslado: Medida };
export function k2(capturasSeg: number[], lineaBaseSeg: number | null): Medida;
export function k3(r: RecoleccionMedida[]): Medida & { noAtendidas: number };
export function k4(v: ViajeMedido[], simulado: { km: number; kmMetodoActual: number }[]): { kmReales: Medida; kmContrafactual: number; litros: number | null; ahorroObservado: Medida; ahorroSimulado: Medida };
export function k5(serie: { fecha: string; activos: number; completos: number }[]): Medida & { serie: { fecha: string; valor: number | null }[] };
export function k6(planes: { generadoEn: Date; revisionIniciadaEn: Date | null; validadoEn: Date }[]): { demora: Medida; trabajoActivo: Medida; metaMin: 5 };
export function k7(ejecuciones: { duracionMs: number; resultado: "ok" | "error" | "tiempo_agotado" }[]): { mediana: Medida; maximo: number | null; fallidas: number; agotadas: number };
export function ciclo(r: RecoleccionMedida[]): Medida;
export function filasCsv(r: RecoleccionMedida[], clientes: Map<string, string>): string; // con BOM y encabezados en español

// src/consultas/indicadores.nucleo.ts (Claude) — permiso indicadores.ver: gerencia y despachador
export interface VistaPanel { desde: string; hasta: string; k1; k2; k3; k4; k5; k6; k7; ciclo; tendencia: { fecha: string; k1Espera; k1Traslado; k3; ciclo }[] }
panel(ctx, desde: unknown, hasta: unknown): Promise<Resultado<VistaPanel>>   // máximo 92 días
// src/app/api/indicadores/csv/route.ts (Claude) — mismo permiso; descarga text/csv
```

**Esquema (Claude, migración `0007`):**

- `instantaneas_k5`: `fecha` (llave), `activos`, `completos` y `tomada_en`. Solo inserción. La toma la primera consulta del panel o la primera generación de plan del día, con `ON CONFLICT DO NOTHING`.
- `configuracion.linea_base` agrega `k2Seg`, `k2Muestra` y `k2Fecha`, editables por el administrador en la configuración.

## 4. Tareas

| # | Responsable | Tarea |
|---|---|---|
| I0 | Ambos | Contratos compilables de §3 y migración `0007` |
| I1 | Codex | `src/indicadores`, con pruebas de valores calculados a mano. Casos borde: viaje sin recolecciones, datos faltantes, un viaje partido en dos rutas, asignación antes de la disponibilidad (espera 0), llegada temprana y servicio dentro de la ventana |
| I2 | Claude | Extracción a `RecoleccionMedida` y `ViajeMedido` (una consulta por rango, en una instantánea), instantánea de K5, línea base de K2 en la configuración y ruta del CSV con su permiso, con pruebas de integración |
| I3 | Codex | Panel `/gerencia/panel`: tarjetas contra la línea base, tendencia diaria, muestras, rango de fechas y botón de CSV. Accesible, con tablas en vez de solo gráficas |
| I4 | Codex escribe, Claude ejecuta | e2e: un día sintético completo (plan, eventos del operador) y el panel y el CSV con valores esperados |
| I5 | Ambos | Revisión cruzada, `verificar-todo.sh` y actualización de la trazabilidad (§16) y de la hoja de ruta |
