# Plan 1 (v2) — Fundaciones y CRM de clientes

- **Fecha:** 2026-10-13. Sustituye a `2026-10-07-plan-1-fundaciones-y-crm.md` (v1).
- **Especificación:** `docs/superpowers/specs/2026-10-07-recycling-solution-piloto-design.md`, revisión 2. "Espec. §n" se refiere a ella.
- **Revisión:** incorpora los seis cambios bloqueantes y las recomendaciones de la revisión de Codex del 2026-10-13; Codex confirmó esta versión el mismo día.
- **Ejecutan:** Claude y Codex en paralelo, con el reparto de la Espec. §15.
- **Regla de ejecución:** todo comando corre dentro de un contenedor con `docker compose`. El anfitrión solo necesita Docker y git; `scripts/verificar-todo.sh` solo coordina contenedores.

## 1. Objetivo y aceptación

Al terminar, en cualquier máquina con Docker:

1. Con `.env` copiado de `.env.example` (que fija `COMPOSE_FILE=compose.yaml:compose.dev.yaml`), `docker compose up` levanta Postgres, aplica migraciones y permisos, crea el primer administrador y sirve la aplicación. En producción, `COMPOSE_FILE=compose.yaml:compose.prod.yaml`.
2. Un despachador entra con correo y contraseña, da de alta y edita clientes (ventanas, documentos, pin en mapa), registra el aviso de privacidad e importa la cartera desde CSV en dos pasos.
3. La lista de clientes muestra K5 sobre toda la cartera e insignias separadas de "completa" y "habilitada hoy".
4. Gerencia ve los clientes sin poder editarlos; operador llega a "sin acceso"; el registro público responde 400; un usuario desactivado pierde el acceso al instante y no puede volver a entrar.
5. Si dos despachadores editan el mismo cliente, o registran el aviso de privacidad del mismo cliente, el segundo recibe "conflicto" y no se pierde nada.
6. Cada escritura deja en la bitácora qué campos cambiaron, en la misma transacción; si la bitácora falla, no se escribe nada. Lo mismo para las altas de usuario.
7. Reintentar la confirmación de una importación no duplica clientes.
8. `scripts/verificar-todo.sh` termina en verde: tipos, lint, unidad, integración con Postgres real, punta a punta contra la imagen de producción y búsqueda de secretos.

## 2. Qué se conserva del v1

El código del v1 se comprobó el 2026-10-07 y otra vez en contenedores el 2026-10-13 (carpeta de ensayo fuera del repositorio).

| Se conserva tal cual | Se conserva con cambios | Se descarta |
|---|---|---|
| `tiempo.ts`, `documentos.ts`, `etiquetas.ts`, `bd.ts`, andamiaje de Next.js y shadcn/ui | `tipos.ts`, `completitud.ts`, `esquemas.ts`, `csv.ts`, `formulario.ts`, `esquema.ts`, `bitacora.ts`, `selector-ubicacion.tsx` (recibe la URL del estilo), acciones, pantallas de clientes y pruebas | Todo lo de Clerk, `datos/clientes.ts` del v1 (sus transacciones no incluían la bitácora), `scripts/alta-usuario.mts` del v1, Neon, Vercel, `next/font/google` |

Las pantallas del v1 no entran al repositorio en T0: Codex las reescribe en T5 tomando como referencia las del plan v1.

## 3. Contratos

Los integra Claude en T0, antes de trabajar en paralelo. Cambiar un contrato después de T0 requiere acuerdo de ambos y un commit propio que actualice esta sección.

### 3.1 Dominio — `src/dominio/clientes/tipos.ts`

```ts
export const TIPOS_RESIDUO = ["RSU", "RME", "RP"] as const;
export type TipoResiduo = (typeof TIPOS_RESIDUO)[number];

export const TIPOS_UNIDAD = ["doble_rodada", "rabon", "camioneta"] as const;
export type TipoUnidad = (typeof TIPOS_UNIDAD)[number];

export const ESTADOS_DOCUMENTO = ["vigente", "pendiente", "vencido"] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

export const ACCIONES_PRIVACIDAD = ["aceptado", "retirado"] as const;
export type AccionPrivacidad = (typeof ACCIONES_PRIVACIDAD)[number];

export const MEDIOS_PRIVACIDAD = ["papel", "correo", "verbal", "otro"] as const;
export type MedioPrivacidad = (typeof MEDIOS_PRIVACIDAD)[number];

/** Horas "HH:MM" (24 h). diaSemana: 0 = domingo … 6 = sábado. */
export interface Ventana { diaSemana: number; horaInicio: string; horaFin: string }

/** venceEl: fecha "AAAA-MM-DD" o null si no vence. */
export interface DocumentoCliente { nombre: string; obligatorio: boolean; estado: EstadoDocumento; venceEl: string | null }

/** Último movimiento registrado del aviso de privacidad. id: el del renglón, sirve para detectar conflictos. */
export interface EstadoPrivacidad { id: string; accion: AccionPrivacidad; versionAviso: string; medio: MedioPrivacidad; en: Date }

export interface Cliente {
  nombre: string;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  direccion: string | null;
  lat: number | null;
  lng: number | null;
  tipoResiduo: TipoResiduo | null;
  material: string | null;
  tiposUnidadAdmitidos: TipoUnidad[];
  notasAcceso: string | null;
  tiempoServicioMin: number;
  cargaEstimadaKg: number | null;
  activo: boolean;
  ventanas: Ventana[];
  documentos: DocumentoCliente[];
  privacidad: EstadoPrivacidad | null;
}

export type ClienteGuardado = Cliente & { id: string; version: number };
```

