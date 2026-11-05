# Plan de seguridad (S4): Caddy es la única pieza expuesta a internet en el modo A (docs/operacion.md, §9).
# Se compila Caddy 2.11.8 con dos dependencias corregidas que su binario oficial aún no trae: golang.org/x/net 0.62.0
# (GO-2026-6860) y go-jose 4.1.6 (GHSA-mgcc-cww5-fp2q). xcaddy verifica las sumas de cada módulo con sum.golang.org.
# Cuando salga una versión de Caddy que ya las incluya, se quita la etapa de construcción.
FROM caddy:2.11.8-builder-alpine AS construir
RUN xcaddy build v2.11.8 \
    --replace golang.org/x/net=golang.org/x/net@v0.62.0 \
    --replace github.com/go-jose/go-jose/v4=github.com/go-jose/go-jose/v4@v4.1.6

# Sin curl (arrastraba libcurl y brotli, CVE-2026-111497) y sin privilegios: Docker deja usar los puertos 80 y 443 a
# cualquier usuario dentro del contenedor. Los volúmenes ya existentes los ajusta proxy-permisos (compose.prod.yaml).
FROM caddy:2.11.8-alpine
COPY --from=construir /usr/bin/caddy /usr/bin/caddy
# checkov:skip=CKV_DOCKER_2: la salud de proxy la observa Compose a través de web; Caddy no expone un punto de salud propio.
RUN apk del --no-cache curl \
 && addgroup -S -g 10001 caddy \
 && adduser -S -D -H -u 10001 -G caddy caddy \
 && chown -R caddy:caddy /data /config
USER caddy
