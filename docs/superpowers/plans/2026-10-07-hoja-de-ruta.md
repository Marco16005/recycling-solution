# Recycling Solution — hoja de ruta de implementación

- **Fecha:** 2026-10-07; revisión 2 del 2026-10-13 (Docker, Better Auth y correcciones de la revisión cruzada con Codex).
- **Especificación:** `docs/superpowers/specs/2026-10-07-recycling-solution-piloto-design.md`
- **Estado (2026-10-22):**
  - Planes 1 a 6 terminados y validados por Claude y Codex en `main` (etiquetas `plan-1-validado`, `plan-2-3-validado`, `plan-4-validado`, `plan-5-validado` y `plan-6-validado`).
  - Plan 7 (calles reales con OSRM y alertas en vivo, sin gasto en tráfico de terceros) validado por Claude y Codex en `main` (etiqueta `plan-7-validado`).
  - Plan CRM (cartera lista para operar: los 10 puntos) validado por Claude y Codex en `main` (etiqueta `plan-crm-validado`).
  - Plan 8 (reacomodo de rutas: más paradas atendidas y menos tiempo muerto) en cierre en la rama `claude/plan-8`: motor 1.2.0, tolerancia configurable y franja en el plan; en la simulación, −38 % de tiempo muerto y −42 % de km con 15 unidades, y +64 atendidas con 8.
  - Sigue la preparación del piloto (abajo): VPS, línea base de K2, cargar la cartera real y revisión del aviso de privacidad por un abogado.
  - Decisiones del dueño en la especificación §14.

El piloto se construye en seis planes. Cada uno deja software funcionando y probado por sí mismo. Solo el Plan 1 está escrito al detalle; el plan detallado de cada hito siguiente se escribe al iniciarlo, con el mismo formato y la misma verificación previa del código, porque depende de lo que se aprenda en el anterior.

## Hitos

| Plan | Entrega | Depende de | Semanas |
|---|---|---|---|
| 1. Fundaciones y CRM de clientes | Proyecto, inicio de sesión con roles, ficha de cliente, lista con completitud, mapa, importación CSV | — | S1 a S2 |
| 2. Unidades, operadores y solicitudes | Catálogo de unidades y operadores, jornada del día, registro de solicitudes en cola FIFO con bloqueos, administración de usuarios | Plan 1 | S3 |
| 3. Motor de ruteo y simulación | Módulo puro `src/motor` con sus pruebas, datos semilla sintéticos y simulación sobre solicitudes históricas | Tipos del Plan 1 y contratos de unidades, jornadas y solicitudes del Plan 2 (se fijan al inicio del Plan 2); después avanza en paralelo con él | S3 a S5 |
| 4. Plan del día | Generar, revisar en lista y mapa, ajustar y validar el plan | Planes 2 y 3 | S5 a S6 |
| 5. Aplicación del operador | Mi ruta en el teléfono, eventos de parada, incidentes y re-ruteo | Plan 4 | S6 |
| 6. Indicadores y panel | K1 a K7, tiempo de ciclo, panel gerencial y exportación CSV | Planes 4 y 5 | S7 |
| Piloto | Dos o tres unidades durante una o dos semanas; calibración y medición | Todos | S7 a S8 |

Las semanas son relativas: S1 es la primera semana de desarrollo. Hay que anclarlas al calendario real de entregas del semestre (decisión abierta 1 de la especificación).

## Qué incluye cada plan

### Plan 1 — Fundaciones y CRM de clientes

Detalle completo en `2026-10-13-plan-1-v2-fundaciones-y-crm.md` (tareas T0 a T8, repartidas entre Claude y Codex). Sustituye al v1 del 2026-10-07.

Aceptación: la lista de §1 del plan, comprobada con `scripts/verificar-todo.sh` en contenedores; incluye conflicto de edición, rollback con bitácora, importación en dos pasos, K5 sobre toda la cartera y permisos por rol.

Trabajo de datos en paralelo: capturar la cartera real (80 a 110 clientes) con ubicación, ventanas, documentos y aviso de privacidad. La meta es 100% antes de iniciar el Plan 4.

### Plan 2 — Unidades, operadores y solicitudes

Detalle en `2026-10-14-plan-2-flota-solicitudes-y-administracion.md` (amplía lo de abajo con el catálogo de documentos, la administración de usuarios y configuración, el aviso de privacidad público y el despliegue en el VPS).

- Tablas: `unidades`, `operadores`, `jornadas`, `solicitudes`; columna `operador_id` en `usuarios`.
- Dominio: `motivosDeBloqueo(solicitud, cliente, unidadesDisponibles, fecha)` extiende `motivosDeBloqueoCliente` del Plan 1 con la disponibilidad de unidades (especificación §7, regla 3). Es función pura y el motor la reutiliza.
- Pantallas: unidades y operadores; jornada del día; solicitudes (alta rápida, cola en orden de registro, bloqueadas con motivo); usuarios y roles (alta, cambio de rol, desactivación con revocación de sesiones, restablecimiento de contraseña).
- Aceptación: una solicitud de un cliente con documento pendiente queda bloqueada y dice por qué; al corregir el documento vuelve a la cola con su hora original; la hora de registro no se puede editar; cada solicitud guarda `captura_inicio_en` y `captura_fin_en` (K2); una unidad marcada como no disponible no aparece para la jornada.

### Plan 3 — Motor de ruteo y simulación

