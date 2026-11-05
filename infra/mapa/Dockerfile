# Imagen del mapa de calles (Plan 7): OSRM con versión fija, osmium para recortar el extracto y curl para descargarlo y
# para la prueba de salud. La misma imagen prepara el mapa (preparar-mapa) y lo sirve (osrm-routed).
# Plan de seguridad (S7): apt-get upgrade aplica los parches de seguridad de Debian 13 que la imagen base aún no trae
# (libc, perl, brotli, pcre2…). Cambia con cada construcción; scripts/seguridad.sh revisa el resultado con Grype.
# checkov:skip=CKV_DOCKER_2: la salud de osrm la revisa Compose (healthcheck en compose.yaml).
# checkov:skip=CKV_DOCKER_3: preparar-mapa escribe el volumen como root; el servicio osrm corre como nobody (compose.yaml).
FROM ghcr.io/project-osrm/osrm-backend:v26.9.0-debian
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends osmium-tool=1.18.0-1 curl=8.14.1-2+deb13u7 ca-certificates=20250419 \
 && rm -rf /var/lib/apt/lists/*
COPY preparar.sh /usr/local/bin/preparar-mapa
RUN chmod 0755 /usr/local/bin/preparar-mapa
