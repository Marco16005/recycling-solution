import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, smallint, text, time, timestamp,
  unique, uniqueIndex, uuid, type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { EntradaPlan, Plan } from "@/motor";
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
export const canalSolicitudEnum = pgEnum("canal_solicitud", ["telefono", "whatsapp", "correo", "presencial", "otro", "propuesta"]);
/** Plan CRM. */
export const tipoNotaEnum = pgEnum("tipo_nota_cliente", ["llamada", "queja", "acuerdo", "otro"]);
export const estadoPropuestaEnum = pgEnum("estado_propuesta", ["confirmada", "descartada", "pospuesta"]);
/** programada: tiene parada vigente en un plan validado; en_ruta: su unidad ya salió (Plan 5). */
export const estadoSolicitudEnum = pgEnum("estado_solicitud", ["pendiente", "cancelada", "atendida", "no_atendida", "programada", "en_ruta"]);
export const estadoPlanEnum = pgEnum("estado_plan", ["propuesto", "validado", "descartado", "reemplazado"]);
/** inicial: el plan del día; re_ruteo: reemplaza a un validado de la misma fecha (Plan 5). */
export const tipoPlanEnum = pgEnum("tipo_plan", ["inicial", "re_ruteo"]);
export const resultadoMotorEnum = pgEnum("resultado_motor", ["ok", "error", "tiempo_agotado"]);
export const estadoParadaEnum = pgEnum("estado_parada", ["pendiente", "en_sitio", "completada", "omitida", "no_atendida", "en_servicio", "reasignada"]);
export const tipoEventoOperadorEnum = pgEnum("tipo_evento_operador", [
  "check_in", "salida_patio", "llegada", "inicio_servicio", "fin_servicio", "no_atendida", "regreso_patio", "fin_descarga", "check_out",
]);
export const resultadoEventoEnum = pgEnum("resultado_evento", ["aplicado", "rechazado"]);
export const tipoIncidenteEnum = pgEnum("tipo_incidente", ["averia", "retraso", "cierre_vial", "cliente_no_disponible", "otro"]);
export const accionIncidenteEnum = pgEnum("accion_incidente", ["continuar", "cancelar", "re_ruteo"]);

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
    /** Plan CRM. */
    contactoCorreo: text("contacto_correo"),
    contactoPuesto: text("contacto_puesto"),
    contactosAdicionales: jsonb("contactos_adicionales").notNull().default([]),
    recurrencia: jsonb("recurrencia"),
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
    check("clientes_contactos_adicionales", sql`jsonb_typeof(${t.contactosAdicionales}) = 'array' AND jsonb_array_length(${t.contactosAdicionales}) <= 10`),
  ],
);

/** Plan CRM: notas de seguimiento. Solo se agregan; corregir es otra nota que apunta a la anterior. */
export const notasCliente = pgTable(
  "notas_cliente",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clienteId: uuid("cliente_id").notNull().references(() => clientes.id, { onDelete: "restrict" }),
    tipo: tipoNotaEnum("tipo").notNull(),
    texto: text("texto").notNull(),
    autor: uuid("autor").notNull().references(() => usuarios.id),
    en: timestamp("en", { withTimezone: true }).notNull(),
    corrigeA: uuid("corrige_a").references((): AnyPgColumn => notasCliente.id),
  },
  (t) => [
    index("notas_cliente_cliente_idx").on(t.clienteId, t.en),
    check("notas_cliente_texto", sql`length(${t.texto}) BETWEEN 1 AND 1000`),
  ],
);

