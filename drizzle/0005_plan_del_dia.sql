CREATE TYPE "public"."estado_parada" AS ENUM('pendiente', 'en_sitio', 'completada', 'omitida', 'no_atendida');--> statement-breakpoint
CREATE TYPE "public"."estado_plan" AS ENUM('propuesto', 'validado', 'descartado');--> statement-breakpoint
CREATE TYPE "public"."resultado_motor" AS ENUM('ok', 'error', 'tiempo_agotado');--> statement-breakpoint
ALTER TYPE "public"."estado_solicitud" ADD VALUE 'programada';--> statement-breakpoint
ALTER TYPE "public"."estado_solicitud" ADD VALUE 'en_ruta';--> statement-breakpoint
CREATE TABLE "ejecuciones_motor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" date NOT NULL,
	"inicio_en" timestamp with time zone NOT NULL,
	"fin_en" timestamp with time zone NOT NULL,
	"duracion_ms" double precision NOT NULL,
	"resultado" "resultado_motor" NOT NULL,
	"error" text,
	"plan_id" uuid,
	"version_motor" text NOT NULL,
	"usuario_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ejecuciones_motor_duracion" CHECK ("ejecuciones_motor"."duracion_ms" >= 0),
	CONSTRAINT "ejecuciones_motor_orden" CHECK ("ejecuciones_motor"."inicio_en" <= "ejecuciones_motor"."fin_en"),
	CONSTRAINT "ejecuciones_motor_plan" CHECK ("ejecuciones_motor"."resultado" = 'ok' OR "ejecuciones_motor"."plan_id" IS NULL),
	CONSTRAINT "ejecuciones_motor_error" CHECK ("ejecuciones_motor"."error" IS NULL OR length("ejecuciones_motor"."error") <= 200)
);
--> statement-breakpoint
CREATE TABLE "paradas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruta_id" uuid NOT NULL,
	"solicitud_id" uuid NOT NULL,
	"secuencia" integer NOT NULL,
	"ventana_inicio" time NOT NULL,
	"ventana_fin" time NOT NULL,
	"llegada_estimada" timestamp with time zone NOT NULL,
	"inicio_estimado" timestamp with time zone NOT NULL,
	"fin_estimado" timestamp with time zone NOT NULL,
	"espera_min" integer NOT NULL,
	"carga_kg" integer NOT NULL,
	"km_desde_anterior" double precision NOT NULL,
	"km_contrafactual" double precision NOT NULL,
	"vigente" boolean DEFAULT true NOT NULL,
	"estado" "estado_parada" DEFAULT 'pendiente' NOT NULL,
	"llegada_en" timestamp with time zone,
	"inicio_servicio_en" timestamp with time zone,
	"fin_servicio_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paradas_secuencia" UNIQUE("ruta_id","secuencia"),
	CONSTRAINT "paradas_secuencia_positiva" CHECK ("paradas"."secuencia" >= 1),
	CONSTRAINT "paradas_ventana" CHECK ("paradas"."ventana_inicio" <= "paradas"."ventana_fin"),
	CONSTRAINT "paradas_estimados" CHECK ("paradas"."llegada_estimada" <= "paradas"."inicio_estimado" AND "paradas"."inicio_estimado" <= "paradas"."fin_estimado"),
	CONSTRAINT "paradas_espera" CHECK ("paradas"."espera_min" >= 0),
	CONSTRAINT "paradas_carga" CHECK ("paradas"."carga_kg" >= 0),
	CONSTRAINT "paradas_km" CHECK ("paradas"."km_desde_anterior" >= 0 AND "paradas"."km_contrafactual" >= 0)
);
--> statement-breakpoint
CREATE TABLE "planes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fecha" date NOT NULL,
	"estado" "estado_plan" DEFAULT 'propuesto' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generado_en" timestamp with time zone NOT NULL,
	"generado_por" uuid NOT NULL,
	"revision_iniciada_en" timestamp with time zone,
	"validado_en" timestamp with time zone,
	"validado_por" uuid,
	"descartado_en" timestamp with time zone,
	"requisitos_confirmados_en" timestamp with time zone,
	"semilla" integer NOT NULL,
	"version_motor" text NOT NULL,
	"entrada" jsonb NOT NULL,
	"versiones" jsonb NOT NULL,
	"resultado" jsonb NOT NULL,
	"ajustes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planes_version" CHECK ("planes"."version" >= 1),
	CONSTRAINT "planes_validado" CHECK (("planes"."estado" = 'validado') = ("planes"."validado_en" IS NOT NULL)),
	CONSTRAINT "planes_validado_completo" CHECK ("planes"."estado" <> 'validado' OR ("planes"."validado_por" IS NOT NULL AND "planes"."revision_iniciada_en" IS NOT NULL AND "planes"."requisitos_confirmados_en" IS NOT NULL)),
	CONSTRAINT "planes_descartado" CHECK (("planes"."estado" = 'descartado') = ("planes"."descartado_en" IS NOT NULL)),
	CONSTRAINT "planes_ajustes" CHECK (jsonb_typeof("planes"."ajustes") = 'array')
);
--> statement-breakpoint
CREATE TABLE "rutas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"jornada_id" uuid NOT NULL,
	"numero_viaje" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"salida_estimada" timestamp with time zone NOT NULL,
	"regreso_estimado" timestamp with time zone NOT NULL,
	"fin_descarga_estimado" timestamp with time zone NOT NULL,
	"carga_kg" integer NOT NULL,
	"km_estimados" double precision NOT NULL,
	"km_contrafactual" double precision NOT NULL,
	"rendimiento_km_l_usado" double precision NOT NULL,
	"disponible_para_salir_en" timestamp with time zone NOT NULL,
	"asignada_en" timestamp with time zone NOT NULL,
	"salida_patio_en" timestamp with time zone,
	"regreso_patio_en" timestamp with time zone,
	"descarga_fin_en" timestamp with time zone,
	"odometro_inicio_km" double precision,
	"odometro_fin_km" double precision,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rutas_viaje" UNIQUE("plan_id","jornada_id","numero_viaje"),
	CONSTRAINT "rutas_version" CHECK ("rutas"."version" >= 1),
	CONSTRAINT "rutas_numero" CHECK ("rutas"."numero_viaje" >= 1),
	CONSTRAINT "rutas_carga" CHECK ("rutas"."carga_kg" >= 0),
	CONSTRAINT "rutas_km" CHECK ("rutas"."km_estimados" >= 0 AND "rutas"."km_contrafactual" >= 0),
	CONSTRAINT "rutas_rendimiento" CHECK ("rutas"."rendimiento_km_l_usado" > 0),
	CONSTRAINT "rutas_horas" CHECK ("rutas"."salida_estimada" <= "rutas"."regreso_estimado" AND "rutas"."regreso_estimado" <= "rutas"."fin_descarga_estimado"),
	CONSTRAINT "rutas_odometro" CHECK ("rutas"."odometro_inicio_km" IS NULL OR "rutas"."odometro_fin_km" IS NULL OR "rutas"."odometro_inicio_km" <= "rutas"."odometro_fin_km")
);
--> statement-breakpoint
ALTER TABLE "ejecuciones_motor" ADD CONSTRAINT "ejecuciones_motor_plan_id_planes_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."planes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ejecuciones_motor" ADD CONSTRAINT "ejecuciones_motor_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paradas" ADD CONSTRAINT "paradas_ruta_id_rutas_id_fk" FOREIGN KEY ("ruta_id") REFERENCES "public"."rutas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paradas" ADD CONSTRAINT "paradas_solicitud_id_solicitudes_id_fk" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planes" ADD CONSTRAINT "planes_generado_por_usuarios_id_fk" FOREIGN KEY ("generado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planes" ADD CONSTRAINT "planes_validado_por_usuarios_id_fk" FOREIGN KEY ("validado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_plan_id_planes_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."planes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_jornada_id_jornadas_id_fk" FOREIGN KEY ("jornada_id") REFERENCES "public"."jornadas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ejecuciones_motor_fecha_idx" ON "ejecuciones_motor" USING btree ("fecha","inicio_en");--> statement-breakpoint
CREATE UNIQUE INDEX "paradas_solicitud_vigente" ON "paradas" USING btree ("solicitud_id") WHERE "paradas"."vigente";--> statement-breakpoint
CREATE INDEX "paradas_solicitud_idx" ON "paradas" USING btree ("solicitud_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planes_un_validado_por_fecha" ON "planes" USING btree ("fecha") WHERE "planes"."estado" = 'validado';--> statement-breakpoint
CREATE UNIQUE INDEX "planes_un_propuesto_por_fecha" ON "planes" USING btree ("fecha") WHERE "planes"."estado" = 'propuesto';--> statement-breakpoint
CREATE INDEX "rutas_jornada_idx" ON "rutas" USING btree ("jornada_id");