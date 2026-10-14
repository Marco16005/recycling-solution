#!/bin/sh
# Prueba de respaldo y restauración en una base desechable (la llama scripts/verificar-todo.sh).
# 1) respaldo y restauración correctos recuperan los datos y los permisos, y detienen la aplicación encendida;
# 2) con una conexión abierta de la aplicación no se restaura nada;
# 3) un respaldo dañado falla sin modificar la base.
set -eu
cd "$(dirname "$0")/.."

PROYECTO="rs-verif-restauracion-$(date +%s)"
export COMPOSE_ARGS="-p $PROYECTO -f compose.yaml -f compose.test.yaml"
export PGPASSWORD=migrador_prueba RS_MIGRADOR_PASSWORD=migrador_prueba RESTAURAR_SIN_ARRANCAR=1
compose() {
  # shellcheck disable=SC2086
  docker compose $COMPOSE_ARGS "$@"
}
sql() { compose exec -T db psql -U rs_super -d recycling -tA -v ON_ERROR_STOP=1 -c "$1"; }
limpiar() { compose down -v --remove-orphans >/dev/null 2>&1 || true; rm -f respaldos/prueba-restauracion-*.dump; }
trap limpiar EXIT
mkdir -p respaldos

compose up -d --wait db >/dev/null
compose run --rm migrate >/dev/null
sql "SET ROLE rs_app; INSERT INTO clientes (nombre) VALUES ('Cliente de prueba de respaldo');" >/dev/null
compose --profile respaldo run --rm --entrypoint pg_dump respaldo \
  -h db -U rs_migrador -d recycling -Fc -f /respaldos/prueba-restauracion-bueno.dump >/dev/null

# Cambio posterior al respaldo: la restauración debe deshacerlo.
sql "SET ROLE rs_app; INSERT INTO clientes (nombre) VALUES ('Cliente posterior');" >/dev/null

echo "== Restauración correcta con la aplicación encendida"
compose up -d --wait web >/dev/null
scripts/restaurar.sh respaldos/prueba-restauracion-bueno.dump >/dev/null
if compose ps --services --status running | grep -qx web; then
  echo "La aplicación debía quedar detenida" >&2; exit 1
fi
[ "$(sql 'SELECT count(*) FROM clientes')" = "1" ] || { echo "Se esperaba 1 cliente tras restaurar" >&2; exit 1; }
if sql "SET ROLE rs_app; UPDATE bitacora SET accion = 'x';" >/dev/null 2>&1; then
  echo "rs_app no debe poder modificar la bitácora tras restaurar" >&2; exit 1
fi
echo "   aplicación detenida, datos recuperados y permisos reaplicados"

echo "== Conexión abierta de la aplicación"
compose exec -d db psql -U rs_app -d recycling -c "SELECT pg_sleep(60)"
sleep 1
sql "SET ROLE rs_app; INSERT INTO clientes (nombre) VALUES ('Cliente con conexión abierta');" >/dev/null
if scripts/restaurar.sh respaldos/prueba-restauracion-bueno.dump >/dev/null 2>&1; then
  echo "No debía restaurarse con una conexión abierta" >&2; exit 1
fi
[ "$(sql 'SELECT count(*) FROM clientes')" = "2" ] || { echo "La base cambió con una conexión abierta" >&2; exit 1; }
sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'rs_app'" >/dev/null
echo "   no se restauró y la base no cambió"

echo "== Respaldo dañado"
head -c 4000 respaldos/prueba-restauracion-bueno.dump > respaldos/prueba-restauracion-danado.dump
if scripts/restaurar.sh respaldos/prueba-restauracion-danado.dump >/dev/null 2>&1; then
  echo "Un respaldo dañado no debe restaurarse" >&2; exit 1
fi
[ "$(sql 'SELECT count(*) FROM clientes')" = "2" ] || { echo "La base cambió tras un respaldo dañado" >&2; exit 1; }
echo "   falló sin modificar la base"
echo "Prueba de restauración en verde."