/** Plan CRM: decisiones del despachador sobre propuestas de recolección. Una por cliente y fecha; solo se agregan. */
export const propuestasRecoleccion = pgTable(
  "propuestas_recoleccion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clienteId: uuid("cliente_id").notNull().references(() => clientes.id, { onDelete: "restrict" }),
    fecha: date("fecha", { mode: "string" }).notNull(),
    estado: estadoPropuestaEnum("estado").notNull(),
    pospuestaHasta: date("pospuesta_hasta", { mode: "string" }),
    solicitudId: uuid("solicitud_id").references(() => solicitudes.id),
    nota: text("nota"),
    decididaPor: uuid("decidida_por").notNull().references(() => usuarios.id),
    decididaEn: timestamp("decidida_en", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("propuestas_recoleccion_cliente_fecha").on(t.clienteId, t.fecha),
    check("propuestas_recoleccion_pospuesta", sql`(${t.estado} = 'pospuesta') = (${t.pospuestaHasta} IS NOT NULL)`),
    check("propuestas_recoleccion_confirmada", sql`(${t.estado} = 'confirmada') = (${t.solicitudId} IS NOT NULL)`),
    check("propuestas_recoleccion_nota", sql`${t.nota} IS NULL OR length(${t.nota}) <= 300`),
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
    /** Plan 7: los tiempos de auto de OSRM se multiplican por este factor para la flota. */
    factorCamion: doublePrecision("factor_camion").notNull().default(1.2),
    /** Plan 7: franjas [{ inicio: "HH:MM", fin: "HH:MM", factor }]; supuestos hasta calibrar en el piloto. */
    horasPico: jsonb("horas_pico").notNull().default([{ inicio: "07:00", fin: "09:30", factor: 1.3 }, { inicio: "13:30", fin: "15:00", factor: 1.15 }]),
    /** Plan 7: a partir de cuántos minutos de atraso proyectado se avisa. */
    umbralAtrasoMin: smallint("umbral_atraso_min").notNull().default(15),
    /** Plan 8: minutos de tiempo muerto que puede agregar una parada readmitida; si pasa, se queda para otro día. */
    toleranciaReadmisionMin: smallint("tolerancia_readmision_min").notNull().default(15),
    version: integer("version").notNull().default(1),
    ...marcas,
  },
  (t) => [
    check("configuracion_fila_unica", sql`${t.id} = 1`),
    check("configuracion_turno", sql`${t.turnoInicio} < ${t.turnoFin}`),
    check("configuracion_velocidad", sql`${t.velocidadKmh} > 0`),
    check("configuracion_circuidad", sql`${t.factorCircuidad} >= 1`),
    check("configuracion_descarga", sql`${t.descargaMin} >= 0`),
    check("configuracion_factor_camion", sql`${t.factorCamion} >= 1 AND ${t.factorCamion} <= 3`),
    check("configuracion_horas_pico", sql`jsonb_typeof(${t.horasPico}) = 'array'`),
    check("configuracion_umbral_atraso", sql`${t.umbralAtrasoMin} BETWEEN 1 AND 120`),
    check("configuracion_tolerancia_readmision", sql`${t.toleranciaReadmisionMin} BETWEEN 0 AND 60`),
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
    /** Sube con cada evento aplicado y cada cancelación por incidente: el re-ruteo la compara (Plan 5). */
    versionOperacion: integer("version_operacion").notNull().default(0),
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

// ---------- Plan 4: plan del día (docs/superpowers/plans/2026-10-15-plan-4-plan-del-dia.md §2)

/**
 * Propuestas y planes validados. Mientras está propuesto, `resultado` (el Plan del motor, con la traza original y los
 * ajustes aplicados) es la única fuente de verdad; rutas y paradas se escriben al validar.
 */
export const planes = pgTable(
  "planes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fecha: date("fecha", { mode: "string" }).notNull(),
    estado: estadoPlanEnum("estado").notNull().default("propuesto"),
    version: integer("version").notNull().default(1),
    generadoEn: timestamp("generado_en", { withTimezone: true }).notNull(),
    generadoPor: uuid("generado_por").notNull().references(() => usuarios.id),
    revisionIniciadaEn: timestamp("revision_iniciada_en", { withTimezone: true }),
    validadoEn: timestamp("validado_en", { withTimezone: true }),
    validadoPor: uuid("validado_por").references(() => usuarios.id),
    descartadoEn: timestamp("descartado_en", { withTimezone: true }),
    requisitosConfirmadosEn: timestamp("requisitos_confirmados_en", { withTimezone: true }),
    semilla: integer("semilla").notNull(),
    versionMotor: text("version_motor").notNull(),
    entrada: jsonb("entrada").$type<EntradaPlan>().notNull(),
    /** VersionesPlan (src/dominio/plan/tipos.ts): versiones de todo lo que sustentó la propuesta. */
    versiones: jsonb("versiones").notNull(),
    resultado: jsonb("resultado").$type<Plan>().notNull(),
    /** Ajustes manuales en orden, con autor y hora. Vacío: el plan es el del motor. */
    ajustes: jsonb("ajustes").notNull().default(sql`'[]'::jsonb`),
    tipo: tipoPlanEnum("tipo").notNull().default("inicial"),
    /** En un re-ruteo, el validado que reemplaza. */
    planBaseId: uuid("plan_base_id").references((): AnyPgColumn => planes.id),
    /** En un re-ruteo: { jornadasNoDisponibles, admitidas, congeladas } (Plan 5, §2). */
    restricciones: jsonb("restricciones"),
    ...marcas,
  },
  (t) => [
    uniqueIndex("planes_un_validado_por_fecha").on(t.fecha).where(sql`${t.estado} = 'validado'`),
    uniqueIndex("planes_un_propuesto_por_fecha").on(t.fecha).where(sql`${t.estado} = 'propuesto'`),
    check("planes_version", sql`${t.version} >= 1`),
    // Un plan reemplazado por un re-ruteo (Plan 5) conserva los datos de su validación. Se compara como texto: el valor
    // 'reemplazado' se agrega al enum en la misma migración y no se puede usar como constante del enum en ella.
    check("planes_validado", sql`(${t.estado}::text IN ('validado', 'reemplazado')) = (${t.validadoEn} IS NOT NULL)`),
    check(
      "planes_validado_completo",
      sql`${t.estado}::text NOT IN ('validado', 'reemplazado') OR (${t.validadoPor} IS NOT NULL AND ${t.revisionIniciadaEn} IS NOT NULL AND ${t.requisitosConfirmadosEn} IS NOT NULL)`,
    ),
    check("planes_descartado", sql`(${t.estado} = 'descartado') = (${t.descartadoEn} IS NOT NULL)`),
    check("planes_ajustes", sql`jsonb_typeof(${t.ajustes}) = 'array'`),
    check("planes_re_ruteo", sql`(${t.tipo} = 're_ruteo') = (${t.planBaseId} IS NOT NULL AND ${t.restricciones} IS NOT NULL)`),
  ],
);

/** Toda corrida del motor, incluso fallida (K7). Solo inserción. plan_id es null si no se guardó plan. */
export const ejecucionesMotor = pgTable(
  "ejecuciones_motor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fecha: date("fecha", { mode: "string" }).notNull(),
    inicioEn: timestamp("inicio_en", { withTimezone: true }).notNull(),
    finEn: timestamp("fin_en", { withTimezone: true }).notNull(),
    /** Reloj monotónico (performance.now()), medido fuera del motor. */
    duracionMs: doublePrecision("duracion_ms").notNull(),
    resultado: resultadoMotorEnum("resultado").notNull(),
    /** Mensaje técnico saneado (nombre y código), sin datos personales. */
    error: text("error"),
    planId: uuid("plan_id").references(() => planes.id),
    versionMotor: text("version_motor").notNull(),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id),
    /** Plan 7: lo que tardó la consulta al mapa antes de correr el motor; null si no hubo consulta. */
    consultaMapaMs: doublePrecision("consulta_mapa_ms"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ejecuciones_motor_fecha_idx").on(t.fecha, t.inicioEn),
    check("ejecuciones_motor_duracion", sql`${t.duracionMs} >= 0`),
    check("ejecuciones_motor_orden", sql`${t.inicioEn} <= ${t.finEn}`),
    check("ejecuciones_motor_plan", sql`${t.resultado} = 'ok' OR ${t.planId} IS NULL`),
    check("ejecuciones_motor_error", sql`${t.error} IS NULL OR length(${t.error}) <= 200`),
    check("ejecuciones_motor_consulta_mapa", sql`${t.consultaMapaMs} IS NULL OR ${t.consultaMapaMs} >= 0`),
  ],
);

