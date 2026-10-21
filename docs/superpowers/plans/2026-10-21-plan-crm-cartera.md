# Plan CRM — Cartera lista para operar: plan de implementación

> **Para quien ejecute:** cada tarea tiene responsable. Misma forma que los Planes 4 a 7: primero contratos que compilan, cada quien en sus carpetas (AGENTS.md), revisión cruzada y `scripts/verificar-todo.sh` en verde sobre el mismo commit. Los pasos van con casillas (`- [ ]`).

**Objetivo:** cargar la cartera real desde Excel sin completar a mano y darle al despachador historial, números, propuestas de recolección, mapa, contactos, notas, exportación y filtros.

**Arquitectura:**
- El dominio puro lee horarios, tipos, ubicaciones y el ritmo de cada cliente.
- Los datos agregan columnas a `clientes` y dos tablas que solo admiten inserciones: notas y decisiones de propuestas.
- Acciones y consultas sobre lo que ya hay. Dos rutas de API (plantilla y exportación) y pantallas nuevas de cartera y solicitudes.

**Tecnología:** Next.js 16, Drizzle 0.45, Postgres 17, Zod 4, Papa Parse, MapLibre, Vitest y fast-check, Playwright. Todo en Docker Compose.

**Especificación:** `docs/superpowers/specs/2026-10-21-plan-crm-cartera-design.md`, aprobada por el usuario el 2026-10-21.

## Restricciones globales

- Docker y versiones exactas. Ninguna dependencia nueva.
- Toda acción y consulta autoriza con un permiso. Cada escritura va en una transacción con su renglón de bitácora: nombres de campos, nunca valores.
- **Permisos:**
  - `clientes.exportar`: despachador;
  - notas: se escriben con `clientes.editar` y se leen con `clientes.ver`;
  - propuestas: `solicitudes.registrar`;
  - plantilla: `clientes.importar`.
- **Límites:**
  - `contactos_adicionales` hasta 10;
  - nota hasta 1000 caracteres, de tipo `llamada | queja | acuerdo | otro`;
  - posponer de 1 a 30 días;
  - ritmo con 3 o más solicitudes atendidas en 180 días; propuesta si la fecha esperada cae entre D − 3 y D;
  - enlace corto: hasta 3 saltos, 3 s y solo dominios de Google;
  - documento por vencer: 30 días o menos.
- **Canal nuevo:** `propuesta`. K2 se reporta aparte para ese canal.
- **CSV:** BOM, CRLF, fórmulas neutralizadas (como el Plan 6) y la misma forma para plantilla, exportación e importación. Las columnas actuales siguen funcionando.
- **Migración:** `0009` para este plan; el Plan 8 pasa a `0010`.
- Solo datos sintéticos. Textos en español. Lecturas dentro de `<Suspense>`.

## Enfoque de la revisión

1. **CSV guardado por Excel en español,** con `;` como separador o en Windows-1252 en vez de UTF-8. La importación lo lee igual, con los acentos bien. *Prueba en PC-2.*
2. **Enlace de "lugar" de Google Maps sin coordenadas** en la URL, o con `!3d…!4d…` pero sin `@`. Si tiene `!3d!4d`, se reconoce; si no, el mensaje dice cómo copiar la ubicación ("Compartir → Copiar coordenadas"). *Prueba en PC-2.*
3. **Teléfonos con formato real en contactos adicionales** (`+52 442 123 4567`, `442-123-45-67 ext 3`). Se validan igual que el principal. *Prueba en PC-2.*
4. **Propuestas para un día que no es de operación,** o para un cliente inactivo o sin horario ese día. No aparecen. *Prueba en PC-2.*
5. **Dos despachadores confirman la misma propuesta a la vez.** Sale una sola solicitud y el otro recibe "ya confirmada". *Prueba en PC-3.*

---

## 1. Reparto y orden

