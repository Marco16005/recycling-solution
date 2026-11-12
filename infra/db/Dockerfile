# Plan de seguridad: Postgres oficial con paquetes de Alpine corregidos que la imagen oficial 17.11-alpine aún no trae.
# La usan db y respaldo (pg_dump -Fc comprime con zlib).
# - 2026-11-07: zlib 1.4 (CVE-2026-4738, crítica).
# - 2026-11-12: libxslt 1.1.43-r4 (CVE-2026-125350, alta y en la lista KEV: se explota activamente; CVE-2026-87636 y
#   CVE-2026-9947) y krb5-libs 1.22.3-r0 (nueve altas, entre ellas CVE-2026-112314 y CVE-2026-40355, y doce más).
# Cuando la oficial los traiga, compose.yaml vuelve a usarla directo y se borra este archivo.
FROM postgres:17.11-alpine
# checkov:skip=CKV_DOCKER_2: la salud de db la revisa Compose con pg_isready (healthcheck en compose.yaml).
# checkov:skip=CKV_DOCKER_3: igual que la imagen oficial: el entrypoint arranca como root solo para ajustar permisos del
# volumen y baja al usuario postgres con su-exec antes de iniciar el servidor.
# Versiones fijas: si Alpine las reemplaza por una revisión nueva, la construcción falla con un mensaje claro y se suben aquí.
RUN apk add --no-cache zlib=1.4-r0 libxslt=1.1.43-r4 krb5-libs=1.22.3-r0