/** Un viaje de una jornada en un plan validado (K1, K4). Los campos reales los llena el Plan 5. */
export const rutas = pgTable(
  "rutas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull().references(() => planes.id, { onDelete: "restrict" }),
    jornadaId: uuid("jornada_id").notNull().references(() => jornadas.id, { onDelete: "restrict" }),
    numeroViaje: integer("numero_viaje").notNull(),
    version: integer("version").notNull().default(1),
    salidaEstimada: timestamp("salida_estimada", { withTimezone: true }).notNull(),
    regresoEstimado: timestamp("regreso_estimado", { withTimezone: true }).notNull(),
    finDescargaEstimado: timestamp("fin_descarga_estimado", { withTimezone: true }).notNull(),
    cargaKg: integer("carga_kg").notNull(),
    kmEstimados: doublePrecision("km_estimados").notNull(),
    /** Suma de paradas.km_contrafactual del viaje al validar. */
    kmContrafactual: doublePrecision("km_contrafactual").notNull(),
    /** Rendimiento de la unidad al validar, congelado para K4. */
    rendimientoKmLUsado: doublePrecision("rendimiento_km_l_usado").notNull(),
    /** Viaje 1: disponible_desde de la jornada; siguientes: fin de descarga estimado del anterior (el Plan 5 pone el real). */
    disponibleParaSalirEn: timestamp("disponible_para_salir_en", { withTimezone: true }).notNull(),
    asignadaEn: timestamp("asignada_en", { withTimezone: true }).notNull(),
    salidaPatioEn: timestamp("salida_patio_en", { withTimezone: true }),
    regresoPatioEn: timestamp("regreso_patio_en", { withTimezone: true }),
    descargaFinEn: timestamp("descarga_fin_en", { withTimezone: true }),
    odometroInicioKm: doublePrecision("odometro_inicio_km"),
    odometroFinKm: doublePrecision("odometro_fin_km"),
    /** Plan 7: modelo de tiempos con que se planeó (TiemposRuta); null en las rutas anteriores. */
    tiempos: jsonb("tiempos"),
    ...marcas,
  },
  (t) => [
    unique("rutas_viaje").on(t.planId, t.jornadaId, t.numeroViaje),
    index("rutas_jornada_idx").on(t.jornadaId),
    check("rutas_version", sql`${t.version} >= 1`),
    check("rutas_numero", sql`${t.numeroViaje} >= 1`),
    check("rutas_carga", sql`${t.cargaKg} >= 0`),
    check("rutas_km", sql`${t.kmEstimados} >= 0 AND ${t.kmContrafactual} >= 0`),
    check("rutas_rendimiento", sql`${t.rendimientoKmLUsado} > 0`),
    check("rutas_horas", sql`${t.salidaEstimada} <= ${t.regresoEstimado} AND ${t.regresoEstimado} <= ${t.finDescargaEstimado}`),
    check("rutas_odometro", sql`${t.odometroInicioKm} IS NULL OR ${t.odometroFinKm} IS NULL OR ${t.odometroInicioKm} <= ${t.odometroFinKm}`),
  ],
);

