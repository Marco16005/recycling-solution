# Recycling Solution — especificación de diseño del piloto

- **Revisión 2 — 2026-10-13.** Incorpora la ejecución 100% en contenedores Docker y las correcciones de la revisión cruzada entre Claude y Codex. La revisión 1 (2026-10-07) está en el historial de git.
- **Estado:** revisión técnica cerrada el 2026-10-13: Codex la validó con seis cambios bloqueantes, se incorporaron y Codex confirmó la versión resultante. Aprobación de producto: las decisiones de §14 siguen abiertas con el dueño del proyecto; ninguna bloquea el Plan 1.
- **Fuente de requisitos:** `7°_LII_CF Solutions_DocumentoIntegrador (unificado).docx`, en la carpeta superior. "DI §n" y "DI Tabla n" se refieren a ese archivo.
- **Hoja de ruta:** `docs/superpowers/plans/2026-10-07-hoja-de-ruta.md`
- **Plan vigente:** `docs/superpowers/plans/2026-10-13-plan-1-v2-fundaciones-y-crm.md`

---

## 1. Propósito

Construir la prueba piloto de un asistente de logística para una recicladora de cartón en El Marqués, Querétaro: 15 unidades de doble rodada, 80 a 110 clientes, 50 a 60 solicitudes de recolección por día y 2 despachadores.

Hoy el despachador recibe solicitudes por llamada y WhatsApp, busca los datos del cliente en Excel o en notas y asigna de memoria. El ciclo de una recolección dura 161 min; 15 min son espera de asignación (desperdicio puro) y 45 min traslado (DI Tabla 3). La capacidad teórica, 44.7 recolecciones por día, no cubre la demanda.

El piloto se construye en dos etapas, en este orden:

1. **Etapa 1 — datos.** CRM de clientes, catálogo de unidades y operadores, y registro de solicitudes en un canal único.
2. **Etapa 2 — ruteo.** Un motor une los datos del CRM con las unidades disponibles y propone las rutas del día; el despachador las valida; el operador las ejecuta desde su teléfono; la gerencia consulta los indicadores.

### Criterios de éxito (DI §1 y Tabla 8)

| # | Indicador | Meta | Definición |
|---|---|---|---|
| K1 | Tiempos muertos por recolección (espera de asignación + traslado) | 48 min o menos (base 60) | §11 |
| K2 | Tiempo administrativo para identificar las especificaciones del cliente | 30% menos que la línea base | §11 |
| K3 | Cumplimiento de ventanas horarias | 80% o más | §11 |
| K4 | Kilómetros y combustible por ruta | 10% menos | §11 |
| K5 | Clientes activos con ficha completa | 100% | §11 |
| K6 | Validación del plan por el despachador | 5 min o menos | §11 |
| K7 | Respuesta del motor de ruteo | 60 s o menos | §11 |

## 2. Alcance

### Dentro del piloto

| Módulo (DI Tabla 9) | Etapa | Usuario |
|---|---|---|
| CRM de clientes | 1 | Despachador |
| Catálogo de unidades y operadores | 1 | Despachador |
| Registro de solicitudes | 1 | Despachador |
| Motor de ruteo | 2 | Sistema y despachador |
| Aplicación del operador (vista web móvil) | 2 | Operador |
| Panel gerencial simplificado | 2 | Gerencia |

### Fuera del piloto (Fase 2)

Checklist digital de operadores y unidades, alertas de vencimiento de licencias, trazabilidad de material (peso, valor, inventario en patio), manifiestos y documentos fiscales, cálculo de huella de carbono, optimización VRPTW con solver, rastreo GPS continuo, aplicación nativa e integración con WhatsApp.

El piloto deja preparado para la Fase 2: kilómetros y combustible por ruta (base de la huella de carbono) y un contrato del motor que permite sustituir la heurística por un solver.

### Destino del piloto

Un VPS de Hostinger que ya corre un sistema de punto de venta (decisión 1). Consecuencias para el diseño:

- **Sin dominio propio por ahora:** Caddy atiende `<ip-con-guiones>.sslip.io`, un nombre gratuito que resuelve a la IP del VPS, y obtiene un certificado público. Cuando haya dominio, basta cambiar `DOMINIO`.
- **Recursos compartidos:** cada servicio tiene un límite de memoria en `compose.prod.yaml` y la imagen se puede construir en otra máquina para `linux/amd64` y copiarse al VPS (`docs/operacion.md`).
- **Puertos 80 y 443:** si el punto de venta ya los usa, la aplicación se publica detrás de su proxy por nombre (`docs/operacion.md`, §9).

### Supuesto de operación: "efímero"

Los contenedores son reemplazables: se pueden destruir y recrear en cualquier máquina con Docker sin perder nada. Los datos (cartera, usuarios, bitácora, planes) **no** son efímeros: viven en un volumen de Postgres y se respaldan y restauran con `pg_dump` y `pg_restore`. Mover el sistema a otra máquina es clonar el repositorio, crear el archivo de variables y restaurar el último respaldo. Desarrollo y pruebas usan bases desechables.

## 3. Decisión: base propia y reutilización

### Productos evaluados como base (consulta del 2026-10-07, revisada el 2026-10-13)

