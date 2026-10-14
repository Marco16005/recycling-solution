# Plan 2 — Flota, solicitudes y administración

- **Fecha:** 2026-10-14.
- **Especificación:** revisión 2, con las decisiones del dueño de §14 (actualizadas el 2026-10-14).
- **Base:** `main` en `0443d0d` (Plan 1 cerrado).
- **Ejecutan:** Claude y Codex. Codex desarrolla el Plan 3 (motor) en paralelo desde el inicio, contra los contratos de `2026-10-14-plan-3-motor-de-ruteo.md`.

## 1. Objetivo y aceptación

Al terminar:

1. El despachador da de alta unidades (placa, tipo, capacidad en kg, rendimiento) y operadores, con sus documentos y vigencias. Una unidad o un operador con un documento obligatorio vencido o faltante aparece **no disponible** y explica por qué.
2. Cada mañana el despachador arma la **jornada**: qué unidad sale con qué operador y desde qué hora está disponible. No puede usar una unidad u operador no disponible ni repetirlos el mismo día.
3. El despachador registra **solicitudes** en segundos: busca el cliente, confirma fecha y carga, y guarda. Cada solicitud recibe un folio, guarda su hora de registro (que no se puede editar) y mide el tiempo de captura (K2).
4. La **cola del día** muestra las solicitudes en orden FIFO:
   - las **bloqueadas**, con su motivo (datos del cliente);
   - las **pospuestas** de días anteriores, al frente, marcadas como atrasadas a partir de dos días hábiles;
   - las listas para planear.
5. Al corregir lo que bloqueaba a un cliente, sus solicitudes vuelven a la cola con su hora original.
6. El administrador gestiona usuarios desde la pantalla: alta, cambio de rol, desactivación, reactivación y restablecimiento de contraseña. Puede ligar un usuario operador a su ficha de operador.
7. El administrador edita la configuración: ubicación del patio en el mapa, turno, velocidad, circuidad, descarga, carga por omisión y días de operación.
8. `/aviso-de-privacidad` muestra, sin iniciar sesión, la versión vigente del aviso integral con los datos de la empresa. La pantalla de entrada tiene un enlace a él. Un script publica versiones nuevas con su huella.
9. El catálogo de documentos (`docs/catalogo-de-documentos.md`) viene precargado. Los documentos de cliente se eligen del catálogo o se escriben libres.
10. Producción en el VPS: límites de memoria por servicio, construcción para `linux/amd64` y la ruta sin dominio con `sslip.io`, todo documentado.
11. `scripts/verificar-todo.sh` en verde, con pruebas de unidad, integración y punta a punta de todo lo anterior.

## 2. Modelo de datos (Claude, migración `0003`)

| Tabla | Columnas |
|---|---|
| `tipos_documento` | `id` (texto, p. ej. `licencia_conducir`), `nombre`, `aplica_a` (`cliente` \| `unidad` \| `operador`), `obligatorio_por_omision`, `requiere_vencimiento`, `descripcion`. La migración lo llena con el catálogo |
| `unidades` | `id`, `placa` (única, normalizada), `numero_economico` (único, opcional), `tipo` (`tipo_unidad`), `capacidad_kg` (> 0), `rendimiento_km_l` (> 0), `activo`, `notas`, `version`, marcas |
| `documentos_unidad` | `id`, `unidad_id`, `tipo_documento_id` (de `aplica_a = unidad`), `estado` (`estado_documento`), `vence_el`, `notas`, marcas; único por (`unidad_id`, `tipo_documento_id`) |
| `operadores` | `id`, `nombre`, `telefono`, `activo`, `aviso_version`, `aviso_entregado_en`, `version`, marcas |
| `documentos_operador` | Igual que `documentos_unidad`, con `operador_id` |
| `usuarios` | Nueva columna `operador_id` (opcional, única, referencia a `operadores`). Si el rol es `operador`, es obligatoria (CHECK) |
| `documentos_cliente` | Nueva columna `tipo_documento_id` (opcional; si no la hay, el nombre es libre) |
| `jornadas` | `id`, `fecha` (`date`), `unidad_id`, `operador_id`, `disponible_desde` (`time`), `check_in_en`, `check_out_en`, `notas`, `version`, marcas. Únicas por (`fecha`, `unidad_id`) y por (`fecha`, `operador_id`) |
| `solicitudes` | `id`, `folio` (único, `S-AAAAMMDD-NNN` según la fecha de registro en Ciudad de México), `cliente_id`, `registrada_en` (`timestamptz`, inmutable), `registrada_por`, `fecha_solicitada` (`date`), `proxima_fecha_elegible` (`date`), `canal` (`telefono` \| `whatsapp` \| `correo` \| `presencial` \| `otro`), `carga_estimada_kg` (opcional), `notas`, `estado` (`pendiente` \| `cancelada` \| `atendida` \| `no_atendida`), `motivo_cancelacion`, `veces_pospuesta`, `captura_inicio_en`, `captura_fin_en`, `version`, marcas |
| `configuracion` | Nuevas columnas `carga_por_omision_kg` (1000), `dias_operacion` (`smallint[]`, por omisión `{1,2,3,4,5,6}`, lunes a sábado), `dias_para_atrasada` (2) |
| `avisos_privacidad` | Nueva columna `texto` (el aviso completo de esa versión) |

