#!/bin/sh
# Restaura un respaldo de forma atómica: detiene lo que escribe, restaura en una sola transacción y, solo si todo
# salió bien, verifica migraciones, vuelve a aplicar permisos y arranca la aplicación. Si algo falla, la base queda
# como estaba y la aplicación detenida.
#
# Uso: scripts/restaurar.sh respaldos/recycling-AAAAMMDD-HHMMSS.dump
# Usa los archivos de Compose de COMPOSE_FILE (.env), o los que se pasen en COMPOSE_ARGS.
# Con RESTAURAR_SIN_ARRANCAR=1 no arranca la aplicación al final (lo usa la prueba).
set -eu
cd "$(dirname "$0")/.."

ARCHIVO=${1:?"Uso: scripts/restaurar.sh respaldos/ARCHIVO.dump"}
case "$ARCHIVO" in
  respaldos/*) ;;
  *) echo "El respaldo debe estar dentro de la carpeta respaldos/" >&2; exit 1 ;;
esac
[ -f "$ARCHIVO" ] || { echo "No existe $ARCHIVO" >&2; exit 1; }
NOMBRE=$(basename "$ARCHIVO")

compose() {
  # shellcheck disable=SC2086
  docker compose ${COMPOSE_ARGS:-} "$@"
}

echo "== Deteniendo lo que escribe en la base"
compose stop web app bootstrap >/dev/null 2>&1 || true
compose up -d --wait db

echo "== Restaurando $NOMBRE en una sola transacción"
compose --profile respaldo run --rm --entrypoint pg_restore respaldo \
  -h db -U rs_migrador -d recycling --clean --if-exists --no-owner \
  --single-transaction --exit-on-error "/respaldos/$NOMBRE"

echo "== Verificando migraciones y permisos"
compose run --rm migrate

if [ "${RESTAURAR_SIN_ARRANCAR:-}" = "1" ]; then
  echo "Restauración completa (sin arrancar la aplicación)."
  exit 0
fi

echo "== Arrancando la aplicación"
compose up -d

echo "Restauración completa."
