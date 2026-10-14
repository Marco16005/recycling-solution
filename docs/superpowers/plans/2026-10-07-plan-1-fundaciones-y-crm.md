# Plan 1 — Fundaciones y CRM de clientes — Implementation Plan

> **Sustituido el 2026-10-13 por `2026-10-13-plan-1-v2-fundaciones-y-crm.md`.** Se conserva como referencia del código verificado el 2026-10-07; lo que dependa de Clerk, Neon o Vercel ya no aplica.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar funcionando el CRM de clientes de Recycling Solution: alta, edición, listado con estado de completitud, ubicación en mapa e importación desde CSV, con inicio de sesión y roles.

**Architecture:** Una aplicación Next.js. Las reglas viven en `src/dominio` (funciones puras), el acceso a Postgres en `src/datos` (Drizzle), la autorización en `src/seguridad` y los casos de uso en `src/acciones`; las pantallas de `src/app` solo llaman acciones. Las pruebas de datos y acciones corren contra un Postgres en memoria (PGlite), sin infraestructura.

**Tech Stack:** Next.js 16 (App Router, Cache Components), TypeScript, Tailwind + shadcn/ui, Drizzle ORM sobre Postgres (Neon), Clerk, Zod 4, MapLibre GL, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-recycling-solution-piloto-design.md` (este plan implementa de la Etapa 1 lo relativo a clientes: §6 `usuarios`, `clientes`, `ventanas_cliente`, `documentos_cliente`, `configuracion`, `bitacora`; §7 regla 3 en lo que toca a documentos; §9 pantalla Clientes; §10; §11 K5).

**Estado del código de este plan:** todo el código incluido se ejecutó el 2026-10-07 en un proyecto desechable con Next.js 16.4.0, Zod 4.6.5, Drizzle ORM 0.45.3, Vitest 5.0.3, Clerk 7.9.11 y MapLibre GL 6.13.0: 46 pruebas en verde, `tsc` y `eslint` sin errores y `next build` exitoso. Lo único no ejecutado es lo que depende de cuentas reales (Tarea 10 y las pruebas de punta a punta de la Tarea 12).

## Global Constraints

- Directorio de trabajo: `/Users/maantora/Desktop/F2/recycling-solution`. Gestor de paquetes: `npm` (Node 24).
- Antes de escribir código de Next.js, leer la guía correspondiente en `node_modules/next/dist/docs/` (lo exige el `AGENTS.md` que genera el andamiaje).
- Cache Components está activo: toda lectura de sesión, `params`, `searchParams` o base de datos se dibuja dentro de un `<Suspense>`.
- El archivo de intercepción de peticiones se llama `src/proxy.ts` (no `middleware.ts`).
- Vocabulario del dominio en español, igual que en el Documento Integrador: `clientes`, `ventanas`, `documentos`, `bitacora`. Código técnico genérico en inglés.
- Toda acción del servidor empieza por autorizar el rol, valida la entrada con Zod en el servidor y deja un renglón en la bitácora por cada escritura.
- El navegador nunca accede a la base de datos; solo las acciones y las páginas del servidor.
- Las fechas calendario se calculan en la zona `America/Mexico_City`; los instantes se guardan como `timestamptz`.
- El repositorio no contiene datos reales de clientes ni secretos. `.env.local` no se versiona.
- `@types/node` debe ser `^24` (Vitest 5 no acepta la versión 20 que instala el andamiaje).

## Review Focus

Entradas que la especificación no enumera y que con más probabilidad afectarían a quien use el CRM. Cada una tiene su prueba en la tarea indicada.

1. **Coordenadas invertidas o fuera de México** al capturar a mano: se rechazan con un mensaje junto al campo (Tarea 2, y de punta a punta en la Tarea 12).
2. **Ventana que cruza la medianoche o que se traslapa** con otra del mismo día: se rechaza; ventanas contiguas sí se aceptan (Tarea 2).
3. **Documento marcado como vigente cuya fecha ya venció:** cuenta como vencido y aparece como documento pendiente en la lista (Tareas 3 y 7).
4. **CSV exportado desde Excel en español** (BOM, punto y coma, coma decimal, renglones vacíos): se lee bien y los errores citan la línea real del archivo (Tarea 5).
5. **Identificador mal formado o inexistente** en la URL o al guardar: responde "no encontrado" en vez de un error de base de datos (Tareas 7, 9 y 11).

---

### Task 1: Proyecto base y regla de completitud del cliente

**Files:**
- Create: andamiaje de Next.js en la raíz del proyecto (lo genera `create-next-app`; respeta la carpeta `docs/` existente)
- Create: `vitest.config.ts`
- Create: `src/dominio/clientes/tipos.ts`, `src/dominio/clientes/completitud.ts`, `src/dominio/tiempo.ts`
- Test: `src/dominio/clientes/completitud.test.ts`, `src/dominio/tiempo.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nada.
- Produces: tipos `Cliente`, `ClienteGuardado`, `Ventana`, `DocumentoCliente`, `TipoResiduo`, `TipoUnidad`, `EstadoDocumento` y las constantes `TIPOS_RESIDUO`, `TIPOS_UNIDAD`, `ESTADOS_DOCUMENTO`; `faltantesDeCliente(c): Faltante[]`, `estaCompleto(c): boolean`, `porcentajeCompletos(clientes): number`; `fechaEnMexico(instante: Date): string` ("AAAA-MM-DD").

- [ ] **Step 1: Crear el proyecto**

```bash
cd /Users/maantora/Desktop/F2/recycling-solution
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
npm install -D vitest "@types/node@^24"
```

Expected: `Success! Created recycling-solution`, con un primer commit "Initial commit from Create Next App" (el andamiaje inicializa git). `docs/` sigue intacta.

- [ ] **Step 2: Configurar Vitest y los scripts**

`vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

En `package.json`, dentro de `"scripts"`, agregar:

```json
"test": "vitest run",
"typecheck": "tsc --noEmit",
"verificar": "npm run typecheck && npm run lint && npm run test"
```

- [ ] **Step 3: Escribir las pruebas que fallan**

`src/dominio/clientes/completitud.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { estaCompleto, faltantesDeCliente, porcentajeCompletos } from "./completitud";

const completo = {
  lat: 20.61,
  lng: -100.28,
  ventanas: [{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }],
  tipoResiduo: "RME" as const,
  tiposUnidadAdmitidos: ["doble_rodada" as const],
  avisoPrivacidadAceptadoEn: new Date("2026-10-01T15:00:00Z"),
  activo: true,
};

describe("completitud del cliente", () => {
  it("un cliente con todos los datos obligatorios está completo", () => {
    expect(faltantesDeCliente(completo)).toEqual([]);
    expect(estaCompleto(completo)).toBe(true);
  });

  it("lista cada dato que falta, en orden fijo", () => {
    const vacio = { lat: null, lng: null, ventanas: [], tipoResiduo: null, tiposUnidadAdmitidos: [], avisoPrivacidadAceptadoEn: null };
    expect(faltantesDeCliente(vacio)).toEqual(["ubicacion", "ventana", "tipo_residuo", "tipos_unidad", "aviso_privacidad"]);
  });

  it("una coordenada sin la otra cuenta como ubicación faltante", () => {
    expect(faltantesDeCliente({ ...completo, lng: null })).toEqual(["ubicacion"]);
  });

  it("K5 solo cuenta clientes activos", () => {
    const incompleto = { ...completo, tipoResiduo: null };
    const inactivoIncompleto = { ...incompleto, activo: false };
    expect(porcentajeCompletos([completo, incompleto, inactivoIncompleto])).toBe(50);
  });

  it("K5 sin clientes activos es 0", () => {
    expect(porcentajeCompletos([])).toBe(0);
  });
});
```

`src/dominio/tiempo.test.ts`

```ts
import { expect, it } from "vitest";
import { fechaEnMexico } from "./tiempo";

it("usa la fecha de Ciudad de México, no la de UTC", () => {
  // 03:00 UTC del día 8 son las 21:00 del día 7 en Ciudad de México (UTC−6)
  expect(fechaEnMexico(new Date("2026-10-08T03:00:00Z"))).toBe("2026-10-07");
  expect(fechaEnMexico(new Date("2026-10-08T18:00:00Z"))).toBe("2026-10-08");
});
```

- [ ] **Step 4: Ejecutarlas para verlas fallar**

Run: `npm test`
Expected: FAIL — no se encuentran `./completitud` ni `./tiempo`.

- [ ] **Step 5: Implementar**

`src/dominio/clientes/tipos.ts`

```ts
export const TIPOS_RESIDUO = ["RSU", "RME", "RP"] as const;
export type TipoResiduo = (typeof TIPOS_RESIDUO)[number];

export const TIPOS_UNIDAD = ["doble_rodada", "rabon", "camioneta"] as const;
export type TipoUnidad = (typeof TIPOS_UNIDAD)[number];

export const ESTADOS_DOCUMENTO = ["vigente", "pendiente", "vencido"] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

/** Horas en formato "HH:MM" (24 h). diaSemana: 0 = domingo … 6 = sábado. */
export interface Ventana {
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
}

/** venceEl en formato "AAAA-MM-DD" o null si no vence. */
export interface DocumentoCliente {
  nombre: string;
  obligatorio: boolean;
  estado: EstadoDocumento;
  venceEl: string | null;
}

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
  avisoPrivacidadAceptadoEn: Date | null;
  activo: boolean;
  ventanas: Ventana[];
  documentos: DocumentoCliente[];
}

export type ClienteGuardado = Cliente & { id: string };
```

`src/dominio/clientes/completitud.ts`

```ts
import type { Cliente } from "./tipos";

export type Faltante = "ubicacion" | "ventana" | "tipo_residuo" | "tipos_unidad" | "aviso_privacidad";

type DatosDeCompletitud = Pick<
  Cliente,
  "lat" | "lng" | "ventanas" | "tipoResiduo" | "tiposUnidadAdmitidos" | "avisoPrivacidadAceptadoEn"
>;

/** Regla de completitud de la especificación (§6): lo que le falta a un cliente para poder rutearse. */
export function faltantesDeCliente(c: DatosDeCompletitud): Faltante[] {
  const faltan: Faltante[] = [];
  if (c.lat === null || c.lng === null) faltan.push("ubicacion");
  if (c.ventanas.length === 0) faltan.push("ventana");
  if (c.tipoResiduo === null) faltan.push("tipo_residuo");
  if (c.tiposUnidadAdmitidos.length === 0) faltan.push("tipos_unidad");
  if (c.avisoPrivacidadAceptadoEn === null) faltan.push("aviso_privacidad");
  return faltan;
}

export function estaCompleto(c: DatosDeCompletitud): boolean {
  return faltantesDeCliente(c).length === 0;
}

/** Indicador K5: porcentaje (0 a 100) de clientes activos completos. Sin clientes activos devuelve 0. */
export function porcentajeCompletos(clientes: (DatosDeCompletitud & Pick<Cliente, "activo">)[]): number {
  const activos = clientes.filter((c) => c.activo);
  if (activos.length === 0) return 0;
  return (activos.filter(estaCompleto).length / activos.length) * 100;
}
```

`src/dominio/tiempo.ts`

```ts
/** Fecha calendario "AAAA-MM-DD" en la zona horaria de operación (Ciudad de México). */
export function fechaEnMexico(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}
```

- [ ] **Step 6: Ejecutarlas para verlas pasar**

Run: `npm run verificar`
Expected: PASS — 2 archivos de prueba, 6 pruebas; `tsc` y `eslint` sin errores.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: proyecto base y regla de completitud del cliente"
```

### Task 2: Validación del cliente

**Files:**
- Create: `src/dominio/clientes/esquemas.ts`
- Test: `src/dominio/clientes/esquemas.test.ts`

**Interfaces:**
- Consumes: constantes de `tipos.ts` (Task 1).
- Produces: `clienteSchema`, `ventanaSchema`, `documentoSchema`; tipo `ClienteEntrada` (igual que `Cliente` pero con `avisoPrivacidadAceptado: boolean` en lugar de la fecha); `erroresPorCampo(error): Record<string, string[]>` con llaves como `"lat"` o `"ventanas.0.horaFin"`.

- [ ] **Step 1: Instalar Zod y escribir la prueba que falla**

```bash
npm install zod
```