Reglas de la base:

- Un trigger impide cambiar `solicitudes.registrada_en`, `folio` y `registrada_por`. Así la hora de registro es inmutable aunque haya un error en el código.
- El folio usa una secuencia por día: tabla `folios_dia(fecha, ultimo)` con `INSERT … ON CONFLICT DO UPDATE … RETURNING`.
- Permisos de `rs_app`:
  - UPDATE en `configuracion`;
  - INSERT, sin UPDATE, en `avisos_privacidad`;
  - DELETE solo en las tablas de documentos y en `jornadas`;
  - nunca DELETE en `solicitudes`: se cancelan.

Los estados `programada` y `en_ruta` de las solicitudes los agrega el Plan 4, junto con `planes`, `rutas` y `paradas`.

## 3. Contratos

Se integran en T0 del Plan 2, antes de trabajar en paralelo, con el mismo procedimiento que el Plan 1 (firmas y `throw new Error("pendiente")`).

### 3.1 Dominio — flota (`src/dominio/flota/`, Codex)

```ts
export const TIPOS_DOCUMENTO_APLICA = ["cliente", "unidad", "operador"] as const;
export interface TipoDocumento { id: string; nombre: string; aplicaA: "cliente" | "unidad" | "operador"; obligatorioPorOmision: boolean; requiereVencimiento: boolean }
export interface DocumentoRegistrado { tipoDocumentoId: string; estado: EstadoDocumento; venceEl: string | null }
export interface Unidad { placa: string; numeroEconomico: string | null; tipo: TipoUnidad; capacidadKg: number; rendimientoKmL: number; activo: boolean; notas: string | null; documentos: DocumentoRegistrado[] }
export interface Operador { nombre: string; telefono: string | null; activo: boolean; avisoVersion: string | null; avisoEntregadoEn: Date | null; documentos: DocumentoRegistrado[] }
export type UnidadGuardada = Unidad & { id: string; version: number };
export type OperadorGuardado = Operador & { id: string; version: number };

export type CodigoNoDisponible = "inactivo" | "documento_faltante" | "documento_no_vigente" | "aviso_no_entregado";
export interface MotivoNoDisponible { codigo: CodigoNoDisponible; detalle: string | null } // detalle: nombre del documento
/** Vacía = disponible. Usa el catálogo para saber qué tipos son obligatorios. fecha "AAAA-MM-DD". */
export function motivosNoDisponibleUnidad(u: Unidad, catalogo: TipoDocumento[], fecha: string): MotivoNoDisponible[];
export function motivosNoDisponibleOperador(o: Operador, catalogo: TipoDocumento[], fecha: string): MotivoNoDisponible[];
/** Documentos que vencen entre fecha y fecha + dias (incluidos), para el aviso de "por vencer". */
export function documentosPorVencer(docs: DocumentoRegistrado[], fecha: string, dias: number): DocumentoRegistrado[];
export function normalizarPlaca(placa: string): string; // mayúsculas, sin espacios ni guiones
export const unidadSchema; export const operadorSchema; // Zod; entradas sin id ni version
export type UnidadEntrada; export type OperadorEntrada;
```

