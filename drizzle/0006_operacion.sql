CREATE TYPE "public"."accion_incidente" AS ENUM('continuar', 'cancelar', 're_ruteo');--> statement-breakpoint
CREATE TYPE "public"."resultado_evento" AS ENUM('aplicado', 'rechazado');--> statement-breakpoint
CREATE TYPE "public"."tipo_evento_operador" AS ENUM('check_in', 'salida_patio', 'llegada', 'inicio_servicio', 'fin_servicio', 'no_atendida', 'regreso_patio', 'fin_descarga', 'check_out');--> statement-breakpoint
CREATE TYPE "public"."tipo_incidente" AS ENUM('averia', 'retraso', 'cierre_vial', 'cliente_no_disponible', 'otro');--> statement-breakpoint
CREATE TYPE "public"."tipo_plan" AS ENUM('inicial', 're_ruteo');--> statement-breakpoint
ALTER TYPE "public"."estado_parada" ADD VALUE 'en_servicio';--> statement-breakpoint
ALTER TYPE "public"."estado_parada" ADD VALUE 'reasignada';--> statement-breakpoint
ALTER TYPE "public"."estado_plan" ADD VALUE 'reemplazado';--> statement-breakpoint
CREATE TABLE "eventos_operador" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evento_id" uuid NOT NULL,
	"jornada_id" uuid NOT NULL,
	"ruta_id" uuid,
	"parada_id" uuid,
	"tipo" "tipo_evento_operador" NOT NULL,
	"ocurrido_en" timestamp with time zone NOT NULL,
	"recibido_en" timestamp with time zone NOT NULL,
	"version_ruta" integer,
	"odometro_km" double precision,
	"motivo" text,
	"huella" text NOT NULL,
	"usuario_id" uuid NOT NULL,
	"resultado" "resultado_evento" NOT NULL,
	"motivo_rechazo" text,
	"conciliado_en" timestamp with time zone,
	"conciliado_por" uuid,
	"nota_conciliacion" text,
	CONSTRAINT "eventos_operador_evento_id_unique" UNIQUE("evento_id"),
	CONSTRAINT "eventos_operador_rechazo" CHECK (("eventos_operador"."resultado" = 'rechazado') = ("eventos_operador"."motivo_rechazo" IS NOT NULL)),
	CONSTRAINT "eventos_operador_textos" CHECK (("eventos_operador"."motivo" IS NULL OR length("eventos_operador"."motivo") <= 200) AND ("eventos_operador"."nota_conciliacion" IS NULL OR length("eventos_operador"."nota_conciliacion") <= 300) AND ("eventos_operador"."motivo_rechazo" IS NULL OR length("eventos_operador"."motivo_rechazo") <= 300)),
	CONSTRAINT "eventos_operador_conciliacion" CHECK (("eventos_operador"."conciliado_en" IS NULL) = ("eventos_operador"."conciliado_por" IS NULL)),
	CONSTRAINT "eventos_operador_odometro" CHECK ("eventos_operador"."odometro_km" IS NULL OR "eventos_operador"."odometro_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "incidentes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evento_id" uuid NOT NULL,
	"huella" text NOT NULL,
	"jornada_id" uuid NOT NULL,
	"parada_id" uuid,
	"tipo" "tipo_incidente" NOT NULL,
	"descripcion" text NOT NULL,
	"reportado_en" timestamp with time zone NOT NULL,
	"reportado_por" uuid NOT NULL,
	"resuelto_en" timestamp with time zone,
	"resuelto_por" uuid,
	"accion" "accion_incidente",
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidentes_evento_id_unique" UNIQUE("evento_id"),
	CONSTRAINT "incidentes_descripcion" CHECK (length("incidentes"."descripcion") BETWEEN 1 AND 300),
	CONSTRAINT "incidentes_resuelto" CHECK (("incidentes"."resuelto_en" IS NULL) = ("incidentes"."resuelto_por" IS NULL) AND ("incidentes"."resuelto_en" IS NULL) = ("incidentes"."accion" IS NULL)),
	CONSTRAINT "incidentes_version" CHECK ("incidentes"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "jornadas" ADD COLUMN "version_operacion" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paradas" ADD COLUMN "motivo_no_atendida" text;--> statement-breakpoint
ALTER TABLE "paradas" ADD COLUMN "cierre_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "planes" ADD COLUMN "tipo" "tipo_plan" DEFAULT 'inicial' NOT NULL;--> statement-breakpoint
ALTER TABLE "planes" ADD COLUMN "plan_base_id" uuid;--> statement-breakpoint
ALTER TABLE "planes" ADD COLUMN "restricciones" jsonb;--> statement-breakpoint
ALTER TABLE "eventos_operador" ADD CONSTRAINT "eventos_operador_jornada_id_jornadas_id_fk" FOREIGN KEY ("jornada_id") REFERENCES "public"."jornadas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_operador" ADD CONSTRAINT "eventos_operador_ruta_id_rutas_id_fk" FOREIGN KEY ("ruta_id") REFERENCES "public"."rutas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_operador" ADD CONSTRAINT "eventos_operador_parada_id_paradas_id_fk" FOREIGN KEY ("parada_id") REFERENCES "public"."paradas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_operador" ADD CONSTRAINT "eventos_operador_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_operador" ADD CONSTRAINT "eventos_operador_conciliado_por_usuarios_id_fk" FOREIGN KEY ("conciliado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidentes" ADD CONSTRAINT "incidentes_jornada_id_jornadas_id_fk" FOREIGN KEY ("jornada_id") REFERENCES "public"."jornadas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidentes" ADD CONSTRAINT "incidentes_parada_id_paradas_id_fk" FOREIGN KEY ("parada_id") REFERENCES "public"."paradas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidentes" ADD CONSTRAINT "incidentes_reportado_por_usuarios_id_fk" FOREIGN KEY ("reportado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidentes" ADD CONSTRAINT "incidentes_resuelto_por_usuarios_id_fk" FOREIGN KEY ("resuelto_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eventos_operador_jornada_idx" ON "eventos_operador" USING btree ("jornada_id","ocurrido_en");--> statement-breakpoint
CREATE INDEX "incidentes_jornada_idx" ON "incidentes" USING btree ("jornada_id");--> statement-breakpoint
ALTER TABLE "planes" ADD CONSTRAINT "planes_plan_base_id_planes_id_fk" FOREIGN KEY ("plan_base_id") REFERENCES "public"."planes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paradas" ADD CONSTRAINT "paradas_no_atendida" CHECK (("paradas"."estado" = 'no_atendida') = ("paradas"."motivo_no_atendida" IS NOT NULL) AND ("paradas"."motivo_no_atendida" IS NULL OR length("paradas"."motivo_no_atendida") <= 200));--> statement-breakpoint
ALTER TABLE "planes" ADD CONSTRAINT "planes_re_ruteo" CHECK (("planes"."tipo" = 're_ruteo') = ("planes"."plan_base_id" IS NOT NULL AND "planes"."restricciones" IS NOT NULL));