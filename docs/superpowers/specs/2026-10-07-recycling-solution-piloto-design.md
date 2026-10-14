# Recycling Solution — especificación de diseño del piloto

- **Fecha:** 2026-10-07
- **Estado:** borrador para revisión. No se escribe código del producto hasta que esta especificación y el plan de implementación estén aprobados.
- **Fuente de requisitos:** `7°_LII_CF Solutions_DocumentoIntegrador (unificado).docx` (en la carpeta superior). Cuando este documento cita "DI §n" o "DI Tabla n" se refiere a ese archivo.
- **Hoja de ruta:** `docs/superpowers/plans/2026-10-07-hoja-de-ruta.md`
- **Primer plan detallado:** `docs/superpowers/plans/2026-10-07-plan-1-fundaciones-y-crm.md`

---

## 1. Propósito

Construir la prueba piloto de un asistente de logística para una recicladora de cartón en El Marqués, Querétaro (15 unidades de doble rodada, 80 a 110 clientes, 50 a 60 solicitudes de recolección por día, 2 despachadores).

Hoy el despachador recibe solicitudes por llamada y WhatsApp, busca los datos del cliente en Excel o notas y asigna de memoria. El ciclo de una recolección dura 161 min, de los cuales 15 min son espera de asignación (desperdicio puro) y 45 min traslado (DI Tabla 3). La capacidad teórica (44.7 recolecciones por día) no cubre la demanda.

El piloto se construye en dos etapas, en este orden:

1. **Etapa 1 — datos.** CRM de clientes, catálogo de unidades y operadores, y registro de solicitudes en un canal único.
2. **Etapa 2 — ruteo.** Un motor que une los datos del CRM con las unidades disponibles y propone las rutas del día; el despachador las valida; el operador las ejecuta desde su teléfono; la gerencia ve los indicadores.

### Criterios de éxito (DI §1 y Tabla 8)

| # | Indicador | Meta | Cómo lo mide el sistema |
|---|---|---|---|
| K1 | Tiempos muertos por recolección (espera de asignación + traslado) | 48 min o menos (base 60) | §11, K1 |
| K2 | Tiempo administrativo para identificar las especificaciones del cliente | 30% menos que la línea base | §11, K2 |
| K3 | Cumplimiento de ventanas horarias | 80% o más | §11, K3 |
| K4 | Kilómetros y combustible por ruta | 10% menos | §11, K4 |
| K5 | Clientes activos con campos obligatorios completos | 100% | §11, K5 |
| K6 | Validación del plan por el despachador | 5 min o menos | §11, K6 |
| K7 | Respuesta del motor de ruteo | 60 s o menos | §11, K7 |

## 2. Alcance

### Dentro del piloto

| Módulo (DI Tabla 9) | Etapa | Usuario |
|---|---|---|
| CRM de clientes | 1 | Despachador |
| Catálogo de unidades y operadores | 1 | Despachador |
| Registro de solicitudes | 1 | Despachador |
| Motor de ruteo | 2 | Sistema y despachador |
| Aplicación móvil del operador (vista web) | 2 | Operador |
| Panel gerencial simplificado | 2 | Gerencia |

### Fuera del piloto (Fase 2)

Checklist digital de operadores y unidades, alertas de vencimiento de licencias, trazabilidad de material (peso, valor, inventario en patio), manifiestos y documentos fiscales, cálculo de huella de carbono, optimización VRPTW con solver, rastreo GPS continuo, aplicación nativa, integración con WhatsApp.

Lo que el piloto sí deja preparado para la Fase 2: kilómetros y combustible estimado por ruta (base de la huella de carbono) y una interfaz del motor que permite sustituir la heurística por un solver.

## 3. Decisión: partir de un proyecto de GitHub o desde cero

Se evaluaron proyectos de código abierto como posible base (consulta del 2026-10-07).