/** Una visita de un viaje. Una solicitud tiene a lo sumo una parada vigente (especificación §6). */
export const paradas = pgTable(
  "paradas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rutaId: uuid("ruta_id").notNull().references(() => rutas.id, { onDelete: "restrict" }),
    solicitudId: uuid("solicitud_id").notNull().references(() => solicitudes.id, { onDelete: "restrict" }),
    secuencia: integer("secuencia").notNull(),
    /** Ventana comprometida: limita el inicio del servicio (K3). */
    ventanaInicio: time("ventana_inicio").notNull(),
    ventanaFin: time("ventana_fin").notNull(),
    llegadaEstimada: timestamp("llegada_estimada", { withTimezone: true }).notNull(),
    inicioEstimado: timestamp("inicio_estimado", { withTimezone: true }).notNull(),
    finEstimado: timestamp("fin_estimado", { withTimezone: true }).notNull(),
    esperaMin: integer("espera_min").notNull(),
    cargaKg: integer("carga_kg").notNull(),
    kmDesdeAnterior: doublePrecision("km_desde_anterior").notNull(),
    /** Viaje redondo patio–cliente–patio de esta solicitud: el método actual (K4). */
    kmContrafactual: doublePrecision("km_contrafactual").notNull(),
    vigente: boolean("vigente").notNull().default(true),
    estado: estadoParadaEnum("estado").notNull().default("pendiente"),
    motivoNoAtendida: text("motivo_no_atendida"),
    /** Cuándo se cerró (fin de servicio o no atendida): el traslado a la siguiente se mide desde aquí (Plan 6, K1). */
    cierreEn: timestamp("cierre_en", { withTimezone: true }),
    llegadaEn: timestamp("llegada_en", { withTimezone: true }),
    inicioServicioEn: timestamp("inicio_servicio_en", { withTimezone: true }),
    finServicioEn: timestamp("fin_servicio_en", { withTimezone: true }),
    ...marcas,
  },
  (t) => [
    unique("paradas_secuencia").on(t.rutaId, t.secuencia),
    uniqueIndex("paradas_solicitud_vigente").on(t.solicitudId).where(sql`${t.vigente}`),
    index("paradas_solicitud_idx").on(t.solicitudId),
    check("paradas_secuencia_positiva", sql`${t.secuencia} >= 1`),
    check("paradas_ventana", sql`${t.ventanaInicio} <= ${t.ventanaFin}`),
    check("paradas_estimados", sql`${t.llegadaEstimada} <= ${t.inicioEstimado} AND ${t.inicioEstimado} <= ${t.finEstimado}`),
    check("paradas_espera", sql`${t.esperaMin} >= 0`),
    check("paradas_carga", sql`${t.cargaKg} >= 0`),
    check("paradas_km", sql`${t.kmDesdeAnterior} >= 0 AND ${t.kmContrafactual} >= 0`),
    check("paradas_no_atendida", sql`(${t.estado} = 'no_atendida') = (${t.motivoNoAtendida} IS NOT NULL) AND (${t.motivoNoAtendida} IS NULL OR length(${t.motivoNoAtendida}) <= 200)`),
  ],
);