### 3.2 Dominio — funciones

`completitud.ts` lo adapta Claude en T0 (es el del v1 con la privacidad nueva) y desde ahí lo mantiene Codex. El resto lo implementa Codex en T3; T0 deja la firma con `throw new Error("pendiente: T3 (Codex)")`.

```ts
// completitud.ts
export type Faltante = "ubicacion" | "ventana" | "tipo_residuo" | "tipos_unidad" | "aviso_privacidad";
/** true si el último movimiento es "aceptado" y es de la versión vigente del aviso. */
export function avisoVigente(p: EstadoPrivacidad | null, versionVigente: string): boolean;
export function faltantesDeCliente(c: Cliente, versionAviso: string): Faltante[];
export function estaCompleto(c: Cliente, versionAviso: string): boolean;
export interface ResumenK5 { activos: number; completos: number; porcentaje: number } // 0 a 100; 0 si no hay activos
export function resumenK5(clientes: Cliente[], versionAviso: string): ResumenK5;

// habilitacion.ts — Espec. §7 regla 3, la parte que depende solo del cliente
export type CodigoBloqueo =
  | "inactivo" | "sin_ubicacion" | "residuo_no_definido" | "residuo_peligroso"
  | "documento_no_vigente" | "sin_aviso_privacidad" | "sin_ventana_ese_dia" | "sin_tipos_unidad";
export interface MotivoBloqueo { codigo: CodigoBloqueo; detalle: string | null }
/** fecha "AAAA-MM-DD" (calendario de Ciudad de México). Vacía = habilitado. Orden: el de CodigoBloqueo. */
export function motivosDeBloqueoCliente(c: Cliente, fecha: string, versionAviso: string): MotivoBloqueo[];
export function diaSemanaDeFecha(fecha: string): number;

// esquemas.ts
export const clienteSchema;                                   // el del v1 sin avisoPrivacidadAceptado
export type ClienteEntrada = z.infer<typeof clienteSchema>;   // = Omit<Cliente, "privacidad">
/** versionAviso: la que vio el despachador. movimientoAnteriorId: id del último movimiento que vio, o null. */
export const privacidadSchema;  // { accion, medio, versionAviso: string, movimientoAnteriorId: uuid | null }
export type PrivacidadEntrada = z.infer<typeof privacidadSchema>;
export function erroresPorCampo(error: z.ZodError): Record<string, string[]>;

// formulario.ts
export function clienteNuevo(): ClienteEntrada;
export function aEntrada(c: ClienteGuardado): ClienteEntrada; // campo por campo; sin id, version ni privacidad

// csv.ts
export const LIMITES_CSV = { bytes: 1_000_000, registros: 2000 } as const;
export const COLUMNAS_CSV;  // las del v1
/** fila: número de fila como la muestra Excel (encabezado = 1). null = error del archivo completo. */
export interface ErrorDeImportacion { fila: number | null; mensajes: string[] }
export interface FilaValida { fila: number; entrada: ClienteEntrada }
export interface AnalisisCsv { validas: FilaValida[]; errores: ErrorDeImportacion[]; registros: number }
export function analizarClientesCsv(contenido: string): AnalisisCsv;
export function nombreNormalizado(nombre: string): string;  // minúsculas, sin acentos, sin signos, espacios colapsados
export type PosibleDuplicado =
  | { fila: number; nombre: string; con: "archivo"; otraFila: number }
  | { fila: number; nombre: string; con: "cartera"; clienteId: string; nombreExistente: string };
/** Orden estable: por fila y luego por otraFila o clienteId. */
export function posiblesDuplicados(validas: FilaValida[], cartera: { id: string; nombre: string }[]): PosibleDuplicado[];
```

### 3.3 Seguridad

`src/seguridad/permisos.ts` (Claude, completo en T0):

```ts
export const ROLES = ["admin", "despachador", "operador", "gerencia"] as const;
export type Rol = (typeof ROLES)[number];
export interface UsuarioSesion { id: string; nombre: string; rol: Rol; activo: boolean }
export const PERMISOS = {
  "clientes.ver": ["despachador", "gerencia"],
  "clientes.editar": ["despachador"],
  "clientes.importar": ["despachador"],
  "usuarios.gestionar": [],
} as const satisfies Record<string, readonly Rol[]>;   // admin puede todo
export type Permiso = keyof typeof PERMISOS;
export function puede(usuario: UsuarioSesion | null, permiso: Permiso): boolean;
export function autorizar(usuario: UsuarioSesion | null, permiso: Permiso): UsuarioSesion; // lanza NoAutenticado | NoAutorizado
```