| # | Responsable | Tarea | Depende de |
|---|---|---|---|
| PC-0 | Claude (parte de Codex reasignada: Codex sin cuota hasta las 17:58; Codex la revisa) | Contratos de §2 que compilan | — |
| PC-1 | Claude | Migración `0009`, `src/datos` y permisos | PC-0 |
| PC-2 | Claude (reasignada, funciones puras de `src/dominio`; Codex la revisa) | Horarios, tipos, ubicación, CSV completo con exportación, esquemas de contactos y recurrencia, ritmo y propuestas | PC-0 |
| PC-3 | Claude | Acciones y API: importar completo, ubicación con enlace corto y distancia a la calle, cliente con contactos y recurrencia, propuestas (confirmar, posponer, descartar), notas, plantilla, exportación, script de supresión | PC-1, PC-2 |
| PC-4 | Claude | Consultas: filtros, historial, números por cliente (`src/indicadores/cliente.ts`), propuestas, mapa y K2 por canal | PC-1, PC-2 |
| PC-5 | Codex | Pantallas: ficha (historial, números, contactos, notas, recurrencia, pegar ubicación), filtros e insignias, mapa de la cartera, propuestas en Solicitudes; e2e | PC-0 (contratos); PC-3 y PC-4 para probar |
| PC-6 | Ambos | `docs/legal`, guía de auditoría, especificación §6, §9 y §16, hoja de ruta (y migración `0010` en el plan del Plan 8), revisión cruzada, `verificar-todo.sh` y merge | todas |

Ramas: Claude trabaja en `claude/plan-crm` (`.worktrees/claude-plan-4`); Codex en `codex/plan-crm` (`.worktrees/codex-plan-4`), creada después de PC-0.

## 2. Contratos (PC-0)