// ---------- Plan 5: operación (docs/superpowers/plans/2026-10-15-plan-5-operador-incidentes-y-reruteo.md §2)

/**
 * Cada evento que manda el teléfono, aplicado o rechazado (decisión 9: los rechazados se guardan para conciliarlos).
 * rs_app solo inserta y llena las columnas de conciliación.
 */
export const eventosOperador = pgTable(
  "eventos_operador",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Lo genera el teléfono: hace idempotente el reintento. */
    eventoId: uuid("evento_id").notNull().unique(),
    jornadaId: uuid("jornada_id").notNull().references(() => jornadas.id, { onDelete: "restrict" }),
    rutaId: uuid("ruta_id").references(() => rutas.id, { onDelete: "restrict" }),
    paradaId: uuid("parada_id").references(() => paradas.id, { onDelete: "restrict" }),
    tipo: tipoEventoOperadorEnum("tipo").notNull(),
    ocurridoEn: timestamp("ocurrido_en", { withTimezone: true }).notNull(),
    recibidoEn: timestamp("recibido_en", { withTimezone: true }).notNull(),
    versionRuta: integer("version_ruta"),
    odometroKm: doublePrecision("odometro_km"),
    motivo: text("motivo"),
    /** SHA-256 del contenido canónico (jornada incluida): el mismo evento_id con otro contenido es un conflicto. */
    huella: text("huella").notNull(),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id),
    resultado: resultadoEventoEnum("resultado").notNull(),
    motivoRechazo: text("motivo_rechazo"),
    conciliadoEn: timestamp("conciliado_en", { withTimezone: true }),
    conciliadoPor: uuid("conciliado_por").references(() => usuarios.id),
    notaConciliacion: text("nota_conciliacion"),
  },
  (t) => [
    index("eventos_operador_jornada_idx").on(t.jornadaId, t.ocurridoEn),
    check("eventos_operador_rechazo", sql`(${t.resultado} = 'rechazado') = (${t.motivoRechazo} IS NOT NULL)`),
    check("eventos_operador_textos", sql`(${t.motivo} IS NULL OR length(${t.motivo}) <= 200) AND (${t.notaConciliacion} IS NULL OR length(${t.notaConciliacion}) <= 300) AND (${t.motivoRechazo} IS NULL OR length(${t.motivoRechazo}) <= 300)`),
    check("eventos_operador_conciliacion", sql`(${t.conciliadoEn} IS NULL) = (${t.conciliadoPor} IS NULL)`),
    check("eventos_operador_odometro", sql`${t.odometroKm} IS NULL OR ${t.odometroKm} >= 0`),
  ],
);

