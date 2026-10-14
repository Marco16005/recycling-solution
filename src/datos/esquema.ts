import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, smallint, text, time, timestamp, uuid,
} from "drizzle-orm/pg-core";
import { user } from "./esquema-auth";

/** Tablas de Better Auth (generadas por su CLI). Solo autentican; la autorización vive en `usuarios`. */
export * from "./esquema-auth";

export const rolEnum = pgEnum("rol", ["admin", "despachador", "operador", "gerencia"]);
export const tipoResiduoEnum = pgEnum("tipo_residuo", ["RSU", "RME", "RP"]);
export const tipoUnidadEnum = pgEnum("tipo_unidad", ["doble_rodada", "rabon", "camioneta"]);
export const estadoDocumentoEnum = pgEnum("estado_documento", ["vigente", "pendiente", "vencido"]);
export const accionPrivacidadEnum = pgEnum("accion_privacidad", ["aceptado", "retirado"]);
export const medioPrivacidadEnum = pgEnum("medio_privacidad", ["papel", "correo", "verbal", "otro"]);

const marcas = {
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
};

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: text("auth_user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "restrict" }),
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
    activo: boolean("activo").notNull().default(true),
    version: integer("version").notNull().default(1),
    ...marcas,
  },
  (t) => [
    index("clientes_nombre_idx").on(t.nombre),
    check("clientes_ubicacion_completa", sql`(${t.lat} IS NULL) = (${t.lng} IS NULL)`),
    check("clientes_tiempo_servicio", sql`${t.tiempoServicioMin} BETWEEN 5 AND 480`),
    check("clientes_carga", sql`${t.cargaEstimadaKg} IS NULL OR ${t.cargaEstimadaKg} BETWEEN 0 AND 40000`),
    check("clientes_version", sql`${t.version} >= 1`),
  ],
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
  (t) => [
    index("ventanas_cliente_cliente_idx").on(t.clienteId),
    check("ventanas_dia_semana", sql`${t.diaSemana} BETWEEN 0 AND 6`),
    check("ventanas_orden", sql`${t.horaInicio} < ${t.horaFin}`),
  ],
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

/** Una fila por versión del aviso de privacidad; conserva qué decía cada una. */
export const avisosPrivacidad = pgTable("avisos_privacidad", {
  version: text("version").primaryKey(),
  descripcion: text("descripcion").notNull(),
  huellaSha256: text("huella_sha256"),
  publicadoEn: timestamp("publicado_en", { withTimezone: true }).notNull().defaultNow(),
});

/** Solo inserción. El estado vigente de un cliente es su renglón de mayor `secuencia`. */
export const aceptacionesPrivacidad = pgTable(
  "aceptaciones_privacidad",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    secuencia: bigint("secuencia", { mode: "number" }).generatedAlwaysAsIdentity().notNull().unique(),
    clienteId: uuid("cliente_id").notNull().references(() => clientes.id, { onDelete: "restrict" }),
    versionAviso: text("version_aviso")
      .notNull()
      .references(() => avisosPrivacidad.version, { onDelete: "restrict" }),
    accion: accionPrivacidadEnum("accion").notNull(),
    medio: medioPrivacidadEnum("medio").notNull(),
    registradoPor: uuid("registrado_por").references(() => usuarios.id),
    en: timestamp("en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("aceptaciones_privacidad_cliente_secuencia_idx").on(t.clienteId, t.secuencia)],
);

/** Una fila por importación confirmada; el id lo genera la pantalla y hace idempotente el reintento. Solo inserción. */
export const importaciones = pgTable("importaciones", {
  id: uuid("id").primaryKey(),
  usuarioId: uuid("usuario_id").references(() => usuarios.id),
  huella: text("huella").notNull(),
  importados: integer("importados").notNull(),
  en: timestamp("en", { withTimezone: true }).notNull().defaultNow(),
});

/** Una sola fila (id = 1); la crea la migración de datos iniciales. */
export const configuracion = pgTable(
  "configuracion",
  {
    id: smallint("id").primaryKey().default(1),
    patioLat: doublePrecision("patio_lat"),
    patioLng: doublePrecision("patio_lng"),
    turnoInicio: time("turno_inicio").notNull().default("08:00"),
    turnoFin: time("turno_fin").notNull().default("16:00"),
    velocidadKmh: doublePrecision("velocidad_kmh").notNull().default(30),
    factorCircuidad: doublePrecision("factor_circuidad").notNull().default(1.4),
    descargaMin: integer("descarga_min").notNull().default(20),
    versionAvisoPrivacidad: text("version_aviso_privacidad")
      .notNull()
      .default("2026-10")
      .references(() => avisosPrivacidad.version, { onDelete: "restrict" }),
    lineaBase: jsonb("linea_base").notNull().default({ esperaMin: 15, trasladoMin: 45, cicloMin: 161 }),
    ...marcas,
  },
  (t) => [
    check("configuracion_fila_unica", sql`${t.id} = 1`),
    check("configuracion_turno", sql`${t.turnoInicio} < ${t.turnoFin}`),
    check("configuracion_velocidad", sql`${t.velocidadKmh} > 0`),
    check("configuracion_circuidad", sql`${t.factorCircuidad} >= 1`),
    check("configuracion_descarga", sql`${t.descargaMin} >= 0`),
  ],
);

/** Solo inserción. `campos` guarda nombres de campos, nunca sus valores. */
export const bitacora = pgTable(
  "bitacora",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    en: timestamp("en", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: uuid("usuario_id").references(() => usuarios.id),
    entidad: text("entidad").notNull(),
    entidadId: uuid("entidad_id"),
    accion: text("accion").notNull(),
    campos: text("campos").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [index("bitacora_entidad_idx").on(t.entidad, t.entidadId)],
);