`src/dominio/clientes/esquemas.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { clienteSchema, erroresPorCampo, type ClienteEntrada } from "./esquemas";

export const clienteValido: ClienteEntrada = {
  nombre: "Cartonera del Bajío",
  contactoNombre: "Laura Méndez",
  contactoTelefono: "442 555 0101",
  direccion: "Av. del Marqués 100, El Marqués, Qro.",
  lat: 20.6102,
  lng: -100.2801,
  tipoResiduo: "RME",
  material: "Cartón nacional",
  tiposUnidadAdmitidos: ["doble_rodada"],
  notasAcceso: "Registro en caseta; casco y chaleco",
  tiempoServicioMin: 66,
  cargaEstimadaKg: 1800,
  avisoPrivacidadAceptado: true,
  activo: true,
  ventanas: [{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }],
  documentos: [{ nombre: "SUA vigente", obligatorio: true, estado: "vigente", venceEl: "2026-12-31" }],
};

function errores(entrada: unknown) {
  const r = clienteSchema.safeParse(entrada);
  return r.success ? {} : erroresPorCampo(r.error);
}

describe("clienteSchema", () => {
  it("acepta un cliente válido y recorta espacios", () => {
    const r = clienteSchema.safeParse({ ...clienteValido, nombre: "  Cartonera del Bajío  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nombre).toBe("Cartonera del Bajío");
  });

  it("acepta un cliente apenas dado de alta, sin ubicación ni ventanas", () => {
    const minimo = { ...clienteValido, lat: null, lng: null, tipoResiduo: null, tiposUnidadAdmitidos: [], ventanas: [], documentos: [] };
    expect(errores(minimo)).toEqual({});
  });

  it("rechaza coordenadas invertidas (latitud y longitud intercambiadas)", () => {
    const e = errores({ ...clienteValido, lat: -100.2801, lng: 20.6102 });
    expect(e.lat).toEqual(["Latitud fuera de México"]);
    expect(e.lng).toEqual(["Longitud fuera de México"]);
  });

  it("rechaza una coordenada sin la otra", () => {
    expect(errores({ ...clienteValido, lng: null }).lat).toEqual(["Latitud y longitud se capturan juntas"]);
  });

  it("rechaza una ventana que cruza la medianoche", () => {
    const e = errores({ ...clienteValido, ventanas: [{ diaSemana: 1, horaInicio: "22:00", horaFin: "02:00" }] });
    expect(e["ventanas.0.horaFin"]?.[0]).toMatch(/medianoche/);
  });

  it("rechaza ventanas que se traslapan el mismo día, pero no en días distintos", () => {
    const traslape = [
      { diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" },
      { diaSemana: 1, horaInicio: "11:00", horaFin: "14:00" },
    ];
    expect(errores({ ...clienteValido, ventanas: traslape }).ventanas).toEqual(["Hay ventanas que se traslapan en el mismo día"]);
    const diasDistintos = [traslape[0], { ...traslape[1], diaSemana: 2 }];
    expect(errores({ ...clienteValido, ventanas: diasDistintos })).toEqual({});
  });

  it("acepta ventanas contiguas (una termina cuando empieza la otra)", () => {
    const contiguas = [
      { diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" },
      { diaSemana: 1, horaInicio: "12:00", horaFin: "15:00" },
    ];
    expect(errores({ ...clienteValido, ventanas: contiguas })).toEqual({});
  });

  it("rechaza teléfono con letras y tiempo de servicio fuera de rango", () => {
    const e = errores({ ...clienteValido, contactoTelefono: "llamar a Laura", tiempoServicioMin: 0 });
    expect(e.contactoTelefono).toEqual(["Teléfono no válido"]);
    expect(e.tiempoServicioMin).toBeDefined();
  });
});
```

- [ ] **Step 2: Ejecutarla para verla fallar**

Run: `npx vitest run src/dominio/clientes/esquemas.test.ts`
Expected: FAIL — no se encuentra `./esquemas`.

- [ ] **Step 3: Implementar**

`src/dominio/clientes/esquemas.ts`

```ts
import { z } from "zod";
import { ESTADOS_DOCUMENTO, TIPOS_RESIDUO, TIPOS_UNIDAD } from "./tipos";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TELEFONO = /^[0-9+() -]{7,20}$/;

/** Caja que contiene a México; atrapa coordenadas invertidas o capturadas en otro país. */
const MEXICO = { latMin: 14.5, latMax: 32.8, lngMin: -118.5, lngMax: -86.5 };

export const ventanaSchema = z
  .object({
    diaSemana: z.number().int().min(0).max(6),
    horaInicio: z.string().regex(HORA, "Usa el formato HH:MM"),
    horaFin: z.string().regex(HORA, "Usa el formato HH:MM"),
  })
  .refine((v) => v.horaInicio < v.horaFin, {
    message: "La hora de inicio debe ser anterior a la de fin (una ventana no puede cruzar la medianoche)",
    path: ["horaFin"],
  });

export const documentoSchema = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre del documento").max(120),
  obligatorio: z.boolean(),
  estado: z.enum(ESTADOS_DOCUMENTO),
  venceEl: z.string().regex(FECHA, "Usa el formato AAAA-MM-DD").nullable(),
});

export const clienteSchema = z
  .object({
    nombre: z.string().trim().min(2, "Escribe el nombre del cliente").max(160),
    contactoNombre: z.string().trim().max(120).nullable(),
    contactoTelefono: z.string().trim().regex(TELEFONO, "Teléfono no válido").nullable(),
    direccion: z.string().trim().max(300).nullable(),
    lat: z.number().min(MEXICO.latMin, "Latitud fuera de México").max(MEXICO.latMax, "Latitud fuera de México").nullable(),
    lng: z.number().min(MEXICO.lngMin, "Longitud fuera de México").max(MEXICO.lngMax, "Longitud fuera de México").nullable(),
    tipoResiduo: z.enum(TIPOS_RESIDUO).nullable(),
    material: z.string().trim().max(120).nullable(),
    tiposUnidadAdmitidos: z.array(z.enum(TIPOS_UNIDAD)).max(TIPOS_UNIDAD.length),
    notasAcceso: z.string().trim().max(500).nullable(),
    tiempoServicioMin: z.number().int().min(5).max(480),
    cargaEstimadaKg: z.number().int().min(0).max(40000).nullable(),
    avisoPrivacidadAceptado: z.boolean(),
    activo: z.boolean(),
    ventanas: z.array(ventanaSchema).max(21),
    documentos: z.array(documentoSchema).max(30),
  })
  .superRefine((c, ctx) => {
    if ((c.lat === null) !== (c.lng === null)) {
      ctx.addIssue({ code: "custom", path: ["lat"], message: "Latitud y longitud se capturan juntas" });
    }
    const porDia = new Map<number, { inicio: string; fin: string }[]>();
    for (const v of c.ventanas) {
      const lista = porDia.get(v.diaSemana) ?? [];
      lista.push({ inicio: v.horaInicio, fin: v.horaFin });
      porDia.set(v.diaSemana, lista);
    }
    for (const lista of porDia.values()) {
      lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
      for (let i = 1; i < lista.length; i++) {
        if (lista[i].inicio < lista[i - 1].fin) {
          ctx.addIssue({ code: "custom", path: ["ventanas"], message: "Hay ventanas que se traslapan en el mismo día" });
          return;
        }
      }
    }
  });

export type ClienteEntrada = z.infer<typeof clienteSchema>;

/** Convierte los errores de Zod en { "campo.subcampo": ["mensaje", …] } para mostrarlos en el formulario. */
export function erroresPorCampo(error: z.ZodError): Record<string, string[]> {
  const salida: Record<string, string[]> = {};
  for (const problema of error.issues) {
    const campo = problema.path.join(".") || "_";
    (salida[campo] ??= []).push(problema.message);
  }
  return salida;
}
```

- [ ] **Step 4: Ejecutarla para verla pasar**

Run: `npx vitest run src/dominio/clientes/esquemas.test.ts`
Expected: PASS — 8 pruebas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: validación de la ficha del cliente"
```

### Task 3: Documentos que bloquean una recolección

**Files:**
- Create: `src/dominio/clientes/documentos.ts`
- Test: `src/dominio/clientes/documentos.test.ts`

**Interfaces:**
- Consumes: `DocumentoCliente`, `EstadoDocumento` (Task 1).
- Produces: `estadoEfectivo(doc, hoy: string): EstadoDocumento`; `documentosQueBloquean(docs, hoy: string): string[]` (nombres de los obligatorios no vigentes). `hoy` en formato "AAAA-MM-DD". El motor de ruteo (Plan 3) reutiliza esta función.

- [ ] **Step 1: Escribir la prueba que falla**

`src/dominio/clientes/documentos.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { documentosQueBloquean, estadoEfectivo } from "./documentos";
import type { DocumentoCliente } from "./tipos";

const doc = (p: Partial<DocumentoCliente>): DocumentoCliente => ({
  nombre: "SUA", obligatorio: true, estado: "vigente", venceEl: null, ...p,
});

describe("documentos del cliente", () => {
  it("un documento vigente con fecha de vencimiento pasada cuenta como vencido", () => {
    expect(estadoEfectivo(doc({ venceEl: "2026-10-06" }), "2026-10-07")).toBe("vencido");
  });

  it("el día del vencimiento todavía es vigente", () => {
    expect(estadoEfectivo(doc({ venceEl: "2026-10-07" }), "2026-10-07")).toBe("vigente");
  });

  it("sin fecha de vencimiento conserva su estado", () => {
    expect(estadoEfectivo(doc({ estado: "pendiente" }), "2026-10-07")).toBe("pendiente");
  });

  it("solo bloquean los obligatorios que no están vigentes", () => {
    const docs = [
      doc({ nombre: "SUA" }),
      doc({ nombre: "Póliza", estado: "pendiente" }),
      doc({ nombre: "Opcional", obligatorio: false, estado: "vencido" }),
      doc({ nombre: "Licencia", venceEl: "2026-01-01" }),
    ];
    expect(documentosQueBloquean(docs, "2026-10-07")).toEqual(["Póliza", "Licencia"]);
  });
});
```

- [ ] **Step 2: Ejecutarla para verla fallar**

Run: `npx vitest run src/dominio/clientes/documentos.test.ts`
Expected: FAIL — no se encuentra `./documentos`.

- [ ] **Step 3: Implementar**

`src/dominio/clientes/documentos.ts`

```ts
import type { DocumentoCliente, EstadoDocumento } from "./tipos";

/**
 * Estado real de un documento en la fecha dada ("AAAA-MM-DD").
 * Un documento marcado como vigente cuya fecha de vencimiento ya pasó cuenta como vencido.
 */
export function estadoEfectivo(doc: DocumentoCliente, hoy: string): EstadoDocumento {
  if (doc.estado === "vigente" && doc.venceEl !== null && doc.venceEl < hoy) return "vencido";
  return doc.estado;
}

/** Nombres de los documentos obligatorios que impiden programar una recolección en la fecha dada. */
export function documentosQueBloquean(docs: DocumentoCliente[], hoy: string): string[] {
  return docs.filter((d) => d.obligatorio && estadoEfectivo(d, hoy) !== "vigente").map((d) => d.nombre);
}
```

- [ ] **Step 4: Ejecutarla para verla pasar**

Run: `npx vitest run src/dominio/clientes/documentos.test.ts`
Expected: PASS — 4 pruebas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: regla de documentos que bloquean la recolección"
```

### Task 4: Valores del formulario y etiquetas

**Files:**
- Create: `src/dominio/clientes/formulario.ts`, `src/dominio/clientes/etiquetas.ts`
- Test: `src/dominio/clientes/formulario.test.ts`

**Interfaces:**
- Consumes: `ClienteEntrada`, `clienteSchema` (Task 2); `ClienteGuardado` (Task 1); `Faltante` (Task 1).
- Produces: `clienteNuevo(): ClienteEntrada`; `aEntrada(cliente: ClienteGuardado): ClienteEntrada`; `DIAS_SEMANA`, `ETIQUETA_FALTANTE`, `ETIQUETA_RESIDUO`, `ETIQUETA_UNIDAD`, `ETIQUETA_ESTADO_DOCUMENTO`.

Estas dos piezas van en `src/dominio` y no en el componente del formulario porque un valor exportado desde un archivo `"use client"` no se puede usar desde una página del servidor.

- [ ] **Step 1: Escribir la prueba que falla**

`src/dominio/clientes/formulario.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { clienteSchema } from "./esquemas";
import { aEntrada, clienteNuevo } from "./formulario";
import type { ClienteGuardado } from "./tipos";

describe("valores del formulario de cliente", () => {
  it("el formulario vacío solo falla por el nombre", () => {
    const r = clienteSchema.safeParse(clienteNuevo());
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join("."))).toEqual(["nombre"]);
  });

  it("un cliente guardado se convierte en una entrada válida, sin id y con el aviso como casilla", () => {
    const guardado: ClienteGuardado = {
      ...clienteNuevo(),
      id: "00000000-0000-4000-8000-000000000001",
      nombre: "Cartonera del Bajío",
      avisoPrivacidadAceptadoEn: new Date("2026-10-07T15:00:00Z"),
    };
    const entrada = aEntrada(guardado);
    expect(entrada).not.toHaveProperty("id");
    expect(entrada).not.toHaveProperty("avisoPrivacidadAceptadoEn");
    expect(entrada.avisoPrivacidadAceptado).toBe(true);
    expect(clienteSchema.safeParse(entrada).success).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutarla para verla fallar**

Run: `npx vitest run src/dominio/clientes/formulario.test.ts`
Expected: FAIL — no se encuentra `./formulario`.

- [ ] **Step 3: Implementar**

`src/dominio/clientes/formulario.ts`

```ts
import type { ClienteEntrada } from "./esquemas";
import type { ClienteGuardado } from "./tipos";

/** Valores iniciales del formulario de alta. */
export function clienteNuevo(): ClienteEntrada {
  return {
    nombre: "",
    contactoNombre: null,
    contactoTelefono: null,
    direccion: null,
    lat: null,
    lng: null,
    tipoResiduo: null,
    material: null,
    tiposUnidadAdmitidos: [],
    notasAcceso: null,
    tiempoServicioMin: 66,
    cargaEstimadaKg: null,
    avisoPrivacidadAceptado: false,
    activo: true,
    ventanas: [],
    documentos: [],
  };
}

