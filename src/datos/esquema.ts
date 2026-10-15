import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, smallint, text, time, timestamp,
  unique, uuid, type AnyPgColumn,
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
export const aplicaDocumentoEnum = pgEnum("aplica_documento", ["cliente", "unidad", "operador"]);
export const origenDocumentoEnum = pgEnum("origen_documento", ["ley", "contrato", "politica"]);
export const canalSolicitudEnum = pgEnum("canal_solicitud", ["telefono", "whatsapp", "correo", "presencial", "otro"]);
export const estadoSolicitudEnum = pgEnum("estado_solicitud", ["pendiente", "cancelada", "atendida", "no_atendida"]);

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
  /** Sube al desactivar, reactivar, restablecer la contraseña o cambiar el rol; invalida las entradas en curso. */
  generacion: integer("generacion").notNull().default(1),
  version: integer("version").notNull().default(1),
  /** Ficha de operador del usuario; obligatoria si el rol es operador. */
  operadorId: uuid("operador_id")
    .unique()
    .references((): AnyPgColumn => operadores.id, { onDelete: "restrict" }),
  ...marcas,
}, (t) => [
  check("usuarios_operador_con_ficha", sql`${t.rol} <> 'operador' OR ${t.operadorId} IS NOT NULL`),
]);

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
    /** Tipo del catálogo; null si el nombre es libre. */
    tipoDocumentoId: text("tipo_documento_id").references(() => tiposDocumento.id, { onDelete: "restrict" }),
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
  /** Texto completo publicado; null solo en la versión inicial previa a la primera publicación. */
  texto: text("texto"),
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
    cargaPorOmisionKg: integer("carga_por_omision_kg").notNull().default(1000),
    /** 0 = domingo … 6 = sábado. */
    diasOperacion: smallint("dias_operacion").array().notNull().default(sql`'{1,2,3,4,5,6}'::smallint[]`),
    diasParaAtrasada: smallint("dias_para_atrasada").notNull().default(2),
    version: integer("version").notNull().default(1),
    ...marcas,
  },
  (t) => [
    check("configuracion_fila_unica", sql`${t.id} = 1`),
    check("configuracion_turno", sql`${t.turnoInicio} < ${t.turnoFin}`),
    check("configuracion_velocidad", sql`${t.velocidadKmh} > 0`),
    check("configuracion_circuidad", sql`${t.factorCircuidad} >= 1`),
    check("configuracion_descarga", sql`${t.descargaMin} >= 0`),
    check("configuracion_carga_omision", sql`${t.cargaPorOmisionKg} > 0`),
    check("configuracion_dias_operacion", sql`cardinality(${t.diasOperacion}) > 0 AND ${t.diasOperacion} <@ '{0,1,2,3,4,5,6}'::smallint[]`),
    check("configuracion_dias_atrasada", sql`${t.diasParaAtrasada} >= 1`),
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

/** Catálogo de documentos (docs/catalogo-de-documentos.md); lo llena la migración. */
export const tiposDocumento = pgTable("tipos_documento", {
  id: text("id").primaryKey(),
  nombre: text("nombre").notNull(),
  aplicaA: aplicaDocumentoEnum("aplica_a").notNull(),
  origen: origenDocumentoEnum("origen").notNull(),
  obligatorioPorOmision: boolean("obligatorio_por_omision").notNull(),
  requiereVencimiento: boolean("requiere_vencimiento").notNull(),
  descripcion: text("descripcion").notNull(),
});

export const unidades = pgTable(
  "unidades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Normalizada: mayúsculas, sin espacios ni guiones. */
    placa: text("placa").notNull().unique(),
    numeroEconomico: text("numero_economico").unique(),
    tipo: tipoUnidadEnum("tipo").notNull(),
    capacidadKg: integer("capacidad_kg").notNull(),
    rendimientoKmL: doublePrecision("rendimiento_km_l").notNull(),
    activo: boolean("activo").notNull().default(true),
    notas: text("notas"),
    version: integer("version").notNull().default(1),
    ...marcas,
  },
  (t) => [
    check("unidades_capacidad", sql`${t.capacidadKg} BETWEEN 1 AND 60000`),
    check("unidades_rendimiento", sql`${t.rendimientoKmL} > 0 AND ${t.rendimientoKmL} <= 50`),
    check("unidades_version", sql`${t.version} >= 1`),
  ],
);

export const documentosUnidad = pgTable(
  "documentos_unidad",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unidadId: uuid("unidad_id").notNull().references(() => unidades.id, { onDelete: "cascade" }),
    tipoDocumentoId: text("tipo_documento_id").notNull().references(() => tiposDocumento.id, { onDelete: "restrict" }),
    /** Si este documento es obligatorio para esta unidad; se inicia con el valor del catálogo. */
    obligatorio: boolean("obligatorio").notNull(),
    estado: estadoDocumentoEnum("estado").notNull().default("pendiente"),
    venceEl: date("vence_el", { mode: "string" }),
    notas: text("notas"),
    ...marcas,
  },
  (t) => [unique("documentos_unidad_tipo").on(t.unidadId, t.tipoDocumentoId)],
);

