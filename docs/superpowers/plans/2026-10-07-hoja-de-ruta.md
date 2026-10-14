# Recycling Solution — hoja de ruta de implementación

- **Fecha:** 2026-10-07
- **Especificación:** `docs/superpowers/specs/2026-10-07-recycling-solution-piloto-design.md`
- **Estado:** en revisión. Nada se implementa hasta que se aprueben la especificación y el Plan 1.

El piloto se construye en seis planes. Cada uno deja software funcionando y probado por sí mismo. Solo el Plan 1 está escrito al detalle; el plan detallado de cada hito siguiente se escribe al iniciarlo, con el mismo formato y la misma verificación previa del código, porque depende de lo que se aprenda en el anterior.

## Hitos

| Plan | Entrega | Depende de | Semanas |
|---|---|---|---|
| 1. Fundaciones y CRM de clientes | Proyecto, inicio de sesión con roles, ficha de cliente, lista con completitud, mapa, importación CSV | — | S1 a S2 |
| 2. Unidades, operadores y solicitudes | Catálogo de unidades y operadores, jornada del día, registro de solicitudes en cola FIFO con bloqueos, administración de usuarios | Plan 1 | S3 |
| 3. Motor de ruteo y simulación | Módulo puro `src/motor` con sus pruebas, datos semilla sintéticos y simulación sobre solicitudes históricas | Solo los tipos del Plan 1; puede avanzar en paralelo con el Plan 2 | S3 a S5 |
| 4. Plan del día | Generar, revisar en lista y mapa, ajustar y validar el plan | Planes 2 y 3 | S5 a S6 |
| 5. Aplicación del operador | Mi ruta en el teléfono, eventos de parada, incidentes y re-ruteo | Plan 4 | S6 |
| 6. Indicadores y panel | K1 a K7, tiempo de ciclo, panel gerencial y exportación CSV | Planes 4 y 5 | S7 |
| Piloto | Dos o tres unidades durante una o dos semanas; calibración y medición | Todos | S7 a S8 |

Las semanas son relativas: S1 es la primera semana de desarrollo. Hay que anclarlas al calendario real de entregas del semestre (decisión abierta 1 de la especificación).

## Qué incluye cada plan

### Plan 1 — Fundaciones y CRM de clientes

Detalle completo en `2026-10-07-plan-1-fundaciones-y-crm.md` (12 tareas).

Aceptación: `npm run verificar` y `npx playwright test` en verde; un rol sin permiso llega a "sin acceso"; cada alta deja renglón en la bitácora; la lista muestra cuántos clientes activos están completos (K5).

Trabajo de datos en paralelo: capturar la cartera real (80 a 110 clientes) con ubicación, ventanas, documentos y aviso de privacidad. La meta es 100% antes de iniciar el Plan 4.

### Plan 2 — Unidades, operadores y solicitudes

- Tablas: `unidades`, `operadores`, `jornadas`, `solicitudes`; columna `operador_id` en `usuarios`.
- Dominio: `motivosDeBloqueo(solicitud, cliente, unidadesDisponibles, fecha)` con la regla 3 de la especificación §7. Es función pura y el motor la reutiliza.
- Pantallas: unidades y operadores; jornada del día; solicitudes (alta rápida, cola en orden de registro, bloqueadas con motivo); usuarios y roles.
- Aceptación: una solicitud de un cliente con documento pendiente queda bloqueada y dice por qué; al corregir el documento vuelve a la cola con su hora original; la hora de registro no se puede editar; cada solicitud guarda `captura_seg` (K2); una unidad marcada como no disponible no aparece para la jornada.

### Plan 3 — Motor de ruteo y simulación

- `src/motor`: tipos `EntradaPlan` y `Plan`, modelo de traslado, filtro, orden FIFO, k-means++ con semilla, asignación de zonas, secuencia y viajes, reparación, comparación contra el método actual, `reasignarPendientes` y modo simulación (especificación §8).
- Datos semilla sintéticos: 30 clientes alrededor de El Marqués, 5 unidades, 40 solicitudes.
- Aceptación: pasan las propiedades de la especificación §12 (cada solicitud admitida aparece una vez; ninguna bloqueada se rutea; se respetan capacidad, turno y ventanas; al faltar cupo se posponen las de registro más reciente; misma semilla, mismo plan); 60 solicitudes con 15 unidades se resuelven en menos de 1 s; la simulación produce el comparativo de kilómetros y minutos contra el método actual, que alimenta la Sección 8 del Documento Integrador.

Este plan no usa base de datos ni pantallas, así que puede empezar en cuanto exista el proyecto.

### Plan 4 — Plan del día

- Tablas: `planes`, `rutas`, `paradas`.
- Acciones: generar plan, mover o posponer una parada, validar, descartar.
- Pantalla: plan en lista por unidad y en mapa, con las pospuestas y bloqueadas a la vista.
- Aceptación: ninguna ruta llega al operador sin validación; todo ajuste manual queda en la bitácora; el plan guarda `duracion_ms` (K7) y el tiempo de validación (K6); prueba de punta a punta de generar y validar.

### Plan 5 — Aplicación del operador

- Vista móvil `/operador`: check-in, salida de patio, llegada y salida por parada, cierre con odómetro.
- Incidentes y solicitud de re-ruteo.
- Tolerancia a mala señal: la ruta del día queda guardada en el teléfono y los eventos se reintentan.
- Aceptación: un operador solo ve y modifica sus rutas; `dentro_de_ventana` se calcula al registrar la llegada; el re-ruteo no toca paradas completadas ni en sitio.

### Plan 6 — Indicadores y panel

- `src/indicadores`: K1 a K7 y tiempo de ciclo como funciones puras (especificación §11).
- Panel gerencial contra la línea base y exportación CSV para las cartas X̄-R.
- Aceptación: cada indicador tiene una prueba con valores calculados a mano; el CSV abre en Excel con una fila por ruta.

### Piloto

- Antes: cronometrar la línea base de K2 con el método actual; cargar el 100% de la cartera.
- Durante: dos o tres unidades, una o dos semanas; registrar hora estimada contra hora real para calibrar velocidad y factor de circuidad.
- Después: resultados a las Secciones 13 a 15 del Documento Integrador.

## Si el calendario no alcanza

Orden de recorte, de lo último que se sacrifica a lo primero:

1. CRM de clientes y registro de solicitudes (Planes 1 y 2): sin ellos no hay datos.
2. Motor y simulación (Plan 3): con solicitudes históricas ya se puede demostrar el ahorro aunque no haya piloto en campo.
3. Plan del día (Plan 4).
4. Panel (Plan 6): los indicadores se pueden calcular desde el CSV.
5. Aplicación del operador (Plan 5): mientras tanto, el despachador comparte la ruta validada y captura él los horarios al regreso de la unidad.

## Criterio de terminado de cada plan

1. `npm run verificar` en verde.
2. Pruebas de punta a punta del plan en verde.
3. Lista de aceptación del plan comprobada y anotada en el commit de cierre.
4. Revisión con `docs/guia-de-auditoria.md`.
5. La tabla de trazabilidad de la especificación (§15) sigue siendo cierta.