/** Convierte un cliente guardado en los valores del formulario de edición. */
export function aEntrada(cliente: ClienteGuardado): ClienteEntrada {
  return {
    nombre: cliente.nombre,
    contactoNombre: cliente.contactoNombre,
    contactoTelefono: cliente.contactoTelefono,
    direccion: cliente.direccion,
    lat: cliente.lat,
    lng: cliente.lng,
    tipoResiduo: cliente.tipoResiduo,
    material: cliente.material,
    tiposUnidadAdmitidos: cliente.tiposUnidadAdmitidos,
    notasAcceso: cliente.notasAcceso,
    tiempoServicioMin: cliente.tiempoServicioMin,
    cargaEstimadaKg: cliente.cargaEstimadaKg,
    avisoPrivacidadAceptado: cliente.avisoPrivacidadAceptadoEn !== null,
    activo: cliente.activo,
    ventanas: cliente.ventanas,
    documentos: cliente.documentos,
  };
}
```

`src/dominio/clientes/etiquetas.ts`

```ts
import type { Faltante } from "./completitud";
import type { EstadoDocumento, TipoResiduo, TipoUnidad } from "./tipos";

export const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

export const ETIQUETA_FALTANTE: Record<Faltante, string> = {
  ubicacion: "Falta ubicación",
  ventana: "Falta ventana horaria",
  tipo_residuo: "Falta tipo de residuo",
  tipos_unidad: "Faltan unidades admitidas",
  aviso_privacidad: "Falta aviso de privacidad",
};

export const ETIQUETA_RESIDUO: Record<TipoResiduo, string> = {
  RSU: "Sólidos urbanos (RSU)",
  RME: "Manejo especial (RME)",
  RP: "Peligrosos (RP)",
};

export const ETIQUETA_UNIDAD: Record<TipoUnidad, string> = {
  doble_rodada: "Doble rodada",
  rabon: "Rabón",
  camioneta: "Camioneta",
};

export const ETIQUETA_ESTADO_DOCUMENTO: Record<EstadoDocumento, string> = {
  vigente: "Vigente",
  pendiente: "Pendiente",
  vencido: "Vencido",
};
```

- [ ] **Step 4: Ejecutarla para verla pasar**

Run: `npx vitest run src/dominio/clientes/formulario.test.ts`
Expected: PASS — 2 pruebas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: valores iniciales del formulario y etiquetas del cliente"
```

### Task 5: Lector de CSV de clientes

**Files:**
- Create: `src/dominio/clientes/csv.ts`
- Test: `src/dominio/clientes/csv.test.ts`

**Interfaces:**
- Consumes: `clienteSchema`, `erroresPorCampo`, `ClienteEntrada` (Task 2).
- Produces: `parsearClientesCsv(contenido: string): { clientes: ClienteEntrada[]; errores: ErrorDeFila[] }`; tipo `ErrorDeFila = { linea: number; mensajes: string[] }`; `COLUMNAS_CSV`.

Lo que el archivo no trae (ventanas, documentos, unidades admitidas, aviso de privacidad) queda vacío: el cliente se importa incompleto y se termina en su ficha.

- [ ] **Step 1: Instalar el lector y escribir la prueba que falla**

```bash
npm install papaparse
npm install -D @types/papaparse
```

`src/dominio/clientes/csv.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parsearClientesCsv } from "./csv";

describe("parsearClientesCsv", () => {
  it("lee un CSV con comas y deja pendientes los datos que el archivo no trae", () => {
    const csv = [
      "nombre,contacto,telefono,direccion,lat,lng,residuo,material,servicio_min,carga_kg",
      "Cartonera del Bajío,Laura,442 555 0101,Av. del Marqués 100,20.6102,-100.2801,RME,Cartón,60,1800",
    ].join("\n");
    const r = parsearClientesCsv(csv);
    expect(r.errores).toEqual([]);
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0]).toMatchObject({
      nombre: "Cartonera del Bajío", lat: 20.6102, lng: -100.2801, tipoResiduo: "RME", tiempoServicioMin: 60,
      cargaEstimadaKg: 1800, tiposUnidadAdmitidos: [], ventanas: [], avisoPrivacidadAceptado: false, activo: true,
    });
  });

  it("tolera el formato de Excel en español: BOM, punto y coma, coma decimal y encabezados con mayúsculas", () => {
    const csv = "﻿Nombre;Lat;Lng;Residuo\r\nZeta Empaques;20,5931;-100,3899;rsu\r\n";
    const r = parsearClientesCsv(csv);
    expect(r.errores).toEqual([]);
    expect(r.clientes[0]).toMatchObject({ nombre: "Zeta Empaques", lat: 20.5931, lng: -100.3899, tipoResiduo: "RSU", tiempoServicioMin: 66 });
  });

  it("respeta comas dentro de un campo entre comillas", () => {
    const csv = 'nombre,direccion\n"Papelera, S.A. de C.V.","Calle 5, Parque Industrial"\n';
    const r = parsearClientesCsv(csv);
    expect(r.clientes[0]).toMatchObject({ nombre: "Papelera, S.A. de C.V.", direccion: "Calle 5, Parque Industrial" });
  });

  it("no importa las filas con errores y dice en qué línea están", () => {
    const csv = [
      "nombre,lat,lng,residuo",
      "Bueno,20.61,-100.28,RME",
      ",20.61,-100.28,RME",
      "Coordenadas invertidas,-100.28,20.61,RME",
      "Residuo raro,20.61,-100.28,XYZ",
      "Sin número,veinte,-100.28,RME",
    ].join("\n");
    const r = parsearClientesCsv(csv);
    expect(r.clientes.map((c) => c.nombre)).toEqual(["Bueno"]);
    expect(r.errores.map((e) => e.linea)).toEqual([3, 4, 5, 6]);
    expect(r.errores[1].mensajes.join(" ")).toMatch(/fuera de México/);
  });

  it("el número de línea del error es el del archivo aunque haya renglones vacíos antes", () => {
    const r = parsearClientesCsv("nombre,residuo\nUno,RME\n\n\nMalo,XYZ\n");
    expect(r.clientes.map((c) => c.nombre)).toEqual(["Uno"]);
    expect(r.errores.map((e) => e.linea)).toEqual([5]);
  });

  it("ignora renglones vacíos y avisa si falta la columna nombre", () => {
    expect(parsearClientesCsv("nombre\nUno\n\n\nDos\n").clientes.map((c) => c.nombre)).toEqual(["Uno", "Dos"]);
    expect(parsearClientesCsv("cliente,lat\nUno,20\n")).toEqual({
      clientes: [],
      errores: [{ linea: 1, mensajes: ['Falta la columna obligatoria "nombre"'] }],
    });
  });
});
```

- [ ] **Step 2: Ejecutarla para verla fallar**

Run: `npx vitest run src/dominio/clientes/csv.test.ts`
Expected: FAIL — no se encuentra `./csv`.

- [ ] **Step 3: Implementar**

`src/dominio/clientes/csv.ts`

```ts
import Papa from "papaparse";
import { clienteSchema, erroresPorCampo, type ClienteEntrada } from "./esquemas";

export interface ErrorDeFila {
  /** Número de línea en el archivo; el encabezado es la línea 1. */
  linea: number;
  mensajes: string[];
}

export interface ResultadoCsv {
  clientes: ClienteEntrada[];
  errores: ErrorDeFila[];
}

export const COLUMNAS_CSV = [
  "nombre", "contacto", "telefono", "direccion", "lat", "lng", "residuo", "material", "servicio_min", "carga_kg",
] as const;

const texto = (v: string | undefined): string | null => {
  const limpio = (v ?? "").trim();
  return limpio === "" ? null : limpio;
};

/** Acepta punto o coma decimal ("20.61" o "20,61"). Devuelve NaN si no es un número. */
const numero = (v: string | undefined): number | null => {
  const limpio = texto(v);
  if (limpio === null) return null;
  return Number(limpio.replace(",", "."));
};

/**
 * Convierte el CSV exportado desde Excel en clientes listos para guardar.
 * Tolera BOM, separador coma o punto y coma, encabezados con mayúsculas y coma decimal.
 * Las filas con errores no se importan; se devuelven con su número de línea.
 */
export function parsearClientesCsv(contenido: string): ResultadoCsv {
  const sinBom = contenido.replace(/^﻿/, "");
  const leido = Papa.parse<Record<string, string>>(sinBom, {
    header: true,
    skipEmptyLines: false,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const encabezados = leido.meta.fields ?? [];
  if (!encabezados.includes("nombre")) {
    return { clientes: [], errores: [{ linea: 1, mensajes: ['Falta la columna obligatoria "nombre"'] }] };
  }

  const resultado: ResultadoCsv = { clientes: [], errores: [] };
  leido.data.forEach((fila, i) => {
    const linea = i + 2;
    // Los renglones vacíos se saltan aquí (no en el lector) para que el número de línea siga siendo el del archivo.
    if (Object.values(fila).every((v) => (v ?? "").trim() === "")) return;
    const candidato = {
      nombre: fila.nombre ?? "",
      contactoNombre: texto(fila.contacto),
      contactoTelefono: texto(fila.telefono),
      direccion: texto(fila.direccion),
      lat: numero(fila.lat),
      lng: numero(fila.lng),
      tipoResiduo: texto(fila.residuo)?.toUpperCase() ?? null,
      material: texto(fila.material),
      tiposUnidadAdmitidos: [],
      notasAcceso: null,
      tiempoServicioMin: numero(fila.servicio_min) ?? 66,
      cargaEstimadaKg: numero(fila.carga_kg),
      avisoPrivacidadAceptado: false,
      activo: true,
      ventanas: [],
      documentos: [],
    };
    const validado = clienteSchema.safeParse(candidato);
    if (validado.success) {
      resultado.clientes.push(validado.data);
    } else {
      const campos = erroresPorCampo(validado.error);
      resultado.errores.push({ linea, mensajes: Object.entries(campos).map(([campo, m]) => `${campo}: ${m.join("; ")}`) });
    }
  });
  return resultado;
}
```

- [ ] **Step 4: Ejecutarla para verla pasar**

Run: `npx vitest run src/dominio/clientes/csv.test.ts`
Expected: PASS — 6 pruebas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: lector de CSV de clientes tolerante al formato de Excel"
```

### Task 6: Esquema de base de datos, base de pruebas y bitácora

**Files:**
- Create: `drizzle.config.ts`, `src/datos/esquema.ts`, `src/datos/bd.ts`, `src/datos/conexion.ts`, `src/datos/pruebas/bd-prueba.ts`, `src/datos/bitacora.ts`
- Create: `drizzle/0000_inicial.sql` (generado)
- Test: `src/datos/bitacora.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: tablas `usuarios`, `clientes`, `ventanasCliente`, `documentosCliente`, `configuracion`, `bitacora` (exportadas desde `esquema.ts`); tipos `BD` y `Tx`; `bd` (conexión real, solo para código de producción); `crearBdPrueba(): Promise<BD>`; `registrarEvento(bd: BD | Tx, evento: Evento): Promise<void>` con `Evento = { usuarioId: string | null; entidad: string; entidadId: string | null; accion: string; datos?: unknown }`.

- [ ] **Step 1: Instalar dependencias y escribir la prueba que falla**

```bash
npm install drizzle-orm pg
npm install -D drizzle-kit @electric-sql/pglite @types/pg
```

`src/datos/bitacora.test.ts`

```ts
import { expect, it } from "vitest";
import { registrarEvento } from "./bitacora";
import { bitacora } from "./esquema";
import { crearBdPrueba } from "./pruebas/bd-prueba";

it("guarda el evento con su hora y sus datos", async () => {
  const bd = await crearBdPrueba();
  await registrarEvento(bd, { usuarioId: null, entidad: "cliente", entidadId: null, accion: "crear", datos: { nombre: "X" } });
  const filas = await bd.select().from(bitacora);
  expect(filas).toHaveLength(1);
  expect(filas[0].accion).toBe("crear");
  expect(filas[0].datos).toEqual({ nombre: "X" });
  expect(filas[0].en).toBeInstanceOf(Date);
});
```

- [ ] **Step 2: Ejecutarla para verla fallar**

Run: `npx vitest run src/datos/bitacora.test.ts`
Expected: FAIL — no se encuentran `./bitacora`, `./esquema` ni `./pruebas/bd-prueba`.

- [ ] **Step 3: Escribir el esquema, la conexión y la bitácora**

`drizzle.config.ts`

```ts
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./src/datos/esquema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Las migraciones usan la conexión directa (sin pool) cuando existe.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
});
```

`src/datos/esquema.ts`

