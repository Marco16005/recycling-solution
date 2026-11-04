# Plan de seguridad — diseño

- **Fecha:** 2026-11-04, revisión 1 (borrador de Claude para revisión de Codex).
- **Base:** `main` en b806c49 (Planes 1 a 8 y CRM validados).
- **Pedido del usuario (2026-11-04):** escanear el sistema con herramientas de seguridad (gitleaks, Semgrep, OSV, OWASP, Checkov, ZAP, nmap, Trivy, Grype, Burp, SonarQube…) para dejarlo más seguro antes del piloto, en colaboración con Codex.

## 1. Objetivo y alcance

1. Corregir antes del piloto todo lo que una persona en internet podría explotar en el servidor.
2. Dejar los escaneos automáticos en un script reproducible, en contenedores y con versiones fijas por digest, para repetirlos antes de cada despliegue.
3. Complementar las herramientas con una auditoría manual del código (Codex), porque los escáneres no ven fallas de autorización ni de lógica.

Fuera de alcance: pruebas contra el VPS hasta que esté desplegado y el dueño lo autorice por escrito (§7), y certificaciones formales.

## 2. Línea base del 2026-11-04

Todo corrió en contenedores contra una copia limpia de b806c49 (`git archive`) y contra la imagen de producción (`target: runner`) levantada con `compose.prod.yaml`, sin Caddy.

| Herramienta (imagen fijada) | Qué revisa | Resultado |
|---|---|---|
| gitleaks v8.30.1 | Secretos en los 130 commits | Sin fugas |
| npm audit (Node 24.21.0) | Dependencias del lockfile | 32 avisos; en producción, 1 crítico, 6 altos, 9 moderados y 1 bajo |
| OSV-Scanner v2.7.0 | Dependencias contra osv.dev | Coincide con npm audit (undici, qs, systeminformation, zod de shadcn) |
| Semgrep 1.183.0 (`p/default`, `p/typescript`, `p/react`, `p/nextjs`, `p/owasp-top-ten`, `p/secrets`, `p/dockerfile`, `p/docker-compose`) | Código | 1 hallazgo: la etapa `dev` del Dockerfile corre como root. 14 archivos con sintaxis que Semgrep no entiende (`import { type … }`) quedan escaneados a medias |
| Trivy 0.76.1 (`config` e `image`) | Dockerfiles e imagen de producción | Imagen: 6 críticos y 47 altos (Debian 12, Next y el npm que trae la imagen base). Config: OSRM corre como root; sin `HEALTHCHECK` |
| Grype v0.121.1 | Imagen de producción e imágenes de terceros | Node 24.21.0 con CVE-2026-111497 (**KEV**, explotada activamente; brotli). Caddy 2.11.6 con 18 críticos corregibles. OSRM v26.9.0 con 11 críticos corregibles. Postgres 17.11-alpine limpio |
| Checkov 3.4.3 | Dockerfiles y secretos | 122 aprobados. Falla: sin `HEALTHCHECK`, OSRM sin usuario, y "credenciales" en `compose.test.yaml` (son de prueba, ver §5) |
| Hadolint v2.15.1 | Dockerfiles | Solo información (DL3066) |
| ZAP 2.17.0 baseline | Aplicación en marcha, sin sesión | 0 fallas y 8 avisos: faltan CSP, anti-clickjacking, `X-Content-Type-Options` y `Permissions-Policy`; `X-Powered-By` revela Next.js |

Trivy se fijó en 0.76.1 por su digest. Las versiones 0.69.4 a 0.69.6 fueron publicadas por atacantes en marzo de 2026 (CVE-2026-33634), y por eso todas las imágenes de herramientas se fijan por digest y no solo por etiqueta.

## 3. Hallazgos y prioridad

Gravedad con la escala de `docs/guia-de-auditoria.md`.