Componentes y módulos de sesión para las pantallas (Claude; en T0 ya funcionan o tienen su firma):

| Archivo | Exporta |
|---|---|
| `src/components/sesion/boton-salir.tsx` (`"use client"`) | `BotonSalir(): JSX.Element` — sin propiedades; cierra la sesión y lleva a `/entrar` |
| `src/seguridad/auth-cliente.ts` | `authClient` de `better-auth/react` (solo lo usan `/entrar` y `BotonSalir`) |

### 3.4 Acciones y consultas

`src/acciones/tipos.ts`:

```ts
export interface Contexto { bd: BD; usuario: UsuarioSesion | null; ahora: Date }
export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; error: "no_autenticado" | "no_autorizado" | "no_encontrado" | "conflicto" }
  | { ok: false; error: "invalido"; campos: Record<string, string[]> };
```

Toda función de `src/acciones/*.nucleo.ts` y `src/consultas/*.nucleo.ts` recibe `Contexto` y argumentos `unknown`, autoriza primero y valida con Zod antes de tocar la base.

```ts
// src/consultas/clientes.nucleo.ts — permiso clientes.ver salvo donde se indica
export interface ClienteResumen {
  id: string; nombre: string; direccion: string | null; tipoResiduo: TipoResiduo | null; activo: boolean;
  faltantes: Faltante[]; completo: boolean; motivosHoy: MotivoBloqueo[];
}
export interface ListadoClientes { fecha: string; k5: ResumenK5; clientes: ClienteResumen[]; puedeEditar: boolean }
export function listarClientes(ctx: Contexto, filtro: unknown /* { texto?: string } */): Promise<Resultado<ListadoClientes>>;

export interface FichaCliente {
  cliente: ClienteGuardado; faltantes: Faltante[]; motivosHoy: MotivoBloqueo[];
  versionAvisoVigente: string; puedeEditar: boolean; estiloMapaUrl: string;
}
export function obtenerFicha(ctx: Contexto, id: unknown): Promise<Resultado<FichaCliente>>;

/** Para la pantalla de alta. Permiso clientes.editar. */
export interface ContextoAlta { estiloMapaUrl: string; versionAvisoVigente: string }
export function obtenerContextoAlta(ctx: Contexto): Promise<Resultado<ContextoAlta>>;

// src/acciones/clientes.nucleo.ts — permiso clientes.editar
/** id null crea (versionEsperada debe ser null). Versión distinta: "conflicto" sin escribir. */
export function guardarCliente(ctx: Contexto, id: unknown, versionEsperada: unknown, entrada: unknown):
  Promise<Resultado<{ id: string; version: number }>>;
/** entrada: PrivacidadEntrada. Si versionAviso ya no es la vigente o movimientoAnteriorId no es el último: "conflicto". */
export function registrarPrivacidad(ctx: Contexto, clienteId: unknown, entrada: unknown):
  Promise<Resultado<{ privacidad: EstadoPrivacidad }>>;

// src/acciones/importacion.nucleo.ts — permiso clientes.importar
export interface ResumenImportacion {
  registros: number; validas: number; errores: ErrorDeImportacion[]; posiblesDuplicados: PosibleDuplicado[];
  muestra: { fila: number; nombre: string; direccion: string | null }[]; // primeras 20 válidas
  huella: string;  // del contenido y de los duplicados encontrados; se devuelve al confirmar
}
/** No escribe nada. */
export function analizarImportacion(ctx: Contexto, csv: unknown): Promise<Resultado<ResumenImportacion>>;
/**
 * opciones: { operacionId: uuid; huella: string; aceptarDuplicados: boolean }.
 * - Si operacionId ya se confirmó: devuelve el mismo resultado sin escribir.
 * - Toma un candado de importación, vuelve a analizar dentro de la transacción y recalcula la huella.
 * - Huella distinta (cambió el archivo o los duplicados): "conflicto". Errores: "invalido" con campos.archivo.
 *   Duplicados sin aceptarDuplicados: "invalido" con campos.duplicados.
 * - Si no: inserta clientes, bitácora y el renglón de importaciones en la misma transacción.
 */
export function confirmarImportacion(ctx: Contexto, csv: unknown, opciones: unknown):
  Promise<Resultado<{ importados: number }>>;
```

Envoltorios que importan las pantallas (Claude):