```ts
// src/dominio/clientes/tipos.ts
export interface ContactoCliente { nombre: string; puesto: string | null; telefono: string | null; correo: string | null }
export type Recurrencia =
  | { tipo: "dias_semana"; dias: number[] }                     // 0 = domingo … 6 = sábado, sin repetidos
  | { tipo: "cada_n_dias"; cadaDias: number; desde: string };   // 2 a 90 días; desde AAAA-MM-DD
// Cliente agrega: contactoCorreo: string | null; contactoPuesto: string | null;
//                 contactosAdicionales: ContactoCliente[]; recurrencia: Recurrencia | null;

// src/dominio/clientes/horarios.ts
export function leerHorarios(texto: string): { ok: true; ventanas: Ventana[] } | { ok: false; mensaje: string };
export function escribirHorarios(ventanas: Ventana[]): string;   // inversa: leerHorarios(escribirHorarios(v)) = v normalizado

// src/dominio/clientes/ubicacion.ts
export type LecturaUbicacion =
  | { ok: true; lat: number; lng: number }
  | { ok: false; motivo: "enlace_corto" | "no_reconocido" | "fuera_de_mexico"; mensaje: string };
export function leerUbicacion(texto: string): LecturaUbicacion;

// src/dominio/clientes/csv.ts
// COLUMNAS_CSV agrega: "horarios", "tipos_unidad", "notas_acceso", "ubicacion", "correo", "puesto".
export function filaCsvDeCliente(c: ClienteGuardado): Record<(typeof COLUMNAS_CSV)[number], string>;
// analizarClientesCsv acepta "," o ";" (detecta por el encabezado) y UTF-8 o Windows-1252: recibe Uint8Array | string.

// src/dominio/solicitudes/propuestas.ts
export interface Ritmo { dias: number; ultima: string; muestra: number }
export function ritmoAprendido(fechasAtendidas: string[], hoy: string): Ritmo | null;   // ≥ 3 en 180 días; mediana de diferencias
export function tocaRecurrencia(r: Recurrencia, fecha: string): boolean;
export interface DecisionPropuesta { fecha: string; estado: "confirmada" | "descartada" | "pospuesta"; pospuestaHasta: string | null }
export interface CandidatoPropuesta {
  clienteId: string; activo: boolean; habilitadoEnFecha: boolean; tieneSolicitudAbierta: boolean;
  recurrencia: Recurrencia | null; ritmo: Ritmo | null; decisiones: DecisionPropuesta[];
}
export interface Propuesta { clienteId: string; motivos: ("recurrencia" | "ritmo")[]; fechaEsperada: string | null; ritmo: Ritmo | null }
export function propuestasParaFecha(fecha: string, diasOperacion: number[], candidatos: CandidatoPropuesta[]): Propuesta[];

// src/indicadores/cliente.ts (Claude)
export interface NumerosCliente {
  completadas: number; noAtendidas: number; ultimaVisita: string | null; ritmo: Ritmo | null;
  vecesPospuesta: number; dentroDeHorario: { porcentaje: number | null; muestra: number };
}
export function numerosDeCliente(datos: { paradas: { fecha: string; estado: string; llegadaEn: string | null;
  ventanaInicio: string; ventanaFin: string }[]; solicitudes: { fechaSolicitada: string; estado: string; vecesPospuesta: number }[] },
  hoy: string): NumerosCliente;   // ventana de 90 días

// Acciones (Claude): src/acciones/clientes.nucleo.ts y src/acciones/propuestas.nucleo.ts
export async function ubicacionDesdeTexto(ctx: Contexto, texto: unknown):
  Promise<Resultado<{ lat: number; lng: number; distanciaCalleM: number | null }>>;
export async function confirmarPropuestas(ctx: Contexto, fecha: unknown, clienteIds: unknown):
  Promise<Resultado<{ creadas: { clienteId: string; solicitudId: string; folio: string }[]; yaConfirmadas: string[] }>>;
export async function posponerPropuesta(ctx: Contexto, fecha: unknown, clienteId: unknown, dias: unknown): Promise<Resultado<null>>;
export async function descartarPropuesta(ctx: Contexto, fecha: unknown, clienteId: unknown, nota: unknown): Promise<Resultado<null>>;
export async function agregarNota(ctx: Contexto, clienteId: unknown, entrada: unknown): Promise<Resultado<{ id: string }>>;

// Consultas (Claude): filtros en listarClientes, más
export interface FiltrosCartera {
  texto?: string; residuo?: TipoResiduo; estado?: "completo" | "incompleto" | "habilitado" | "no_habilitado";
  sinUbicacion?: boolean; documentos?: "por_vencer" | "vencidos"; activos?: "activos" | "inactivos" | "todos";
}
// FichaCliente agrega: historial (página), numeros: NumerosCliente, notas (última versión de cada una, con corregida),
//                      ritmo: Ritmo | null.
export async function propuestasDeRecoleccion(ctx: Contexto, fecha?: unknown): Promise<Resultado<{ fecha: string;
  propuestas: (Propuesta & { nombre: string; ultimaSolicitud: string | null })[] }>>;
export async function mapaCartera(ctx: Contexto, filtros: unknown): Promise<Resultado<{ puntos: { clienteId: string; nombre: string;
  lat: number; lng: number; estado: "completo_habilitado" | "incompleto" | "no_habilitado" }[]; sinUbicacion: number; estiloMapaUrl: string }>>;
```

## 3. Comandos

```bash
c() { docker compose -p rs-claude-plan-crm -f compose.yaml -f compose.test.yaml "$@"; }
c run --rm unit npx vitest run --project unidad src/dominio/clientes
c run --rm unit npm run verificar
c run --rm integration npx vitest run --project integracion src/acciones/crm
c run --rm --build e2e
scripts/verificar-todo.sh          # al cierre, árbol limpio y sin tocar nada mientras corre
```

---

### PC-0: Contratos (Claude; parte de Codex reasignada)

- [ ] **Paso 1.** Escribir las firmas de §2. Las funciones nuevas lanzan `"pendiente: PC-n"`. Los campos nuevos de `Cliente` se llenan por ahora con valores neutros en `src/datos/clientes.ts` y en las pruebas de ejemplo.
- [ ] **Paso 2.** Correr `c run --rm unit npm run verificar`. Esperado: verde, con las pruebas de hoy.
- [ ] **Paso 3.** Commit `Plan CRM PC-0: contratos que compilan`, con la nota de la reasignación. Crear `codex/plan-crm`.