| Candidato | Licencia | Qué ofrece | Decisión |
|---|---|---|---|
| [Atomic CRM](https://github.com/marmelab/atomic-crm) | MIT | CRM de ventas: contactos, empresas, negocios, tareas. React, shadcn/ui, Supabase | No como base: sus entidades no modelan ventanas, documentos, unidades, solicitudes ni rutas, y sus pantallas dependen de su entorno de administración y de Supabase. Se pueden copiar patrones o piezas de presentación autocontenidas, conservando el aviso MIT. |
| [Twenty](https://github.com/twentyhq/twenty) | AGPL-3.0 y módulos comerciales; el paquete `twenty-ui` tiene licencia MIT propia | CRM tipo Salesforce; `twenty-ui` es una biblioteca React con Base UI y temas propios | No como base. `twenty-ui` solo si un componente concreto ahorra trabajo medible, tras probar SSR, hidratación, accesibilidad y tamaño; no se mezcla un segundo sistema visual completo con shadcn/ui. |
| [Fleetbase](https://github.com/fleetbase/fleetbase) | AGPL-3.0, doble licencia | Plataforma de logística en PHP y Ember; su SDK de JavaScript es cliente de esa plataforma y también es AGPL | No se incorpora: no es un motor ni un componente reutilizable en Next.js. Sirve como referencia de flujos operativos. Usa OSRM para rutas; si la Fase 2 necesita tiempos de calle reales, se usará OSRM directamente en un contenedor. |
| Solvers: VROOM, OR-Tools, PyVRP, Timefold | BSD, Apache-2.0, MIT, Apache-2.0 | Optimización de rutas con ventanas de tiempo | Alternativa A4 del DI; se reserva para la Fase 2 detrás del mismo contrato del motor. |

Sobre AGPL: no impide comercializar, pero quien ofrece por red una versión modificada debe poner su código fuente a disposición de esos usuarios. La obligación depende de lo que efectivamente se incorpore; separar contenedores no la elimina por sí solo.

**Decisión:** desarrollo propio sobre un stack estándar, reutilizando librerías abiertas. Coincide con la alternativa A3 que eligió el DI (Tabla 14): una regla de asignación propia y explicable. Un código propio y pequeño se puede auditar completo.

### Librerías que sí se usan

shadcn/ui (componentes), MapLibre GL JS (mapa), Papa Parse (CSV), Zod (validación), Drizzle ORM (datos), Better Auth (autenticación) y, en el Plan 3, fast-check (pruebas de propiedades del motor). React Hook Form queda como opción si los formularios crecen; el del Plan 1 no lo necesita.

## 4. Stack y operación en contenedores

| Capa | Elección | Por qué |
|---|---|---|
| Aplicación | Next.js 16.4 (App Router) + TypeScript; `output: "standalone"`; Cache Components activado explícitamente (`cacheComponents: true`) | Una base de código para los tres roles; la imagen de producción incluye solo lo necesario |
| Interfaz | Tailwind CSS 4 + shadcn/ui; fuentes locales con el paquete `geist` | El build no depende de Google Fonts ni de Internet |
| Base de datos | Postgres 17 en contenedor | Sin cuentas externas |
| Acceso a datos | Drizzle ORM y migraciones SQL versionadas | Esquema en TypeScript, SQL revisable |
| Autenticación | Better Auth 1.7 con su adaptador de Drizzle, sobre el mismo Postgres; solo correo y contraseña; registro público cerrado | Librería dentro de la aplicación, sin servicio extra. Auth.js pasó al mantenimiento del equipo de Better Auth en septiembre de 2025, que recomienda Better Auth para proyectos nuevos |
| Mapa | MapLibre con un estilo cuya URL es configurable en el servidor (por omisión, OpenFreeMap) | Si se exige operar sin Internet, se sirven estilos y teselas locales |
| Pruebas | Vitest (unidad e integración), PGlite para pruebas rápidas, Postgres real para integración, Playwright para punta a punta | — |
| Entrada HTTP en producción | Caddy como proxy inverso con HTTPS | Los teléfonos de los operadores necesitan HTTPS |

### Servicios de Compose

| Servicio | Archivos | Qué hace |
|---|---|---|
| `db` | base | Postgres 17. Al crear el volumen ejecuta el script que crea los dos roles (§10) |
| `app` | dev | Servidor de desarrollo con el código montado; `node_modules` y `.next` en volúmenes propios del proyecto |
| `migrate` | base | Trabajo de una sola ejecución: aplica migraciones con el rol migrador y vuelve a aplicar permisos |
| `bootstrap` | base | Trabajo idempotente que crea el primer administrador |
| `unit` | test | Vitest de dominio, motor e indicadores |
| `integration` | test | Vitest contra un Postgres de prueba desechable |
| `e2e` | test | Playwright, con imagen de la misma versión que `@playwright/test`, contra la imagen de producción |
| `web` | prod | Imagen `runner` (`node server.js`, usuario sin privilegios) |
| `proxy` | prod | Caddy con HTTPS |
| `respaldo` | base, perfil `respaldo` | `pg_dump` y `pg_restore` a una carpeta montada |

Dockerfile multietapa: `deps` (Node 24 con `npm ci`), `dev`, `build` (`next build`) y `runner` (`.next/standalone`, `.next/static`, `public`). `migrate`, `bootstrap`, `unit` e `integration` usan la etapa `dev`, que trae las herramientas.

Reglas:

- Cada comando oficial se expresa con `docker compose`; nada requiere Node instalado en el anfitrión.
- Versiones fijadas: imágenes por etiqueta exacta, dependencias por `package-lock.json`. Ningún `@latest` en el procedimiento.
- Sin `container_name` fijo: cada worktree y cada corrida de pruebas usa su propio nombre de proyecto de Compose, y por tanto sus propios volúmenes y red.
- Secretos solo en el archivo `.env` (no versionado) y en variables del entorno; `.env.example` documenta cada variable sin valores reales. Nada de secretos en capas de imagen ni en variables `NEXT_PUBLIC_*`.

## 5. Arquitectura

```
navegador ──▶ proxy (Caddy, solo producción) ──▶ Next.js
                                                 │
   src/app (pantallas por rol) ──lecturas──▶ src/consultas ─┐
            └──────────mutaciones─────────▶ src/acciones ──┤ autorizan con src/seguridad
                                                            ▼
                         src/dominio (reglas puras) ◀── usan ── consultas y acciones
                         src/datos (persistencia, recibe la transacción) ──▶ Postgres
                         src/motor, src/indicadores (puros; Planes 3 y 6)
```

| Capa | Hace | No hace |
|---|---|---|
| `src/dominio` | Tipos, validaciones, completitud, habilitación, lectura de CSV | Acceso a datos, red, reloj o azar sin sembrar |
| `src/datos` | Esquema, migraciones, consultas y escrituras SQL; recibe `BD` o `Tx` y nunca abre ni confirma una transacción por su cuenta | Reglas de negocio, autorización |
| `src/seguridad` | Better Auth, sesión, usuario de la aplicación, matriz de permisos | Reglas de negocio |
| `src/consultas` | Lecturas para las pantallas: autorizan y componen datos con reglas de dominio | Escribir |
| `src/acciones` | Casos de uso: autorizan, validan con Zod, abren **una** transacción que incluye la escritura y su renglón de bitácora | Presentación |
| `src/app` | Pantallas; solo llaman consultas y acciones | Acceso directo a `src/datos` |
| `src/motor`, `src/indicadores` | Funciones puras deterministas | Leer la base o la red |

`src/consultas`, `src/seguridad/sesion.ts` y la conexión real llevan `import "server-only"`. Los scripts y las pruebas no importan esos módulos.

### Flujo principal del día

1. El despachador registra las solicitudes conforme llegan.
2. Operador y unidad hacen check-in; el despachador marca las unidades no disponibles.
3. "Generar plan": la acción toma una instantánea de la entrada, llama al motor y guarda un plan `propuesto`.
4. El despachador revisa en lista y mapa, ajusta y valida. La validación vuelve a comprobar elegibilidad, disponibilidad y versión dentro de una transacción.
5. El operador ve su ruta en el teléfono y registra eventos.
6. Ante un incidente, el despachador pide una nueva propuesta para las paradas pendientes.
7. La gerencia consulta el panel.

## 6. Modelo de datos

Reglas generales: `id` uuid; `creado_en` y `actualizado_en` en las tablas mutables; fechas calendario en `date`, horarios recurrentes en `time`, instantes en `timestamptz`; la fecha de operación se calcula en `America/Mexico_City` dentro del código, no con la variable `TZ`.

### Etapa 1 (Plan 1)

**Better Auth** — `user`, `session`, `account`, `verification`, generadas por su CLI. Solo autentican.

**`usuarios`** — `auth_user_id` (único, referencia a `user.id`), `nombre`, `rol` (`admin` | `despachador` | `operador` | `gerencia`), `activo`. Única fuente de autorización; el navegador nunca elige rol. `operador_id` se agrega en el Plan 2.

**`clientes`** — `nombre`, `contacto_nombre`, `contacto_telefono`, `direccion`, `lat`, `lng`, `tipo_residuo` (`RSU` | `RME` | `RP`), `material`, `tipos_unidad_admitidos`, `notas_acceso`, `tiempo_servicio_min` (66 por omisión, entre 5 y 480), `carga_estimada_kg`, `activo`, `version` (entero, empieza en 1 y sube en cada actualización).

**`ventanas_cliente`** — `cliente_id`, `dia_semana` (0 a 6), `hora_inicio`, `hora_fin`, con `CHECK (hora_inicio < hora_fin)`.

**`documentos_cliente`** — `cliente_id`, `nombre`, `obligatorio`, `estado` (`vigente` | `pendiente` | `vencido`), `vence_el` (`date`, opcional).

**`avisos_privacidad`** — una fila por versión del aviso: `version` (llave), `descripcion`, `huella_sha256` del texto publicado (opcional mientras la empresa no entregue el texto), `publicado_en`. Conserva qué decía cada versión.

**`aceptaciones_privacidad`** — solo inserción: `secuencia` (identidad, orden total), `cliente_id`, `version_aviso` (referencia a `avisos_privacidad`), `accion` (`aceptado` | `retirado`), `medio` (`papel` | `correo` | `verbal` | `otro`), `registrado_por`, `en`. El estado vigente es el renglón de mayor `secuencia` del cliente. Registrar un movimiento exige la versión del aviso que vio el despachador y el identificador del último movimiento que vio; si cualquiera cambió, la acción responde `conflicto`.

**`importaciones`** — una fila por importación confirmada: `id` (lo genera la pantalla; hace idempotente el reintento), `usuario_id`, `huella` del análisis confirmado, `importados`, `en`.

**`configuracion`** — una sola fila: `id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1)`; `patio_lat`, `patio_lng`, `turno_inicio` (08:00), `turno_fin` (16:00), `velocidad_kmh` (> 0), `factor_circuidad` (≥ 1), `descarga_min` (≥ 0), `version_aviso_privacidad` (referencia a `avisos_privacidad`), `linea_base` (espera 15, traslado 45, ciclo 161; el Plan 6 agrega la línea base de K2 con su fecha y tamaño de muestra).

Cambiar `version_aviso_privacidad` deja sin aviso vigente a todo cliente que aceptó una versión anterior: su ficha queda incompleta (K5) y no se pueden programar sus recolecciones hasta que acepte la nueva. La regla es configurable, pero usarla en operación requiere la confirmación del dueño (§14, decisión 6).

**`bitacora`** — solo inserción (el rol de la aplicación solo tiene INSERT y SELECT): `en`, `usuario_id`, `entidad`, `entidad_id`, `accion`, `campos` (nombres de los campos que cambiaron; nunca sus valores personales).

**Regla de completitud (K5):** un cliente está completo si tiene ubicación, al menos una ventana, tipo de residuo, tipos de unidad admitidos y aviso de privacidad aceptado vigente.

### Etapa 2 (Planes 2 a 5) — contrato de captura

Los campos que alimentan los indicadores se definen desde ahora, porque los datos que no se capturen no se recuperan después.

- **`unidades`**, **`operadores`** — como en la revisión 1; `operadores` tendrá su propio aviso de privacidad.
- **`jornadas`** — `fecha`, `unidad_id`, `operador_id`, `check_in_en`, `disponible_desde`, `check_out_en`.
- **`solicitudes`** — `folio` único, `cliente_id`, `registrada_en` (inmutable, llave FIFO), `fecha_solicitada`, `proxima_fecha_elegible`, `canal`, `carga_estimada_kg`, `estado`, `motivos`, `captura_inicio_en`, `captura_fin_en` (K2).
- **`ejecuciones_motor`** — toda corrida, incluso fallida: `inicio_en`, `fin_en`, `duracion_ms` (reloj monotónico, fuera del motor), `resultado` (`ok` | `error` | `tiempo_agotado`), `plan_id` (K7).
- **`planes`** — `fecha`, `estado`, `version`, `generado_en`, `revision_iniciada_en`, `validado_en`, `validado_por`, `entrada` (instantánea versionada de solicitudes, restricciones, unidades y parámetros), `version_motor` (K6).
- **`rutas`** — `plan_id`, `jornada_id`, `numero_viaje`, `version`, `disponible_para_salir_en`, `asignada_en`, `salida_patio_en`, `regreso_patio_en`, `descarga_fin_en`, `odometro_inicio_km`, `odometro_fin_km`, `rendimiento_km_l_usado`, `km_contrafactual` (K1, K4).
- **`paradas`** — `ruta_id`, `solicitud_id`, `secuencia` (única por ruta), `ventana_inicio` y `ventana_fin` comprometidas, `llegada_estimada`, `llegada_en`, `inicio_servicio_en`, `fin_servicio_en`, `estado` (K1, K3).
- **`eventos_operador`** — `evento_id` único generado en el teléfono (idempotencia), `ruta_id`, `parada_id`, `tipo`, `ocurrido_en`, `recibido_en`, `version_ruta`.
- **`incidentes`** — como en la revisión 1.

Una solicitud tiene a lo sumo una asignación operativa vigente, garantizada por un índice único parcial; las propuestas descartadas se conservan como historial. Una jornada no puede quedar en dos planes validados para la misma fecha.

## 7. Reglas de negocio

1. **Canal único.** Toda recolección nace como solicitud con folio.
2. **Hora de registro inmutable**; es la base del orden FIFO.
3. **Completitud y habilitación son cosas distintas.** `faltantesDeCliente` dice qué le falta a la ficha; `motivosDeBloqueo` dice por qué no se puede programar una recolección en una fecha. Se bloquea si: el cliente está inactivo; el tipo de residuo es `RP` o no está definido; un documento obligatorio no está vigente en la fecha de servicio (un documento "vigente" con fecha vencida cuenta como vencido); no hay aviso de privacidad aceptado; no hay ventana ese día; no hay ubicación; falta un documento que el catálogo de documentos requeridos (Plan 2, decisión 6) exige y nunca se capturó.

   No tener hoy una unidad disponible de un tipo admitido no bloquea: la solicitud se **pospone** con ese motivo, porque depende de la flota del día y no de los datos del cliente.
4. **FIFO global de admisión.** Las solicitudes elegibles se procesan por `registrada_en` y folio. Cada una se intenta insertar de forma factible en cualquier unidad compatible, sin mover a las ya admitidas. Una solicitud admitida nunca se desplaza por otra más reciente. Si una solicitud antigua no cabe junto con las que se admitieron antes que ella, se pospone con su motivo y el proceso continúa con las más recientes, que pueden caber (por ejemplo, por ser más pequeñas o estar en otra zona). Una carga mayor que la capacidad de cualquier unidad del catálogo es inviabilidad física: la solicitud se bloquea con ese motivo. La pospuesta conserva su hora de registro y pasa al frente de la cola del siguiente día de operación; con dos o más días de operación pospuesta se marca atrasada para que decida el despachador (§14, decisión 3).
5. **Sin pérdida de prioridad.** Una solicitud pospuesta conserva su hora de registro y su `proxima_fecha_elegible` avanza al siguiente día de operación, donde vuelve a estar al frente de la cola. Esto no garantiza que se atienda (una solicitud que nunca cabe se seguirá posponiendo); por eso se marca atrasada (decisión 3) para que decida el despachador.
6. **El despachador decide.** El motor propone; nada llega al operador sin validación. Validar es una transacción que bloquea el plan y las jornadas que usa, comprueba su `version` y vuelve a verificar elegibilidad, disponibilidad y capacidad, y que ninguna de sus solicitudes tenga ya una asignación vigente por otro plan; si algo cambió, la validación se rechaza con el motivo. Prueba obligatoria: dos planes distintos con solicitudes en común validados al mismo tiempo; uno gana y el otro recibe el motivo.
7. **Una unidad no disponible no recibe ruta.**
8. **Ediciones concurrentes.** Guardar un cliente exige la `version` que se leyó; si cambió, se responde `conflicto` y nada se escribe.

## 8. Motor de ruteo (Plan 3)

### Contrato

```ts
generarPlan(entrada: EntradaPlan): Plan
```

`EntradaPlan`: fecha, instante de planificación, solicitudes candidatas con los datos de su cliente, unidades con su ubicación, hora y carga al quedar libres (en el re-ruteo ya descuentan lo congelado), configuración y semilla. El contrato completo está en el Plan 3.

`Plan`: rutas (unidad, viaje, paradas en orden con llegada estimada y espera), solicitudes pospuestas y bloqueadas con su motivo, y resumen con la comparación contra el método actual.

Propiedades obligatorias, verificadas con fast-check:

- Misma entrada y misma semilla producen exactamente el mismo plan.
- Toda solicitud termina en una sola categoría: ruteada, bloqueada o pospuesta, con motivo.
- Ninguna ruta excede capacidad por viaje, fin de turno (incluido regreso y descarga) ni ventanas.
- Si una solicitud A quedó pospuesta y una B más reciente quedó ruteada, entonces A no tenía ninguna inserción factible en el plan formado solo por las solicitudes admitidas antes que A. La validación final lo comprueba reintentando A sobre ese plan; casos de prueba: dos zonas con antigüedades cruzadas, y una antigua grande con recientes pequeñas.
- Una validación final independiente del algoritmo comprueba todo lo anterior antes de devolver el plan.

### Algoritmo (versión 1)

1. **Elegibilidad** con `motivosDeBloqueo`.
2. **Orden FIFO** por `registrada_en` y folio; desempates estables por id.
3. **Zonas iniciales:** k-means++ con semilla sobre coordenadas proyectadas a kilómetros, con k = mínimo entre unidades disponibles y solicitudes, a lo sumo 100 iteraciones. Puntos idénticos y grupos vacíos se resuelven reasignando el punto más lejano a la zona vacía. Las zonas solo ordenan qué unidad se prueba primero para cada solicitud.
4. **Admisión FIFO con inserción factible:** cada solicitud, en orden, se inserta en la posición de menor costo entre todas las rutas compatibles (primero las de su zona), respetando ventana, capacidad por viaje, servicio, espera, regreso, descarga y fin de turno. Si no cabe en ninguna, se abre un nuevo viaje en la unidad con holgura; si tampoco, se pospone con motivo.
5. **Comparación** contra el método actual (un viaje redondo por cliente) para las mismas solicitudes ruteadas; se reporta como ahorro **simulado**, separado del ahorro observado en el piloto.

Casos límite con salida definida: sin unidades, todo se pospone con motivo "sin unidades disponibles"; ninguna unidad disponible hoy de un tipo admitido por el cliente, se pospone con motivo "sin unidad compatible disponible"; carga mayor que toda capacidad del catálogo, se bloquea por inviabilidad física.

Modelo de traslado: `km = haversine × factor_circuidad`; `min = km ÷ velocidad_kmh × 60`. Es un parámetro del motor; OSRM en contenedor puede sustituirlo en la Fase 2.

### Re-ruteo

Es `generarPlan` con restricciones (Plan 5, §4). No toca lo completado, lo no atendido ni la parada en sitio, y el viaje en curso de cada unidad disponible se congela completo (incluye el tramo comprometido): la unidad vuelve a entrar al motor en el patio, sin carga, al terminar ese viaje. Los viajes futuros de las unidades disponibles se conservan en su unidad y en su orden como `admitidas` (pueden recibir inserciones). Se reubican en orden FIFO las pendientes de las jornadas que dejan de estar disponibles y las solicitudes listas nuevas del día.

### Por qué se le llama inteligencia artificial

El paso 3 es agrupamiento no supervisado: las zonas se forman cada día con las solicitudes reales. La optimización completa (VRPTW) queda para la Fase 2 detrás del mismo contrato.

## 9. Pantallas

| Rol | Pantalla | Qué permite |
|---|---|---|
| Despachador | Clientes | Lista con búsqueda; K5 global, independiente de la búsqueda; insignias "completa" y "habilitada hoy" por separado; ficha con ventanas, documentos, aviso de privacidad y pin en mapa; aviso de conflicto si otro despachador guardó antes |
| Gerencia | Clientes (solo lectura) | Las mismas pantallas, sin botones de alta, edición, importación ni registro de privacidad |
| Despachador | Importar clientes | Dos pasos: analizar (vista previa con errores, posibles duplicados y conteos, sin escribir) y confirmar (escribe todo el lote o nada) |
| Despachador | Unidades, operadores, jornada, solicitudes, plan del día | Planes 2 y 4 |
| Operador | Mi ruta (móvil) | Plan 5 |
| Gerencia | Panel | Plan 6 |
| Admin | Usuarios | Alta, cambio de rol, desactivación con revocación de sesiones, restablecimiento de contraseña (Plan 2). En el Plan 1 lo mismo se hace con scripts auditados dentro del contenedor: `bootstrap`, `alta-usuario`, `desactivar-usuario` y `restablecer-clave` |

## 10. Seguridad y privacidad

### Autenticación

- Better Auth con correo y contraseña (mínimo 10 caracteres). `disableSignUp: true`: el registro público responde 400 (comprobado el 2026-10-13).
- No se usa el plugin de administración de Better Auth: tiene roles y rutas propios que duplicarían la autorización.
- Las altas no usan el adaptador de la librería, que está ligado a su propia conexión y no participaría en nuestra transacción. Un solo módulo, `src/seguridad/identidades.ts`, escribe con Drizzle y **en una sola transacción** la identidad (`user`), la credencial (`account` con proveedor `credential` y la contraseña calculada con `hashPassword` de `better-auth/crypto`), el renglón de `usuarios` y su bitácora. Si algo falla, no queda nada. Comprobado en contenedor el 2026-10-13: un usuario creado así entra con la API de Better Auth. El módulo depende de la versión fijada 1.7.7; actualizar Better Auth exige repetir esa prueba.
- Un `databaseHook` de Better Auth (`session.create.before`) impide crear sesión si el usuario no tiene renglón en `usuarios` o está inactivo (comprobado el 2026-10-13: responde 401).
- Better Auth verifica la contraseña y guarda la sesión en pasos separados. Para que una baja o un restablecimiento que caiga entre ambos no deje viva una sesión, `usuarios.generacion` sube con cada baja, reactivación o cambio de contraseña; toda petición HTTP a Better Auth pasa por `manejar` (en `auth-base.ts`), que lee la generación del correo antes de la verificación, y la sesión se revisa contra ella antes de guardarse (se niega) y después (se borra). Probado con pausas que fuerzan esos cruces (2026-10-14).
- Desactivar un usuario pone `activo = false` y borra sus sesiones en la misma transacción, con su bitácora. Reactivarlo no revive sesiones. Cada petición protegida vuelve a leer `usuarios`, así que un cambio de rol surte efecto de inmediato.
- Recuperación de acceso sin correo: el administrador restablece la contraseña (script en el Plan 1, pantalla en el Plan 2), lo que borra las sesiones del usuario y queda en la bitácora.
- `bootstrap` es idempotente: si el correo ya pertenece a un administrador, no hace nada (ni cambia su contraseña); si pertenece a una identidad con otro rol o sin renglón en `usuarios`, termina con error y no la promueve; si no existe, crea el administrador con la transacción anterior.

### Autorización: matriz de permisos

| Operación | admin | despachador | operador | gerencia |
|---|---|---|---|---|
| Ver y editar clientes, importar | sí | sí | no | no |
| Ver clientes (solo lectura) | sí | sí | no | sí |
| Gestionar usuarios | sí | no | no | no |
| Unidades, solicitudes, planes (Planes 2 y 4) | sí | sí | no | lectura |
| Su propia ruta y sus eventos (Plan 5) | intervención registrada | lectura | sí, solo si la jornada es suya | lectura |
| Panel (Plan 6) | sí | sí | no | sí |

Toda acción de `admin` sobre datos de operación queda en la bitácora como intervención.

### Base de datos

Dos roles creados por el script de inicio de `db`: `rs_migrador`, dueño del esquema, que usa `migrate`; y `rs_app`, que usa la aplicación con permisos mínimos y sin UPDATE ni DELETE sobre `bitacora`, `aceptaciones_privacidad` ni `importaciones`. Se revoca `CREATE` sobre `public` a `PUBLIC`. Las llaves foráneas hacia el historial no borran en cascada. Los permisos se vuelven a aplicar después de cada migración y de cada restauración, y la aplicación solo arranca cuando `migrate` terminó bien. El migrador toma un candado de Postgres para que dos ejecuciones no se crucen, y compara la huella de cada migración aplicada con la del archivo. Solo el entorno de pruebas tiene un superusuario, con el que crea y borra sus bases desechables. El migrador comprueba que lo aplicado sea el principio exacto de las migraciones del repositorio **antes** de aplicar nada. Altas, ediciones e importaciones de clientes comparten un candado de nombres, para que una importación que ya revisó sus duplicados no se cruce con un cliente nuevo o renombrado. La restauración de respaldos es atómica (`scripts/restaurar.sh`).

### Privacidad (LFPDPPP)

- Datos personales mínimos: nombre y teléfono de contacto.
- Historial de aceptación del aviso en `aceptaciones_privacidad`; retirar la aceptación no borra el historial.
- La bitácora registra qué campos cambiaron, no sus valores.
- En el piloto no se captura la ubicación del operador: los indicadores salen de horas y odómetros (minimización; Plan 5, §4). Si se agregara, sería solo en los eventos que él marque y con su propio aviso de privacidad.
- El repositorio solo contiene datos sintéticos.
- Retención: la bitácora y el historial de privacidad se conservan mientras dure el piloto; el plazo posterior y el borrado o anonimización los decide el dueño (§14, decisión 10).

## 11. Indicadores

Cada indicador será una función pura en `src/indicadores` (Plan 6) con su prueba; los datos que necesita ya están en el contrato de captura de §6.

| # | Definición |
|---|---|
| K1 | Por recolección: espera = (`asignada_en − disponible_para_salir_en` de la ruta, 0 si se asignó antes) dividida entre las recolecciones del viaje; traslado = `llegada_en` de la parada menos `fin_servicio_en` de la parada anterior del viaje, o menos `salida_patio_en` si es la primera. Se reporta la media por recolección y el tamaño de la muestra. |
| K2 | Mediana de `captura_fin_en − captura_inicio_en` de las solicitudes, contra una línea base cronometrada con el mismo inicio y fin, guardada en `configuracion.linea_base` con su fecha y tamaño de muestra. |
| K3 | Paradas cuyo **inicio de servicio** cae dentro de la ventana comprometida (llegar antes y esperar cuenta como cumplida), entre paradas programadas; se reportan aparte las omitidas y las no atendidas. |
| K4 | Km reales por odómetro contra el contrafactual guardado en la ruta para las mismas solicitudes atendidas; litros estimados con el rendimiento guardado en la ruta. El ahorro simulado se reporta por separado del observado. |
| K5 | Clientes activos completos entre clientes activos, calculado sobre toda la cartera. Para ver su evolución, el Plan 6 guarda una instantánea diaria (fecha, activos, completos). |
| K6 | Demora total `validado_en − generado_en` y trabajo activo `validado_en − revision_iniciada_en`; la meta de 5 min se compara con el trabajo activo. |
| K7 | `duracion_ms` de cada ejecución del motor, incluidas las fallidas. |
| Ciclo | Por recolección: espera prorrateada + traslado + servicio (`fin_servicio_en − llegada_en`) + (regreso al patio y descarga del viaje) ÷ recolecciones del viaje. Es comparable con los 161 min de la línea base (15 + 45 + 66 + 35). Se exporta con el tamaño de muestra para las cartas X̄-R. |

## 12. Pruebas

| Nivel | Dónde corre | Qué cubre |
|---|---|---|
| Unidad | Servicio `unit` | Dominio, motor (con fast-check) e indicadores |
| Integración rápida | Servicio `unit`, con PGlite | Repositorios y casos de uso |
| Integración real | Servicio `integration`, con Postgres desechable | Migración desde base vacía y, desde el Plan 2, desde la versión anterior con datos; migración repetida; roles y permisos; transacciones con rollback; conflictos de versión; concurrencia |
| Punta a punta | Servicio `e2e` contra la imagen de producción | Flujos completos con usuarios y datos sintéticos exclusivos |

Casos obligatorios del Plan 1: rollback completo cuando falla la bitácora (clientes y altas de usuario); conflicto de versión del cliente y del aviso de privacidad; importación sin sesión, con gerencia, con usuario inactivo, con entrada que no es texto, con archivo dañado, con duplicados que cambiaron después del análisis y con reintento de la misma operación; acceso directo a cada acción y consulta por rol; registro público cerrado; cookie falsificada o caducada; usuario desactivado sin acceso y sin poder volver a entrar; reactivación sin sesiones anteriores.

## 13. Riesgos y supuestos

| Riesgo o supuesto | Mitigación |
|---|---|
| La cartera real no tiene coordenadas | Captura con pin en mapa; K5 lo vigila |
| Tiempos de traslado estimados alejados de la realidad | Parámetros configurables y calibración con el piloto |
| Poca señal en campo | Ruta guardada en el teléfono y eventos idempotentes con reintento (Plan 5) |
| El despachador no adopta el canal único | Alta de solicitud rápida; él valida todo |
| Pérdida de datos en la máquina del piloto | Respaldo diario con el servicio `respaldo` y prueba de restauración |
| Dependencia de OpenFreeMap | URL de estilo configurable; teselas locales si se exige operar sin Internet |
| Se asume un viaje redondo por cliente en el método actual | Confirmar con la empresa (decisión abierta 6) |

## 14. Decisiones del dueño del proyecto

Actualizado el 2026-10-14 con lo que respondió el dueño. "Dueño" indica que la tomó él. "Claude y Codex" indica que el dueño la delegó: Claude la propuso y se ajustó en la revisión con Codex del 2026-10-14.

| # | Tema | Decisión | Quién | Estado |
|---|---|---|---|---|
| 1 | Calendario y destino | VPS de Hostinger **compartido con un punto de venta**, sin dominio por ahora. HTTPS con un nombre gratuito que apunta a la IP del VPS (`<ip-con-guiones>.sslip.io`) y certificado público de Let's Encrypt emitido por Caddy, sin instalar nada en los teléfonos. Límites de memoria en Compose para no afectar al punto de venta. La fecha límite real sigue abierta | Dueño (destino); Claude y Codex (HTTPS) | Condicionada a comprobar en el VPS: puertos 80 y 443, proxy existente, memoria y emisión y renovación del certificado (`docs/operacion.md`, §9) |
| 2 | Turno | 480 min, confirmado por el dueño, incluidos el regreso al patio y la descarga. El horario 08:00 a 16:00 es una propuesta configurable (`configuracion.turno_inicio` y `turno_fin`). Los descansos no se modelan en el piloto | Dueño (duración); Claude y Codex (horario) | Resuelta |
| 3 | FIFO cuando una solicitud antigua no cabe | El motor atiende a las más recientes que sí caben. La antigua **conserva su lugar en la fila**: pasa al siguiente día de operación como la primera en la cola, y el despachador la ve pospuesta con su motivo y su diagnóstico. Si su fecha solicitada quedó dos o más días de operación atrás, se marca **atrasada** para que el despachador decida (por ejemplo, un viaje extra u otra unidad). Las veces que se pospuso se guardan aparte | Claude y Codex | Resuelta |
| 4 | Ventanas | La ventana limita el **inicio del servicio**: la unidad puede llegar antes y esperar a que abra, y el servicio puede terminar después del fin. K3 se mide igual | Claude y Codex | Resuelta |
| 5 | Capacidad | Límite por **peso** (kg) de cada unidad. Si una solicitud no trae carga estimada, se usa la del cliente y, si tampoco hay, `configuracion.carga_por_omision_kg` (1000 kg, estimación visible para calibrar en el piloto). Una carga mayor que la capacidad de todas las unidades de los tipos que admite el cliente queda bloqueada | Claude y Codex | Resuelta |
| 6 | Documentos y privacidad | Catálogo de documentos en `docs/catalogo-de-documentos.md`; cada unidad u operador puede ajustar qué documentos le aplican. Aviso de privacidad en `docs/legal/`, sin finalidades secundarias en el piloto. Para los contactos de clientes, el tratamiento se basa en consentimiento tácito; si lo revocan, el cliente queda bloqueado hasta que designe otro contacto. Cada publicación del aviso es una versión nueva e invalida la aceptación de las anteriores | Dueño (pidió el aviso); Claude y Codex (contenido) | Resuelta, con revisión legal pendiente |
| 7 | Indicadores | K2 mide desde que se abre el alta de solicitud hasta que se guarda. Combustible estimado con el rendimiento de cada unidad. Se supone que hoy se hace un viaje por cliente. Ambos supuestos se confirman con la empresa durante el piloto | Claude y Codex | Resuelta como supuesto |
| 8 | Identidades | El dueño es el primer administrador. Los operadores entran con un correo interno que asigna el administrador (por ejemplo, `jperez@operadores.local`) y una contraseña que el administrador restablece si la olvidan | Claude y Codex | Resuelta |
| 9 | Operación sin señal | La ruta del día queda guardada en el teléfono. Los eventos se guardan en cola y se envían al recuperar la señal, hasta 24 h después. Si mientras tanto la ruta cambió, el servidor no aplica los eventos de paradas que ya no le tocan, pero los **guarda como rechazados** para que el despachador los concilie; el teléfono pide llamar al despachador | Claude y Codex | Resuelta |
| 10 | Retención | Matriz propuesta por finalidad en `docs/legal/README.md` (inicio del cómputo, bloqueo, supresión y respaldos). Necesita asesoría legal antes de publicarse | Claude y Codex | Propuesta para confirmar |
| 11 | HTTPS en red local | Ya no aplica: el sistema corre en un VPS público (decisión 1). `tls internal` queda solo como alternativa | Claude y Codex | Resuelta |

## 15. Colaboración Claude–Codex

| Responsable | Carpetas |
|---|---|
| Claude | Archivos raíz, `package*.json`, Docker, `infra/`, `src/datos`, `drizzle/`, `src/seguridad`, `src/acciones`, `src/consultas`, rutas de autenticación y `src/app/layout.tsx`, scripts y CI |
| Codex | `src/dominio`, `src/app/despacho`, `src/components` (salvo lo que genere el andamiaje), pruebas de punta a punta funcionales; en el Plan 3, `src/motor` |

- Contratos primero: tipos, `Resultado`, `Contexto` y firmas de consultas y acciones se integran antes de trabajar en paralelo.
- Ramas cortas en worktrees separados; un solo responsable modifica el esquema, genera migraciones y resuelve el lockfile.
- Cada entrega trae su commit, sus pruebas y la evidencia de ejecución en contenedores. Codex no tiene acceso al socket de Docker: prepara y revisa pruebas; Claude las ejecuta en contenedores y entrega la evidencia.
- Validación cruzada: Codex revisa transacciones, permisos, migraciones y Docker; Claude revisa dominio y pantallas y corre sus pruebas. La aceptación final es sobre el mismo commit integrado.

## 16. Trazabilidad con el Documento Integrador

| Elemento del DI | Dónde se cumple |
|---|---|
| §1 Alcance en dos etapas | §2 |
| §1 Indicadores; Tabla 8 | §1, §6 (captura) y §11 |
| Tabla 1, simulación, cartas X̄-R y panel | §8 y §11 |
| Tabla 6, roles | §9 y §10 |
| Tabla 9, seis módulos | §2 |
| Tabla 10, requerimientos por etapa | §7, §10 |
| §6, cuatro pasos del motor | §8 |
| Tabla 14, alternativa A3 | §3 |
| Mi ruta del operador, eventos e incidentes (Tabla 6, rol operador) | Plan 5: `/operador`, `src/dominio/operacion`, `src/acciones/operador.nucleo.ts` |
| Re-ruteo ante incidente (§6 del DI, paso 4 del motor) | §8 Re-ruteo; Plan 5 §4 |
| Cartas X̄-R y panel (Tabla 1) | Plan 6: `/gerencia/panel`, `src/indicadores`, CSV en `/api/indicadores/csv` |
