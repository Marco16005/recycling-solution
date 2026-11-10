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

echo "== 1/8 Tipos, lint y pruebas de unidad"
compose unidad run --rm --build unit

echo "== 2/8 Integración con Postgres"
compose integracion run --rm --build integration

echo "== 3/8 Punta a punta contra la imagen de producción"
compose e2e run --rm --build e2e

echo "== 4/8 Respaldo y restauración (con la aplicación encendida, con conexión abierta y con respaldo dañado)"
scripts/probar-restauracion.sh

echo "== 5/8 Búsqueda de secretos en el historial (gitleaks; no detecta datos personales)"
# Se escanea el repositorio principal con todas sus ramas: desde un worktree, .git es un archivo que apunta fuera del montaje.
PRINCIPAL=$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")
docker run --rm -v "$PRINCIPAL:/repo:ro" zricethezav/gitleaks:v8.30.1 detect --source /repo --log-opts=--all --no-banner --redact

echo "== 6/8 Seguridad rápida: dependencias de producción e imagen de la aplicación (scripts/seguridad.sh --rapido)"
# El escaneo completo (código, Dockerfiles, Caddy, Postgres, mapa y ZAP) es scripts/seguridad.sh, antes de cada despliegue.
scripts/seguridad.sh --rapido

echo "== 7/8 Configuración de Caddy y de Compose (vecinos, feruga, errores con HSTS y contenedores sin privilegios)"
scripts/probar-caddy.sh

echo "== 8/8 Producción en esta máquina: Caddy, contenedores sin privilegios y errores con HSTS"
scripts/probar-produccion.sh

echo "Verificación completa: todo en verde."