### 3.2 Dominio — solicitudes (`src/dominio/solicitudes/`, Codex)

```ts
export const CANALES = ["telefono", "whatsapp", "correo", "presencial", "otro"] as const;
export const ESTADOS_SOLICITUD = ["pendiente", "cancelada", "atendida", "no_atendida"] as const;
export interface Solicitud {
  folio: string; clienteId: string; registradaEn: Date; fechaSolicitada: string; proximaFechaElegible: string;
  canal: Canal; cargaEstimadaKg: number | null; notas: string | null; estado: EstadoSolicitud; vecesPospuesta: number;
}
export type SolicitudGuardada = Solicitud & { id: string; version: number };
export const solicitudSchema; // entrada del alta: clienteId, fechaSolicitada, canal, cargaEstimadaKg, notas, capturaInicioEn
export type SolicitudEntrada;

/** Siguiente fecha de operación estrictamente posterior a fecha. diasOperacion: 0 = domingo … 6 = sábado. */
export function siguienteDiaOperacion(fecha: string, diasOperacion: number[]): string;
/** Días de operación entre la fecha solicitada y hoy, sin contar la fecha solicitada. */
export function diasDeAtraso(s: Solicitud, hoy: string, diasOperacion: number[]): number;
/** Orden FIFO estable: registradaEn, luego folio. */
export function ordenFifo<T extends Pick<Solicitud, "registradaEn" | "folio">>(xs: T[]): T[];
/** Carga a usar: la de la solicitud, la del cliente o la de configuración. */
export function cargaEfectivaKg(s: Pick<Solicitud, "cargaEstimadaKg">, cliente: { cargaEstimadaKg: number | null }, porOmisionKg: number): number;

export type EstadoEnCola = "lista" | "bloqueada" | "futura" | "cerrada";
export interface ElementoCola { solicitud: SolicitudGuardada; estado: EstadoEnCola; motivos: MotivoBloqueo[]; atrasada: boolean; diasDeAtraso: number }
/** Arma la cola del día: cerradas fuera; futura si proximaFechaElegible > hoy; bloqueada con motivosDeBloqueoCliente; lista si no. Orden FIFO. */
export function colaDelDia(
  solicitudes: SolicitudGuardada[], clientes: Map<string, Cliente>, hoy: string,
  versionAviso: string, diasOperacion: number[], diasParaAtrasada: number,
): ElementoCola[];
export function formatoFolio(fecha: string, consecutivo: number): string; // S-AAAAMMDD-NNN
```

### 3.3 Permisos (Claude)

| Permiso | Roles (admin siempre) |
|---|---|
| `flota.ver` | despachador, gerencia |
| `flota.editar` | despachador |
| `jornada.gestionar` | despachador |
| `solicitudes.ver` | despachador, gerencia |
| `solicitudes.registrar` | despachador |
| `solicitudes.cancelar` | despachador |
| `usuarios.gestionar` | — |
| `configuracion.editar` | — |

### 3.4 Consultas y acciones (Claude)

Mismo patrón que el Plan 1: `*.nucleo.ts` con `Contexto` y argumentos `unknown`, envoltorios `server-only` o `"use server"`, y `Resultado<T>`.

