ALTER TABLE "configuracion" ADD COLUMN "factor_camion" double precision DEFAULT 1.2 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "horas_pico" jsonb DEFAULT '[{"inicio":"07:00","fin":"09:30","factor":1.3},{"inicio":"13:30","fin":"15:00","factor":1.15}]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "umbral_atraso_min" smallint DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "ejecuciones_motor" ADD COLUMN "consulta_mapa_ms" double precision;--> statement-breakpoint
ALTER TABLE "rutas" ADD COLUMN "tiempos" jsonb;--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_factor_camion" CHECK ("configuracion"."factor_camion" >= 1 AND "configuracion"."factor_camion" <= 3);--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_horas_pico" CHECK (jsonb_typeof("configuracion"."horas_pico") = 'array');--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_umbral_atraso" CHECK ("configuracion"."umbral_atraso_min" BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE "ejecuciones_motor" ADD CONSTRAINT "ejecuciones_motor_consulta_mapa" CHECK ("ejecuciones_motor"."consulta_mapa_ms" IS NULL OR "ejecuciones_motor"."consulta_mapa_ms" >= 0);