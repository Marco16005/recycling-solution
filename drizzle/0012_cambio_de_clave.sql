ALTER TABLE "usuarios" ADD COLUMN "debe_cambiar_clave" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Transición (diseño del 2026-11-07, §2.3): quien hoy tiene una contraseña que puso un administrador desde la aplicación
-- (su último evento de contraseña es crear o restablecer_clave, no …_por_script) debe cambiarla al entrar.
UPDATE "usuarios" AS u SET "debe_cambiar_clave" = true
WHERE (
  SELECT b."accion" FROM "bitacora" AS b
  WHERE b."entidad" = 'usuario' AND b."entidad_id" = u."id"
    AND b."accion" IN ('crear', 'crear_por_script', 'restablecer_clave', 'restablecer_clave_por_script')
  ORDER BY b."en" DESC, b."id" DESC
  LIMIT 1
) IN ('crear', 'restablecer_clave');
