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

-- Configuración: el administrador la edita (fila única: sin altas ni bajas).
REVOKE INSERT, DELETE ON configuracion FROM rs_app;

-- Catálogos que la aplicación solo lee. Las versiones del aviso las publica scripts/publicar-aviso.mts como rs_migrador.
REVOKE INSERT, UPDATE, DELETE ON avisos_privacidad, tipos_documento FROM rs_app;

-- Las solicitudes se cancelan, nunca se borran; los folios tampoco.
REVOKE DELETE ON solicitudes, folios_dia FROM rs_app;

-- Plan 4: cada corrida del motor es historial de solo inserción (K7); una propuesta se descarta y una parada se
-- retira con vigente = false, nunca se borran.
REVOKE UPDATE, DELETE ON ejecuciones_motor FROM rs_app;
REVOKE DELETE ON planes, rutas, paradas FROM rs_app;
