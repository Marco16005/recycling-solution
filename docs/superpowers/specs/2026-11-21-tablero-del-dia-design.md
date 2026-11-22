# Tablero del día: avance por camión y viaje, y marcas del despacho — diseño

- **Fecha:** 2026-11-21.
- **Base:** `main` en 60d790b.
- **Pedido del usuario:** quien opera dijo, después de la lista "Antes de generar": "que se vean los viajes y las unidades y después si ya se completaron". Y: "en mi jornada tengo asignados a todos, pero de acuerdo al plan del día ¿cómo puedo decir esta camioneta ya llegó, y le falta tal recolección? ¿Qué viaje ya se finalizó, cuál está en espera y cuál en recolección?"
- **Decisiones del usuario (2026-11-21):**
  1. El avance lo marcan **los dos**: el operador desde su teléfono y, si no puede, el despacho por él. Cada marca guarda quién la hizo.
  2. Cuando marca el despacho, el **odómetro es opcional**. Si falta, ese viaje no cuenta para el indicador de kilómetros (K4), como ya ocurre con un dato faltante.
  3. La **hora** es la actual, y el despacho puede corregirla a una anterior del mismo día, nunca futura.

## 1. Qué pasa hoy

- Después de validar, `/despacho/plan` muestra "Seguimiento" con una tarjeta por jornada: contadores ("2 completadas · 3 pendientes"), el último evento y una lista plana de paradas con horas proyectadas. **No agrupa por viaje** ni dice en palabras en qué va cada camión o cada recolección.
- El avance solo lo marca el operador en `/operador` (permiso `ruta.operar`). El despacho solo lo ve (`operacion.ver`). Si el operador no usa el teléfono, nadie puede marcar nada.

## 2. Qué se agrega

### 2.1 Tablero por camión

En "Seguimiento", cada camión (jornada) muestra:

- **Encabezado:** placa y operador, y una frase con lo que hace ahora:
  - "Sin llegar al patio";
  - "En el patio, sin salir";
  - "Viaje 2: en camino a Cartonera X";
  - "Viaje 2: en Cartonera X, esperando";
  - "Viaje 2: recolectando en Cartonera X";
  - "Viaje 2: regresando al patio";
  - "Viaje 2: descargando en el patio";
  - "En el patio, entre viajes";
  - "Jornada terminada".
- **Avance:** "3 de 7 recolecciones".
- **Viajes, en orden.** Cada uno con su estado:
  - **En espera:** no ha salido.
  - **En camino:** salió y no ha regresado.
  - **Descargando:** regresó al patio y no ha terminado de descargar.
  - **Terminado:** terminó de descargar.

  También lleva la hora de salida y la de regreso.
- **Recolecciones de cada viaje, en orden.** Cada una con folio, cliente, horario del cliente y estado en palabras:
  - **Pendiente:** con la llegada proyectada.
  - **En camino:** es la siguiente del viaje en curso.
  - **En el cliente:** llegó y no ha empezado.
  - **Recolectando.**
  - **Recolectada:** con su hora.
  - **No se pudo atender:** con su motivo.
  - **Reasignada** u **omitida.**

- **Hora proyectada y del plan.** Una parada pendiente o en camino muestra las dos llegadas, la proyectada y la estimada por el plan, para ver el retraso, como el seguimiento del Plan 7.
- **Horas al minuto hacia abajo:** una marca a las 08:00:30 se ve 08:00.
- **Viajes que se quedan sin paradas.** Si un re-ruteo pasa a otro camión todas las paradas de un viaje que todavía no sale, ese viaje deja de aparecer, como en el teléfono del operador, y sus paradas aparecen en el camión que las recibió. Dentro de un viaje que sigue, las reasignadas y las omitidas se muestran con su estado (revisión de Codex del 60e4cdf).
- **Pospuestas por re-ruteo.** Las paradas que un re-ruteo pospuso en un viaje que salió de la secuencia aparecen en el camión como "Pospuestas por re-ruteo: ya no se harán hoy" (revisión del 2b721d1). Cada solicitud aparece una sola vez en todo el día, en el camión donde se pospuso por última vez, y nunca si volvió a quedar activa hoy en algún camión (revisiones del cabd8e8 y del ceab474).
- **Botones que parten la línea:** con nombres largos de cliente, un botón sin saltos desbordaba la pantalla del teléfono.

Las alertas, los incidentes, los eventos por conciliar y el re-ruteo siguen igual.

### 2.2 Marcar el avance desde el despacho

- **El botón.** Cada camión trae un botón con **el siguiente paso**, el mismo que vería el operador (`siguienteAccion` del dominio): "Marcar: llegó a Cartonera X". Abre un formulario corto:
  - la **hora**: la actual, editable, nunca futura ni antes de la última marca de ese camión;
  - el **odómetro**: opcional, solo al salir y al regresar al patio.
