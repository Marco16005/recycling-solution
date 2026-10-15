# Plan 6 — Indicadores y panel

- **Fecha:** 2026-10-15.
- **Revisión:** 2. Incorpora los 6 hallazgos de Codex sobre el borrador; las respuestas están en §5.
- **Especificación:**
  - §11: K1 a K7 y ciclo;
  - §6: contrato de captura;
  - §1: criterios de éxito;
  - §14: decisiones 4 y 7;
  - §16: trazabilidad.
- **Base:** Plan 5 terminado. Las funciones puras pueden empezar antes, con datos sintéticos.
- **Ejecutan:**
  - Codex: `src/indicadores`, el panel y el e2e;
  - Claude: la extracción de datos, la instantánea de K5, la línea base de K2 y el CSV.

## 1. Objetivo y aceptación

1. **Funciones puras.** Cada indicador es una función pura en `src/indicadores`, con su prueba de valores calculados a mano. Reporta el valor, el tamaño de muestra y, si aplica, la línea base.
2. **Panel.** `/gerencia/panel` muestra, para un rango de fechas (máximo 92 días):
   - K1 a K7 y el ciclo contra la línea base (espera 15, traslado 45 y ciclo 161 minutos; K2 con su línea base cronometrada);
   - la tendencia diaria y los tamaños de muestra;
   - el ahorro **simulado** (del plan), separado del **observado** (odómetros).
3. **CSV.** Una fila por recolección `completada` o `no_atendida`, con:
   - fecha, folio, nombre comercial del cliente, placa y número de viaje en la jornada;
   - espera prorrateada, traslado, servicio y regreso más descarga prorrateado;
   - ciclo, dentro de la ventana, km contrafactual y estado.

   Un valor faltante es una celda vacía. El archivo va en UTF-8 con BOM, separado por comas y con punto decimal. No lleva contacto ni teléfono.
4. **K5.** El valor actual se calcula en vivo sobre toda la cartera. La serie histórica sale de instantáneas diarias: los días sin instantánea aparecen como hueco, no como cero.
5. **Línea base de K2** en la configuración: mediana en segundos, tamaño de muestra y fecha de medición.
6. **Verificación.** `scripts/verificar-todo.sh` en verde. El e2e opera un día sintético y comprueba los valores del panel y del CSV.

## 2. Definiciones operativas (especificación §11, precisadas)

- **Viaje físico:** una ruta persistida. El Plan 5 no parte viajes: un re-ruteo conserva completo el viaje en curso.
- **Rutas consideradas:** las de los planes validados **y reemplazados** del rango, porque un plan reemplazado conserva lo que sí se ejecutó.
- **Horas:** en Ciudad de México.
- **Datos faltantes:** excluyen a la recolección de ese indicador, no cuentan como cero, y el tamaño de muestra lo refleja.

| # | Muestra | Fórmula |
|---|---|---|
| K1 espera | Recolecciones `completada` | Por viaje: `max(0, asignada_en − disponible_para_salir_en)` ÷ completadas del viaje |
| K1 traslado | Recolecciones `completada` con `llegada_en` | `llegada_en` − `cierre_en` de la parada anterior en la secuencia del viaje (completada o no atendida). Si es la primera parada cerrada del viaje, se resta `salida_patio_en`. Si la anterior no tiene `cierre_en`, el dato falta |
| K2 | Solicitudes con captura completa | Mediana de `captura_fin_en − captura_inicio_en`, contra `linea_base.k2Seg` |
| K3 | Paradas `completada` | Numerador: `ventana_inicio ≤ inicio_servicio_en ≤ ventana_fin`. Llegar antes y esperar cuenta como cumplido; empezar el servicio antes de que abra la ventana, no. Se reportan aparte, como conteos, las `no_atendida`, las `omitida` y las pendientes al cierre del día. Las `reasignada` no cuentan |
| K4 | Viajes con odómetro de salida y regreso | Km reales (`odometro_fin_km − odometro_inicio_km`) contra la suma de `km_contrafactual` de sus paradas `completada`. Litros = km ÷ `rendimiento_km_l_usado`. El ahorro simulado sale de `planes.resultado.resumen` de los planes **iniciales con `validado_en`**, estén validados o ya reemplazados por un re-ruteo |
| K5 | Cartera activa | Actual: completos ÷ activos, en vivo. Serie: instantáneas diarias |
| K6 | Planes con `validado_en` (validados o reemplazados), iniciales y re-ruteos por separado | Demora total `validado_en − generado_en` y trabajo activo `validado_en − revision_iniciada_en`. La meta de 5 minutos se compara **solo** con el trabajo activo |
| K7 | `ejecuciones_motor` | Mediana y máximo de `duracion_ms` de las `ok`; las `error` y `tiempo_agotado` se cuentan aparte |
| Ciclo | Recolecciones `completada` con traslado conocido | Espera prorrateada + traslado + servicio (`fin_servicio_en − llegada_en`) + (`descarga_fin_en − cierre_en` de la última parada del viaje) ÷ completadas del viaje |

## 3. Contratos

