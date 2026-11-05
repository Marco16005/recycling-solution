# Plan de seguridad (S4): Caddy es la única pieza expuesta a internet en el modo A (docs/operacion.md, §9).
# 2.11.8 está compilado con Go 1.26.9 (corrige golang.org/x/net y la biblioteca estándar). Se quita curl, que Caddy
# no usa y que arrastraba libcurl y brotli con fallas corregibles (brotli: CVE-2026-111497, explotada activamente).
FROM caddy:2.11.8-alpine
RUN apk del --no-cache curl