```ts
import { sql } from "drizzle-orm";
import {
  boolean, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, smallint, text, time, timestamp, uuid,
} from "drizzle-orm/pg-core";

export const rolEnum = pgEnum("rol", ["admin", "despachador", "operador", "gerencia"]);
export const tipoResiduoEnum = pgEnum("tipo_residuo", ["RSU", "RME", "RP"]);
export const tipoUnidadEnum = pgEnum("tipo_unidad", ["doble_rodada", "rabon", "camioneta"]);
export const estadoDocumentoEnum = pgEnum("estado_documento", ["vigente", "pendiente", "vencido"]);

const marcas = {
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
};

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  nombre: text("nombre").notNull(),
  rol: rolEnum("rol").notNull(),
  activo: boolean("activo").notNull().default(true),
  ...marcas,
});

export const clientes = pgTable(
  "clientes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nombre: text("nombre").notNull(),
    contactoNombre: text("contacto_nombre"),
    contactoTelefono: text("contacto_telefono"),
    direccion: text("direccion"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    tipoResiduo: tipoResiduoEnum("tipo_residuo"),
    material: text("material"),
    tiposUnidadAdmitidos: tipoUnidadEnum("tipos_unidad_admitidos").array().notNull().default(sql`'{}'::tipo_unidad[]`),
    notasAcceso: text("notas_acceso"),
    tiempoServicioMin: integer("tiempo_servicio_min").notNull().default(66),
    cargaEstimadaKg: integer("carga_estimada_kg"),
    avisoPrivacidadAceptadoEn: timestamp("aviso_privacidad_aceptado_en", { withTimezone: true }),
    activo: boolean("activo").notNull().default(true),
    ...marcas,
  },
  (t) => [index("clientes_nombre_idx").on(t.nombre)],
);

export const ventanasCliente = pgTable(
  "ventanas_cliente",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clienteId: uuid("cliente_id").notNull().references(() => clientes.id, { onDelete: "cascade" }),
    diaSemana: smallint("dia_semana").notNull(),
    horaInicio: time("hora_inicio").notNull(),
    horaFin: time("hora_fin").notNull(),
    ...marcas,
  },
  (t) => [index("ventanas_cliente_cliente_idx").on(t.clienteId)],
);

export const documentosCliente = pgTable(
  "documentos_cliente",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clienteId: uuid("cliente_id").notNull().references(() => clientes.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    obligatorio: boolean("obligatorio").notNull().default(true),
    estado: estadoDocumentoEnum("estado").notNull().default("pendiente"),
    venceEl: date("vence_el", { mode: "string" }),
    ...marcas,
  },
  (t) => [index("documentos_cliente_cliente_idx").on(t.clienteId)],
);

export const configuracion = pgTable("configuracion", {
  id: uuid("id").primaryKey().defaultRandom(),
  patioLat: doublePrecision("patio_lat"),
  patioLng: doublePrecision("patio_lng"),
  turnoInicio: time("turno_inicio").notNull().default("08:00"),
  turnoFin: time("turno_fin").notNull().default("16:00"),
  velocidadKmh: doublePrecision("velocidad_kmh").notNull().default(30),
  factorCircuidad: doublePrecision("factor_circuidad").notNull().default(1.4),
  descargaMin: integer("descarga_min").notNull().default(20),
  lineaBase: jsonb("linea_base").notNull().default({ esperaMin: 15, trasladoMin: 45, cicloMin: 161 }),
  ...marcas,
});

export const bitacora = pgTable(
  "bitacora",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    en: timestamp("en", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: uuid("usuario_id").references(() => usuarios.id),
    entidad: text("entidad").notNull(),
    entidadId: uuid("entidad_id"),
    accion: text("accion").notNull(),
    datos: jsonb("datos"),
  },
  (t) => [index("bitacora_entidad_idx").on(t.entidad, t.entidadId)],
);
```

`src/datos/bd.ts`

```ts
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as esquema from "./esquema";

/** Tipo común a la conexión real (node-postgres) y a la de pruebas (PGlite). */
export type BD = PgDatabase<PgQueryResultHKT, typeof esquema>;

/** Manejador dentro de una transacción. */
export type Tx = Parameters<Parameters<BD["transaction"]>[0]>[0];
```

`src/datos/conexion.ts`

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { BD } from "./bd";
import * as esquema from "./esquema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

/** Conexión real a Postgres. Las pruebas no la usan: reciben una base en memoria. */
export const bd: BD = drizzle(pool, { schema: esquema });
```

`src/datos/pruebas/bd-prueba.ts`

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { BD } from "../bd";
import * as esquema from "../esquema";

/** Postgres en memoria con todas las migraciones aplicadas. Una base nueva por llamada. */
export async function crearBdPrueba(): Promise<BD> {
  const bd = drizzle(new PGlite(), { schema: esquema });
  await migrate(bd, { migrationsFolder: "drizzle" });
  return bd;
}
```

`src/datos/bitacora.ts`

```ts
import type { BD, Tx } from "./bd";
import { bitacora } from "./esquema";

export interface Evento {
  usuarioId: string | null;
  entidad: string;
  entidadId: string | null;
  accion: string;
  datos?: unknown;
}

/** Agrega un renglón a la bitácora. La bitácora solo crece: no hay actualizar ni borrar. */
export async function registrarEvento(bd: BD | Tx, evento: Evento): Promise<void> {
  await bd.insert(bitacora).values({
    usuarioId: evento.usuarioId,
    entidad: evento.entidad,
    entidadId: evento.entidadId,
    accion: evento.accion,
    datos: evento.datos ?? null,
  });
}
```

- [ ] **Step 4: Generar la migración**

Run: `npx drizzle-kit generate --name inicial`
Expected: `6 tables` y `Your SQL migration file ➜ drizzle/0000_inicial.sql`. Este comando no necesita base de datos.

- [ ] **Step 5: Ejecutar la prueba para verla pasar**

Run: `npm run verificar`
Expected: PASS — la prueba de bitácora aplica la migración en un Postgres en memoria y pasa; `tsc` sin errores.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: esquema inicial de base de datos y bitácora"
```

### Task 7: Repositorio de clientes

**Files:**
- Create: `src/datos/clientes.ts`
- Test: `src/datos/clientes.test.ts`

**Interfaces:**
- Consumes: `BD`, `Tx`, tablas de `esquema.ts`, `crearBdPrueba` (Task 6); `ClienteEntrada` (Task 2); `faltantesDeCliente` (Task 1); `documentosQueBloquean` (Task 3).
- Produces: `crearCliente(bd, entrada, ahora): Promise<string>` (devuelve el id); `actualizarCliente(bd, id, entrada, ahora): Promise<boolean>` (false si no existe); `obtenerCliente(bd, id): Promise<ClienteGuardado | null>`; `listarClientes(bd, hoy, texto?): Promise<ClienteResumen[]>` con `ClienteResumen = { id, nombre, direccion, tipoResiduo, activo, faltantes: Faltante[], documentosQueBloquean: string[] }`.

- [ ] **Step 1: Escribir la prueba que falla**

`src/datos/clientes.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { ClienteEntrada } from "@/dominio/clientes/esquemas";
import { actualizarCliente, crearCliente, listarClientes, obtenerCliente } from "./clientes";
import { crearBdPrueba } from "./pruebas/bd-prueba";

const entrada: ClienteEntrada = {
  nombre: "Cartonera del Bajío",
  contactoNombre: "Laura Méndez",
  contactoTelefono: "442 555 0101",
  direccion: "Av. del Marqués 100",
  lat: 20.6102,
  lng: -100.2801,
  tipoResiduo: "RME",
  material: "Cartón nacional",
  tiposUnidadAdmitidos: ["doble_rodada"],
  notasAcceso: null,
  tiempoServicioMin: 66,
  cargaEstimadaKg: 1800,
  avisoPrivacidadAceptado: true,
  activo: true,
  ventanas: [
    { diaSemana: 3, horaInicio: "13:00", horaFin: "17:00" },
    { diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" },
  ],
  documentos: [{ nombre: "SUA vigente", obligatorio: true, estado: "vigente", venceEl: "2026-12-31" }],
};
const t0 = new Date("2026-10-07T15:00:00Z");
const t1 = new Date("2026-10-09T15:00:00Z");
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

describe("repositorio de clientes", () => {
  it("guarda y recupera un cliente con sus ventanas (ordenadas) y documentos", async () => {
    const bd = await crearBdPrueba();
    const id = await crearCliente(bd, entrada, t0);
    const c = await obtenerCliente(bd, id);
    expect(c?.nombre).toBe("Cartonera del Bajío");
    expect(c?.tiposUnidadAdmitidos).toEqual(["doble_rodada"]);
    expect(c?.ventanas).toEqual([
      { diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" },
      { diaSemana: 3, horaInicio: "13:00", horaFin: "17:00" },
    ]);
    expect(c?.documentos).toEqual(entrada.documentos);
    expect(c?.avisoPrivacidadAceptadoEn?.toISOString()).toBe(t0.toISOString());
  });

  it("al actualizar reemplaza ventanas y documentos y conserva la fecha del aviso de privacidad", async () => {
    const bd = await crearBdPrueba();
    const id = await crearCliente(bd, entrada, t0);
    const ok = await actualizarCliente(bd, id, { ...entrada, nombre: "Cartonera BJ", ventanas: [], documentos: [] }, t1);
    const c = await obtenerCliente(bd, id);
    expect(ok).toBe(true);
    expect(c?.nombre).toBe("Cartonera BJ");
    expect(c?.ventanas).toEqual([]);
    expect(c?.documentos).toEqual([]);
    expect(c?.avisoPrivacidadAceptadoEn?.toISOString()).toBe(t0.toISOString());
  });

  it("al retirar la aceptación del aviso se borra la fecha", async () => {
    const bd = await crearBdPrueba();
    const id = await crearCliente(bd, entrada, t0);
    await actualizarCliente(bd, id, { ...entrada, avisoPrivacidadAceptado: false }, t1);
    expect((await obtenerCliente(bd, id))?.avisoPrivacidadAceptadoEn).toBeNull();
  });

  it("actualizar u obtener un cliente inexistente no falla", async () => {
    const bd = await crearBdPrueba();
    expect(await actualizarCliente(bd, ID_INEXISTENTE, entrada, t1)).toBe(false);
    expect(await obtenerCliente(bd, ID_INEXISTENTE)).toBeNull();
  });

  it("lista en orden alfabético con lo que falta y los documentos que bloquean", async () => {
    const bd = await crearBdPrueba();
    await crearCliente(bd, { ...entrada, nombre: "Zeta Empaques", lat: null, lng: null, ventanas: [] }, t0);
    await crearCliente(bd, { ...entrada, documentos: [{ ...entrada.documentos[0], venceEl: "2026-10-01" }] }, t0);
    const lista = await listarClientes(bd, "2026-10-07");
    expect(lista.map((c) => c.nombre)).toEqual(["Cartonera del Bajío", "Zeta Empaques"]);
    expect(lista[0].faltantes).toEqual([]);
    expect(lista[0].documentosQueBloquean).toEqual(["SUA vigente"]);
    expect(lista[1].faltantes).toEqual(["ubicacion", "ventana"]);
    expect(lista[1].documentosQueBloquean).toEqual([]);
  });

  it("filtra por texto sin distinguir mayúsculas", async () => {
    const bd = await crearBdPrueba();
    await crearCliente(bd, entrada, t0);
    await crearCliente(bd, { ...entrada, nombre: "Zeta Empaques" }, t0);
    expect((await listarClientes(bd, "2026-10-07", "zeta")).map((c) => c.nombre)).toEqual(["Zeta Empaques"]);
  });
});
```

- [ ] **Step 2: Ejecutarla para verla fallar**

Run: `npx vitest run src/datos/clientes.test.ts`
Expected: FAIL — no se encuentra `./clientes`.

- [ ] **Step 3: Implementar**

`src/datos/clientes.ts`

```ts
import { asc, eq, ilike, inArray } from "drizzle-orm";
import { faltantesDeCliente, type Faltante } from "@/dominio/clientes/completitud";
import { documentosQueBloquean } from "@/dominio/clientes/documentos";
import type { ClienteEntrada } from "@/dominio/clientes/esquemas";
import type { ClienteGuardado, TipoResiduo } from "@/dominio/clientes/tipos";
import type { BD, Tx } from "./bd";
import { clientes, documentosCliente, ventanasCliente } from "./esquema";

export interface ClienteResumen {
  id: string;
  nombre: string;
  direccion: string | null;
  tipoResiduo: TipoResiduo | null;
  activo: boolean;
  faltantes: Faltante[];
  documentosQueBloquean: string[];
}

const hhmm = (hora: string) => hora.slice(0, 5);

function columnas(entrada: ClienteEntrada, avisoEn: Date | null, ahora: Date) {
  return {
    nombre: entrada.nombre,
    contactoNombre: entrada.contactoNombre,
    contactoTelefono: entrada.contactoTelefono,
    direccion: entrada.direccion,
    lat: entrada.lat,
    lng: entrada.lng,
    tipoResiduo: entrada.tipoResiduo,
    material: entrada.material,
    tiposUnidadAdmitidos: entrada.tiposUnidadAdmitidos,
    notasAcceso: entrada.notasAcceso,
    tiempoServicioMin: entrada.tiempoServicioMin,
    cargaEstimadaKg: entrada.cargaEstimadaKg,
    avisoPrivacidadAceptadoEn: avisoEn,
    activo: entrada.activo,
    actualizadoEn: ahora,
  };
}

async function reemplazarHijos(tx: Tx, clienteId: string, entrada: ClienteEntrada): Promise<void> {
  await tx.delete(ventanasCliente).where(eq(ventanasCliente.clienteId, clienteId));
  await tx.delete(documentosCliente).where(eq(documentosCliente.clienteId, clienteId));
  if (entrada.ventanas.length > 0) {
    await tx.insert(ventanasCliente).values(entrada.ventanas.map((v) => ({ clienteId, ...v })));
  }
  if (entrada.documentos.length > 0) {
    await tx.insert(documentosCliente).values(entrada.documentos.map((d) => ({ clienteId, ...d })));
  }
}

export async function crearCliente(bd: BD, entrada: ClienteEntrada, ahora: Date): Promise<string> {
  return bd.transaction(async (tx) => {
    const avisoEn = entrada.avisoPrivacidadAceptado ? ahora : null;
    const [fila] = await tx.insert(clientes).values(columnas(entrada, avisoEn, ahora)).returning({ id: clientes.id });
    await reemplazarHijos(tx, fila.id, entrada);
    return fila.id;
  });
}

/** Devuelve false si el cliente no existe. Conserva la fecha original de aceptación del aviso de privacidad. */
export async function actualizarCliente(bd: BD, id: string, entrada: ClienteEntrada, ahora: Date): Promise<boolean> {
  return bd.transaction(async (tx) => {
    const [actual] = await tx
      .select({ avisoEn: clientes.avisoPrivacidadAceptadoEn })
      .from(clientes)
      .where(eq(clientes.id, id));
    if (!actual) return false;
    const avisoEn = entrada.avisoPrivacidadAceptado ? (actual.avisoEn ?? ahora) : null;
    await tx.update(clientes).set(columnas(entrada, avisoEn, ahora)).where(eq(clientes.id, id));
    await reemplazarHijos(tx, id, entrada);
    return true;
  });
}

export async function obtenerCliente(bd: BD, id: string): Promise<ClienteGuardado | null> {
  const [c] = await bd.select().from(clientes).where(eq(clientes.id, id));
  if (!c) return null;
  const ventanas = await bd
    .select()
    .from(ventanasCliente)
    .where(eq(ventanasCliente.clienteId, id))
    .orderBy(asc(ventanasCliente.diaSemana), asc(ventanasCliente.horaInicio));
  const documentos = await bd
    .select()
    .from(documentosCliente)
    .where(eq(documentosCliente.clienteId, id))
    .orderBy(asc(documentosCliente.nombre));
  return {
    id: c.id,
    nombre: c.nombre,
    contactoNombre: c.contactoNombre,
    contactoTelefono: c.contactoTelefono,
    direccion: c.direccion,
    lat: c.lat,
    lng: c.lng,
    tipoResiduo: c.tipoResiduo,
    material: c.material,
    tiposUnidadAdmitidos: c.tiposUnidadAdmitidos,
    notasAcceso: c.notasAcceso,
    tiempoServicioMin: c.tiempoServicioMin,
    cargaEstimadaKg: c.cargaEstimadaKg,
    avisoPrivacidadAceptadoEn: c.avisoPrivacidadAceptadoEn,
    activo: c.activo,
    ventanas: ventanas.map((v) => ({ diaSemana: v.diaSemana, horaInicio: hhmm(v.horaInicio), horaFin: hhmm(v.horaFin) })),
    documentos: documentos.map((d) => ({ nombre: d.nombre, obligatorio: d.obligatorio, estado: d.estado, venceEl: d.venceEl })),
  };
}

/** Lista para la pantalla de clientes, con lo que le falta a cada uno. `hoy` en formato "AAAA-MM-DD". */
export async function listarClientes(bd: BD, hoy: string, texto?: string): Promise<ClienteResumen[]> {
  const filtro = texto && texto.trim() !== "" ? ilike(clientes.nombre, `%${texto.trim()}%`) : undefined;
  const filas = await bd.select().from(clientes).where(filtro).orderBy(asc(clientes.nombre));
  if (filas.length === 0) return [];
  const ids = filas.map((f) => f.id);
  const ventanas = await bd.select().from(ventanasCliente).where(inArray(ventanasCliente.clienteId, ids));
  const documentos = await bd.select().from(documentosCliente).where(inArray(documentosCliente.clienteId, ids));
  return filas.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    direccion: c.direccion,
    tipoResiduo: c.tipoResiduo,
    activo: c.activo,
    faltantes: faltantesDeCliente({
      lat: c.lat,
      lng: c.lng,
      tipoResiduo: c.tipoResiduo,
      tiposUnidadAdmitidos: c.tiposUnidadAdmitidos,
      avisoPrivacidadAceptadoEn: c.avisoPrivacidadAceptadoEn,
      ventanas: ventanas
        .filter((v) => v.clienteId === c.id)
        .map((v) => ({ diaSemana: v.diaSemana, horaInicio: hhmm(v.horaInicio), horaFin: hhmm(v.horaFin) })),
    }),
    documentosQueBloquean: documentosQueBloquean(
      documentos.filter((d) => d.clienteId === c.id),
      hoy,
    ),
  }));
}
```

- [ ] **Step 4: Ejecutarla para verla pasar**

Run: `npx vitest run src/datos/clientes.test.ts`
Expected: PASS — 6 pruebas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: repositorio de clientes con ventanas y documentos"
```

