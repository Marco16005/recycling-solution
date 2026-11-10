# Plan de seguridad (S4): Caddy es la única pieza expuesta a internet en el modo A (docs/operacion.md, §9).
# Se compila Caddy 2.11.9 con dos dependencias corregidas que su binario oficial aún no trae: golang.org/x/net 0.62.0
# (GO-2026-6860) y klauspost/compress 1.20.2 (GO-2026-6865, alta; la usa encode zstd gzip). xcaddy verifica las sumas
# de cada módulo con sum.golang.org. Cuando salga una versión de Caddy que ya las incluya, se quita la etapa de
# construcción. Historial: go-jose 4.1.6 (GHSA-mgcc-cww5-fp2q) se reemplazaba aquí hasta 2.11.8; 2.11.9 ya la trae.
FROM caddy:2.11.9-builder-alpine AS construir
RUN xcaddy build v2.11.9 \
    --replace golang.org/x/net=golang.org/x/net@v0.62.0 \
    --replace github.com/klauspost/compress=github.com/klauspost/compress@v1.20.2

# Sin curl (arrastraba libcurl y brotli, CVE-2026-111497) y sin privilegios: Docker deja usar los puertos 80 y 443 a
# cualquier usuario dentro del contenedor. Los volúmenes ya existentes los ajusta proxy-permisos (compose.prod.yaml).
# zlib 1.4-r0 fija (CVE-2026-4738, crítica, 2026-11-07): la imagen base aún trae la 1.3.2 y Alpine 3.24 ya publica la
# corrección. Si Alpine la reemplaza por una revisión nueva, la construcción falla con un mensaje claro: subir la versión
# aquí, o quitar la línea cuando caddy:<versión>-alpine ya la traiga.
FROM caddy:2.11.9-alpine
COPY --from=construir /usr/bin/caddy /usr/bin/caddy
# checkov:skip=CKV_DOCKER_2: la salud de proxy la observa Compose a través de web; Caddy no expone un punto de salud propio.
# Sin la capacidad de archivo cap_net_bind_service que trae el binario: con cap_drop ALL (compose.prod.yaml) Linux no lo
# ejecutaría («operation not permitted»), y no hace falta, porque Docker deja usar 80 y 443 a cualquier usuario (2026-11-10).
RUN apk del --no-cache curl \
 && apk add --no-cache zlib=1.4-r0 \
 && setcap -r /usr/bin/caddy \
 && addgroup -S -g 10001 caddy \
 && adduser -S -D -H -u 10001 -G caddy caddy \
 && chown -R caddy:caddy /data /config
USER caddy
