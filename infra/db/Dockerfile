# Plan de seguridad (2026-11-07): Postgres oficial con zlib 1.4 (CVE-2026-4738, crítica). La imagen oficial 17.11-alpine
# aún trae zlib 1.3.2 y Alpine 3.24 ya publica la corrección. La usan db y respaldo (pg_dump -Fc comprime con zlib).
# Cuando la oficial traiga zlib 1.4, compose.yaml vuelve a usarla directo y se borra este archivo.
FROM postgres:17.11-alpine
# checkov:skip=CKV_DOCKER_2: la salud de db la revisa Compose con pg_isready (healthcheck en compose.yaml).
# checkov:skip=CKV_DOCKER_3: igual que la imagen oficial: el entrypoint arranca como root solo para ajustar permisos del
# volumen y baja al usuario postgres con su-exec antes de iniciar el servidor.
# Versión fija: si Alpine la reemplaza por una revisión nueva, la construcción falla con un mensaje claro y se sube aquí.
RUN apk add --no-cache zlib=1.4-r0