### Task 8: Autorización por rol

**Files:**
- Create: `src/seguridad/autorizacion.ts`
- Test: `src/seguridad/autorizacion.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `ROLES`, tipo `Rol`; `UsuarioSesion = { id, nombre, rol, activo }`; errores `NoAutenticado` y `NoAutorizado`; `autorizar(usuario: UsuarioSesion | null, permitidos: readonly Rol[]): UsuarioSesion`. El rol `admin` siempre pasa.

- [ ] **Step 1: Escribir la prueba que falla**

`src/seguridad/autorizacion.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { autorizar, NoAutenticado, NoAutorizado, type UsuarioSesion } from "./autorizacion";

const usuario = (rol: UsuarioSesion["rol"], activo = true): UsuarioSesion => ({ id: "u1", nombre: "Prueba", rol, activo });

describe("autorizar", () => {
  it("deja pasar al rol permitido", () => {
    expect(autorizar(usuario("despachador"), ["despachador"]).rol).toBe("despachador");
  });

  it("el administrador puede todo", () => {
    expect(autorizar(usuario("admin"), ["operador"]).rol).toBe("admin");
  });

  it("rechaza a quien no tiene sesión", () => {
    expect(() => autorizar(null, ["despachador"])).toThrow(NoAutenticado);
  });

  it("rechaza a un usuario desactivado aunque su rol sea válido", () => {
    expect(() => autorizar(usuario("despachador", false), ["despachador"])).toThrow(NoAutenticado);
  });

  it("rechaza al rol equivocado", () => {
    expect(() => autorizar(usuario("operador"), ["despachador", "gerencia"])).toThrow(NoAutorizado);
  });
});
```

- [ ] **Step 2: Ejecutarla para verla fallar**

Run: `npx vitest run src/seguridad/autorizacion.test.ts`
Expected: FAIL — no se encuentra `./autorizacion`.

- [ ] **Step 3: Implementar**

`src/seguridad/autorizacion.ts`

```ts
export const ROLES = ["admin", "despachador", "operador", "gerencia"] as const;
export type Rol = (typeof ROLES)[number];

export interface UsuarioSesion {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
}

export class NoAutenticado extends Error {
  constructor() {
    super("No hay una sesión activa");
    this.name = "NoAutenticado";
  }
}

export class NoAutorizado extends Error {
  constructor() {
    super("Tu rol no permite esta acción");
    this.name = "NoAutorizado";
  }
}

/** Devuelve al usuario si puede actuar; el rol admin puede todo. Lanza NoAutenticado o NoAutorizado. */
export function autorizar(usuario: UsuarioSesion | null, permitidos: readonly Rol[]): UsuarioSesion {
  if (usuario === null || !usuario.activo) throw new NoAutenticado();
  if (usuario.rol !== "admin" && !permitidos.includes(usuario.rol)) throw new NoAutorizado();
  return usuario;
}
```

- [ ] **Step 4: Ejecutarla para verla pasar**

Run: `npx vitest run src/seguridad/autorizacion.test.ts`
Expected: PASS — 5 pruebas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: autorización por rol"
```

### Task 9: Casos de uso: guardar e importar clientes

**Files:**
- Create: `src/acciones/clientes.nucleo.ts`
- Test: `src/acciones/clientes.nucleo.test.ts`

**Interfaces:**
- Consumes: `autorizar`, `NoAutorizado`, `UsuarioSesion`, `Rol` (Task 8); `clienteSchema`, `erroresPorCampo` (Task 2); `parsearClientesCsv`, `ErrorDeFila` (Task 5); `crearCliente`, `actualizarCliente`, `obtenerCliente`, `listarClientes` (Task 7); `registrarEvento`, `BD`, `crearBdPrueba`, tablas `bitacora` y `usuarios` (Task 6).
- Produces: `Contexto = { bd: BD; usuario: UsuarioSesion | null; ahora: Date }`; `Resultado<T>` (unión `ok` / `no_autenticado` / `no_autorizado` / `no_encontrado` / `invalido` con `campos`); `guardarCliente(ctx, id: string | null, entrada: unknown): Promise<Resultado<{ id: string }>>`; `importarClientes(ctx, contenidoCsv: string): Promise<Resultado<{ importados: number; errores: ErrorDeFila[] }>>`.

El núcleo recibe la base de datos, el usuario y la hora como parámetros; así se prueba sin Clerk ni red. El enlace con la sesión real se agrega en la Tarea 11.

- [ ] **Step 1: Escribir la prueba que falla**

`src/acciones/clientes.nucleo.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { bitacora, usuarios } from "@/datos/esquema";
import { obtenerCliente } from "@/datos/clientes";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import type { ClienteEntrada } from "@/dominio/clientes/esquemas";
import type { Rol, UsuarioSesion } from "@/seguridad/autorizacion";
import { listarClientes } from "@/datos/clientes";
import { guardarCliente, importarClientes, type Contexto } from "./clientes.nucleo";

const entrada: ClienteEntrada = {
  nombre: "Cartonera del Bajío", contactoNombre: null, contactoTelefono: null, direccion: null,
  lat: 20.6102, lng: -100.2801, tipoResiduo: "RME", material: null, tiposUnidadAdmitidos: ["doble_rodada"],
  notasAcceso: null, tiempoServicioMin: 66, cargaEstimadaKg: null, avisoPrivacidadAceptado: true, activo: true,
  ventanas: [{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }], documentos: [],
};

async function contexto(rol: Rol | null): Promise<Contexto> {
  const bd = await crearBdPrueba();
  let usuario: UsuarioSesion | null = null;
  if (rol !== null) {
    const [fila] = await bd.insert(usuarios).values({ clerkId: "clerk_prueba", nombre: "Prueba", rol }).returning();
    usuario = { id: fila.id, nombre: fila.nombre, rol: fila.rol, activo: fila.activo };
  }
  return { bd, usuario, ahora: new Date("2026-10-07T15:00:00Z") };
}

describe("guardarCliente", () => {
  it("el despachador crea un cliente y queda registrado en la bitácora", async () => {
    const ctx = await contexto("despachador");
    const r = await guardarCliente(ctx, null, entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await obtenerCliente(ctx.bd, r.valor.id))?.nombre).toBe("Cartonera del Bajío");
    const eventos = await ctx.bd.select().from(bitacora);
    expect(eventos.map((e) => [e.entidad, e.accion, e.entidadId, e.usuarioId])).toEqual([
      ["cliente", "crear", r.valor.id, ctx.usuario?.id],
    ]);
  });

  it("sin sesión responde no_autenticado y no escribe nada", async () => {
    const ctx = await contexto(null);
    expect(await guardarCliente(ctx, null, entrada)).toEqual({ ok: false, error: "no_autenticado" });
    expect(await ctx.bd.select().from(bitacora)).toEqual([]);
  });

  it("el operador y la gerencia no pueden guardar clientes", async () => {
    expect(await guardarCliente(await contexto("operador"), null, entrada)).toEqual({ ok: false, error: "no_autorizado" });
    expect(await guardarCliente(await contexto("gerencia"), null, entrada)).toEqual({ ok: false, error: "no_autorizado" });
  });

  it("una entrada inválida devuelve los errores por campo y no escribe nada", async () => {
    const ctx = await contexto("despachador");
    const r = await guardarCliente(ctx, null, { ...entrada, nombre: "", lat: -100.28, lng: 20.61 });
    expect(r).toMatchObject({ ok: false, error: "invalido" });
    if (!r.ok && r.error === "invalido") expect(Object.keys(r.campos).sort()).toEqual(["lat", "lng", "nombre"]);
    expect(await ctx.bd.select().from(bitacora)).toEqual([]);
  });

  it("actualiza un cliente existente", async () => {
    const ctx = await contexto("admin");
    const creado = await guardarCliente(ctx, null, entrada);
    if (!creado.ok) throw new Error("no se creó");
    const r = await guardarCliente(ctx, creado.valor.id, { ...entrada, nombre: "Cartonera BJ" });
    expect(r).toEqual({ ok: true, valor: { id: creado.valor.id } });
    expect((await obtenerCliente(ctx.bd, creado.valor.id))?.nombre).toBe("Cartonera BJ");
  });

  it("un id inexistente o mal formado responde no_encontrado, sin error de base de datos", async () => {
    const ctx = await contexto("despachador");
    expect(await guardarCliente(ctx, "00000000-0000-4000-8000-000000000000", entrada)).toEqual({ ok: false, error: "no_encontrado" });
    expect(await guardarCliente(ctx, "esto-no-es-un-id", entrada)).toEqual({ ok: false, error: "no_encontrado" });
  });
});

describe("importarClientes", () => {
  const csv = "nombre,lat,lng,residuo\nUno,20.61,-100.28,RME\nMalo,20.61,-100.28,XYZ\nDos,,,\n";

  it("guarda las filas válidas, reporta las inválidas y deja un evento por cliente", async () => {
    const ctx = await contexto("despachador");
    const r = await importarClientes(ctx, csv);
    expect(r).toMatchObject({ ok: true, valor: { importados: 2 } });
    if (r.ok) expect(r.valor.errores.map((e) => e.linea)).toEqual([3]);
    expect((await listarClientes(ctx.bd, "2026-10-07")).map((c) => c.nombre)).toEqual(["Dos", "Uno"]);
    expect((await ctx.bd.select().from(bitacora)).map((e) => e.accion)).toEqual(["importar", "importar"]);
  });

  it("el operador no puede importar", async () => {
    const ctx = await contexto("operador");
    expect(await importarClientes(ctx, csv)).toEqual({ ok: false, error: "no_autorizado" });
    expect(await listarClientes(ctx.bd, "2026-10-07")).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecutarla para verla fallar**

Run: `npx vitest run src/acciones/clientes.nucleo.test.ts`
Expected: FAIL — no se encuentra `./clientes.nucleo`.

- [ ] **Step 3: Implementar**

`src/acciones/clientes.nucleo.ts`

```ts
import { z } from "zod";
import type { BD } from "@/datos/bd";
import { registrarEvento } from "@/datos/bitacora";
import { actualizarCliente, crearCliente } from "@/datos/clientes";
import { parsearClientesCsv, type ErrorDeFila } from "@/dominio/clientes/csv";
import { clienteSchema, erroresPorCampo } from "@/dominio/clientes/esquemas";
import { autorizar, NoAutorizado, type UsuarioSesion } from "@/seguridad/autorizacion";