/** Incidentes que reporta el operador y resuelve el despachador. */
export const incidentes = pgTable(
  "incidentes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventoId: uuid("evento_id").notNull().unique(),
    huella: text("huella").notNull(),
    jornadaId: uuid("jornada_id").notNull().references(() => jornadas.id, { onDelete: "restrict" }),
    paradaId: uuid("parada_id").references(() => paradas.id, { onDelete: "restrict" }),
    tipo: tipoIncidenteEnum("tipo").notNull(),
    /** Breve; la pantalla pide no escribir datos personales. */
    descripcion: text("descripcion").notNull(),
    reportadoEn: timestamp("reportado_en", { withTimezone: true }).notNull(),
    reportadoPor: uuid("reportado_por").notNull().references(() => usuarios.id),
    resueltoEn: timestamp("resuelto_en", { withTimezone: true }),
    resueltoPor: uuid("resuelto_por").references(() => usuarios.id),
    accion: accionIncidenteEnum("accion"),
    version: integer("version").notNull().default(1),
    ...marcas,
  },
  (t) => [
    index("incidentes_jornada_idx").on(t.jornadaId),
    check("incidentes_descripcion", sql`length(${t.descripcion}) BETWEEN 1 AND 300`),
    check("incidentes_resuelto", sql`(${t.resueltoEn} IS NULL) = (${t.resueltoPor} IS NULL) AND (${t.resueltoEn} IS NULL) = (${t.accion} IS NULL)`),
    check("incidentes_version", sql`${t.version} >= 1`),
  ],
);

// ---------- Plan 6: indicadores (docs/superpowers/plans/2026-10-15-plan-6-indicadores-y-panel.md §3)

/** Instantánea diaria de K5 para su serie histórica. Solo inserción; una por fecha. */
export const instantaneasK5 = pgTable(
  "instantaneas_k5",
  {
    fecha: date("fecha", { mode: "string" }).primaryKey(),
    activos: integer("activos").notNull(),
    completos: integer("completos").notNull(),
    tomadaEn: timestamp("tomada_en", { withTimezone: true }).notNull(),
  },
  (t) => [check("instantaneas_k5_conteos", sql`${t.activos} >= 0 AND ${t.completos} BETWEEN 0 AND ${t.activos}`)],
);