| Archivo | Exporta |
|---|---|
| `src/consultas/clientes.ts` (`server-only`) | `listarClientesConsulta(filtro: { texto?: string }): Promise<Resultado<ListadoClientes>>`, `obtenerFichaConsulta(id: string): Promise<Resultado<FichaCliente>>`, `obtenerContextoAltaConsulta(): Promise<Resultado<ContextoAlta>>` |
| `src/consultas/sesion.ts` (`server-only`) | `usuarioDeLaSesion(): Promise<UsuarioSesion \| null>` — null si no hay sesión, no hay renglón en `usuarios` o está inactivo |
| `src/acciones/clientes.ts` (`"use server"`) | `guardarClienteAccion(id: string \| null, versionEsperada: number \| null, entrada: ClienteEntrada): Promise<Resultado<{ id: string; version: number }>>`, `registrarPrivacidadAccion(clienteId: string, entrada: PrivacidadEntrada): Promise<Resultado<{ privacidad: EstadoPrivacidad }>>` |
| `src/acciones/importacion.ts` (`"use server"`) | `analizarImportacionAccion(csv: string): Promise<Resultado<ResumenImportacion>>`, `confirmarImportacionAccion(csv: string, opciones: { operacionId: string; huella: string; aceptarDuplicados: boolean }): Promise<Resultado<{ importados: number }>>` |

Con resultado `ok`, las acciones que escriben llaman `revalidatePath("/despacho/clientes")`. Las pantallas traducen `no_autenticado` en `redirect("/entrar")`, `no_autorizado` en `redirect("/sin-acceso")` y `no_encontrado` en `notFound()`.

### 3.5 Pruebas de punta a punta

Claude entrega la infraestructura y Codex escribe los casos funcionales sobre ella.

- Corren en el servicio `e2e` contra `http://web:3000` (`PLAYWRIGHT_BASE_URL`), con un solo worker.
- Cada corrida parte de una base vacía en `tmpfs`: `migrate`, `bootstrap` y `scripts/semilla-e2e.mts`.
- La semilla crea un usuario sintético por rol: `admin@e2e.local`, `despachador@e2e.local`, `despachador2@e2e.local`, `gerencia@e2e.local`, `operador@e2e.local` e `inactivo@e2e.local` (despachador desactivado), todos con la contraseña de `E2E_CLAVE`. No crea clientes.
- `e2e/ayudas/sesion.ts` (Claude) exporta `entrarComo(page: Page, usuario: UsuarioE2E): Promise<void>` y el tipo `UsuarioE2E` con los seis anteriores.
- `e2e/ayudas/datos.ts` (Claude) exporta `nombreUnico(prefijo: string): string`. Cada prueba crea sus propios clientes con nombres únicos y no depende de cuántos existen; las que miden K5 comparan dos lecturas de la misma corrida.

## 4. Tareas

Cada tarea termina con su commit y la evidencia de ejecución en contenedores (comando y resultado) en el mensaje o en la descripción de la integración.

### T0 — Base de integración (Claude, en `main`)

Archivos: andamiaje, `Dockerfile`, `.dockerignore`, `compose.yaml`, `compose.dev.yaml`, `compose.test.yaml`, `.env.example`, `package.json` y `package-lock.json`, `next.config.ts`, `vitest.config.ts`, `drizzle.config.ts`, `eslint.config.mjs`, `tsconfig.json`, `AGENTS.md`, `CLAUDE.md`, los contratos de §3, el esquema de §T1.3 con su migración inicial (para que los contratos compilen) y el código conservado del v1.

1. Copiar el andamiaje comprobado (Next.js 16.4.0, React 19.3.0, shadcn/ui base-nova) y el código del v1 sin Clerk.
2. Fijar versiones exactas en `package.json` (next 16.4.0, better-auth y su adaptador 1.7.7, drizzle-orm 0.45.4, drizzle-kit 0.31.11, zod 4.6.7, maplibre-gl 6.14.0, papaparse 5.7.0, pg 8.23.1, @electric-sql/pglite 0.5.9, vitest 5.0.4, @playwright/test 1.64.0) y agregar `geist`. Imágenes: `node:24.21.0-bookworm-slim`, `postgres:17.11-alpine`, `caddy:2.11.6-alpine`, `mcr.microsoft.com/playwright:v1.64.0-noble`.
3. `next.config.ts`: `output: "standalone"`, `cacheComponents: true`, `experimental.serverActions.bodySizeLimit: "2mb"` (holgura sobre el límite de 1 MB del CSV).
4. Fuentes con el paquete `geist` en `src/app/layout.tsx`; nada de `next/font/google`.
5. Componentes de shadcn/ui para Codex: alert, badge, button, card, checkbox, dialog, input, label, select, separator, table, textarea.
6. `vitest.config.ts` con dos proyectos: `unidad` (`src/**/*.test.ts` salvo `*.integracion.test.ts`) e `integracion`.
7. Scripts de `package.json`: `verificar` (tsc, eslint, `vitest run --project unidad`), `prueba:integracion`, `migrar`, `bootstrap` y los de administración de usuarios.
8. `AGENTS.md` con las reglas para Codex (responsables, invariantes de la guía de auditoría, todo en contenedores, contratos de §3) y `CLAUDE.md` que remite a él. Se conserva el bloque que agrega Next.js.
9. `.gitignore`: `.env*` salvo `.env.example`, `.worktrees/`, `respaldos/`.

Prueba: `docker compose -f compose.yaml -f compose.test.yaml run --rm unit npm run verificar` en verde; las pruebas de funciones pendientes quedan como `it.todo`.