export interface Contexto {
  bd: BD;
  usuario: UsuarioSesion | null;
  ahora: Date;
}

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; error: "no_autenticado" | "no_autorizado" | "no_encontrado" }
  | { ok: false; error: "invalido"; campos: Record<string, string[]> };

const idSchema = z.uuid();

/** Crea (id = null) o actualiza un cliente. Solo despachador o admin. Toda escritura queda en la bitácora. */
export async function guardarCliente(ctx: Contexto, id: string | null, entrada: unknown): Promise<Resultado<{ id: string }>> {
  let usuario: UsuarioSesion;
  try {
    usuario = autorizar(ctx.usuario, ["despachador"]);
  } catch (e) {
    return { ok: false, error: e instanceof NoAutorizado ? "no_autorizado" : "no_autenticado" };
  }

  const validado = clienteSchema.safeParse(entrada);
  if (!validado.success) return { ok: false, error: "invalido", campos: erroresPorCampo(validado.error) };

  if (id === null) {
    const nuevoId = await crearCliente(ctx.bd, validado.data, ctx.ahora);
    await registrarEvento(ctx.bd, { usuarioId: usuario.id, entidad: "cliente", entidadId: nuevoId, accion: "crear", datos: validado.data });
    return { ok: true, valor: { id: nuevoId } };
  }

  if (!idSchema.safeParse(id).success) return { ok: false, error: "no_encontrado" };
  const existia = await actualizarCliente(ctx.bd, id, validado.data, ctx.ahora);
  if (!existia) return { ok: false, error: "no_encontrado" };
  await registrarEvento(ctx.bd, { usuarioId: usuario.id, entidad: "cliente", entidadId: id, accion: "actualizar", datos: validado.data });
  return { ok: true, valor: { id } };
}

/** Importa clientes desde el texto de un CSV. Guarda las filas válidas y devuelve las que tuvieron errores. */
export async function importarClientes(
  ctx: Contexto,
  contenidoCsv: string,
): Promise<Resultado<{ importados: number; errores: ErrorDeFila[] }>> {
  let usuario: UsuarioSesion;
  try {
    usuario = autorizar(ctx.usuario, ["despachador"]);
  } catch (e) {
    return { ok: false, error: e instanceof NoAutorizado ? "no_autorizado" : "no_autenticado" };
  }

  const { clientes, errores } = parsearClientesCsv(contenidoCsv);
  for (const cliente of clientes) {
    const id = await crearCliente(ctx.bd, cliente, ctx.ahora);
    await registrarEvento(ctx.bd, { usuarioId: usuario.id, entidad: "cliente", entidadId: id, accion: "importar", datos: cliente });
  }
  return { ok: true, valor: { importados: clientes.length, errores } };
}
```

- [ ] **Step 4: Ejecutarla para verla pasar**

Run: `npm run verificar`
Expected: PASS — 46 pruebas en 10 archivos; `tsc` y `eslint` sin errores.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: casos de uso para guardar e importar clientes"
```

### Task 10: Infraestructura: Vercel, base de datos, inicio de sesión

Esta tarea necesita las cuentas del responsable del proyecto (decisión abierta 4 de la especificación). **Detenerse y pedirle que complete cada paso que abra el navegador.**

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/proxy.ts`, `src/seguridad/sesion.ts`, `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sin-acceso/page.tsx`, `scripts/alta-usuario.mts`
- Create: `.env.local` (no se versiona)

**Interfaces:**
- Consumes: `autorizar`, `Rol`, `ROLES`, `UsuarioSesion` (Task 8); `bd`, tabla `usuarios` (Task 6).
- Produces: `usuarioActual(): Promise<UsuarioSesion | null>`; `exigirRol(...permitidos: Rol[]): Promise<UsuarioSesion>` (lanza `NoAutenticado` o `NoAutorizado`); rutas `/sign-in` y `/sin-acceso`; comando `npx tsx scripts/alta-usuario.mts <id_clerk> "<Nombre>" <rol>`.

- [ ] **Step 1: Actualizar la CLI de Vercel, vincular el proyecto y aprovisionar**

```bash
npm i -g vercel@latest
vercel link
vercel integration add neon
vercel integration add clerk
vercel env pull .env.local --yes
```

Expected: `.env.local` contiene `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` y `CLERK_SECRET_KEY`. Si algún nombre difiere, ajustar `drizzle.config.ts` y `src/datos/conexion.ts` a los nombres reales y anotarlo en el commit. Consultar `vercel integration guide neon --framework nextjs` y `vercel integration guide clerk --framework nextjs` ante cualquier duda.

Agregar a mano en `.env.local`:

```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
```

y registrar la misma variable en Vercel: `vercel env add NEXT_PUBLIC_CLERK_SIGN_IN_URL` (valor `/sign-in`, todos los entornos).

- [ ] **Step 2: Aplicar la migración a la base real**

Run: `npx drizzle-kit migrate`
Expected: aplica `0000_inicial` sin errores. Verificar con `npx drizzle-kit generate --name verificacion`: debe responder `No schema changes, nothing to migrate`.

- [ ] **Step 3: Instalar Clerk y escribir el enlace con la sesión**

```bash
npm install @clerk/nextjs @clerk/localizations server-only
npm install -D tsx
```

`src/app/layout.tsx`

```tsx
import type { Metadata } from "next";
import { esMX } from "@clerk/localizations";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Recycling Solution",
  description: "Asistente de logística para la recolección",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider localization={esMX}>
      <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

`src/proxy.ts`

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const esPublica = createRouteMatcher(["/sign-in(.*)"]);

/** Toda ruta exige sesión, salvo la de inicio de sesión. El rol se revisa después, en el servidor. */
export default clerkMiddleware(async (auth, req) => {
  if (!esPublica(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
```

`src/seguridad/sesion.ts`

```ts
import "server-only";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { bd } from "@/datos/conexion";
import { usuarios } from "@/datos/esquema";
import { autorizar, type Rol, type UsuarioSesion } from "./autorizacion";

/** Usuario de la sesión según la tabla `usuarios` (única fuente del rol). null si no hay sesión o no está dado de alta. */
export async function usuarioActual(): Promise<UsuarioSesion | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const [fila] = await bd.select().from(usuarios).where(eq(usuarios.clerkId, userId)).limit(1);
  return fila ? { id: fila.id, nombre: fila.nombre, rol: fila.rol, activo: fila.activo } : null;
}

/** Para páginas y acciones del servidor: devuelve al usuario o lanza NoAutenticado / NoAutorizado. */
export async function exigirRol(...permitidos: Rol[]): Promise<UsuarioSesion> {
  return autorizar(await usuarioActual(), permitidos);
}
```

`src/app/sign-in/[[...sign-in]]/page.tsx`

```tsx
import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";

export default function PaginaInicioSesion() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
        <SignIn />
      </Suspense>
    </main>
  );
}
```

`src/app/sin-acceso/page.tsx`

```tsx
import { SignOutButton } from "@clerk/nextjs";

export default function SinAcceso() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Tu cuenta no tiene acceso a esta sección</h1>
      <p className="text-sm text-muted-foreground">
        Pide al administrador que te dé de alta o que revise tu rol. Si entraste con la cuenta equivocada, cierra la sesión.
      </p>
      <SignOutButton>
        <button className="w-fit text-sm underline">Cerrar sesión</button>
      </SignOutButton>
    </main>
  );
}
```

`scripts/alta-usuario.mts`

```ts
// Da de alta (o actualiza) a un usuario de Clerk en la tabla `usuarios` con su rol.
// Uso: npx tsx scripts/alta-usuario.mts <id_de_usuario_en_clerk> "<Nombre>" <admin|despachador|operador|gerencia>
import nextEnv from "@next/env";
import { ROLES, type Rol } from "../src/seguridad/autorizacion";

nextEnv.loadEnvConfig(process.cwd());

const [clerkId, nombre, rol] = process.argv.slice(2);
if (!clerkId || !nombre || !ROLES.includes(rol as Rol)) {
  console.error(`Uso: npx tsx scripts/alta-usuario.mts <id_de_usuario_en_clerk> "<Nombre>" <${ROLES.join("|")}>`);
  process.exit(1);
}

// La conexión lee DATABASE_URL al cargarse; por eso se importa después de cargar .env.local
const { bd } = await import("../src/datos/conexion");
const { usuarios } = await import("../src/datos/esquema");

await bd
  .insert(usuarios)
  .values({ clerkId, nombre, rol: rol as Rol })
  .onConflictDoUpdate({ target: usuarios.clerkId, set: { nombre, rol: rol as Rol, activo: true } });