```ts
// src/indicadores/tipos.ts (Codex) — entradas planas que arma la consulta; sin acceso a datos
export type Anterior = { tipo: "primera"; salidaPatioEn: Date | null } | { tipo: "anterior"; cierreEn: Date | null };
export interface RecoleccionMedida {
  fecha: string; folio: string; cliente: string; placa: string; viajeId: string; numeroViajeEnJornada: number;
  estado: "completada" | "no_atendida";
  asignadaEn: Date; disponibleParaSalirEn: Date;
  llegadaEn: Date | null; inicioServicioEn: Date | null; finServicioEn: Date | null;
  ventanaInicio: string; ventanaFin: string;          // "HH:MM"
  anterior: Anterior;
  completadasDelViaje: number;                         // para prorratear espera y regreso más descarga
  regresoMasDescargaMin: number | null;                // del viaje: descarga_fin_en − cierre_en de su última parada
  kmContrafactual: number;
}
export interface ViajeMedido { viajeId: string; odometroInicioKm: number | null; odometroFinKm: number | null; rendimientoKmL: number; kmContrafactualCompletadas: number }
export interface ConteosK3 { noAtendidas: number; omitidas: number; pendientesAlCierre: number }
export interface Medida { valor: number | null; muestra: number; lineaBase?: number }

export function k1(r: RecoleccionMedida[]): { espera: Medida; traslado: Medida };
export function k2(capturasSeg: number[], lineaBaseSeg: number | null): Medida;
export function k3(r: RecoleccionMedida[], conteos: ConteosK3): Medida & ConteosK3;
export function k4(v: ViajeMedido[], simulado: { km: number; kmMetodoActual: number }[]): {
  kmReales: Medida; kmContrafactual: number; litros: number | null; ahorroObservado: Medida; ahorroSimulado: Medida;
};
export function k5(actual: { activos: number; completos: number }, serie: { fecha: string; activos: number; completos: number }[]):
  Medida & { serie: { fecha: string; valor: number }[] };
export function k6(planes: { tipo: "inicial" | "re_ruteo"; generadoEn: Date; revisionIniciadaEn: Date | null; validadoEn: Date }[]):
  Record<"inicial" | "re_ruteo", { demora: Medida; trabajoActivo: Medida }> & { metaMin: 5 };
export function k7(e: { duracionMs: number; resultado: "ok" | "error" | "tiempo_agotado" }[]): { mediana: Medida; maximo: number | null; errores: number; agotadas: number };
export function ciclo(r: RecoleccionMedida[]): Medida;
export function csv(r: RecoleccionMedida[]): string;   // con BOM, encabezados en español y celdas vacías para faltantes

// src/consultas/indicadores.nucleo.ts (Claude) — permiso indicadores.ver (gerencia y despachador)
panel(ctx, desde: unknown, hasta: unknown): Promise<Resultado<VistaPanel>>
// src/app/api/indicadores/csv/route.ts (Claude) — mismo permiso; text/csv
```

**Esquema (Claude, migración `0007`):**

- `instantaneas_k5`: `fecha` (llave), `activos`, `completos` y `tomada_en`; solo inserción. La toma el script `npm run instantanea-k5`, que el cron de §9 de `docs/operacion.md` corre junto al respaldo de las 17:00. Si falta la del día, también la toma la primera consulta del panel.
- `configuracion.linea_base` agrega `k2Seg`, `k2Muestra` y `k2Fecha`, editables por el administrador.

## 4. Tareas

| # | Responsable | Tarea |
|---|---|---|
| I0 | Ambos | Contratos compilables de §3 y migración `0007` |
| I1 | Codex | `src/indicadores`, con valores calculados a mano. Casos borde: viaje sin completadas, datos faltantes, anterior no atendida, re-ruteo con viaje congelado, asignación antes de la disponibilidad (espera 0), llegar antes y esperar dentro de la ventana, y servicio iniciado antes de que abra |
| I2 | Claude | Extracción a `RecoleccionMedida` y `ViajeMedido` (una consulta por rango, en una instantánea), conteos de K3, instantánea de K5 y su script, línea base de K2 y CSV con su permiso, con pruebas de integración |
| I3 | Codex | Panel con tarjetas contra la línea base, tendencia, muestras, rango y botón de CSV. Tablas accesibles, no solo gráficas |
| I4 | Codex escribe, Claude ejecuta | e2e del día sintético, con los valores esperados en el panel y el CSV |
| I5 | Ambos | Revisión cruzada, `verificar-todo.sh` y trazabilidad (§16) |

## 5. Respuesta a la revisión de Codex (2026-10-15)

| # | Hallazgo | Decisión |
|---|---|---|
| 1 | Viaje físico con `continua_ruta_id` | Un viaje físico es una ruta persistida; se consideran los planes validados y reemplazados (§2) |
| 2 | K3 sin el inicio de la ventana; denominador | `ventana_inicio ≤ inicio ≤ ventana_fin`. Denominador: completadas. No atendidas, omitidas y pendientes al cierre, aparte (§2) |
| 3 | Parada anterior sin fin | `Anterior` distingue la primera parada de una anterior con o sin `cierre_en`. `cierre_en` lo agrega el Plan 5. Prorrateo sobre completadas (§3) |
| 4 | Columnas del CSV | La entrada trae cliente, placa y número de viaje; las celdas faltantes van vacías (§1.3, §3) |
| 5 | K5 actual contra instantánea vieja | Valor actual en vivo; serie histórica con huecos; script diario (§2, §3) |
| 6 | K6 sin los reemplazados | Se incluyen los planes con `validado_en`, iniciales y re-ruteos por separado; la meta solo contra el trabajo activo (§2) |