| Candidato | Qué es | Licencia | Stack y operación | Encaje con el piloto |
|---|---|---|---|---|
| [Atomic CRM](https://github.com/marmelab/atomic-crm) | CRM de ventas ligero | MIT | React, Vite, shadcn/ui, Supabase | Bajo. Sus entidades son contactos, empresas, negocios en kanban, tareas y notas. No tiene ventanas horarias, documentos por cliente, unidades, solicitudes ni rutas. |
| [Twenty](https://github.com/twentyhq/twenty) | CRM tipo Salesforce | AGPL-3.0 con módulos comerciales | Node, Postgres, Redis, worker; 2 a 4 GB de RAM | Bajo. Mismo desajuste de dominio y mucha más operación. |
| [Fleetbase](https://github.com/fleetbase/fleetbase) | Plataforma de logística (órdenes, despacho, app de conductor, ruteo con OSRM) | AGPL-3.0, doble licencia | PHP y Ember en Docker; pide correo, mapas, SMS, almacenamiento, colas y sockets; 4 GB de RAM | Medio en dominio, bajo en viabilidad. Es una plataforma completa, no una base pequeña. |
| Repos de recolección de residuos (Garbougie, GarbageTruckOptimization) | Proyectos académicos o de hackathon | Varias | Sin mantenimiento | Nulo como base. |
| Solvers: [VROOM](https://github.com/VROOM-Project/vroom), OR-Tools, PyVRP, Timefold | Optimización de rutas con ventanas de tiempo | BSD, Apache-2.0, MIT, Apache-2.0 | Servicio aparte | Son la alternativa A4 del DI (descartada para el semestre). Se reservan para la Fase 2. |

**Decisión: desarrollo propio sobre un stack estándar, reutilizando librerías; no se hace fork de ningún producto.**

Razones:

1. **El dominio no coincide.** Un CRM de ventas modela prospectos y negocios; aquí "CRM" significa ficha de restricciones del cliente. De Atomic CRM solo se aprovecharía el andamiaje (login, listas, formularios), que con el stack elegido se obtiene igual sin heredar código ajeno.
2. **El modelo de datos es pequeño.** Son 14 tablas. Escribirlas cuesta menos que entender y recortar una plataforma.
3. **Coherencia con el Documento Integrador.** La matriz de selección (DI Tabla 14) eligió A3, desarrollo propio con regla híbrida, sobre A1, software existente. Adoptar Fleetbase sería volver a A1 y perder el diferenciador que se defiende: una regla de asignación propia y explicable.
4. **Licencia y operación.** AGPL obliga a publicar el código si se ofrece como servicio a terceros (el DI plantea comercializarlo a futuro). Fleetbase y Twenty requieren operar varios servicios en Docker.
5. **Auditoría.** Un código propio y pequeño se puede revisar completo con otro modelo; un fork grande no.

Lo que sí se reutiliza: Postgres y autenticación administrados, componentes de interfaz (shadcn/ui), mapas (MapLibre), y el diseño de Atomic CRM como referencia de patrones de pantalla.

## 4. Stack tecnológico

| Capa | Elección | Por qué | Alternativa |
|---|---|---|---|
| Aplicación | Next.js 16 (App Router, con Cache Components activo) + TypeScript | Una sola base de código para despachador, operador y gerencia; despliegue directo en Vercel | — |
| Interfaz | Tailwind CSS + shadcn/ui | Componentes accesibles y editables; rápido de construir | — |
| Base de datos | Postgres en Neon (integración nativa del Marketplace de Vercel) | Variables de entorno automáticas; ramas de base de datos para pruebas | Supabase (Postgres + Auth + Storage en un proveedor) |
| Acceso a datos | Drizzle ORM + migraciones versionadas | Esquema en TypeScript, SQL legible y auditable | Prisma |
| Autenticación | Clerk (integración nativa) con registro público desactivado | Los usuarios los crea el administrador; sin manejar contraseñas propias | Supabase Auth |
| Validación | Zod en cada acción del servidor | Una definición por entidad, reutilizada en formularios y servidor | — |
| Mapa | MapLibre GL JS con teselas de OpenFreeMap | Sin llave de API ni costo; el servicio público se ofrece sin garantía de disponibilidad, aceptable para un piloto | MapTiler (plan gratuito) |
| Motor de ruteo | Módulo TypeScript puro en `src/motor/`, sin dependencias de red ni de base de datos | Determinista, probado con pruebas unitarias, auditable | Solver externo en Fase 2 |
| Pruebas | Vitest (unidad e integración) y Playwright (flujos de punta a punta) | — | — |
| Hospedaje | Vercel | — | — |

Decisiones derivadas:

- **Sin API de geocodificación.** Con 80 a 110 clientes, la ubicación se captura una vez moviendo un pin en el mapa o pegando coordenadas.
- **Tiempos de traslado estimados**, no consultados a un servicio: distancia haversine × factor de circuidad ÷ velocidad promedio, ambos configurables y calibrables con los datos del piloto. El motor recibe el modelo de traslado como parámetro, así que se puede sustituir por OSRM o Google sin tocar el resto.
- **Sin tiempo real por sockets.** Las pantallas del despachador se refrescan cada 20 s; para 5 a 10 usuarios es suficiente.
- **Vocabulario.** Tablas, rutas de la aplicación e interfaz usan los términos del DI en español (`clientes`, `unidades`, `solicitudes`, `rutas`, `paradas`). El código técnico genérico va en inglés.
- **Requisito previo:** actualizar la CLI de Vercel (`npm i -g vercel@latest`); la instalada (54.0.0) no soporta los comandos del Marketplace. Al implementar base de datos y autenticación se siguen las guías `vercel:vercel-storage` y `vercel:auth`.
- **Planes gratuitos.** Bastan para el piloto. El plan Hobby de Vercel es para uso no comercial; si la empresa lo adopta en operación, hay que pasar a un plan de pago.

## 5. Arquitectura

```
┌────────────────────────── Next.js en Vercel ──────────────────────────┐
│                                                                       │
│  /despacho/*        /operador/*          /gerencia/*      /admin/*    │
│  (escritorio)       (móvil)              (panel)          (usuarios)  │
│        │                 │                    │               │       │
│        └────────── acciones del servidor (src/acciones) ──────┘       │
│                  autorización por rol + validación Zod                │
│                              │                                        │
│        ┌─────────────────────┼──────────────────────┐                 │
│        ▼                     ▼                      ▼                 │
│  src/datos (Drizzle)   src/motor (puro)      src/indicadores (puro)   │
│        │               sin BD, sin red        cálculo de K1..K7       │
│        ▼                                                              │
│   Postgres (Neon)                                                     │
└───────────────────────────────────────────────────────────────────────┘
        Clerk: identidad                MapLibre + OpenFreeMap: mapa
```

Unidades y sus límites:

| Unidad | Hace | No hace | Depende de |
|---|---|---|---|
| `src/datos` | Esquema, migraciones y consultas | Reglas de negocio | Postgres |
| `src/motor` | Recibe datos planos y devuelve un plan de rutas | Leer o escribir la base de datos; llamar a la red; usar reloj o azar no sembrado | Nada |
| `src/indicadores` | Calcula K1 a K7 a partir de registros | Leer la base de datos | Nada |
| `src/acciones` | Autoriza, valida, llama a datos y motor, escribe la bitácora | Lógica de presentación | `datos`, `motor`, `indicadores`, Clerk |
| `src/app` | Pantallas por rol | Acceso directo a la base de datos | `acciones` |

El motor y los indicadores son funciones puras a propósito: se prueban sin infraestructura y un auditor puede verificar su comportamiento leyendo solo esas carpetas.

### Flujo principal del día

1. El despachador registra las solicitudes conforme llegan (quedan con hora de registro).
2. Operador y unidad hacen check-in; el despachador marca las unidades no disponibles.
3. El despachador pulsa "Generar plan". La acción carga los datos, llama al motor y guarda un plan en estado `propuesto`.
4. El despachador revisa el plan en lista y mapa, ajusta si quiere (mover o posponer una parada) y lo valida.
5. Cada operador ve su ruta en el teléfono y marca: salida de patio, llegada y salida de cada parada, cierre de ruta con odómetro.
6. Si hay un incidente, el operador lo reporta; el despachador pide una nueva propuesta para las paradas pendientes.
7. La gerencia consulta el panel.

## 6. Modelo de datos

Todas las tablas tienen `id` (uuid) y, salvo `bitacora`, `creado_en` y `actualizado_en`. Las horas se guardan con zona horaria (`timestamptz`) y se muestran en hora de la Ciudad de México.

### Etapa 1

**`usuarios`** — `clerk_id` (único), `nombre`, `rol` (`admin` | `despachador` | `operador` | `gerencia`), `operador_id` (opcional), `activo`. Es la única fuente del rol.

**`clientes`** — `nombre`, `contacto_nombre`, `contacto_telefono`, `direccion`, `lat`, `lng`, `tipo_residuo` (`RSU` | `RME` | `RP`), `material` (texto), `tipos_unidad_admitidos` (lista de `tipo_unidad`), `notas_acceso`, `tiempo_servicio_min` (predeterminado 66), `carga_estimada_kg`, `aviso_privacidad_aceptado_en`, `activo`.

**`ventanas_cliente`** — `cliente_id`, `dia_semana` (0 a 6), `hora_inicio`, `hora_fin`. Un cliente puede tener varias.

**`documentos_cliente`** — `cliente_id`, `nombre` (por ejemplo "SUA vigente"), `obligatorio`, `estado` (`vigente` | `pendiente` | `vencido`), `vence_el` (opcional).

**`unidades`** — `clave` (única, por ejemplo U-03), `placas`, `tipo` (`doble_rodada` | `rabon` | `camioneta`), `capacidad_kg`, `rendimiento_km_l`, `disponible`, `motivo_no_disponible`, `activo`.

**`operadores`** — `nombre`, `telefono`, `unidad_habitual_id` (opcional), `activo`.

**`solicitudes`** — `folio` (consecutivo), `cliente_id`, `registrada_en` (inmutable; es la llave FIFO), `fecha_requerida`, `canal` (`llamada` | `whatsapp` | `otro`), `carga_estimada_kg`, `notas`, `estado`, `motivos_bloqueo` (lista), `registrada_por`, `captura_seg`.

Estados de una solicitud:

```
registrada ──▶ programada ──▶ en_ruta ──▶ completada
     │              │
     ├──▶ bloqueada (documentación, residuo, ventana o acceso; vuelve a registrada al corregirse)
     ├──▶ pospuesta (no cupo hoy; conserva su hora de registro y mañana va primero)
     └──▶ cancelada
```

**`configuracion`** — una sola fila: `patio_lat`, `patio_lng`, `turno_inicio` (08:00), `turno_fin` (16:00), `velocidad_kmh` (30), `factor_circuidad` (1.4), `descarga_min` (20), y `linea_base` (espera 15, traslado 45, ciclo 161, según DI Tabla 3).

**`bitacora`** — solo inserción: `en`, `usuario_id`, `entidad`, `entidad_id`, `accion`, `datos` (json). Toda acción que modifica datos escribe aquí.

Regla de completitud (K5): un cliente está completo si tiene ubicación, al menos una ventana, tipo de residuo, tipos de unidad admitidos y aviso de privacidad aceptado.

### Etapa 2

**`jornadas`** — `fecha`, `unidad_id`, `operador_id`, `check_in_en`, `check_out_en`. Únicos: (`fecha`, `unidad_id`) y (`fecha`, `operador_id`).

**`planes`** — `fecha`, `estado` (`propuesto` | `validado` | `descartado`), `generado_en`, `generado_por`, `validado_en`, `validado_por`, `parametros` (json: semilla, k, velocidad, circuidad), `version_motor`, `duracion_ms`, `resumen` (json: km, paradas, pospuestas, bloqueadas, comparación contra el método actual).

**`rutas`** — `plan_id`, `jornada_id`, `numero_viaje`, `km_estimados`, `min_estimados`, `estado` (`propuesta` | `asignada` | `en_curso` | `terminada` | `cancelada`), `asignada_en`, `salida_patio_en`, `cerrada_en`, `odometro_inicio_km`, `odometro_fin_km`.

**`paradas`** — `ruta_id`, `solicitud_id`, `secuencia`, `llegada_estimada`, `llegada_en`, `salida_en`, `dentro_de_ventana` (se calcula al registrar la llegada), `estado` (`pendiente` | `en_sitio` | `completada` | `omitida`).

**`incidentes`** — `ruta_id`, `parada_id` (opcional), `tipo` (`averia` | `retraso` | `cierre_vial` | `cliente_no_disponible` | `otro`), `descripcion`, `reportado_en`, `reportado_por`, `resuelto_en`, `accion` (`re_ruteo` | `continuar` | `cancelar`).

## 7. Reglas de negocio

1. **Canal único.** Toda recolección nace como solicitud registrada en el sistema; no se asigna nada que no tenga folio.
2. **Hora de registro inmutable.** `registrada_en` no se edita; es la base del orden FIFO.
3. **Bloqueo a prueba de errores (poka-yoke).** Una solicitud no puede programarse si se cumple cualquiera de estas condiciones; el sistema guarda el motivo:
   - el cliente genera residuos peligrosos (`RP`);
   - el cliente tiene un documento obligatorio en `pendiente` o `vencido`;
   - el cliente no tiene ventana el día requerido;
   - el cliente no tiene ubicación;
   - ninguna unidad disponible es de un tipo que el cliente admita.
4. **Sin inanición.** Una solicitud pospuesta conserva su hora de registro, así que al día siguiente queda al frente de la cola.
5. **El despachador decide.** El motor propone; nada llega al operador sin validación. Los ajustes manuales quedan en la bitácora.
6. **Unidad no disponible no recibe ruta.**

## 8. Motor de ruteo

### Contrato

```ts
generarPlan(entrada: EntradaPlan): Plan
```

`EntradaPlan`: fecha, solicitudes candidatas con los datos de su cliente (ubicación, ventanas del día, documentos, residuo, tipos admitidos, tiempo de servicio, carga), jornadas del día (unidad, tipo, capacidad), configuración y semilla.

`Plan`: rutas (unidad, número de viaje, paradas en orden con hora estimada de llegada y minutos de espera, km y minutos), solicitudes pospuestas con motivo, solicitudes bloqueadas con motivos, y un resumen con la comparación contra el método actual.

Propiedad obligatoria: **misma entrada y misma semilla producen exactamente el mismo plan.**

### Algoritmo (versión 1)

"Híbrida FIFO + agrupación geográfica" queda definida así: **FIFO decide qué solicitudes entran al plan del día y cuáles se posponen cuando no caben; la geografía decide cómo se agrupan en rutas.**

1. **Filtro.** Aplica la regla 3 de §7. Las que no pasan salen como bloqueadas.
2. **Orden FIFO.** Ordena las válidas por `registrada_en` y, en empate, por folio.
3. **Agrupación geográfica.** k-means++ con semilla sobre las coordenadas (proyectadas a kilómetros alrededor del patio), con k = mínimo entre unidades disponibles y solicitudes. Cada grupo es la zona de una unidad.
4. **Asignación de zona a unidad.** Las zonas se ordenan por carga total descendente y las unidades por capacidad descendente; una unidad solo toma una zona si todos sus clientes admiten ese tipo de unidad. Si una zona queda sin unidad compatible, sus solicitudes pasan al paso de reparación.
5. **Secuencia y viajes.** Dentro de cada zona, a partir del patio y de la hora de inicio de turno: se elige la siguiente parada con menor (traslado + espera) entre las que aún pueden cumplir su ventana. Si la carga acumulada excede la capacidad, la unidad regresa a patio, descarga (`descarga_min`) e inicia otro viaje.
6. **Reparación.** Si una ruta termina después del fin de turno o una parada ya no puede cumplir su ventana: primero se intenta mover esa parada a la zona vecina más cercana que tenga holgura; si no se puede, se pospone la solicitud con registro más reciente de esa zona y se recalcula. Máximo 50 iteraciones; lo que no se resuelva se reporta como pospuesto con motivo.
7. **Comparación.** Para las mismas solicitudes se calcula el método actual (un viaje redondo por cliente) y se reporta la diferencia en kilómetros y minutos.

Modelo de traslado: `km = haversine × factor_circuidad`; `min = km ÷ velocidad_kmh × 60`.

Tamaño del problema: hasta 60 solicitudes y 15 unidades; se resuelve en milisegundos, muy por debajo de la meta de 60 s.

### Re-ruteo ante incidente

`reasignarPendientes(plan, rutaAfectada, ahora)`: libera las paradas pendientes de la ruta afectada e inserta cada una, en orden FIFO, en la ruta donde cueste menos (kilómetros añadidos) entre las que cumplan ventana, capacidad y fin de turno. Las que no quepan se posponen. No toca paradas completadas ni en sitio.

### Simulación

El mismo `generarPlan` se ejecuta sobre un conjunto de solicitudes históricas sin guardar el plan. Es el entregable "Simulación del sistema propuesto" (DI Tabla 1) y la tercera fase del proceso (DI §2).

### Por qué se le llama inteligencia artificial

El paso 3 es agrupamiento no supervisado: las zonas no son fijas, se forman cada día con las solicitudes reales. La optimización completa (VRPTW) queda para la Fase 2 detrás del mismo contrato.

### Límites conocidos de la versión 1

- k-means no equilibra cargas por sí mismo; lo compensa el paso de reparación.
- Los tiempos de traslado son estimados; se calibran comparando hora estimada contra hora real de llegada durante el piloto.
- No optimiza globalmente; es una heurística explicable. Es la decisión tomada en DI Tabla 14.

## 9. Pantallas

| Rol | Pantalla | Qué permite |
|---|---|---|
| Despachador | Clientes | Lista con búsqueda y estado de completitud; ficha con ventanas, documentos, pin en mapa; importación desde CSV |
| Despachador | Unidades y operadores | Altas, disponibilidad con motivo |
| Despachador | Jornada | Quién sale hoy en qué unidad; check-in |
| Despachador | Solicitudes | Alta rápida (cliente, fecha, carga, canal); cola en orden FIFO; bloqueadas con motivo |
| Despachador | Plan del día | Generar, ver en lista y mapa, mover o posponer paradas, validar, pedir re-ruteo |
| Operador | Mi ruta (móvil) | Check-in, salida de patio, llegada y salida por parada, incidente, cierre con odómetro |
| Gerencia | Panel | K1 a K7 contra la línea base, tendencia diaria, exportación CSV |
| Admin | Usuarios y configuración | Roles, patio, turno, parámetros del modelo de traslado |

## 10. Seguridad y privacidad

- **Autenticación:** Clerk; registro público desactivado; el administrador crea las cuentas.
- **Autorización:** toda acción del servidor empieza con `exigirRol(...)`. Un operador solo ve y modifica sus propias rutas. No hay acceso a la base de datos desde el navegador.
- **Validación:** toda entrada pasa por un esquema Zod en el servidor, aunque el formulario ya valide.
- **Datos personales (LFPDPPP):** se guarda el mínimo (nombre y teléfono de contacto). La ubicación del operador se registra solo en los eventos que él marca (llegada, salida), no de forma continua. Aviso de privacidad para clientes y operadores.
- **Bitácora** de toda modificación, con usuario y hora.
- **Secretos** solo en variables de entorno de Vercel; nunca en el repositorio.
- **Datos de prueba:** el repositorio solo contiene datos sintéticos. La cartera real se importa directo a la base de datos.

## 11. Indicadores

Cada indicador es una función pura en `src/indicadores` con su prueba.

| # | Definición operativa |
|---|---|
| K1 | Por ruta: espera = `asignada_en − check_in_en` de la jornada (0 si la ruta se asignó antes del check-in). Traslado por parada = `llegada_en −` (salida de la parada anterior o `salida_patio_en`). K1 = espera prorrateada entre las paradas + traslado promedio. |
| K2 | Mediana de `captura_seg` de las solicitudes del periodo, contra la línea base cronometrada del método actual. |
| K3 | Paradas completadas con `dentro_de_ventana` ÷ paradas completadas. |
| K4 | Km reales = `odometro_fin_km − odometro_inicio_km`; litros = km ÷ `rendimiento_km_l`. Se compara contra los km del método actual que calcula el motor para las mismas solicitudes. |
| K5 | Clientes activos completos ÷ clientes activos. |
| K6 | `validado_en − generado_en` del plan. |
| K7 | `duracion_ms` del plan. |
| Ciclo | Por ruta: (`cerrada_en −` inicio de la ruta) ÷ paradas completadas. Se exporta en CSV para construir las cartas X̄-R (DI Figura 3). |

## 12. Pruebas

- **Motor (unidad, Vitest).** Casos fijos y propiedades: toda solicitud admitida aparece exactamente una vez; ninguna bloqueada aparece en una ruta; ninguna ruta excede capacidad, turno ni ventanas; al faltar cupo se posponen las de registro más reciente; misma semilla, mismo plan.
- **Indicadores (unidad).** Un caso por indicador con valores calculados a mano.
- **Acciones (integración).** Cada acción rechaza al rol equivocado y a la entrada inválida, y escribe en la bitácora.
- **Flujos (Playwright).** Tres: alta de cliente completa; solicitud bloqueada por documento pendiente; generar, validar y ejecutar una ruta.
- **Datos semilla** sintéticos: 30 clientes alrededor de El Marqués, 5 unidades, 40 solicitudes.

## 13. Riesgos y supuestos

| Riesgo o supuesto | Consecuencia | Mitigación |
|---|---|---|
| La cartera real no tiene coordenadas | El motor no puede agrupar | Captura con pin en mapa durante la Etapa 1; K5 lo vigila |
| Tiempos de traslado estimados alejados de la realidad | Horas estimadas poco fiables | Parámetros configurables y calibración con datos del piloto |
| Poca señal en campo | El operador no puede marcar eventos | La ruta del día se guarda en el teléfono y los eventos se reintentan al recuperar señal |
| El despachador no adopta el canal único | El motor trabaja con datos incompletos | Alta de solicitud en menos de 30 s; él valida todo |
| Calendario | Faltan semanas para el piloto | Ver decisión abierta 1 |
| Se asume un viaje redondo por cliente en el método actual | La comparación de ahorro depende de ello | Confirmar con la empresa (DI §3 menciona que a veces ya se atienden varios clientes por viaje) |

## 14. Decisiones abiertas

1. **Calendario.** ¿Cuál es la fecha de la 4ª entrega y del cierre? El plan está en semanas relativas; los objetivos del DI ("primeras 6 semanas", "meses 2 y 3") deben anclarse al calendario real.
2. **Turno.** El DI usa 480 min; una versión anterior decía 450. Confirmar.
3. **Datos de la cartera.** ¿Quién entrega el Excel de clientes y quién captura ubicaciones y documentos?
4. **Cuentas.** ¿A nombre de quién quedan el proyecto de Vercel, la base de datos y Clerk?
5. **Teléfonos de los operadores.** ¿Tienen datos móviles durante la ruta?
6. **Captura asistida desde WhatsApp (opcional).** Pegar el mensaje del cliente y que un modelo de lenguaje proponga la solicitud ya llenada. Reforzaría el componente de IA, pero no es necesaria para los indicadores. Está fuera del plan base.

## 15. Trazabilidad con el Documento Integrador

| Elemento del DI | Dónde se cumple aquí |
|---|---|
| §1 Alcance en dos etapas | §2 |
| §1 Indicadores de éxito; Tabla 8 | §1 y §11 |
| Tabla 1, simulación | §8, Simulación |
| Tabla 1, cartas X̄-R y panel | §11, Ciclo; §9, Panel |
| Tabla 6, roles | §9 y §10 |
| Tabla 9, seis módulos | §2 |
| Tabla 10, requerimientos por etapa | §7 (bloqueos), §10 (LFPDPPP), §6 (aviso de privacidad) |
| §6, cuatro pasos del motor | §8 |
| Tabla 14, alternativa A3 | §3 |