### PC-1: Migración 0009 y datos (Claude)

**Archivos:**
- `src/datos/esquema.ts`:
  - `clientes.contacto_correo`, `clientes.contacto_puesto`;
  - `clientes.contactos_adicionales jsonb NOT NULL DEFAULT '[]'`, con `CHECK` de arreglo;
  - `clientes.recurrencia jsonb`;
  - enum `canal_solicitud` agrega `propuesta`;
  - tablas `notas_cliente` y `propuestas_recoleccion` según la especificación §4.4 y §4.8, con `UNIQUE (cliente_id, fecha)` en propuestas.
- `drizzle/0009_cartera.sql`.
- `infra/db/permisos.sql`: `rs_app` sin UPDATE ni DELETE en `notas_cliente` y `propuestas_recoleccion`.
- `src/seguridad/permisos.ts`: `clientes.exportar`.
- `src/datos/clientes.ts`: lee y escribe los campos nuevos.
- Nuevos `src/datos/notas.ts` y `src/datos/propuestas.ts`.

- [ ] **Paso 1: pruebas que fallan** (`src/datos/crm.integracion.test.ts`):
  - `un cliente guarda y lee contactos adicionales, correo, puesto y recurrencia`;
  - `notas_cliente y propuestas_recoleccion sin UPDATE ni DELETE para rs_app`;
  - `dos decisiones para el mismo cliente y fecha violan el índice único`;
  - `el canal propuesta existe`.
- [ ] **Paso 2.** Correr las pruebas. Esperado: FALLA.
- [ ] **Paso 3.** Implementar. Correr las pruebas, `src/datos/migraciones` y la integración completa. Esperado: verde.
- [ ] **Paso 4.** Commit `Plan CRM PC-1: migración 0009 (contactos, recurrencia, notas y propuestas)`.

### PC-2: Dominio puro (Claude, reasignada; Codex la revisa)

**Archivos:**
- `src/dominio/clientes/horarios.ts`, `ubicacion.ts`, `csv.ts`, `esquemas.ts` (contactos con el mismo validador de teléfono y correo opcional, recurrencia) y `formulario.ts`.
- `src/dominio/solicitudes/propuestas.ts`.
- Pruebas `*.test.ts` junto a cada uno.

- [ ] **Paso 1: pruebas que fallan.** Valores a mano:
  - `leerHorarios("lun-vie 08:00-14:00; sab 09:00-12:00")` da 6 ventanas; acepta acentos y mayúsculas; rechaza `"lunes a viernes 8-2"` con el mensaje de la especificación §4.1; ida y vuelta con `escribirHorarios`.
  - `leerUbicacion` reconoce:
    - `20.62, -100.30`;
    - `https://maps.google.com/?q=20.62,-100.3`;
    - `https://www.google.com/maps/@20.62,-100.3,17z`;
    - `…!3d20.62!4d-100.3`;
    - `https://maps.apple.com/?ll=20.62,-100.3`;
    - `geo:20.62,-100.3`.
    
    Y responde:
    - `enlace_corto` para `https://maps.app.goo.gl/abc`;
    - `fuera_de_mexico` para `40.4,-3.7`;
    - `no_reconocido` para un enlace de lugar sin coordenadas, con el mensaje de "Compartir → Copiar coordenadas" (enfoque 2).
  - `analizarClientesCsv` lee:
    - un archivo con `;` y otro en Windows-1252 con "Querétaro" (enfoque 1);
    - las columnas nuevas, con error si `ubicacion` y `lat/lng` no coinciden y error "Enlace corto: …" en el CSV;
    - un CSV con las columnas viejas, igual que hoy.
    
    Y `filaCsvDeCliente` hace ida y vuelta con `analizarClientesCsv`.
  - Contactos adicionales: teléfonos `+52 442 123 4567` y `442-123-45-67 ext 3` válidos o inválidos igual que el principal; más de 10 se rechazan (enfoque 3).
  - `ritmoAprendido`:
    - dos fechas dan `null`;
    - `["2026-09-01","2026-09-08","2026-09-16","2026-09-22"]` con hoy `2026-10-01` da `{ dias: 7, ultima: "2026-09-22", muestra: 4 }`, con la mediana de 7, 8 y 6;
    - las fechas de más de 180 días no cuentan.
  - `propuestasParaFecha`:
    - entra la fecha esperada D − 3 y no entra D − 4;
    - una sola propuesta con dos motivos;
    - fuera: solicitud abierta, inactivo, no habilitado, día que no es de operación (enfoque 4), decisión del mismo día y pospuesta vigente;
    - entra de nuevo cuando `pospuestaHasta` ya pasó.
  - `tocaRecurrencia` para días de la semana y para cada N días desde una fecha.
