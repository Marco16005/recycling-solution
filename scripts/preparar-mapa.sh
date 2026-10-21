#!/bin/sh
# Prepara el mapa de calles (Plan 7) en el volumen mapa_datos, todo en contenedores. Idempotente: si el mapa con la misma
# fecha y caja ya está, no hace nada. Variables (en .env): MAPA_FECHA (AAMMDD de un extracto fechado de Geofabrik) y
# MAPA_CAJA (oeste,sur,este,norte). Después: docker compose up -d osrm (con el perfil mapa activo). Ver docs/operacion.md.
# Las opciones se pasan a docker compose: en un worktree, scripts/preparar-mapa.sh -p rs-<rama>, y el mismo -p al levantar osrm
# (también sirve COMPOSE_PROJECT_NAME en .env). Sin eso, el volumen sería el del proyecto que Compose deriva de la carpeta.
set -eu
cd "$(dirname "$0")/.."
docker compose "$@" --profile preparar-mapa run --rm --build mapa-preparar real
