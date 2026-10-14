-- Primera versión del aviso de privacidad. El texto lo entrega la empresa (especificación §14, decisión 6);
-- cuando exista se registra como una versión nueva con su huella SHA-256.
INSERT INTO "avisos_privacidad" ("version", "descripcion")
VALUES ('2026-10', 'Versión inicial del piloto; texto pendiente de la empresa')
ON CONFLICT ("version") DO NOTHING;
--> statement-breakpoint
-- Fila única de configuración con los valores de la especificación §6.
INSERT INTO "configuracion" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