```ts
// src/consultas/flota.nucleo.ts
listarUnidades(ctx, filtro: unknown): Resultado<{ fecha: string; unidades: (UnidadGuardada & { motivos: MotivoNoDisponible[]; porVencer: DocumentoRegistrado[] })[]; catalogo: TipoDocumento[]; puedeEditar: boolean }>
obtenerUnidad(ctx, id: unknown): Resultado<{ unidad: UnidadGuardada; motivos; porVencer; catalogo; puedeEditar }>
listarOperadores(ctx, filtro) / obtenerOperador(ctx, id)   // análogos
// src/acciones/flota.nucleo.ts
guardarUnidad(ctx, id, versionEsperada, entrada): Resultado<{ id; version }>      // conflicto, placa repetida → invalido { placa }
guardarOperador(ctx, id, versionEsperada, entrada): Resultado<{ id; version }>

// src/consultas/jornada.nucleo.ts
obtenerJornada(ctx, fecha: unknown): Resultado<{
  fecha; jornadas: (JornadaGuardada & { unidad: UnidadResumen; operador: OperadorResumen })[];
  unidadesDisponibles: UnidadResumen[]; operadoresDisponibles: OperadorResumen[];
  noDisponibles: { tipo: "unidad" | "operador"; id; nombre; motivos: MotivoNoDisponible[] }[];
}>
// src/acciones/jornada.nucleo.ts
asignarJornada(ctx, entrada: unknown /* { fecha, unidadId, operadorId, disponibleDesde } */): Resultado<{ id }>   // revalida disponibilidad en la transacción
quitarJornada(ctx, id: unknown, versionEsperada: unknown): Resultado<{}>
registrarCheckIn(ctx, id, instante?) / registrarCheckOut(ctx, id)   // el Plan 5 los usa desde el teléfono

// src/consultas/solicitudes.nucleo.ts
colaDeSolicitudes(ctx, fecha: unknown): Resultado<{ fecha; elementos: (ElementoCola & { cliente: { id; nombre } })[]; resumen: { listas; bloqueadas; atrasadas; futuras } }>
buscarClientesParaSolicitud(ctx, texto: unknown): Resultado<{ id; nombre; direccion; cargaEstimadaKg; motivosHoy }[]>   // máx. 10, sin acentos
// src/acciones/solicitudes.nucleo.ts
registrarSolicitud(ctx, entrada: unknown): Resultado<{ id; folio }>               // captura_fin_en = ctx.ahora
cancelarSolicitud(ctx, id, versionEsperada, motivo: unknown): Resultado<{}>
reprogramarSolicitud(ctx, id, versionEsperada, fecha: unknown): Resultado<{}>   // cambia fecha_solicitada y próxima elegible; nunca registrada_en

// src/consultas/usuarios.nucleo.ts y src/acciones/usuarios.nucleo.ts (usuarios.gestionar)
listarUsuarios(ctx): Resultado<{ usuarios: { id; nombre; correo; rol; activo; operadorId }[]; operadores: OperadorResumen[] }>
crearUsuario(ctx, entrada): Resultado<{ id; claveTemporal: string }>    // la clave se muestra una sola vez
cambiarRol(ctx, id, entrada): Resultado<{}>                               // sube la generación (cierra sesiones)
desactivarUsuarioAccion / reactivarUsuarioAccion / restablecerClaveAccion  // → { claveTemporal } en restablecer
// src/consultas/configuracion.nucleo.ts y src/acciones/configuracion.nucleo.ts (configuracion.editar)
obtenerConfiguracion(ctx) / guardarConfiguracion(ctx, versionEsperada, entrada)  // configuracion gana columna version
// src/consultas/aviso.ts (sin sesión)
avisoVigente(): Promise<{ version; texto; publicadoEn }>
```

### 3.5 Pantallas