### T1 — Contenedores y base de datos (Claude, rama `claude/fundaciones`)

Archivos: `Dockerfile`, `compose*.yaml`, `infra/db/**`, `src/datos/**`, `drizzle/**`, `scripts/migrar.mts`.

1. **Dockerfile** multietapa (`deps`, `dev`, `build`, `runner`) de la Espec. §4. `runner` corre como usuario `node`, copia `.next/standalone`, `.next/static` y `public`, y expone 3000.
2. **Roles** (`infra/db/init/01-roles.sh`, corre al crear el volumen): `rs_migrador` (LOGIN, dueño de la base y del esquema `public`) y `rs_app` (LOGIN). Contraseñas desde `RS_MIGRADOR_PASSWORD` y `RS_APP_PASSWORD`. `REVOKE CREATE ON SCHEMA public FROM PUBLIC`.
3. **Esquema** (`src/datos/esquema.ts`, que reexporta `esquema-auth.ts` para que la generación de migraciones y el tipo `BD` incluyan ambas fuentes):
   - `usuarios.auth_user_id text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE RESTRICT`.
   - `clientes.version integer NOT NULL DEFAULT 1`; sin `aviso_privacidad_aceptado_en`.
   - CHECK: `dia_semana BETWEEN 0 AND 6`; `hora_inicio < hora_fin`; `tiempo_servicio_min BETWEEN 5 AND 480`; `carga_estimada_kg BETWEEN 0 AND 40000`; `lat` y `lng` ambos nulos o ambos presentes.
   - `avisos_privacidad`, `aceptaciones_privacidad` (con `secuencia` de identidad y llaves sin cascada) e `importaciones` de la Espec. §6.
   - `configuracion` de una sola fila con sus CHECK; `version_aviso_privacidad` referencia a `avisos_privacidad`.
   - `bitacora.campos text[] NOT NULL DEFAULT '{}'`.
   - La migración inicial inserta la versión `2026-10` del aviso (descripción: texto pendiente de la empresa) y la fila de configuración.
4. **`scripts/migrar.mts`**: toma `pg_advisory_lock`; aplica migraciones con `drizzle-orm/node-postgres/migrator` como `rs_migrador`; compara el hash de cada migración aplicada en `drizzle.__drizzle_migrations` con el del archivo correspondiente; ejecuta `infra/db/permisos.sql`; suelta el candado. Termina con error si algo no coincide. `web` y `app` dependen de que `migrate` termine bien.
5. **`permisos.sql`** (idempotente): `rs_app` recibe USAGE en `public`; SELECT, INSERT, UPDATE y DELETE en las tablas; luego REVOKE UPDATE, DELETE en `bitacora`, `aceptaciones_privacidad` e `importaciones`; USAGE en secuencias; nada sobre el esquema `drizzle`.
6. **Conexión**: `src/datos/conexion-base.ts` exporta `crearConexion(url): { bd: BD; cerrar(): Promise<void> }` (sin `server-only`); `src/datos/conexion.ts` lleva `import "server-only"` y exporta `bd`.
7. **Repositorios** (`clientes.ts`, `privacidad.ts`, `configuracion.ts`, `importaciones.ts`, `bitacora.ts`): reciben `BD | Tx` y nunca abren transacción. `actualizarClienteSiVersion` es un solo `UPDATE … WHERE id = $1 AND version = $2 RETURNING version` y, si no devuelve renglón, distingue `no_encontrado` de `conflicto`. `ultimoMovimientoPrivacidad` ordena por `secuencia`. Las lecturas que combinan cliente e hijos (ficha y cartera) corren en una transacción de solo lectura `REPEATABLE READ` que abre la consulta.
8. **Bases de prueba**:
   - `src/datos/pruebas/bd-prueba.ts`: PGlite con migraciones, para pruebas de unidad.
   - `src/datos/pruebas/postgres-prueba.ts`: usa `PRUEBA_ADMIN_URL`, que solo existe en `compose.test.yaml` (superusuario del Postgres desechable). Crea una base `prueba_` + 16 caracteres hexadecimales (validados con expresión regular antes de usarlos en SQL) con dueño `rs_migrador`, corre `migrar` y conecta como `rs_app`. Al terminar cierra los pools y borra solo bases cuyo nombre cumple esa expresión.

Pruebas de integración (`*.integracion.test.ts`):

- Migrar una base vacía deja las migraciones del journal con su hash, la versión del aviso y la fila de configuración; migrar otra vez no cambia nada; dos migradores simultáneos terminan bien.
- `rs_app` no puede UPDATE ni DELETE en `bitacora`, `aceptaciones_privacidad` ni `importaciones`, no puede crear tablas y no puede insertar `configuracion` con `id = 2`.
- Los CHECK rechazan `hora_inicio >= hora_fin`, `dia_semana = 7` y una latitud sin longitud.
- Dos `actualizarClienteSiVersion` concurrentes con la misma versión: uno actualiza y el otro devuelve `conflicto`.