| # | Hallazgo | Gravedad | Corrección | Responsable |
|---|---|---|---|---|
| S1 | Next 16.4.0: ejecución remota de código sin sesión en la optimización de imágenes SVG (GHSA-2464-fhr4-w9xw) y en funciones `use cache` que devuelven arreglos tipados (GHSA-673q-mjm6-r5xr, y el proyecto usa Cache Components); denegación de servicio con server actions (GHSA-p3m5-59mp-jv5r) | Bloquea el piloto | `next` y `eslint-config-next` a 16.4.5 | Claude (`package*.json`) |
| S2 | Node 24.21.0: CVE-2026-111497 (KEV) y tres altas más | Bloquea el piloto | Imágenes `deps` y `runner` a `node:24.22.2`. Evaluar `trixie-slim` (0 críticos) contra `bookworm-slim` (2 críticos sin corrección): se elige la que pase `verificar-todo` con menos críticos | Claude (Dockerfile) |
| S3 | La imagen `runner` trae npm con brace-expansion, tar, undici 6 e ip-address vulnerables, y npm no se usa en producción (`CMD ["node", "server.js"]`) | Corrige antes del piloto | Borrar npm y corepack de la etapa `runner` | Claude |
| S4 | Caddy 2.11.6 (la única pieza expuesta a internet en el modo A): brotli (KEV), curl y `golang.org/x/net` | Corrige antes del piloto | Subir a la versión más reciente de Caddy y, si sigue con paquetes corregibles, una imagen propia `FROM caddy:… ` con `apk upgrade --no-cache` | Claude (`infra/caddy`) |
| S5 | Encabezados: sin CSP, `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` ni `Permissions-Policy`, y con `X-Powered-By`. Sin HSTS en Caddy | Corrige antes del piloto | `headers()` y `poweredByHeader: false` en `next.config.ts`, para que valgan también detrás del proxy del punto de venta (modo B). CSP compatible con MapLibre (`worker-src blob:` y teselas de OpenFreeMap) y el service worker del operador. `Permissions-Policy` con `geolocation=(self)`. HSTS solo con https | Claude (`next.config.ts`, Caddyfile); Codex revisa que no rompa mapa ni `/operador` |
| S6 | Dependencias transitivas: undici 7.30.0, qs, fast-uri, body-parser, systeminformation y la zod de shadcn. Casi todas llegan por `shadcn`, que es una herramienta de desarrollo pero está en `dependencies` | Corrige antes del piloto | `shadcn` a 4.23.0 y a `devDependencies` (solo se usa su CSS al compilar); `npm audit fix` sin cambios mayores | Claude |
| S7 | OSRM corre como root y su imagen tiene 11 críticos corregibles. Solo escucha en la red interna | Mejora | `apt-get upgrade` en `infra/mapa/Dockerfile` y un usuario sin privilegios si `osrm-routed` lo permite con el volumen | Claude |
| S8 | Sin `HEALTHCHECK` en la imagen de la aplicación | Mejora | `healthcheck` del servicio `web` en Compose | Claude |
| S9 | Pistas de la auditoría de Codex, interrumpida por cuota: (a) la importación CSV puede construir cerca de dos millones de pares de posibles duplicados con un archivo permitido; (b) el límite de tiempo del motor se revisa hasta que termina el cálculo síncrono; (c) una función exportada de validación del re-ruteo depende de que quien la llama ya haya autorizado | Por clasificar | Codex confirma, clasifica y propone corrección en su auditoría completa (§6) | Codex (`src/dominio`, `src/motor`); Claude (`src/acciones`) |

## 4. Escaneo automático: `scripts/seguridad.sh`

- Corre todo en contenedores con las imágenes fijadas por digest en el propio script, sobre una copia limpia (`git archive HEAD`) y sobre la imagen `runner` construida.
- Pasos: gitleaks; `npm audit --omit=dev`; OSV-Scanner; Semgrep con los paquetes del §2 más las reglas propias de `.semgrep/`; Trivy `config`; Grype sobre las imágenes `web`, `db`, `proxy` y `osrm`; Checkov; Hadolint; y ZAP baseline contra la pila levantada con `-p rs-seguridad`.
- Falla con cualquier crítico o alto **que tenga corrección publicada** en las dependencias de producción o en las imágenes, y con cualquier falla de ZAP. Lo que no tiene corrección o no aplica va en `.grype.yaml` o `.trivyignore`, con motivo y fecha de revisión.
- Reportes en `reportes-seguridad/`, carpeta ignorada por git.
- `verificar-todo.sh` suma un paso 6 con la parte rápida (`npm audit` de producción y Grype de la imagen `runner`). El resto queda en `seguridad.sh`, que se corre antes de cada despliegue y una vez al mes.

### Reglas Semgrep propias

Codex propone de 3 a 6 reglas que hagan cumplir las invariantes de `AGENTS.md`, por ejemplo:
- una acción o consulta exportada que no autoriza con un permiso de `src/seguridad/permisos.ts`;
- `src/dominio` con `Date.now()`, `new Date()` sin argumentos o `Math.random()`;
- pantallas que importan `src/datos`.

Cada regla lleva una prueba con un caso que debe marcar y otro que no.

## 5. Falsos positivos aceptados

- Checkov `CKV_SECRET_4` y `CKV_SECRET_6` en `compose.test.yaml`: son contraseñas fijas de la base de pruebas, que se destruye con `down -v`. No se usan fuera de las pruebas.
- Semgrep `missing-user` en la etapa `dev` del Dockerfile: esa etapa solo corre en desarrollo y en pruebas. La de producción usa `USER node`.
- Avisos de ZAP que quedan después de S5 (2026-11-04: 0 fallas, 4 avisos, 64 aprobados):
  - `CSP: script-src unsafe-inline` (10055): Next escribe en línea los datos de React Server Components. Los nonces obligarían a renderizar cada página en cada petición y rompen Cache Components. La política sigue prohibiendo scripts de otros dominios, marcos y formularios hacia fuera (`src/seguridad/encabezados.ts`).
  - `Cross-Origin-Embedder-Policy` (90004): exigirlo bloquearía las teselas de OpenFreeMap, que no mandan `Cross-Origin-Resource-Policy`. La aplicación no usa `SharedArrayBuffer` ni necesita aislamiento entre orígenes.
  - `Non-Storable Content` (10049) y `Modern Web Application` (10109): son informativos. Que las páginas con datos personales no se guarden en caché es lo deseado.