console.log(`Usuario registrado: ${nombre} (${rol})`);
process.exit(0);
```

- [ ] **Step 4: Cerrar el registro público y crear al primer usuario**

En el panel de Clerk: restringir el registro para que solo el administrador cree cuentas (modo de registro restringido) y crear un usuario con correo y contraseña. Copiar su identificador (`user_…`) y ejecutar:

```bash
npx tsx scripts/alta-usuario.mts user_XXXXXXXX "Nombre del administrador" admin
```

Expected: `Usuario registrado: Nombre del administrador (admin)`.

- [ ] **Step 5: Verificar**

Run: `npm run verificar && npm run build`
Expected: PASS y `next build` termina con la tabla de rutas, incluyendo `/sign-in/[[...sign-in]]`, `/sin-acceso` y `ƒ Proxy (Middleware)`.

Run: `npm run dev` y abrir `http://localhost:3000/sin-acceso` sin sesión.
Expected: redirige a `/sign-in`; tras entrar con el usuario creado muestra la página "Tu cuenta no tiene acceso a esta sección" (todavía no existe `/despacho`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: inicio de sesión con Clerk, sesión por rol y base de datos en Neon"
```

### Task 11: Pantallas del CRM de clientes

**Files:**
- Create: `src/acciones/clientes.ts`
- Create: `src/app/despacho/layout.tsx`, `src/app/despacho/clientes/page.tsx`, `src/app/despacho/clientes/nuevo/page.tsx`, `src/app/despacho/clientes/[id]/page.tsx`
- Create: `src/app/despacho/clientes/formulario-cliente.tsx`, `src/app/despacho/clientes/selector-ubicacion.tsx`
- Create: `src/app/despacho/clientes/importar/page.tsx`, `src/app/despacho/clientes/importar/formulario-importar.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/components/ui/*` y `src/lib/utils.ts` (los genera shadcn)

**Interfaces:**
- Consumes: `guardarCliente`, `importarClientes`, `Contexto` (Task 9); `usuarioActual`, `exigirRol` (Task 10); `bd` (Task 6); `listarClientes`, `obtenerCliente` (Task 7); `clienteNuevo`, `aEntrada`, etiquetas (Task 4); `fechaEnMexico` (Task 1); `COLUMNAS_CSV`, `ErrorDeFila` (Task 5).
- Produces: acciones `guardarClienteAccion(id: string | null, entrada: unknown)` e `importarClientesAccion(contenidoCsv: string)`; rutas `/despacho/clientes`, `/despacho/clientes/nuevo`, `/despacho/clientes/[id]`, `/despacho/clientes/importar`.

- [ ] **Step 1: Instalar componentes y mapa**

```bash
npx shadcn@latest init --defaults --yes
npx shadcn@latest add button input label badge table card textarea --yes
npm install maplibre-gl
```

Expected: se crean `src/components/ui/{button,input,label,badge,table,card,textarea}.tsx` y `src/lib/utils.ts`.

- [ ] **Step 2: Enlazar los casos de uso con la sesión real**

`src/acciones/clientes.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { bd } from "@/datos/conexion";
import { usuarioActual } from "@/seguridad/sesion";
import { guardarCliente, importarClientes, type Contexto } from "./clientes.nucleo";

async function contexto(): Promise<Contexto> {
  return { bd, usuario: await usuarioActual(), ahora: new Date() };
}

export async function guardarClienteAccion(id: string | null, entrada: unknown) {
  const resultado = await guardarCliente(await contexto(), id, entrada);
  if (resultado.ok) revalidatePath("/despacho/clientes");
  return resultado;
}

export async function importarClientesAccion(contenidoCsv: string) {
  const resultado = await importarClientes(await contexto(), contenidoCsv);
  if (resultado.ok) revalidatePath("/despacho/clientes");
  return resultado;
}
```

- [ ] **Step 3: Estructura de la sección de despacho**

`SoloDespacho` lee la sesión, así que se dibuja dentro de `<Suspense>`; las páginas hijas quedan dentro de ese mismo límite.

`src/app/despacho/layout.tsx`

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { NoAutenticado, NoAutorizado } from "@/seguridad/autorizacion";
import { exigirRol } from "@/seguridad/sesion";

/** Lee la sesión; por eso se dibuja dentro de <Suspense> (requisito de Cache Components). */
async function SoloDespacho({ children }: { children: React.ReactNode }) {
  try {
    await exigirRol("despachador");
  } catch (error) {
    if (error instanceof NoAutenticado || error instanceof NoAutorizado) redirect("/sin-acceso");
    throw error;
  }
  return children;
}

export default function DespachoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <nav className="flex items-center gap-6 text-sm">
          <span className="font-semibold">Recycling Solution</span>
          <Link href="/despacho/clientes" className="hover:underline">Clientes</Link>
        </nav>
        <UserButton />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
          <SoloDespacho>{children}</SoloDespacho>
        </Suspense>
      </main>
    </div>
  );
}
```

`src/app/page.tsx`

```tsx
import { redirect } from "next/navigation";

export default function Inicio() {
  redirect("/despacho/clientes");
}
```

- [ ] **Step 4: Lista de clientes**

`src/app/despacho/clientes/page.tsx`

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listarClientes } from "@/datos/clientes";
import { bd } from "@/datos/conexion";
import { ETIQUETA_FALTANTE, ETIQUETA_RESIDUO } from "@/dominio/clientes/etiquetas";
import { fechaEnMexico } from "@/dominio/tiempo";
import { exigirRol } from "@/seguridad/sesion";

export default async function PaginaClientes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await exigirRol("despachador");
  const { q } = await searchParams;
  const clientes = await listarClientes(bd, fechaEnMexico(new Date()), q);
  const activos = clientes.filter((c) => c.activo);
  const completos = activos.filter((c) => c.faltantes.length === 0).length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground" data-testid="resumen-completitud">
            {completos} de {activos.length} clientes activos con datos completos
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/despacho/clientes/importar" className={buttonVariants({ variant: "outline" })}>Importar CSV</Link>
          <Link href="/despacho/clientes/nuevo" className={buttonVariants()}>Nuevo cliente</Link>
        </div>
      </div>

      <form className="max-w-sm">
        <Input type="search" name="q" defaultValue={q ?? ""} placeholder="Buscar por nombre" aria-label="Buscar cliente por nombre" />
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>Residuo</TableHead>
            <TableHead>Estado de la ficha</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clientes.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Link href={`/despacho/clientes/${c.id}`} className="font-medium hover:underline">{c.nombre}</Link>
                {c.direccion && <div className="text-xs text-muted-foreground">{c.direccion}</div>}
              </TableCell>
              <TableCell>{c.tipoResiduo ? ETIQUETA_RESIDUO[c.tipoResiduo] : "—"}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {!c.activo && <Badge variant="secondary">Inactivo</Badge>}
                  {c.faltantes.length === 0 && c.documentosQueBloquean.length === 0 && <Badge variant="outline">Completa</Badge>}
                  {c.faltantes.map((f) => (
                    <Badge key={f} variant="secondary">{ETIQUETA_FALTANTE[f]}</Badge>
                  ))}
                  {c.documentosQueBloquean.map((d) => (
                    <Badge key={d} variant="destructive">Documento pendiente: {d}</Badge>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {clientes.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                {q ? "Ningún cliente coincide con la búsqueda." : "Todavía no hay clientes. Da de alta el primero o importa un CSV."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );
}
```

- [ ] **Step 5: Formulario, mapa y páginas de alta y edición**

`src/app/despacho/clientes/selector-ubicacion.tsx`

```tsx
"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const ESTILO = "https://tiles.openfreemap.org/styles/liberty";
const EL_MARQUES: [number, number] = [-100.28, 20.61]; // MapLibre usa [longitud, latitud]
const redondear = (grados: number) => Math.round(grados * 1e6) / 1e6;

interface Props {
  lat: number | null;
  lng: number | null;
  alCambiar: (lat: number, lng: number) => void;
}

/** Mapa para ubicar al cliente: un clic coloca el marcador y devuelve las coordenadas. */
export function SelectorUbicacion({ lat, lng, alCambiar }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const marcador = useRef<maplibregl.Marker | null>(null);
  const centroInicial = useRef<[number, number]>(lat !== null && lng !== null ? [lng, lat] : EL_MARQUES);
  const alCambiarActual = useRef(alCambiar);

  useEffect(() => {
    alCambiarActual.current = alCambiar;
  }, [alCambiar]);

  useEffect(() => {
    if (!contenedor.current) return;
    const nuevo = new maplibregl.Map({ container: contenedor.current, style: ESTILO, center: centroInicial.current, zoom: 12 });
    nuevo.addControl(new maplibregl.NavigationControl());
    nuevo.on("click", (evento) => alCambiarActual.current(redondear(evento.lngLat.lat), redondear(evento.lngLat.lng)));
    mapa.current = nuevo;
    return () => {
      nuevo.remove();
      mapa.current = null;
      marcador.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapa.current) return;
    if (lat === null || lng === null) {
      marcador.current?.remove();
      marcador.current = null;
      return;
    }
    if (marcador.current) marcador.current.setLngLat([lng, lat]);
    else marcador.current = new maplibregl.Marker().setLngLat([lng, lat]).addTo(mapa.current);
  }, [lat, lng]);

  return <div ref={contenedor} className="h-72 w-full rounded-lg border" role="application" aria-label="Mapa para ubicar al cliente" />;
}
```

`src/app/despacho/clientes/formulario-cliente.tsx`

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarClienteAccion } from "@/acciones/clientes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ClienteEntrada } from "@/dominio/clientes/esquemas";
import { DIAS_SEMANA, ETIQUETA_ESTADO_DOCUMENTO, ETIQUETA_RESIDUO, ETIQUETA_UNIDAD } from "@/dominio/clientes/etiquetas";
import { ESTADOS_DOCUMENTO, TIPOS_RESIDUO, TIPOS_UNIDAD, type EstadoDocumento, type TipoResiduo, type TipoUnidad } from "@/dominio/clientes/tipos";
import { SelectorUbicacion } from "./selector-ubicacion";

const CAMPO = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";
const textoONulo = (valor: string) => (valor.trim() === "" ? null : valor);
const numeroONulo = (valor: string) => (valor.trim() === "" ? null : Number(valor));

const MENSAJE_ERROR: Record<string, string> = {
  no_autenticado: "Tu sesión terminó. Vuelve a entrar.",
  no_autorizado: "Tu rol no permite guardar clientes.",
  no_encontrado: "Este cliente ya no existe.",
  invalido: "Revisa los campos marcados.",
};

