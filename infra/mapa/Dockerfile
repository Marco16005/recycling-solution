# Imagen del mapa de calles (Plan 7): OSRM con versión fija, osmium para recortar el extracto y curl para descargarlo y
# para la prueba de salud. La misma imagen prepara el mapa (preparar-mapa) y lo sirve (osrm-routed).
FROM ghcr.io/project-osrm/osrm-backend:v26.9.0-debian
RUN apt-get update \
 && apt-get install -y --no-install-recommends osmium-tool=1.18.0-1 curl=8.14.1-2+deb13u7 ca-certificates=20250419 \
 && rm -rf /var/lib/apt/lists/*
COPY preparar.sh /usr/local/bin/preparar-mapa
RUN chmod 0755 /usr/local/bin/preparar-mapa