### T2 — Autenticación y autorización (Claude, rama `claude/fundaciones`)

Archivos: `src/seguridad/**`, `src/consultas/sesion.ts`, `src/components/sesion/**`, `src/proxy.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/entrar/**`, `src/app/sin-acceso/**`, `src/app/page.tsx`, `src/app/layout.tsx`, `scripts/bootstrap.mts`, `scripts/alta-usuario.mts`, `scripts/desactivar-usuario.mts`, `scripts/restablecer-clave.mts`.

1. `auth-base.ts`: `crearAuth(bd)` con la configuración comprobada (Espec. §10): adaptador de Drizzle con `esquema-auth`, `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 }`, `plugins: [nextCookies()]`, `trustedOrigins: [BETTER_AUTH_URL]` y `databaseHooks.session.create.before` que niega la sesión si el usuario no tiene renglón activo en `usuarios`. `auth.ts` (`server-only`) exporta `auth = crearAuth(bd)`.
2. `identidades.ts`, único módulo que escribe en las tablas de Better Auth, con funciones que reciben `Tx`:
   - `crearIdentidad(tx, { correo, nombre, clave, rol, creadoPor })`: `user`, `account` (proveedor `credential`, `hashPassword` de `better-auth/crypto`), `usuarios` y bitácora.
   - `desactivarUsuario(tx, usuarioId, por)`: `activo = false`, borra sus filas de `session`, bitácora.
   - `restablecerClave(tx, usuarioId, claveNueva, por)`: nuevo hash, borra sesiones, bitácora.
   - Quien llama abre la transacción. Una prueba con Postgres real fuerza un error después de cada paso y comprueba que no queda nada.
3. `sesion.ts` (`server-only`): `usuarioActual()` lee la sesión con `auth.api.getSession({ headers: await headers() })` y busca `usuarios` por `auth_user_id`; `contextoDeLaPeticion()` arma el `Contexto`. `src/consultas/sesion.ts` expone `usuarioDeLaSesion()`.
4. `permisos.ts` del contrato §3.3, con pruebas de la matriz completa.
5. `src/proxy.ts`: con `getSessionCookie` redirige a `/entrar` si no hay cookie en `/despacho`, `/operador` y `/gerencia`. Es una revisión optimista; la autorización real está en consultas y acciones.
6. `/entrar` con `authClient.signIn.email` y mensaje genérico si falla; `BotonSalir`; `/sin-acceso`.
7. `src/app/page.tsx` redirige según el rol: despachador, gerencia y admin a `/despacho/clientes`; operador a `/sin-acceso` hasta el Plan 5.
8. Scripts: `bootstrap.mts` (Espec. §10: idempotente, no promueve identidades existentes), `alta-usuario.mts`, `desactivar-usuario.mts`, `restablecer-clave.mts`. Todos usan `identidades.ts` en una transacción y dejan bitácora con `usuario_id` nulo y la acción `por_script`.

Pruebas: matriz de permisos; usuario inactivo es `NoAutenticado`; `bootstrap` dos veces deja un solo administrador sin cambiar su contraseña; `bootstrap` con el correo de un despachador existente termina con error y no lo promueve. Con `auth.handler` sobre Postgres real: registro público 400; entrada correcta 200 con cookie; contraseña equivocada 401; cookie falsificada o caducada sin sesión; usuario desactivado sin sesiones y sin poder entrar; reactivado sin sesiones anteriores; restablecer la clave invalida la anterior.

### T3 — Dominio del CRM (Codex, rama `codex/dominio-crm`)

Archivos: `src/dominio/**` y sus pruebas.

1. `tipos.ts` y `completitud.ts` los deja Claude en T0; Codex no cambia `tipos.ts` sin acuerdo.
2. `habilitacion.ts`: Espec. §7 regla 3 sin la parte de unidades. Un documento "vigente" con fecha pasada cuenta como vencido (reutilizar `estadoEfectivo`). `RP` bloquea como `residuo_peligroso`; `null` como `residuo_no_definido`.
3. `esquemas.ts`:
   - Fechas de documentos: calendario real (`2026-02-30` y `2026-13-01` se rechazan).
   - Teléfono: entre 10 y 15 dígitos, contando solo dígitos; se permiten espacios, guiones, paréntesis y `+`.
   - Se conserva el resto de las reglas del v1 (caja de México, ventanas sin traslape, límites).
   - `privacidadSchema` con `versionAviso` y `movimientoAnteriorId`.
4. `formulario.ts`: `clienteNuevo` y `aEntrada` sin aviso, id ni versión.
5. `csv.ts`:
   - Rechaza archivos de más de `LIMITES_CSV.bytes` (en bytes UTF-8) o de más de `LIMITES_CSV.registros` registros.
   - Reporta los errores del lector (`leido.errors`): comillas sin cerrar y conteo de campos distinto al encabezado.
   - Rechaza encabezados repetidos después de normalizarlos.
   - Acepta campos entre comillas con saltos de línea; la `fila` es la de Excel, no la línea del archivo.
   - No aplica `.trim()` a valores que no son texto (el caso `__parsed_extra`).
   - Toda fila pasa por `clienteSchema`.
   - `nombreNormalizado` y `posiblesDuplicados` (dentro del archivo y contra la cartera).
