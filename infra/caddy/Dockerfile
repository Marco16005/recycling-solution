# Plan de seguridad (S4): Caddy es la única pieza expuesta a internet en el modo A (docs/operacion.md, §9).
# 2.11.8 está compilado con Go 1.26.9 (corrige golang.org/x/net y la biblioteca estándar). Se quita curl, que Caddy
# no usa y que arrastraba libcurl y brotli con fallas corregibles (brotli: CVE-2026-111497, explotada activamente).
# Corre sin privilegios: Docker permite usar los puertos 80 y 443 dentro del contenedor a cualquier usuario
# (net.ipv4.ip_unprivileged_port_start=0). Los volúmenes nuevos de /data y /config heredan el dueño de la imagen.
FROM caddy:2.11.8-alpine
RUN apk del --no-cache curl \
 && addgroup -S -g 10001 caddy \
 && adduser -S -D -H -u 10001 -G caddy caddy \
 && chown -R caddy:caddy /data /config
USER caddy
