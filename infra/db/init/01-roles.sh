#!/bin/sh
# Corre una sola vez, al crear el volumen de Postgres (docker-entrypoint-initdb.d), como superusuario.
# rs_migrador: dueño de la base y del esquema; lo usa el servicio migrate.
# rs_app: la aplicación; sus permisos los da infra/db/permisos.sql después de cada migración.
set -eu
: "${RS_MIGRADOR_PASSWORD:?Falta RS_MIGRADOR_PASSWORD}"
: "${RS_APP_PASSWORD:?Falta RS_APP_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v base="$POSTGRES_DB" -v clave_migrador="$RS_MIGRADOR_PASSWORD" -v clave_app="$RS_APP_PASSWORD" <<'SQL'
CREATE ROLE rs_migrador LOGIN PASSWORD :'clave_migrador';
CREATE ROLE rs_app LOGIN PASSWORD :'clave_app';
ALTER DATABASE :"base" OWNER TO rs_migrador;
ALTER SCHEMA public OWNER TO rs_migrador;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"base" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"base" TO rs_app;
SQL