- Avisos de dependencias de desarrollo sin uso en el servidor: el `esbuild` de `drizzle-kit` (su servidor de desarrollo no se usa) y `minimatch` en eslint. Se revisan cuando haya versión mayor compatible.

## 6. Auditoría manual (Codex)

Solo lectura, sobre b806c49:
- un modelo de amenazas breve;
- OWASP Top 10 2025 y ASVS 5.0 nivel 2 en lo que aplique: autenticación y sesiones, autorización por objeto, server actions, entradas y CSV, SSRF en la resolución de enlaces cortos, encabezados, el service worker del operador, fugas en errores y bitácora, límites de tasa, Docker, Compose y Caddy, roles de Postgres, y respaldos;
- las reglas Semgrep del §4.

Formato de `docs/guia-de-auditoria.md`, con el responsable y si está confirmado en el código. Se lanzó el 2026-11-04 y se cortó por cuota; se relanza completa en cuanto Codex tenga cuota.

## 7. Pruebas contra el VPS (después del despliegue)

El VPS es de Hostinger y lo comparte un punto de venta, así que solo se prueba con autorización escrita del dueño, fuera del horario de venta y a baja velocidad:
- `nmap -sV` a los puertos principales, para confirmar que solo responden 22, 80 y 443 y que Postgres y OSRM no se ven desde fuera;
- testssl.sh contra el nombre `sslip.io`;
- ZAP baseline contra la URL pública.

Antes se revisa la política de uso aceptable de Hostinger. El escaneo se limita a la IP propia del VPS.

## 8. SonarQube y Burp Suite

- **SonarQube Community 26.10** se corre una sola vez en local, con Docker y `sonar-scanner-cli` 12.3, como segunda opinión de calidad y de "security hotspots". Pide unos 4 GB de RAM, así que se levanta, se lee el reporte y se borra. No entra a `verificar-todo` porque Semgrep y las reglas propias cubren lo mismo de forma reproducible.
- **Burp Suite** no se usa: ZAP cubre el escaneo dinámico automatizado, y Burp Community es manual y gráfico. Si el usuario quiere practicar pruebas manuales para el Documento Integrador, se hace con ZAP o Burp sobre la pila local, nunca sobre el VPS.

## 9. Avance

- **P-S1 (4447420):** Next 16.4.5, Node 24.22.2 sobre Debian 13 (trixie), npm fuera de la imagen de producción y shadcn como herramienta de desarrollo. `verificar-todo` en verde (798 de unidad, 132 de integración, 39 de punta a punta, respaldo y gitleaks). Grype sobre la imagen nueva: 0 críticos, 0 altos con corrección y ninguna KEV (quedan 59 altos de Debian sin corrección publicada). `npm audit` de producción: solo 4 moderados de drizzle-kit.
- **P-S2:** encabezados (S5) en `next.config.ts` y `src/proxy.ts`, con 7 pruebas de unidad y 4 de punta a punta (`e2e/seguridad.spec.ts`), una de ellas con control positivo: una petición prohibida debe quedar registrada como violación. ZAP baseline: de 8 avisos a 4, todos aceptados en §5.
- **Caddy (S4), hallazgo del 2026-11-04:** quitar curl de la imagen 2.11.7 elimina brotli (KEV) y curl. Quedan Go 1.26.8, `golang.org/x/net` y go-jose dentro del binario de Caddy; se corrigen con una versión de Caddy compilada con Go 1.26.9. La 2.11.8 salió el 2026-11-04 solo para amd64; se adopta cuando exista para arm64 (desarrollo) o se compila con xcaddy.

## 10. Orden de trabajo

1. P-S1: S1, S2, S3 y S6 (dependencias e imagen base). `verificar-todo` en verde.
2. P-S2: S5 (encabezados). Prueba e2e que los comprueba; ZAP baseline sin avisos salvo los aceptados.
3. P-S3: auditoría completa de Codex y sus correcciones, repartidas por carpeta.
4. P-S4: `scripts/seguridad.sh`, reglas Semgrep, S4, S7 y S8, y una corrida de ZAP autenticada (despachador y operador) contra la pila local.
5. P-S5: SonarQube una vez; documentar los resultados en `docs/seguridad.md`.
6. Después del despliegue: §7.

## 11. Criterio de terminado

- Sin críticos ni altos con corrección publicada en las dependencias de producción ni en las imágenes `web`, `proxy` y `db`.
- ZAP baseline sin fallas, y solo con avisos aceptados por escrito.
- Los hallazgos de Codex clasificados como "bloquea el piloto" o "corrige antes del piloto" están cerrados.
- `verificar-todo.sh` en verde, con el paso 6.
- Claude y Codex validan el mismo commit. Merge `--no-ff` a `main` y etiqueta `plan-seguridad-validado`.