export const operadores = pgTable(
  "operadores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nombre: text("nombre").notNull(),
    telefono: text("telefono"),
    activo: boolean("activo").notNull().default(true),
    avisoVersion: text("aviso_version").references(() => avisosPrivacidad.version, { onDelete: "restrict" }),
    avisoEntregadoEn: timestamp("aviso_entregado_en", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...marcas,
  },
  (t) => [
    check("operadores_aviso_completo", sql`(${t.avisoVersion} IS NULL) = (${t.avisoEntregadoEn} IS NULL)`),
    check("operadores_version", sql`${t.version} >= 1`),
  ],
);

export const documentosOperador = pgTable(
  "documentos_operador",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operadorId: uuid("operador_id").notNull().references(() => operadores.id, { onDelete: "cascade" }),
    tipoDocumentoId: text("tipo_documento_id").notNull().references(() => tiposDocumento.id, { onDelete: "restrict" }),
    /** Si este documento es obligatorio para esta operador; se inicia con el valor del catálogo. */
    obligatorio: boolean("obligatorio").notNull(),
    estado: estadoDocumentoEnum("estado").notNull().default("pendiente"),
    venceEl: date("vence_el", { mode: "string" }),
    notas: text("notas"),
    ...marcas,
  },
  (t) => [unique("documentos_operador_tipo").on(t.operadorId, t.tipoDocumentoId)],
);

/** Qué unidad sale con qué operador cada día. */
export const jornadas = pgTable(
  "jornadas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fecha: date("fecha", { mode: "string" }).notNull(),
    unidadId: uuid("unidad_id").notNull().references(() => unidades.id, { onDelete: "restrict" }),
    operadorId: uuid("operador_id").notNull().references(() => operadores.id, { onDelete: "restrict" }),
    disponibleDesde: time("disponible_desde").notNull(),
    checkInEn: timestamp("check_in_en", { withTimezone: true }),
    checkOutEn: timestamp("check_out_en", { withTimezone: true }),
    notas: text("notas"),
    version: integer("version").notNull().default(1),
    ...marcas,
  },
  (t) => [
    unique("jornadas_unidad_dia").on(t.fecha, t.unidadId),
    unique("jornadas_operador_dia").on(t.fecha, t.operadorId),
    check("jornadas_version", sql`${t.version} >= 1`),
  ],
);

/** Consecutivo de folios por día de registro (Ciudad de México). */
export const foliosDia = pgTable("folios_dia", {
  fecha: date("fecha", { mode: "string" }).primaryKey(),
  ultimo: integer("ultimo").notNull(),
});

export const solicitudes = pgTable(
  "solicitudes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folio: text("folio").notNull().unique(),
    clienteId: uuid("cliente_id").notNull().references(() => clientes.id, { onDelete: "restrict" }),
    /** Llave FIFO. Inmutable: lo garantiza un trigger. */
    registradaEn: timestamp("registrada_en", { withTimezone: true }).notNull().defaultNow(),
    registradaPor: uuid("registrada_por").references(() => usuarios.id),
    fechaSolicitada: date("fecha_solicitada", { mode: "string" }).notNull(),
    proximaFechaElegible: date("proxima_fecha_elegible", { mode: "string" }).notNull(),
    canal: canalSolicitudEnum("canal").notNull(),
    cargaEstimadaKg: integer("carga_estimada_kg"),
    notas: text("notas"),
    estado: estadoSolicitudEnum("estado").notNull().default("pendiente"),
    motivoCancelacion: text("motivo_cancelacion"),
    vecesPospuesta: integer("veces_pospuesta").notNull().default(0),
    capturaInicioEn: timestamp("captura_inicio_en", { withTimezone: true }),
    capturaFinEn: timestamp("captura_fin_en", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...marcas,
  },
  (t) => [
    index("solicitudes_cola_idx").on(t.estado, t.proximaFechaElegible, t.registradaEn),
    index("solicitudes_cliente_idx").on(t.clienteId),
    check("solicitudes_carga", sql`${t.cargaEstimadaKg} IS NULL OR ${t.cargaEstimadaKg} BETWEEN 1 AND 60000`),
    check("solicitudes_elegible", sql`${t.proximaFechaElegible} >= ${t.fechaSolicitada}`),
    check("solicitudes_cancelacion", sql`(${t.estado} = 'cancelada') = (${t.motivoCancelacion} IS NOT NULL)`),
    check("solicitudes_captura", sql`${t.capturaInicioEn} IS NULL OR ${t.capturaFinEn} IS NULL OR ${t.capturaInicioEn} <= ${t.capturaFinEn}`),
    check("solicitudes_version", sql`${t.version} >= 1`),
  ],
);
