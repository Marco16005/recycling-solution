CREATE TABLE "instantaneas_k5" (
	"fecha" date PRIMARY KEY NOT NULL,
	"activos" integer NOT NULL,
	"completos" integer NOT NULL,
	"tomada_en" timestamp with time zone NOT NULL,
	CONSTRAINT "instantaneas_k5_conteos" CHECK ("instantaneas_k5"."activos" >= 0 AND "instantaneas_k5"."completos" BETWEEN 0 AND "instantaneas_k5"."activos")
);