- **No se pudo atender.** Si el paso es en un cliente, hay un segundo botón, "No se pudo atender", que pide el motivo.
- **Reglas.** Se aplican **las mismas reglas** que a los eventos del teléfono: la misma máquina de transiciones, la idempotencia por `evento_id` y los candados.
- **Si se rechaza,** el despacho ve el motivo y no se guarda nada. A diferencia del teléfono, el despacho está en línea y no hay nada que conciliar después.
- **Rastro.** El evento guarda `usuario_id`, el del despachador. La bitácora lo registra como `evento_<tipo>_por_despacho`.
- **Si el teléfono llega tarde.** Cuando el despacho marca y después el teléfono envía el mismo paso desde su cola, el servidor lo rechaza y lo guarda para conciliar. Ya funciona así: es la decisión 9 de la especificación.

### 2.3 Cómo funciona el día, en la pantalla

- **En "Antes de generar":** un bloque plegable, "¿Cómo funciona el plan del día?", con cuatro pasos:
  1. arma la jornada y registra las solicitudes;
  2. genera, revisa y valida;
  3. cada operador marca su avance en el teléfono, o tú lo marcas aquí;
  4. en "Seguimiento" ves cada camión.
- **Bajo el título "Seguimiento":** una línea que dice quién marca y cada cuánto se actualiza.

## 3. Contratos

**Permiso nuevo** (`src/seguridad/permisos.ts`): `"operacion.registrar": ["despachador"]`. El administrador puede todo, como siempre; gerencia no.

**Acción** (`src/acciones/operacion.ts`, Claude):

```ts
/** evento: EventoEntrada. Permiso operacion.registrar. Idempotente por eventoId. Rechazo: invalido con el motivo, sin guardar. */
export async function registrarEventoPorDespachoAccion(evento: unknown): Promise<Resultado<RespuestaEvento>>
```

- La jornada puede ser cualquiera, no solo la propia.
- `ocurridoEn` debe estar en la fecha de la jornada (Ciudad de México), no después de la hora actual (con 2 minutos de tolerancia) y no antes del último evento aplicado de la jornada.
- `odometroKm` puede ser null al salir y al regresar al patio.

**Consulta** (`src/consultas/operacion.nucleo.ts`, Claude). `SeguimientoJornada` agrega `tablero` y `VistaSeguimiento` agrega `puedeRegistrar`:

```ts
export type EstadoViajeTablero = "en_espera" | "en_camino" | "descargando" | "terminado";
export type EstadoParadaTablero = "pendiente" | "en_camino" | "en_cliente" | "recolectando" | "recolectada" | "no_atendida" | "reasignada" | "omitida";
export interface ParadaTablero {
  paradaId: string; folio: string; cliente: string; estado: EstadoParadaTablero; etiqueta: string;
  /** HH:MM: la hora en que se recolectó o se cerró; la llegada proyectada si está pendiente; null si no aplica. */
  hora: string | null;
  /** HH:MM: la llegada estimada por el plan si está pendiente o en camino; si no, null. */
  horaPlan: string | null;
  ventana: { inicio: string; fin: string };
  motivo: string | null;
}
export interface ViajeTablero {
  rutaId: string; numero: number; estado: EstadoViajeTablero; etiqueta: string;
  salida: string | null; regreso: string | null; paradas: ParadaTablero[];
}
export interface SiguientePaso {
  tipo: TipoEvento; texto: string; rutaId: string | null; paradaId: string | null; versionRuta: number | null;
  pideOdometro: boolean; permiteNoAtendida: boolean;
  /** HH:MM al minuto hacia abajo: la hora mínima que se puede marcar (la del último evento), o null. */
  desde: string | null;
}
export interface TableroJornada {
  frase: string;
  recolecciones: { hechas: number; total: number };
  viajes: ViajeTablero[];
  /** null si la jornada terminó o si quien consulta no puede registrar. */
  siguiente: SiguientePaso | null;
}
```

**Dominio** (`src/dominio/operacion/transiciones.ts`, Codex): en `salida_patio` y `regreso_patio`, `odometroKm` puede ser null, que significa "desconocido". Si viene, sigue la regla de no decreciente. El efecto no lleva odómetro cuando es null. `registrarEventoOperador` sigue exigiéndolo al operador en la acción (Claude), así que el teléfono no cambia.

## 4. Reparto

- **Claude:**
  - el permiso, la acción y el núcleo compartido con `registrarEventoOperador` (un solo camino para guardar);
  - la consulta con el tablero y el bloque "¿Cómo funciona?" de `src/components/preparacion`;
  - las pruebas de unidad e integración: permisos, hora fuera de rango, odómetro vacío, rechazo sin guardar, idempotencia y bitácora.
- **Codex:**
  - el dominio (odómetro null) con sus pruebas;
  - el tablero en `src/components/plan/seguimiento.tsx`, con el formulario de marcar;
  - el e2e: el despachador valida un plan, marca un viaje completo y ve los estados cambiar.

## 5. Seguridad

- **Permisos:** solo el despachador y el administrador marcan; la gerencia y el operador no. Cada evento queda con quién lo marcó, en el evento y en la bitácora.
- **Reglas sin atajos:** las mismas transiciones, los mismos candados y la misma idempotencia que el teléfono. Una marca nunca se salta el orden del viaje.
- **Hora:** solo del mismo día y nunca futura ni anterior a la última marca, para que los indicadores de tiempo no se desordenen.
