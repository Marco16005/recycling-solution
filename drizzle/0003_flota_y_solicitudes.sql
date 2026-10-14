CREATE TYPE "public"."aplica_documento" AS ENUM('cliente', 'unidad', 'operador');--> statement-breakpoint
CREATE TYPE "public"."canal_solicitud" AS ENUM('telefono', 'whatsapp', 'correo', 'presencial', 'otro');--> statement-breakpoint
CREATE TYPE "public"."estado_solicitud" AS ENUM('pendiente', 'cancelada', 'atendida', 'no_atendida');--> statement-breakpoint
CREATE TYPE "public"."origen_documento" AS ENUM('ley', 'contrato', 'politica');--> statement-breakpoint
CREATE TABLE "documentos_operador" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operador_id" uuid NOT NULL,
	"tipo_documento_id" text NOT NULL,
	"obligatorio" boolean NOT NULL,
	"estado" "estado_documento" DEFAULT 'pendiente' NOT NULL,
	"vence_el" date,
	"notas" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documentos_operador_tipo" UNIQUE("operador_id","tipo_documento_id")
);
--> statement-breakpoint
CREATE TABLE "documentos_unidad" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidad_id" uuid NOT NULL,
	"tipo_documento_id" text NOT NULL,
	"obligatorio" boolean NOT NULL,
	"estado" "estado_documento" DEFAULT 'pendiente' NOT NULL,
	"vence_el" date,
	"notas" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documentos_unidad_tipo" UNIQUE("unidad_id","tipo_documento_id")
);
--> statement-breakpoint
CREATE TABLE "folios_dia" (
	"fecha" date PRIMARY KEY NOT NULL,
	"ultimo" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jornadas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" date NOT NULL,
	"unidad_id" uuid NOT NULL,
	"operador_id" uuid NOT NULL,
	"disponible_desde" time NOT NULL,
	"check_in_en" timestamp with time zone,
	"check_out_en" timestamp with time zone,
	"notas" text,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jornadas_unidad_dia" UNIQUE("fecha","unidad_id"),
	CONSTRAINT "jornadas_operador_dia" UNIQUE("fecha","operador_id"),
	CONSTRAINT "jornadas_version" CHECK ("jornadas"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "operadores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"telefono" text,
	"activo" boolean DEFAULT true NOT NULL,
	"aviso_version" text,
	"aviso_entregado_en" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operadores_aviso_completo" CHECK (("operadores"."aviso_version" IS NULL) = ("operadores"."aviso_entregado_en" IS NULL)),
	CONSTRAINT "operadores_version" CHECK ("operadores"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "solicitudes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folio" text NOT NULL,
	"cliente_id" uuid NOT NULL,
	"registrada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"registrada_por" uuid,
	"fecha_solicitada" date NOT NULL,
	"proxima_fecha_elegible" date NOT NULL,
	"canal" "canal_solicitud" NOT NULL,
	"carga_estimada_kg" integer,
	"notas" text,
	"estado" "estado_solicitud" DEFAULT 'pendiente' NOT NULL,
	"motivo_cancelacion" text,
	"veces_pospuesta" integer DEFAULT 0 NOT NULL,
	"captura_inicio_en" timestamp with time zone,
	"captura_fin_en" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solicitudes_folio_unique" UNIQUE("folio"),
	CONSTRAINT "solicitudes_carga" CHECK ("solicitudes"."carga_estimada_kg" IS NULL OR "solicitudes"."carga_estimada_kg" BETWEEN 1 AND 60000),
	CONSTRAINT "solicitudes_elegible" CHECK ("solicitudes"."proxima_fecha_elegible" >= "solicitudes"."fecha_solicitada"),
	CONSTRAINT "solicitudes_cancelacion" CHECK (("solicitudes"."estado" = 'cancelada') = ("solicitudes"."motivo_cancelacion" IS NOT NULL)),
	CONSTRAINT "solicitudes_captura" CHECK ("solicitudes"."captura_inicio_en" IS NULL OR "solicitudes"."captura_fin_en" IS NULL OR "solicitudes"."captura_inicio_en" <= "solicitudes"."captura_fin_en"),
	CONSTRAINT "solicitudes_version" CHECK ("solicitudes"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "tipos_documento" (
	"id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"aplica_a" "aplica_documento" NOT NULL,
	"origen" "origen_documento" NOT NULL,
	"obligatorio_por_omision" boolean NOT NULL,
	"requiere_vencimiento" boolean NOT NULL,
	"descripcion" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unidades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placa" text NOT NULL,
	"numero_economico" text,
	"tipo" "tipo_unidad" NOT NULL,
	"capacidad_kg" integer NOT NULL,
	"rendimiento_km_l" double precision NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"notas" text,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unidades_placa_unique" UNIQUE("placa"),
	CONSTRAINT "unidades_numero_economico_unique" UNIQUE("numero_economico"),
	CONSTRAINT "unidades_capacidad" CHECK ("unidades"."capacidad_kg" BETWEEN 1 AND 60000),
	CONSTRAINT "unidades_rendimiento" CHECK ("unidades"."rendimiento_km_l" > 0 AND "unidades"."rendimiento_km_l" <= 50),
	CONSTRAINT "unidades_version" CHECK ("unidades"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "avisos_privacidad" ADD COLUMN "texto" text;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "carga_por_omision_kg" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "dias_operacion" smallint[] DEFAULT '{1,2,3,4,5,6}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "dias_para_atrasada" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "documentos_cliente" ADD COLUMN "tipo_documento_id" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "operador_id" uuid;--> statement-breakpoint
ALTER TABLE "documentos_operador" ADD CONSTRAINT "documentos_operador_operador_id_operadores_id_fk" FOREIGN KEY ("operador_id") REFERENCES "public"."operadores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_operador" ADD CONSTRAINT "documentos_operador_tipo_documento_id_tipos_documento_id_fk" FOREIGN KEY ("tipo_documento_id") REFERENCES "public"."tipos_documento"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_unidad" ADD CONSTRAINT "documentos_unidad_unidad_id_unidades_id_fk" FOREIGN KEY ("unidad_id") REFERENCES "public"."unidades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_unidad" ADD CONSTRAINT "documentos_unidad_tipo_documento_id_tipos_documento_id_fk" FOREIGN KEY ("tipo_documento_id") REFERENCES "public"."tipos_documento"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jornadas" ADD CONSTRAINT "jornadas_unidad_id_unidades_id_fk" FOREIGN KEY ("unidad_id") REFERENCES "public"."unidades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jornadas" ADD CONSTRAINT "jornadas_operador_id_operadores_id_fk" FOREIGN KEY ("operador_id") REFERENCES "public"."operadores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operadores" ADD CONSTRAINT "operadores_aviso_version_avisos_privacidad_version_fk" FOREIGN KEY ("aviso_version") REFERENCES "public"."avisos_privacidad"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitudes" ADD CONSTRAINT "solicitudes_registrada_por_usuarios_id_fk" FOREIGN KEY ("registrada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "solicitudes_cola_idx" ON "solicitudes" USING btree ("estado","proxima_fecha_elegible","registrada_en");--> statement-breakpoint
CREATE INDEX "solicitudes_cliente_idx" ON "solicitudes" USING btree ("cliente_id");--> statement-breakpoint
ALTER TABLE "documentos_cliente" ADD CONSTRAINT "documentos_cliente_tipo_documento_id_tipos_documento_id_fk" FOREIGN KEY ("tipo_documento_id") REFERENCES "public"."tipos_documento"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_operador_id_operadores_id_fk" FOREIGN KEY ("operador_id") REFERENCES "public"."operadores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_operador_id_unique" UNIQUE("operador_id");--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_carga_omision" CHECK ("configuracion"."carga_por_omision_kg" > 0);--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_dias_operacion" CHECK (cardinality("configuracion"."dias_operacion") > 0 AND "configuracion"."dias_operacion" <@ '{0,1,2,3,4,5,6}'::smallint[]);--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_dias_atrasada" CHECK ("configuracion"."dias_para_atrasada" >= 1);--> statement-breakpoint
-- Los usuarios con rol operador que ya existían reciben su ficha de operador antes de exigirla.
DO $$
DECLARE
  u record;
  nuevo uuid;
BEGIN
  FOR u IN SELECT id, nombre FROM usuarios WHERE rol = 'operador' AND operador_id IS NULL LOOP
    INSERT INTO operadores (nombre) VALUES (u.nombre) RETURNING id INTO nuevo;
    UPDATE usuarios SET operador_id = nuevo WHERE id = u.id;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_operador_con_ficha" CHECK ("usuarios"."rol" <> 'operador' OR "usuarios"."operador_id" IS NOT NULL);