- [ ] **Paso 2.** Correr `c run --rm unit npx vitest run --project unidad src/dominio/clientes src/dominio/solicitudes`. Esperado: FALLA.
- [ ] **Paso 3.** Implementar. Papa Parse con `delimiter` detectado por el encabezado y `TextDecoder("utf-8", { fatal: true })`, que cae a `"windows-1252"` si el UTF-8 no es válido.
- [ ] **Paso 4.** Correr `npm run verificar`. Esperado: verde.
- [ ] **Paso 5.** Commit `Plan CRM PC-2: horarios, ubicación, CSV completo, contactos, recurrencia y propuestas`, con la nota de la reasignación.

### PC-3: Acciones y API (Claude)

**Archivos:**
- `src/acciones/clientes.nucleo.ts`: guardar con los campos nuevos, `ubicacionDesdeTexto` y `agregarNota`.
- `src/acciones/importar.nucleo.ts` (o donde viva hoy la importación): guarda lo nuevo.
- `src/acciones/propuestas.nucleo.ts`.
- `src/traslados/index.ts`: `distanciaACalle(punto, opciones) → number | null`, con `/nearest`.
- `src/app/api/clientes/plantilla/route.ts` y `src/app/api/clientes/csv/route.ts`.
- `scripts/suprimir-notas-cliente.mts`, con el migrador como `publicar-aviso`, y su bitácora.
- Pruebas: `src/acciones/crm.integracion.test.ts`.

- [ ] **Paso 1: pruebas que fallan.**
  - `importar un CSV con todas las columnas deja fichas completas (K5) y exportar → importar da los mismos datos`;
  - `ubicacionDesdeTexto resuelve un enlace corto contra un servidor falso (redirección a ?q=lat,lng), corta tras 3 saltos o 3 s, rechaza un dominio que no es de Google, y devuelve distanciaCalleM con OSRM`;
  - `confirmarPropuestas crea la solicitud con canal propuesta y registrada_en = ahora; dos confirmaciones a la vez dejan una sola y la otra en yaConfirmadas` (enfoque 5);
  - `no confirma a un cliente que ya tiene solicitud abierta`;
  - `posponer 7 días lo esconde hasta D + 7; descartar vale solo para D`;
  - `agregarNota respeta tipo y largo, corregir crea otra nota, y la bitácora guarda ["tipo","texto"]`;
  - `GET /api/clientes/csv: 403 para gerencia; para el despachador, CSV con BOM y fórmulas neutralizadas, y bitácora exportar_clientes`;
  - `GET /api/clientes/plantilla con el permiso clientes.importar`;
  - `el script suprime las notas de un cliente y deja su renglón en la bitácora`.
- [ ] **Paso 2.** Correr `c run --rm integration npx vitest run --project integracion src/acciones/crm`. Esperado: FALLA.
- [ ] **Paso 3.** Implementar.
  - La confirmación bloquea al cliente (`bloquearCliente`), comprueba que no tenga solicitud abierta, inserta la solicitud y la decisión, y registra la bitácora, todo en una transacción. El índice único resuelve la carrera.
  - El enlace corto se sigue con `redirect: "manual"` y una lista de hosts permitidos.
- [ ] **Paso 4.** Correr las pruebas y la integración completa. Esperado: verde.
- [ ] **Paso 5.** Commit `Plan CRM PC-3: acciones de cartera, propuestas, notas, plantilla y exportación`.

