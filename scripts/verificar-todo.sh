#!/bin/sh
# Verificación completa del proyecto, toda en contenedores: solo necesita Docker.
# Cada etapa usa su propio proyecto de Compose y sus volúmenes se borran al terminar.
set -eu
cd "$(dirname "$0")/.."

SUFIJO=$(date +%s)
PROYECTOS=""

compose() {
  proyecto="rs-verif-$1-$SUFIJO"
  shift
  PROYECTOS="$PROYECTOS $proyecto"
  docker compose -p "$proyecto" -f compose.yaml -f compose.test.yaml "$@"
}

limpiar() {
  for proyecto in $PROYECTOS; do
    docker compose -p "$proyecto" -f compose.yaml -f compose.test.yaml down -v --remove-orphans >/dev/null 2>&1 || true
  done
}
trap limpiar EXIT

echo "== 1/5 Tipos, lint y pruebas de unidad"
compose unidad run --rm --build unit

echo "== 2/5 Integración con Postgres"
compose integracion run --rm --build integration

echo "== 3/5 Punta a punta contra la imagen de producción"
compose e2e run --rm --build e2e

echo "== 4/5 Respaldo y restauración (con la aplicación encendida, con conexión abierta y con respaldo dañado)"
scripts/probar-restauracion.sh

echo "== 5/5 Búsqueda de secretos en el historial (gitleaks; no detecta datos personales)"
docker run --rm -v "$PWD:/repo:ro" zricethezav/gitleaks:v8.30.1 detect --source /repo --no-banner --redact

echo "Verificación completa: todo en verde."
