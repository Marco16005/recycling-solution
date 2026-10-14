-- Permisos del rol de la aplicación. Idempotente: lo ejecuta scripts/migrar.mts como rs_migrador
-- después de cada migración y de cada restauración (especificación §10).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO rs_app;

-- Se parte de cero en cada ejecución para que un permiso viejo no sobreviva.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rs_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM rs_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rs_app;

-- Historial de solo inserción.
REVOKE UPDATE, DELETE ON bitacora, aceptaciones_privacidad, importaciones FROM rs_app;

-- Catálogos que en el Plan 1 la aplicación solo lee.
REVOKE INSERT, UPDATE, DELETE ON configuracion, avisos_privacidad FROM rs_app;