### PC-4: Consultas e indicadores (Claude)

**Archivos:** `src/consultas/clientes.nucleo.ts` (filtros, ficha y mapa), `src/consultas/propuestas.nucleo.ts`, `src/indicadores/cliente.ts`, `src/consultas/indicadores.nucleo.ts` (K2 sin `propuesta` y aparte) y sus pruebas.

- [ ] **Paso 1: pruebas que fallan.**
  - `numerosDeCliente`, con valores a mano: 3 completadas, 1 no atendida y 2 de 3 llegadas en horario dan 66.7 % con muestra 3;
  - `listarClientes con cada filtro y combinado con texto; K5 no cambia con los filtros; insignia de documento por vencer`;
  - `obtenerFicha trae historial paginado, números, notas con su última versión y ritmo`;
  - `propuestasDeRecoleccion para el siguiente día de operación por omisión`;
  - `mapaCartera con estados y conteo sin ubicación`;
  - `K2 del panel excluye las solicitudes de canal propuesta y las reporta aparte`.
- [ ] **Paso 2.** Correr las pruebas. Esperado: FALLA.
- [ ] **Paso 3.** Implementar. Cada consulta lee en una sola instantánea (`leerInstantanea`).
- [ ] **Paso 4.** Correr `npm run verificar` y la integración. Esperado: verde.
- [ ] **Paso 5.** Commit `Plan CRM PC-4: filtros, historial, números por cliente, propuestas y mapa`.

### PC-5: Pantallas y e2e (Codex)

**Nombres accesibles** (para el e2e):
- en la ficha, las regiones "Historial", "Números del cliente", "Contactos", "Notas de seguimiento" y "Recurrencia"; el campo "Pegar ubicación";
- en la lista, la región "Filtros" y el enlace "Exportar CSV";
- la página "Mapa de la cartera";
- en Solicitudes, la región "Propuestas para <fecha>" con botones "Confirmar seleccionadas", "Posponer" y "Descartar";
- en importar, "Descargar plantilla".

- [ ] **Paso 1.** Pantallas según la especificación §4 y estos nombres. En notas, el aviso "No escribas datos sensibles". En propuestas, los motivos ("pide cada ~7 días; última hace 8" y "recurrencia: martes y viernes").
- [ ] **Paso 2.** e2e (`e2e/clientes.spec.ts` y `e2e/solicitudes.spec.ts`):
  - descargar la plantilla e importar una fila completa;
  - pegar el enlace de WhatsApp y ver el pin;
  - agregar y corregir una nota;
  - filtrar y exportar;
  - abrir el mapa;
  - confirmar una propuesta (con una ayuda de Claude que siembre el historial de un cliente).
- [ ] **Paso 3.** Claude corre `npm run verificar` y el e2e. Esperado: verde. Commit con "Autor: Codex".

### PC-6: Documentación y cierre (Ambos)

- [ ] **Paso 1** (Claude). Documentación:
  - `docs/legal`: notas de seguimiento como registros de comunicación; consulta a Google de los enlaces cortos; exportación en el procedimiento interno. Todo marcado para el abogado.
  - Guía de auditoría, invariantes:
    - 31: ninguna solicitud se crea sin confirmación;
    - 32: notas y decisiones solo se agregan;
    - 33: cada exportación queda en la bitácora.
  - Especificación del piloto §6, §9 y §16; hoja de ruta (Plan CRM antes del Plan 8); `docs/README.md`.
  - En el plan del Plan 8: migración `0010` e invariantes desde 34.
- [ ] **Paso 2.** Revisión cruzada: Codex revisa PC-0 a PC-4; Claude revisa PC-5.
- [ ] **Paso 3.** `scripts/verificar-todo.sh` sobre el mismo commit. Esperado: "Verificación completa: todo en verde.".
- [ ] **Paso 4.** Veredicto de ambos. Merge `--no-ff` a `main` y etiqueta `plan-crm-validado`. Sin push.