export function FormularioCliente({ id, inicial }: { id: string | null; inicial: ClienteEntrada }) {
  const [datos, setDatos] = useState(inicial);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, iniciarGuardado] = useTransition();
  const router = useRouter();

  function cambiar<K extends keyof ClienteEntrada>(campo: K, valor: ClienteEntrada[K]) {
    setDatos((actual) => ({ ...actual, [campo]: valor }));
  }

  function alternarUnidad(tipo: TipoUnidad, marcado: boolean) {
    const sinTipo = datos.tiposUnidadAdmitidos.filter((t) => t !== tipo);
    cambiar("tiposUnidadAdmitidos", marcado ? [...sinTipo, tipo] : sinTipo);
  }

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    iniciarGuardado(async () => {
      const resultado = await guardarClienteAccion(id, datos);
      if (resultado.ok) {
        router.push("/despacho/clientes");
        return;
      }
      setErrores(resultado.error === "invalido" ? resultado.campos : {});
      setMensaje(MENSAJE_ERROR[resultado.error]);
    });
  }

  const error = (campo: string) =>
    errores[campo] ? <p className="text-xs text-destructive" role="alert">{errores[campo].join(" ")}</p> : null;

  return (
    <form onSubmit={enviar} className="flex flex-col gap-6" noValidate>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-medium">Datos generales</legend>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="nombre">Nombre del cliente</Label>
          <Input id="nombre" value={datos.nombre} onChange={(e) => cambiar("nombre", e.target.value)} />
          {error("nombre")}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contactoNombre">Contacto</Label>
          <Input id="contactoNombre" value={datos.contactoNombre ?? ""} onChange={(e) => cambiar("contactoNombre", textoONulo(e.target.value))} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contactoTelefono">Teléfono</Label>
          <Input id="contactoTelefono" inputMode="tel" value={datos.contactoTelefono ?? ""} onChange={(e) => cambiar("contactoTelefono", textoONulo(e.target.value))} />
          {error("contactoTelefono")}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="direccion">Dirección</Label>
          <Input id="direccion" value={datos.direccion ?? ""} onChange={(e) => cambiar("direccion", textoONulo(e.target.value))} />
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-medium">Ubicación</legend>
        <p className="text-sm text-muted-foreground sm:col-span-2">Haz clic en el mapa para colocar el marcador, o escribe las coordenadas.</p>
        <div className="sm:col-span-2">
          <SelectorUbicacion lat={datos.lat} lng={datos.lng} alCambiar={(lat, lng) => setDatos((actual) => ({ ...actual, lat, lng }))} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lat">Latitud</Label>
          <Input id="lat" type="number" step="any" value={datos.lat ?? ""} onChange={(e) => cambiar("lat", numeroONulo(e.target.value))} />
          {error("lat")}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lng">Longitud</Label>
          <Input id="lng" type="number" step="any" value={datos.lng ?? ""} onChange={(e) => cambiar("lng", numeroONulo(e.target.value))} />
          {error("lng")}
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-medium">Recolección</legend>
        <div className="flex flex-col gap-1">
          <Label htmlFor="tipoResiduo">Tipo de residuo</Label>
          <select id="tipoResiduo" className={CAMPO} value={datos.tipoResiduo ?? ""} onChange={(e) => cambiar("tipoResiduo", e.target.value === "" ? null : (e.target.value as TipoResiduo))}>
            <option value="">Sin definir</option>
            {TIPOS_RESIDUO.map((tipo) => (
              <option key={tipo} value={tipo}>{ETIQUETA_RESIDUO[tipo]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="material">Material</Label>
          <Input id="material" value={datos.material ?? ""} onChange={(e) => cambiar("material", textoONulo(e.target.value))} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="tiempoServicioMin">Tiempo de recolección y pesaje (min)</Label>
          <Input id="tiempoServicioMin" type="number" min={5} max={480} value={datos.tiempoServicioMin} onChange={(e) => cambiar("tiempoServicioMin", Number(e.target.value))} />
          {error("tiempoServicioMin")}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cargaEstimadaKg">Carga estimada (kg)</Label>
          <Input id="cargaEstimadaKg" type="number" min={0} value={datos.cargaEstimadaKg ?? ""} onChange={(e) => cambiar("cargaEstimadaKg", numeroONulo(e.target.value))} />
          {error("cargaEstimadaKg")}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-sm font-medium">Unidades que admite el acceso</span>
          <div className="flex flex-wrap gap-4">
            {TIPOS_UNIDAD.map((tipo) => (
              <label key={tipo} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={datos.tiposUnidadAdmitidos.includes(tipo)} onChange={(e) => alternarUnidad(tipo, e.target.checked)} />
                {ETIQUETA_UNIDAD[tipo]}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="notasAcceso">Notas de acceso</Label>
          <Textarea id="notasAcceso" value={datos.notasAcceso ?? ""} onChange={(e) => cambiar("notasAcceso", textoONulo(e.target.value))} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">Ventanas horarias</legend>
        {error("ventanas")}
        {datos.ventanas.map((ventana, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select aria-label={`Día de la ventana ${i + 1}`} className={CAMPO} value={ventana.diaSemana}
              onChange={(e) => cambiar("ventanas", datos.ventanas.map((v, j) => (j === i ? { ...v, diaSemana: Number(e.target.value) } : v)))}>
              {DIAS_SEMANA.map((dia, numero) => (
                <option key={dia} value={numero}>{dia}</option>
              ))}
            </select>
            <Input aria-label={`Hora de inicio de la ventana ${i + 1}`} type="time" className="w-32" value={ventana.horaInicio}
              onChange={(e) => cambiar("ventanas", datos.ventanas.map((v, j) => (j === i ? { ...v, horaInicio: e.target.value } : v)))} />
            <Input aria-label={`Hora de fin de la ventana ${i + 1}`} type="time" className="w-32" value={ventana.horaFin}
              onChange={(e) => cambiar("ventanas", datos.ventanas.map((v, j) => (j === i ? { ...v, horaFin: e.target.value } : v)))} />
            <Button type="button" variant="ghost" onClick={() => cambiar("ventanas", datos.ventanas.filter((_, j) => j !== i))}>Quitar</Button>
            {error(`ventanas.${i}.horaFin`)}
          </div>
        ))}
        <Button type="button" variant="outline" className="w-fit"
          onClick={() => cambiar("ventanas", [...datos.ventanas, { diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }])}>
          Agregar ventana
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">Documentación requerida</legend>
        {datos.documentos.map((documento, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Nombre del documento ${i + 1}`} className="w-56" placeholder="Nombre del documento" value={documento.nombre}
              onChange={(e) => cambiar("documentos", datos.documentos.map((d, j) => (j === i ? { ...d, nombre: e.target.value } : d)))} />
            <select aria-label={`Estado del documento ${i + 1}`} className={CAMPO} value={documento.estado}
              onChange={(e) => cambiar("documentos", datos.documentos.map((d, j) => (j === i ? { ...d, estado: e.target.value as EstadoDocumento } : d)))}>
              {ESTADOS_DOCUMENTO.map((estado) => (
                <option key={estado} value={estado}>{ETIQUETA_ESTADO_DOCUMENTO[estado]}</option>
              ))}
            </select>
            <Input aria-label={`Vencimiento del documento ${i + 1}`} type="date" className="w-40" value={documento.venceEl ?? ""}
              onChange={(e) => cambiar("documentos", datos.documentos.map((d, j) => (j === i ? { ...d, venceEl: textoONulo(e.target.value) } : d)))} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={documento.obligatorio}
                onChange={(e) => cambiar("documentos", datos.documentos.map((d, j) => (j === i ? { ...d, obligatorio: e.target.checked } : d)))} />
              Obligatorio
            </label>
            <Button type="button" variant="ghost" onClick={() => cambiar("documentos", datos.documentos.filter((_, j) => j !== i))}>Quitar</Button>
            {error(`documentos.${i}.nombre`)}
          </div>
        ))}
        <Button type="button" variant="outline" className="w-fit"
          onClick={() => cambiar("documentos", [...datos.documentos, { nombre: "", obligatorio: true, estado: "pendiente", venceEl: null }])}>
          Agregar documento
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">Privacidad y estado</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={datos.avisoPrivacidadAceptado} onChange={(e) => cambiar("avisoPrivacidadAceptado", e.target.checked)} />
          El cliente aceptó el aviso de privacidad
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={datos.activo} onChange={(e) => cambiar("activo", e.target.checked)} />
          Cliente activo
        </label>
      </fieldset>

      {mensaje && <p className="text-sm text-destructive" role="alert">{mensaje}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar cliente"}</Button>
        <Button type="button" variant="outline" onClick={() => router.push("/despacho/clientes")}>Cancelar</Button>
      </div>
    </form>
  );
}
```

`src/app/despacho/clientes/nuevo/page.tsx`

```tsx
import { clienteNuevo } from "@/dominio/clientes/formulario";
import { exigirRol } from "@/seguridad/sesion";
import { FormularioCliente } from "../formulario-cliente";

export default async function PaginaClienteNuevo() {
  await exigirRol("despachador");
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Nuevo cliente</h1>
      <FormularioCliente id={null} inicial={clienteNuevo()} />
    </section>
  );
}
```

`src/app/despacho/clientes/[id]/page.tsx`

```tsx
import { notFound } from "next/navigation";
import { z } from "zod";
import { obtenerCliente } from "@/datos/clientes";
import { bd } from "@/datos/conexion";
import { aEntrada } from "@/dominio/clientes/formulario";
import { exigirRol } from "@/seguridad/sesion";
import { FormularioCliente } from "../formulario-cliente";

export default async function PaginaCliente({ params }: { params: Promise<{ id: string }> }) {
  await exigirRol("despachador");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const cliente = await obtenerCliente(bd, id);
  if (!cliente) notFound();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{cliente.nombre}</h1>
      <FormularioCliente id={cliente.id} inicial={aEntrada(cliente)} />
    </section>
  );
}
```

- [ ] **Step 6: Importación desde CSV**

`src/app/despacho/clientes/importar/formulario-importar.tsx`

```tsx
"use client";

import { useState, useTransition } from "react";
import { importarClientesAccion } from "@/acciones/clientes";
import { Button } from "@/components/ui/button";
import type { ErrorDeFila } from "@/dominio/clientes/csv";

export function FormularioImportar() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [resumen, setResumen] = useState<{ importados: number; errores: ErrorDeFila[] } | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [importando, iniciar] = useTransition();

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!archivo) return;
    iniciar(async () => {
      const resultado = await importarClientesAccion(await archivo.text());
      if (resultado.ok) {
        setResumen(resultado.valor);
        setMensaje(null);
      } else {
        setResumen(null);
        setMensaje("No se pudo importar: tu sesión terminó o tu rol no lo permite.");
      }
    });
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <input type="file" accept=".csv,text/csv" aria-label="Archivo CSV de clientes" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
      <Button type="submit" className="w-fit" disabled={!archivo || importando}>{importando ? "Importando…" : "Importar"}</Button>
      {mensaje && <p className="text-sm text-destructive" role="alert">{mensaje}</p>}
      {resumen && (
        <div className="flex flex-col gap-2 text-sm" role="status">
          <p>Se importaron {resumen.importados} clientes.</p>
          {resumen.errores.length > 0 && (
            <>
              <p>{resumen.errores.length} renglones no se importaron:</p>
              <ul className="list-disc pl-5">
                {resumen.errores.map((e) => (
                  <li key={e.linea}>Línea {e.linea}: {e.mensajes.join(" · ")}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </form>
  );
}
```

`src/app/despacho/clientes/importar/page.tsx`

```tsx
import { COLUMNAS_CSV } from "@/dominio/clientes/csv";
import { exigirRol } from "@/seguridad/sesion";
import { FormularioImportar } from "./formulario-importar";

export default async function PaginaImportar() {
  await exigirRol("despachador");
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Importar clientes desde CSV</h1>
      <p className="text-sm text-muted-foreground">
        Guarda la hoja de Excel como CSV. Solo la columna <code>nombre</code> es obligatoria. Columnas reconocidas:{" "}
        <code>{COLUMNAS_CSV.join(", ")}</code>. Las ventanas horarias, los documentos y las unidades admitidas se completan después en la ficha de cada cliente.
      </p>
      <FormularioImportar />
    </section>
  );
}
```

- [ ] **Step 7: Verificar**

Run: `npm run verificar && npm run build`
Expected: PASS; la tabla de rutas de `next build` lista `/despacho/clientes`, `/despacho/clientes/[id]`, `/despacho/clientes/importar` y `/despacho/clientes/nuevo` como prerenderizado parcial (◐).

Run: `npm run dev`, entrar como administrador y comprobar a mano:
1. `/` redirige a `/despacho/clientes` y muestra "Todavía no hay clientes".
2. "Nuevo cliente": guardar solo con nombre crea al cliente y la lista lo muestra con sus faltantes.
3. Un clic en el mapa llena latitud y longitud.
4. `/despacho/clientes/esto-no-es-un-id` muestra la página 404.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: pantallas de clientes: lista, ficha con mapa e importación CSV"
```

### Task 12: Pruebas de punta a punta y aceptación del hito

**Files:**
- Create: `playwright.config.ts`, `e2e/global.setup.ts`, `e2e/clientes.spec.ts`
- Modify: `.env.local` (credenciales del usuario de prueba), `.gitignore`

**Interfaces:**
- Consumes: las rutas de la Tarea 11 y el inicio de sesión de la Tarea 10.
- Produces: comando `npx playwright test`.

- [ ] **Step 1: Instalar Playwright y crear el usuario de prueba**

```bash
npm install -D @playwright/test @clerk/testing
npx playwright install chromium
```

En el panel de Clerk crear un segundo usuario con contraseña para las pruebas, darlo de alta como despachador y guardar sus credenciales en `.env.local`:

```bash
npx tsx scripts/alta-usuario.mts user_YYYYYYYY "Despachador de prueba" despachador
```

```
E2E_USUARIO=correo-del-usuario-de-prueba
E2E_CLAVE=contraseña-del-usuario-de-prueba
```

Agregar a `.gitignore`:

```
/test-results/
/playwright-report/
```

- [ ] **Step 2: Escribir las pruebas**

`playwright.config.ts`

```ts
import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/sign-in",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "preparacion", testMatch: /global\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["preparacion"] },
  ],
});
```

`e2e/global.setup.ts`

```ts
import { clerkSetup } from "@clerk/testing/playwright";
import { test as preparar } from "@playwright/test";

preparar("prepara Clerk para pruebas", async () => {
  await clerkSetup();
});
```

`e2e/clientes.spec.ts`

```ts
import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";

async function entrarComoDespachador(page: Page) {
  await page.goto("/sign-in");
  await clerk.signIn({
    page,
    signInParams: { strategy: "password", identifier: process.env.E2E_USUARIO!, password: process.env.E2E_CLAVE! },
  });
}

test("el despachador da de alta un cliente completo y lo ve en la lista", async ({ page }) => {
  const nombre = `Cliente de prueba ${Date.now()}`;
  await entrarComoDespachador(page);
  await page.goto("/despacho/clientes/nuevo");

  await page.getByLabel("Nombre del cliente").fill(nombre);
  await page.getByLabel("Latitud").fill("20.6102");
  await page.getByLabel("Longitud").fill("-100.2801");
  await page.getByLabel("Tipo de residuo").selectOption("RME");
  await page.getByLabel("Doble rodada").check();
  await page.getByRole("button", { name: "Agregar ventana" }).click();
  await page.getByLabel("El cliente aceptó el aviso de privacidad").check();
  await page.getByRole("button", { name: "Guardar cliente" }).click();

  await expect(page).toHaveURL(/\/despacho\/clientes$/);
  await expect(page.getByRole("row", { name: new RegExp(nombre) }).getByText("Completa")).toBeVisible();
});

test("coordenadas invertidas no se guardan y el error aparece junto al campo", async ({ page }) => {
  await entrarComoDespachador(page);
  await page.goto("/despacho/clientes/nuevo");

  await page.getByLabel("Nombre del cliente").fill("Cliente con coordenadas invertidas");
  await page.getByLabel("Latitud").fill("-100.2801");
  await page.getByLabel("Longitud").fill("20.6102");
  await page.getByRole("button", { name: "Guardar cliente" }).click();

  await expect(page.getByText("Latitud fuera de México")).toBeVisible();
  await expect(page).toHaveURL(/\/despacho\/clientes\/nuevo$/);
});
```

- [ ] **Step 3: Ejecutarlas**

Run: `npx playwright test`
Expected: PASS — 3 pruebas (preparación y dos de clientes). Si `clerk.signIn` falla, revisar la guía de pruebas de Clerk para Playwright: es la única parte de este plan que no se pudo ejecutar de antemano.

- [ ] **Step 4: Aceptación del hito**

Comprobar y anotar el resultado de cada punto en el mensaje del commit:

1. `npm run verificar` y `npx playwright test` en verde.
2. Un usuario con rol `operador` o `gerencia` que abre `/despacho/clientes` llega a `/sin-acceso`.
3. Tras crear un cliente, la tabla `bitacora` tiene un renglón `cliente / crear` con el usuario correcto.
4. Importar un CSV de prueba con un renglón inválido muestra "Se importaron N clientes" y la línea del error.
5. Despliegue de vista previa: `vercel deploy` y repetir el punto 2 en la URL resultante.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: flujo de punta a punta de clientes y aceptación del hito 1"
```

---

## Lo que queda fuera de este plan

Cada punto tiene su propio plan en la hoja de ruta (`docs/superpowers/plans/2026-10-07-hoja-de-ruta.md`):

- Unidades, operadores, jornadas y solicitudes (Plan 2), incluida la pantalla de administración de usuarios que sustituye al script `alta-usuario.mts`.
- Motor de ruteo (Plan 3), plan del día (Plan 4), aplicación del operador (Plan 5) e indicadores (Plan 6).
- Captura de la cartera real: es trabajo de datos, no de código; se mide con el resumen "N de M clientes activos con datos completos" de la lista.