6. `etiquetas.ts`: etiqueta legible de cada `CodigoBloqueo`, `AccionPrivacidad` y `MedioPrivacidad`.

Pruebas obligatorias: cada `CodigoBloqueo` por separado; documento que vence hoy (no bloquea) y ayer (bloquea); `diaSemanaDeFecha` en domingo y sábado sin depender de la zona del proceso; CSV con BOM, punto y coma, coma decimal, renglones vacíos, campo multilínea, comillas sin cerrar, columnas de más, encabezado repetido, 2001 registros y 1 MB + 1 byte; "Cartonera  Núñez S.A." y "cartonera nunez sa" como duplicados.

### T4 — Consultas y acciones (Claude, rama `claude/fundaciones`)

Archivos: `src/consultas/**`, `src/acciones/**`.

1. `guardarCliente`: autoriza; valida `id` (uuid o null), `versionEsperada` (entero positivo o null, coherente con `id`) y `entrada`; abre **una** transacción con la escritura del cliente, el reemplazo de ventanas y documentos y la bitácora. `campos`: al crear, los campos con valor; al actualizar, los que cambiaron (`src/acciones/cambios.ts`).
2. `registrarPrivacidad`: autoriza y valida; en una transacción bloquea el renglón del cliente (`SELECT … FOR UPDATE`), compara `versionAviso` con la vigente y `movimientoAnteriorId` con el último movimiento, inserta el movimiento y su bitácora.
3. `analizarImportacion`: rechaza entradas que no son texto; analiza; calcula duplicados contra la cartera y la huella (SHA-256 del contenido y de la lista ordenada de duplicados); no escribe.
4. `confirmarImportacion`: el comportamiento de §3.4, con `pg_advisory_xact_lock` para serializar importaciones.
5. `listarClientes`, `obtenerFicha` y `obtenerContextoAlta`: autorizan; K5 sobre la cartera completa; el filtro de texto solo afecta a la lista; `puedeEditar = puede(usuario, "clientes.editar")`; `estiloMapaUrl` desde `MAPA_ESTILO_URL`.

Pruebas (PGlite salvo donde se indica):

- Cada función: sin sesión, usuario inactivo, operador y gerencia; id mal formado; entrada que no es objeto o no es texto.
- Rollback: si falla la bitácora, no queda ni cliente ni ventanas ni documentos.
- Conflicto: guardar con versión vieja y registrar privacidad con versión del aviso vieja o con movimiento anterior distinto devuelven `conflicto` sin escribir.
- Importación: analizar no escribe; confirmar con un error no escribe ninguna fila; con duplicados exige `aceptarDuplicados`; si cambia la cartera entre analizar y confirmar, `conflicto`; repetir el `operacionId` no duplica; un archivo válido escribe todas las filas, una bitácora por cliente y un renglón de importaciones.
- K5 no cambia al filtrar por texto.
- La bitácora solo contiene nombres de campo.
- Postgres real: rollback con el permiso de INSERT en `bitacora` revocado a `rs_app` en esa base; dos confirmaciones simultáneas del mismo archivo importan una sola vez.

### T5 — Pantallas de despacho (Codex, rama `codex/dominio-crm`, después de T3)

Archivos: `src/app/despacho/**` y `src/components/clientes/**`.

1. `despacho/layout.tsx`: encabezado con el nombre que da `usuarioDeLaSesion()` y `BotonSalir`; la parte que lee la sesión va dentro de `<Suspense>`.
2. `despacho/clientes/page.tsx`: tarjeta de K5 (completos de activos y porcentaje), búsqueda (`q`), tabla con insignias "Completa" y "Habilitada hoy" por separado, faltantes y motivos legibles. "Nuevo" e "Importar" solo si `puedeEditar`.
3. `despacho/clientes/nuevo` (con `obtenerContextoAltaConsulta`) y `despacho/clientes/[id]`: formulario del v1 adaptado:
   - Envía `versionEsperada`; con `conflicto` avisa y ofrece recargar la ficha sin perder lo capturado en pantalla.
   - Muestra todos los errores del servidor: los de campo junto al campo y los generales (`_`) arriba.
   - Accesibilidad: `aria-describedby` y `aria-invalid` por campo; resumen con `role="alert"`; foco al primer campo con error.
   - Sección de aviso de privacidad aparte: estado (aceptado, retirado o sin registro, con versión y fecha) y registro de aceptación o retiro con medio, enviando la versión y el movimiento que se mostraron. En un cliente nuevo indica que primero hay que guardarlo.
   - Gerencia ve la ficha en solo lectura.
4. `despacho/clientes/importar`: paso 1, lee el archivo en el navegador, valida el tamaño antes de enviar y muestra el resumen; paso 2, confirma con un `operacionId` generado al mostrar el resumen, la `huella` recibida y la casilla de aceptar duplicados si los hay. Con `conflicto`, pide volver a analizar.
5. `selector-ubicacion.tsx` recibe `estiloMapaUrl` como propiedad.

