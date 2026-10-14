CREATE TYPE "public"."accion_privacidad" AS ENUM('aceptado', 'retirado');--> statement-breakpoint
CREATE TYPE "public"."estado_documento" AS ENUM('vigente', 'pendiente', 'vencido');--> statement-breakpoint
CREATE TYPE "public"."medio_privacidad" AS ENUM('papel', 'correo', 'verbal', 'otro');--> statement-breakpoint
CREATE TYPE "public"."rol" AS ENUM('admin', 'despachador', 'operador', 'gerencia');--> statement-breakpoint
CREATE TYPE "public"."tipo_residuo" AS ENUM('RSU', 'RME', 'RP');--> statement-breakpoint
CREATE TYPE "public"."tipo_unidad" AS ENUM('doble_rodada', 'rabon', 'camioneta');--> statement-breakpoint
CREATE TABLE "aceptaciones_privacidad" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secuencia" bigint GENERATED ALWAYS AS IDENTITY (sequence name "aceptaciones_privacidad_secuencia_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"cliente_id" uuid NOT NULL,
	"version_aviso" text NOT NULL,
	"accion" "accion_privacidad" NOT NULL,
	"medio" "medio_privacidad" NOT NULL,
	"registrado_por" uuid,
	"en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aceptaciones_privacidad_secuencia_unique" UNIQUE("secuencia")
);
--> statement-breakpoint
CREATE TABLE "avisos_privacidad" (
	"version" text PRIMARY KEY NOT NULL,
	"descripcion" text NOT NULL,
	"huella_sha256" text,
	"publicado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bitacora" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"en" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" uuid,
	"entidad" text NOT NULL,
	"entidad_id" uuid,
	"accion" text NOT NULL,
	"campos" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"contacto_nombre" text,
	"contacto_telefono" text,
	"direccion" text,
	"lat" double precision,
	"lng" double precision,
	"tipo_residuo" "tipo_residuo",
	"material" text,
	"tipos_unidad_admitidos" "tipo_unidad"[] DEFAULT '{}'::tipo_unidad[] NOT NULL,
	"notas_acceso" text,
	"tiempo_servicio_min" integer DEFAULT 66 NOT NULL,
	"carga_estimada_kg" integer,
	"activo" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clientes_ubicacion_completa" CHECK (("clientes"."lat" IS NULL) = ("clientes"."lng" IS NULL)),
	CONSTRAINT "clientes_tiempo_servicio" CHECK ("clientes"."tiempo_servicio_min" BETWEEN 5 AND 480),
	CONSTRAINT "clientes_carga" CHECK ("clientes"."carga_estimada_kg" IS NULL OR "clientes"."carga_estimada_kg" BETWEEN 0 AND 40000),
	CONSTRAINT "clientes_version" CHECK ("clientes"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "configuracion" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"patio_lat" double precision,
	"patio_lng" double precision,
	"turno_inicio" time DEFAULT '08:00' NOT NULL,
	"turno_fin" time DEFAULT '16:00' NOT NULL,
	"velocidad_kmh" double precision DEFAULT 30 NOT NULL,
	"factor_circuidad" double precision DEFAULT 1.4 NOT NULL,
	"descarga_min" integer DEFAULT 20 NOT NULL,
	"version_aviso_privacidad" text DEFAULT '2026-10' NOT NULL,
	"linea_base" jsonb DEFAULT '{"esperaMin":15,"trasladoMin":45,"cicloMin":161}'::jsonb NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configuracion_fila_unica" CHECK ("configuracion"."id" = 1),
	CONSTRAINT "configuracion_turno" CHECK ("configuracion"."turno_inicio" < "configuracion"."turno_fin"),
	CONSTRAINT "configuracion_velocidad" CHECK ("configuracion"."velocidad_kmh" > 0),
	CONSTRAINT "configuracion_circuidad" CHECK ("configuracion"."factor_circuidad" >= 1),
	CONSTRAINT "configuracion_descarga" CHECK ("configuracion"."descarga_min" >= 0)
);
--> statement-breakpoint
CREATE TABLE "documentos_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"obligatorio" boolean DEFAULT true NOT NULL,
	"estado" "estado_documento" DEFAULT 'pendiente' NOT NULL,
	"vence_el" date,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "importaciones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usuario_id" uuid,
	"huella" text NOT NULL,
	"importados" integer NOT NULL,
	"en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"nombre" text NOT NULL,
	"rol" "rol" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "ventanas_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"dia_semana" smallint NOT NULL,
	"hora_inicio" time NOT NULL,
	"hora_fin" time NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ventanas_dia_semana" CHECK ("ventanas_cliente"."dia_semana" BETWEEN 0 AND 6),
	CONSTRAINT "ventanas_orden" CHECK ("ventanas_cliente"."hora_inicio" < "ventanas_cliente"."hora_fin")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aceptaciones_privacidad" ADD CONSTRAINT "aceptaciones_privacidad_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aceptaciones_privacidad" ADD CONSTRAINT "aceptaciones_privacidad_version_aviso_avisos_privacidad_version_fk" FOREIGN KEY ("version_aviso") REFERENCES "public"."avisos_privacidad"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aceptaciones_privacidad" ADD CONSTRAINT "aceptaciones_privacidad_registrado_por_usuarios_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bitacora" ADD CONSTRAINT "bitacora_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_version_aviso_privacidad_avisos_privacidad_version_fk" FOREIGN KEY ("version_aviso_privacidad") REFERENCES "public"."avisos_privacidad"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_cliente" ADD CONSTRAINT "documentos_cliente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importaciones" ADD CONSTRAINT "importaciones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventanas_cliente" ADD CONSTRAINT "ventanas_cliente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aceptaciones_privacidad_cliente_secuencia_idx" ON "aceptaciones_privacidad" USING btree ("cliente_id","secuencia");--> statement-breakpoint
CREATE INDEX "bitacora_entidad_idx" ON "bitacora" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "clientes_nombre_idx" ON "clientes" USING btree ("nombre");--> statement-breakpoint
CREATE INDEX "documentos_cliente_cliente_idx" ON "documentos_cliente" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "ventanas_cliente_cliente_idx" ON "ventanas_cliente" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");