Detalle en `2026-10-14-plan-3-motor-de-ruteo.md`. Codex lo desarrolla en paralelo con el Plan 2.

- `src/motor`: tipos `EntradaPlan` y `Plan`, modelo de traslado, filtro, orden FIFO, k-means++ con semilla, admisión FIFO global con inserción factible, viajes, validación final independiente, comparación contra el método actual, re-ruteo con el mismo `generarPlan`, traza de decisiones y modo simulación (especificación §8 y Plan 3).
- Datos semilla sintéticos: 30 clientes alrededor de El Marqués, 5 unidades, 40 solicitudes.
- Aceptación: pasan las propiedades de la especificación §8 con fast-check (cada solicitud termina en una sola categoría con motivo; ninguna bloqueada se rutea; se respetan capacidad, turno y ventanas; ninguna admitida queda pospuesta mientras una más reciente se rutea, salvo inviabilidad física registrada; misma semilla, mismo plan) y los casos límite definidos; 60 solicitudes con 15 unidades se resuelven en menos de 1 s; la simulación produce el comparativo de kilómetros y minutos contra el método actual, que alimenta la Sección 8 del Documento Integrador.

Este plan no usa base de datos ni pantallas, así que puede empezar en cuanto estén fijados los contratos de unidades, jornadas y solicitudes.

### Plan 4 — Plan del día

- Tablas: `ejecuciones_motor`, `planes`, `rutas`, `paradas` (especificación §6, contrato de captura).
- Acciones: generar plan, mover o posponer una parada, validar, descartar.
- Pantalla: plan en lista por unidad y en mapa, con las pospuestas y bloqueadas a la vista.
- Aceptación: ninguna ruta llega al operador sin validación; validar bloquea el plan, compara su versión y vuelve a revisar elegibilidad y disponibilidad (dos validaciones simultáneas: una gana, la otra recibe el motivo); todo ajuste manual queda en la bitácora; cada corrida del motor queda en `ejecuciones_motor` (K7), incluso si falla; el plan guarda `generado_en`, `revision_iniciada_en` y `validado_en` (K6); prueba de punta a punta de generar y validar.

### Plan 5 — Aplicación del operador

- Vista móvil `/operador`: check-in, salida de patio, llegada y salida por parada, cierre con odómetro.
- Incidentes y solicitud de re-ruteo.
- Tolerancia a mala señal: la ruta del día queda guardada en el teléfono y los eventos se reintentan con su `evento_id`, de modo que un reintento no duplica el evento.
- Aviso de privacidad propio para operadores antes de capturar ubicación en eventos.
- Aceptación: un operador solo ve y modifica las rutas de su jornada; un evento repetido no se duplica; las transiciones inválidas (por ejemplo, salir de una parada sin haber llegado) se rechazan; el re-ruteo no toca paradas completadas, en sitio ni el tramo comprometido.

### Plan 6 — Indicadores y panel

- `src/indicadores`: K1 a K7 y tiempo de ciclo como funciones puras (especificación §11).
- Panel gerencial contra la línea base y exportación CSV para las cartas X̄-R.
- Aceptación: cada indicador tiene una prueba con valores calculados a mano y reporta su tamaño de muestra; el CSV abre en Excel con una fila por recolección.

### Plan 7 — Calles reales y alertas en vivo

- OSRM en contenedor propio con el mapa recortado de Querétaro (gratuito, sin enviar ubicaciones): matriz dirigida por calle, factor de camión y horas pico.
- Proyección en vivo de cada jornada y alertas de ventana en riesgo, fuera de turno y atraso; liberar paradas de viajes futuros en el re-ruteo; frontera viva al validar.
- Navegación del operador con Waze o Google Maps (enlaces) y recorridos por calle en el mapa.
- Aceptación: con la fórmula anterior el motor da el mismo plan; los planes 1.0.0 siguen funcionando; nada proyectado queda antes de ahora; sin OSRM, el plan sale aproximado con su motivo.

### Plan CRM — Cartera lista para operar (antes del Plan 8)

- Importación completa con plantilla (horarios, tipos de unidad, ubicación, correo y puesto), CSV de Excel en español (`;` y Windows-1252).
- Ubicación pegada desde WhatsApp o Google Maps (enlaces cortos incluidos) con distancia a la calle.
- Historial y números por cliente, varios contactos, notas de seguimiento sin borrado, filtros, exportación con bitácora y mapa de la cartera.
- Propuestas de recolección por ritmo aprendido o recurrencia fija, que el despachador confirma, pospone o descarta.
- Aceptación: nada se crea sin confirmar; exportar e importar conserva la plantilla; las pruebas de punta a punta cubren cada punto.

### Plan 8 — Optimización entre rutas

- Reacomodar paradas entre rutas para recortar km sin romper ventanas, capacidad, turno ni FIFO (la "A" de la conversación con el usuario del 2026-10-15). El aprendizaje de tiempos con datos reales (la "B") va después del piloto.

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

1. `scripts/verificar-todo.sh` en verde (todo en contenedores).
2. Pruebas de punta a punta del plan en verde contra la imagen de producción.
3. Lista de aceptación del plan comprobada y anotada en el commit de cierre.
4. Revisión con `docs/guia-de-auditoria.md`.
5. La tabla de trazabilidad de la especificación (§16) sigue siendo cierta.
6. Claude y Codex validan el mismo commit integrado (especificación §15).