### T6 — Operación, punta a punta y verificación completa (Claude)

1. `compose.prod.yaml` con `web` y `proxy` (Caddy; `infra/caddy/Caddyfile` con `{$DOMINIO}`). Sin dominio público, `tls internal` exige instalar la autoridad de Caddy en cada teléfono (Espec. §14, decisión 11).
2. Servicio `respaldo` (perfil `respaldo`): `pg_dump -Fc` a `./respaldos` con fecha y hora; restauración con `pg_restore --clean --if-exists` seguida de `migrar` (que vuelve a aplicar permisos). Procedimiento en `docs/operacion.md`, incluida la mudanza a otra máquina y una prueba de restauración.
3. `compose.test.yaml`: `db` en `tmpfs` con `PRUEBA_ADMIN_URL`; `unit`; `integration`; `web` construido con la etapa `runner`; `e2e` que espera a `migrate`, `bootstrap`, la semilla y `web`.
4. Infraestructura de §3.5 y pruebas de punta a punta de autenticación: entrada y salida, registro público cerrado, operador en "sin acceso", usuario desactivado expulsado en la siguiente petición.
5. `scripts/verificar-todo.sh`: construye imágenes y corre `verificar`, integración, punta a punta y gitleaks (imagen con versión fija), cada uno con su propio nombre de proyecto de Compose; termina con código distinto de 0 si algo falla. gitleaks busca secretos; no prueba que no haya datos personales.

### T7 — Punta a punta funcional del CRM (Codex escribe, Claude ejecuta)

Archivo: `e2e/clientes.spec.ts`, con las ayudas de §3.5. Casos: alta completa con aviso de privacidad y coordenadas capturadas, aparece como completa; edición; conflicto entre dos contextos de navegador (despachador y despachador2); importación en dos pasos con un archivo con un error (no importa nada) y luego corregido; reintento de confirmación sin duplicar; gerencia en solo lectura; K5 igual con y sin búsqueda.

### T8 — Integración y validación final (ambos)

1. Claude integra `claude/fundaciones` y `codex/dominio-crm` en `main` con merge sin avance rápido; el lockfile y las migraciones los resuelve solo Claude.
2. Codex revisa los cambios de Claude (transacciones, permisos, migraciones, Docker). Claude revisa los de Codex (dominio y pantallas) y corre sus pruebas.
3. Se corrigen los hallazgos en ramas cortas.
4. Ambos ejecutan la lista de aceptación de §1 sobre el mismo commit, con `scripts/verificar-todo.sh` corrido por Claude y la salida revisada por Codex.
5. El commit de cierre anota la lista de aceptación y el hash verificado.

## 5. Orden y paralelismo

```
T0 (Claude, main) ──┬── T1 → T2 → T4 → T6 ──┐
                    └── T3 → T5 → T7 ───────┴── T8
```

Codex trabaja contra los contratos de T0; las pantallas usan los envoltorios de §3.4, que existen desde T0 con su firma. Para probar sus pantallas antes de T8, Claude integra en una rama temporal y le entrega la evidencia; Codex no edita archivos de Claude.

## 6. Comandos

| Para | Comando |
|---|---|
| Desarrollo | `docker compose up` (con `COMPOSE_FILE` de `.env.example`) |
| Verificación rápida | `docker compose -f compose.yaml -f compose.test.yaml run --rm unit npm run verificar` |
| Integración | `docker compose -p rs-prueba -f compose.yaml -f compose.test.yaml run --rm integration` |
| Todo | `scripts/verificar-todo.sh` |
| Producción | `COMPOSE_FILE=compose.yaml:compose.prod.yaml` en `.env` y `docker compose up -d` |
| Respaldo | `docker compose --profile respaldo run --rm respaldo` |

En un worktree, cada comando agrega `-p rs-<rama>` para no compartir volúmenes ni red con otro.

## 7. Qué revisar con más cuidado (Review Focus)

- Transacciones: ninguna escritura sin su bitácora y nada fuera de la transacción de la acción; altas de usuario incluidas.
- `actualizarClienteSiVersion` y `registrarPrivacidad` bajo concurrencia real.
- `confirmarImportacion`: huella, idempotencia y candado.
- Que ninguna consulta ni acción lea o escriba antes de `autorizar`.
- Que `usuarios.activo` se lea en cada petición, que el hook niegue sesiones a inactivos y que desactivar borre sesiones.
- CSV: límites en bytes, filas de Excel correctas con campos multilínea, duplicados.
- Fechas: `fechaEnMexico` alrededor de la medianoche; `diaSemanaDeFecha` sin depender de la zona del contenedor.
- Que ninguna variable `NEXT_PUBLIC_*` lleve secretos y que el build no descargue nada de Internet salvo dependencias.
- Que los permisos de `rs_app` se vuelvan a aplicar después de migrar y de restaurar, y que la aplicación no arranque antes.