| Ruta | Responsable | Contenido |
|---|---|---|
| `/despacho/unidades`, `/despacho/unidades/nueva`, `/despacho/unidades/[id]` | Codex | Lista con disponibilidad y documentos por vencer; ficha con documentos del catálogo |
| `/despacho/operadores`, `…/nuevo`, `…/[id]` | Codex | Igual que unidades, más la entrega del aviso de privacidad |
| `/despacho/jornada` | Codex | Fecha (hoy por omisión); asignar unidad y operador con hora; quitar; lista de no disponibles con motivo |
| `/despacho/solicitudes` | Codex | Alta rápida arriba (buscador de cliente, fecha, canal, carga) y cola FIFO abajo con estados, atrasadas y motivos; cancelar y reprogramar |
| Ficha de cliente (Plan 1) | Codex | Selector de tipo de documento del catálogo, además del nombre libre |
| Navegación del layout de despacho | Codex | Clientes, Solicitudes, Jornada, Unidades, Operadores |
| `/admin/usuarios` | Claude | Tabla de usuarios; alta, rol, desactivar, reactivar, restablecer; clave temporal mostrada una vez |
| `/admin/configuracion` | Claude | Formulario con mapa del patio (reusa `SelectorUbicacion`), turno, parámetros y días de operación |
| `/aviso-de-privacidad` | Claude | Público, sin sesión; texto vigente e historial de versiones |
| Enlace en `/entrar` y pie de las pantallas | Claude | Al aviso de privacidad |

### 3.6 Aviso de privacidad en el sistema (Claude)

- **Variables de entorno:** `EMPRESA_RAZON_SOCIAL`, `EMPRESA_NOMBRE_COMERCIAL`, `EMPRESA_DOMICILIO`, `PRIVACIDAD_RESPONSABLE`, `PRIVACIDAD_CORREO`, `PRIVACIDAD_TELEFONO`, `PRIVACIDAD_HORARIO`, `PROVEEDOR_HOSPEDAJE`, `PROVEEDOR_RESPALDOS`, `PROVEEDOR_MAPAS`, `URL_AVISO`, y los plazos de conservación.
- **`scripts/publicar-aviso.mts`:**
  1. Llena la plantilla `docs/legal/aviso-de-privacidad-integral.md`.
  2. Se niega si queda algún `{{…}}`.
  3. Calcula la huella.
  4. Como `rs_migrador`, inserta la versión con su texto y la hace vigente en `configuracion`.
  5. Deja bitácora.
- **Versión `2026-10`:** si existe sin texto, la primera publicación la completa en lugar de crear otra.

## 4. Tareas

| # | Responsable | Tarea |
|---|---|---|
| T0 | Claude | Contratos de §3 con firmas; `fast-check` (para el Plan 3) en `package.json`; navegación vacía |
| T1 | Claude | Migración `0003` (tablas, triggers, folios, permisos), repositorios, pruebas de integración (inmutabilidad de `registrada_en`, unicidades, folios concurrentes, permisos) |
| T2 | Codex | Dominio de flota y de solicitudes con pruebas (cada `CodigoNoDisponible`, por vencer, días de operación, atraso, FIFO estable, cola con cada estado, folio) |
| T3 | Claude | Consultas y acciones de flota, jornada, solicitudes, usuarios y configuración, con pruebas de permisos, conflictos, transacciones y bitácora |
| T4 | Codex | Pantallas de despacho de §3.5 |
| T5 | Claude | Pantallas de admin, aviso público, `publicar-aviso`, VPS (límites de memoria, `linux/amd64`, `sslip.io`, convivencia con el punto de venta en `docs/operacion.md`) |
| T6 | Codex escribe, Claude ejecuta | Punta a punta: alta de unidad y operador con documento vencido (no disponible), jornada, solicitud con cliente bloqueado y luego desbloqueado (conserva su hora), pospuesta atrasada, cancelar, admin de usuarios, aviso público sin sesión |
| T7 | Ambos | Revisión cruzada, `verificar-todo.sh` sobre el mismo commit, cierre |

## 5. Qué revisar con más cuidado

- `registrada_en` y el folio no cambian por ninguna vía: ni acción, ni SQL directo de `rs_app`, ni reprogramación.
- Dos altas de solicitud simultáneas el mismo día no repiten folio.
- `asignarJornada` revalida la disponibilidad dentro de la transacción y no permite la misma unidad u operador dos veces el mismo día.
- Cambiar el rol o desactivar a un usuario cierra sus sesiones (generación de credenciales).
- `publicar-aviso` no publica con campos sin llenar; publicar invalida las aceptaciones anteriores (comportamiento ya acordado).
- Ninguna pantalla nueva lee `src/datos` y todas autorizan con los permisos de §3.3.
