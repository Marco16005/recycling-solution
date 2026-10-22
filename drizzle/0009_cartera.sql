CREATE TYPE "public"."estado_propuesta" AS ENUM('confirmada', 'descartada', 'pospuesta');--> statement-breakpoint
CREATE TYPE "public"."tipo_nota_cliente" AS ENUM('llamada', 'queja', 'acuerdo', 'otro');--> statement-breakpoint
ALTER TYPE "public"."canal_solicitud" ADD VALUE 'propuesta';--> statement-breakpoint
CREATE TABLE "notas_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tipo" "tipo_nota_cliente" NOT NULL,
	"texto" text NOT NULL,
	"autor" uuid NOT NULL,
	"en" timestamp with time zone NOT NULL,
	"corrige_a" uuid,
	CONSTRAINT "notas_cliente_texto" CHECK (length("notas_cliente"."texto") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "propuestas_recoleccion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"estado" "estado_propuesta" NOT NULL,
	"pospuesta_hasta" date,
	"solicitud_id" uuid,
	"nota" text,
	"decidida_por" uuid NOT NULL,
	"decidida_en" timestamp with time zone NOT NULL,
	CONSTRAINT "propuestas_recoleccion_pospuesta" CHECK (("propuestas_recoleccion"."estado" = 'pospuesta') = ("propuestas_recoleccion"."pospuesta_hasta" IS NOT NULL)),
	CONSTRAINT "propuestas_recoleccion_confirmada" CHECK (("propuestas_recoleccion"."estado" = 'confirmada') = ("propuestas_recoleccion"."solicitud_id" IS NOT NULL)),
	CONSTRAINT "propuestas_recoleccion_nota" CHECK ("propuestas_recoleccion"."nota" IS NULL OR length("propuestas_recoleccion"."nota") <= 300)
);
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "contacto_correo" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "contacto_puesto" text;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "contactos_adicionales" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "recurrencia" jsonb;--> statement-breakpoint
ALTER TABLE "notas_cliente" ADD CONSTRAINT "notas_cliente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas_cliente" ADD CONSTRAINT "notas_cliente_autor_usuarios_id_fk" FOREIGN KEY ("autor") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas_cliente" ADD CONSTRAINT "notas_cliente_corrige_a_notas_cliente_id_fk" FOREIGN KEY ("corrige_a") REFERENCES "public"."notas_cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propuestas_recoleccion" ADD CONSTRAINT "propuestas_recoleccion_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propuestas_recoleccion" ADD CONSTRAINT "propuestas_recoleccion_solicitud_id_solicitudes_id_fk" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propuestas_recoleccion" ADD CONSTRAINT "propuestas_recoleccion_decidida_por_usuarios_id_fk" FOREIGN KEY ("decidida_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notas_cliente_cliente_idx" ON "notas_cliente" USING btree ("cliente_id","en");--> statement-breakpoint
CREATE UNIQUE INDEX "propuestas_recoleccion_cliente_fecha" ON "propuestas_recoleccion" USING btree ("cliente_id","fecha");--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_contactos_adicionales" CHECK (jsonb_typeof("clientes"."contactos_adicionales") = 'array' AND jsonb_array_length("clientes"."contactos_adicionales") <= 10);