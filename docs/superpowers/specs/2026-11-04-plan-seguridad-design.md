# Plan de seguridad — diseño

- **Fecha:** 2026-11-04, revisión 2: incorpora la auditoría manual de Codex (§6) y su aprobación de P-S1 y P-S2.
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
| S9 | (Codex, hallazgo 1) La importación CSV construye un par por cada combinación de filas con el mismo nombre: 1.999.000 con 2000 filas iguales, que caben en 1 MB. Alcanzable por despachador o admin | Bloquea el piloto | Un aviso por fila y tipo: la primera fila anterior y el cliente de menor id (máximo 2 × n); la respuesta lista hasta 50 mensajes | Codex (`src/dominio/clientes/csv.ts`); Claude (`src/acciones/importacion.nucleo.ts`) |
| S10 | (Codex, hallazgo 2) El límite de 30 s no interrumpe el motor, que es síncrono y bloquea el proceso. Medido: 1000 solicitudes con 15 unidades tardan 58 s, y con 60 unidades, 13 min | Corrige antes del piloto | Tope de entrada antes de correrlo: 300 solicitudes y 40 unidades (~6 s, cinco veces un día del piloto), con prueba de tiempo en el tope | Claude (`src/acciones/plan-comun.ts`) |
| S11 | (Codex, hallazgo 3) `validarReruteo` es exportada y no autoriza; recibe `usuarioId` del llamador. Hoy no se explota: solo la llama `validarPlanDelDia`, que autoriza | Corrige antes del piloto | Autoriza `planes.validar` y toma el usuario de la sesión | Claude (`src/acciones/reruteo.nucleo.ts`) |
| S12 | (Codex, hallazgo 4) Si «Salir» falla por la red, se borran los datos del teléfono pero la pantalla se queda con la ruta y la sesión sigue abierta en el servidor | Corrige antes del piloto | Siempre lleva a `/entrar`; si el servidor no recibió el cierre, se anota y `/entrar` lo completa al cargar con red, con «Entrar» desactivado mientras tanto | Claude (`src/components/sesion`, `src/app/entrar`) |
| S13 | (Codex, hallazgo 5) Sin límite de frecuencia para acciones costosas autenticadas (generar plan o re-ruteo, importar, seguir enlaces) | Corrige antes del piloto | Límite en memoria por usuario: motor 4 por minuto, importar 20 y enlaces 30 (`src/seguridad/limites.ts`). Las pruebas lo apagan con `LIMITAR_ACCIONES=no` y lo prueban encendido | Claude |
| S14 | (Codex, hallazgo 6) Al seguir un enlace corto no se descarta el cuerpo de la respuesta | Mejora | Se cancela el cuerpo: solo importan el estado y `Location`. No se fija la IP resuelta: los hosts son nombres exactos de Google y un rebinding exigiría controlar su DNS | Claude (`src/acciones/enlaces.ts`) |

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

### Resultados del 2026-11-07 (feruga.tech, 45.90.223.219)

El dueño lo autorizó por escrito, ya desplegada la versión del 2026-11-07. Se corrió desde la computadora de desarrollo, en contenedores con imágenes fijas por digest, a baja velocidad y solo contra la IP del VPS. El servidor ya no lo comparte el punto de venta; está dedicado a la aplicación. No se encontró la política de uso aceptable de Hostinger sobre escanear el servidor propio desde fuera; las de otros proveedores prohíben escanear desde el VPS o sistemas ajenos, que no es el caso.

| Prueba | Resultado |
|---|---|
| nmap `-sT -sV`, 1000 puertos principales, 50 paquetes/s | Solo 22, 80 y 443 abiertos; los demás, filtrados. Postgres, OSRM y la aplicación no se ven desde fuera |
| nmap `ssh-auth-methods` y `ssh2-enum-algos` | SSH acepta solo `publickey`. Intercambio de llaves moderno (incluye `mlkem768x25519`) |
| testssl.sh 3.2 | **A+ (96)**. Solo TLS 1.2 y 1.3; certificado de Let's Encrypt válido y con cadena correcta. HSTS de un año en las páginas |
| ZAP baseline, sin sesión, 1 minuto | 1 aviso: HSTS faltaba en los archivos estáticos (`/_next/static`, `favicon.ico`), que no pasan por `src/proxy.ts` |

Atendido:

- **HSTS en los estáticos:** Caddy pone `Strict-Transport-Security` en toda respuesta que no lo traiga (`header ?…`), sin duplicar el de la aplicación. Probado con Caddy delante de un servidor de prueba. En el modo B lo tiene que poner el proxy del punto de venta. En la red local, las IP no quedan fijadas por HSTS, pero un nombre interno sí, durante un año. Si cambia la autoridad de Caddy, cada equipo debe instalar la nueva (`docs/operacion.md` §5). Ya pasaba con las páginas; ahora también con los estáticos.

- **BREACH (testssl, medio).** Primero se aceptó con dos premisas falsas: que la cookie `SameSite=Lax` no viaja desde otro sitio (sí viaja en una navegación GET de primer nivel) y que ninguna página refleja lo que se escribe (la cartera refleja el filtro `q` junto a datos de clientes). Lo señaló Codex. Ahora se mitiga:
  - Next ya no comprime (`compress: false`; antes mandaba `gzip` por su cuenta).
  - Caddy comprime solo los archivos estáticos (`@estaticos`), ninguna página. Codex señaló que Next 16 pone la dirección completa, con su query, en el HTML y en las respuestas RSC y de acciones. Así, `/operador?q=…` también reunía texto controlado con datos privados; por eso `/operador` tampoco se comprime. Lo pesado de su pantalla (JavaScript y fuentes) es estático: va comprimido y el teléfono lo guarda.
  - Probado con Caddy delante de un servidor de prueba: `zstd` solo en los estáticos.
  - En el modo B, el proxy del punto de venta hace lo mismo. Hay ejemplos completos para nginx y Caddy en `docs/operacion.md` §9.

Aceptado, con motivo:

- **`Server: Caddy` en la redirección de HTTP a HTTPS (puerto 80):** no dice la versión, y quitarlo exigiría un bloque `http://` propio que cambia cómo se atienden las IP y la red local.
- **Sin OCSP stapling:** Let's Encrypt dejó de ofrecer OCSP en 2025.

Para el dueño, fuera del repositorio:

- **Registro CAA en el DNS:** testssl lo marca como bajo. Limita qué autoridades pueden emitir certificados del dominio; ver `docs/pendientes.md`.
- **SSH, opcional:** todavía permite `hmac-sha1` y `umac-64`, como OpenSSH por omisión. Se pueden quitar en `sshd_config` (`MACs`).

Reportes en `reportes-seguridad/*-vps/` (no se versionan).

## 8. SonarQube y Burp Suite

- **SonarQube Community 26.10** se corre una sola vez en local, con Docker y `sonar-scanner-cli` 12.3, como segunda opinión de calidad y de "security hotspots". Pide unos 4 GB de RAM, así que se levanta, se lee el reporte y se borra. No entra a `verificar-todo` porque Semgrep y las reglas propias cubren lo mismo de forma reproducible.
- **Burp Suite** no se usa: ZAP cubre el escaneo dinámico automatizado, y Burp Community es manual y gráfico. Si el usuario quiere practicar pruebas manuales para el Documento Integrador, se hace con ZAP o Burp sobre la pila local, nunca sobre el VPS.

## 9. Avance

- **P-S1 (4447420):** Next 16.4.5, Node 24.22.2 sobre Debian 13 (trixie), npm fuera de la imagen de producción y shadcn como herramienta de desarrollo. `verificar-todo` en verde (798 de unidad, 132 de integración, 39 de punta a punta, respaldo y gitleaks). Grype sobre la imagen nueva: 0 críticos, 0 altos con corrección y ninguna KEV (quedan 59 altos de Debian sin corrección publicada). `npm audit` de producción: solo 4 moderados de drizzle-kit.
- **P-S2:** encabezados (S5) en `next.config.ts` y `src/proxy.ts`, con 7 pruebas de unidad y 4 de punta a punta (`e2e/seguridad.spec.ts`), una de ellas con control positivo: una petición prohibida debe quedar registrada como violación. ZAP baseline: de 8 avisos a 4, todos aceptados en §5.
- **Caddy (S4), hallazgo del 2026-11-04:** quitar curl de la imagen 2.11.7 elimina brotli (KEV) y curl. Quedan Go 1.26.8, `golang.org/x/net` y go-jose dentro del binario de Caddy; se corrigen con una versión de Caddy compilada con Go 1.26.9. La 2.11.8 salió el 2026-11-04 solo para amd64; se adopta cuando exista para arm64 (desarrollo) o se compila con xcaddy.

- **Hallazgo 1 (Codex, b7e1196 y 783135c):** un aviso por fila y tipo, con prueba de 2000 filas iguales y una propiedad. El ordenamiento radix que propuso Codex se cambió por `sort`; la reasignación fue por cuota, y Codex la revisa.
- **P-S3 (Claude):** S10 a S14, más S4 (Caddy 2.11.8 sin curl), S7 (OSRM sirve como `nobody`) y S8 (`healthcheck` de `web`). Caddy 2.11.8 sin curl: 0 críticos. Queda go-jose v4.1.5 (GHSA-mgcc-cww5-fp2q) dentro del binario, que solo se usa para el certificado ACME; es una excepción con fecha de revisión hasta que Caddy lo actualice.

- **P-S4 (368338a y siguiente):** `scripts/seguridad.sh` con excepciones documentadas en `infra/seguridad/`, y `verificar-todo.sh` con un paso 6 (`--rapido`). Primera corrida completa, el 2026-11-04: 11 de 12 pasos en verde, ZAP incluido. Trivy marcó que Caddy corría como root (DS-0002, alto): ahora corre como `caddy` (uid 10001), con `skip_install_trust`, y responde por HTTPS sin encabezado `Server`. Los respaldos de `/data` de Caddy en `operacion.md` corren con `--user root` y devuelven los archivos con `chown`. La imagen del mapa aplica los parches de Debian (`apt-get upgrade`) y Grype ya no encuentra críticos ni altos corregibles.

- **Revisión de Codex de P-S3 y P-S4 (2026-11-05):** aprobó el cambio a `sort` y pidió cinco cambios, ya aplicados:
  1. «Entrar» queda desactivado mientras el cierre siga pendiente, con un botón para reintentar y reintento automático al volver la red.
  2. `seguridad.sh` construye y levanta todo desde la misma copia del commit.
  3. ZAP también corre con sesión de despachador y de operador, y un OSV que no corre ya cuenta como falla.
  4. Las excepciones de Checkov viven dentro de cada Dockerfile.
  5. `proxy-permisos` deja `/data` y `/config` a nombre de Caddy en cada arranque; se probó con un volumen creado como root por Caddy 2.11.6.
- **Caddy compilado con xcaddy:** la noche del 2026-11-04 se publicó GO-2026-6860 (`golang.org/x/net` 0.60). Caddy se compila con x/net 0.62.0 y go-jose 4.1.6, y Grype ya no encuentra nada corregible; la excepción de go-jose se quitó.
- **Pruebas de unidad:** PGlite se colgaba al crear bases con la máquina cargada (2 de 4 corridas). Ahora cada archivo migra una vez y las pruebas cargan esa plantilla: la suite pasó de 132 s a unos 27 s, estable en tres corridas.

- **Segunda revisión de Codex (2026-11-05):** aprobó cuatro de los cinco cambios y encontró dos cosas:
  - La vista previa del CSV seguía devolviendo todos los avisos. Ahora devuelve hasta 50 más `totalPosiblesDuplicados`; la pantalla la ajustó Codex en 3b7838f.
  - ZAP «con sesión» no entraba, porque `ZAP_AUTH_HEADER_SITE` llevaba el puerto. Con `web` sí entra: `/despacho/clientes` y `/operador` responden 200, con 73 y 25 URLs. El script falla si la corrida con sesión no llega con 200.
- **SonarQube Community 26.10 (una vez, 2026-11-05):** 16 768 líneas; 2 vulnerabilidades, 5 bugs, 11 de mantenibilidad y 0 hotspots. Atendido:
  - `S2819`: el service worker rechaza mensajes de otro origen.
  - `S8786`: `sinBarrasFinales` reemplaza `/\/+$/` en `src/traslados`, con prueba en tiempo lineal.
  - Aceptado o falso positivo:
    - `S6471`: OSRM como root al preparar el mapa (§5).
    - `S2871`: los `sort()` ordenan textos (ids, fechas ISO, JSON); el orden por código es el correcto y `localeCompare` lo haría depender del idioma.
    - `S6853`: `Label` genérico, que recibe `htmlFor` de quien lo usa.
    - `S7773` y `S7767`: estilo (`Number.NaN`, `| 0` del generador con semilla).
  - Mientras SonarQube estuvo encendido (2.4 GB), siete pruebas de unidad agotaron su tiempo al crear la base. Se apagó, y la suite volvió a 815 de 815 en 26 s: por eso SonarQube no entra a `verificar-todo`.

### Vulnerabilidades publicadas después de la línea base (2026-11-07)

Las encontró `scripts/seguridad.sh` en el servidor, ya desplegado. Se corrigen sin excepciones:

| Imagen | Paquete | Gravedad | Corrección |
|---|---|---|---|
| Caddy | `klauspost/compress` 1.20.1 (GO-2026-6865), lo usa `encode zstd gzip` | Alta | Caddy 2.11.9 compilado con `--replace` a 1.20.2; también conserva `x/net` 0.62.0. go-jose 4.1.6 ya viene en 2.11.9 |
| Caddy | zlib 1.3.2 (CVE-2026-4738) | Crítica | zlib 1.4-r0 (versión fija) en la imagen final |
| Postgres | zlib 1.3.2 (CVE-2026-4738) | Crítica | Imagen propia mínima `rs-postgres:17.11` (`infra/db/Dockerfile`): la oficial más zlib 1.4-r0. La usan `db` y `respaldo`, porque `pg_dump -Fc` comprime con zlib |
| Postgres | `moby/sys/user` | Media | No hace fallar el escaneo; llega con la siguiente imagen oficial |
| Aplicación (2026-11-09) | `zlib1g` 1.3.1-1+b1 de Debian (CVE-2026-76844 y CVE-2026-85091, altas; CVE-2026-27171, media) | Alta | `apt-get install --only-upgrade zlib1g=…+deb13u1` (versión fija) en la etapa `runner`; se quita cuando la imagen de Node la traiga |

No se registró como excepción en `grype.yaml`, porque esa configuración aplica a las cuatro imágenes y ocultaría el mismo CVE en las demás. `seguridad.sh` construye Caddy y Postgres con `--pull`, para escanear sobre la imagen base vigente. Cuando la imagen oficial de Postgres traiga zlib 1.4, se vuelve a usar directo y se borra `infra/db/Dockerfile`.

Dos ajustes del escaneo:

- **Trivy DS-0002 en `infra/db/Dockerfile`:** excepción con motivo, porque la imagen arranca como root igual que la oficial y baja a `postgres` con su-exec.
- **ZAP 10096, Timestamp Disclosure: era un error del propio escaneo.** Lo que ZAP tomó por fechas (1852294936, 1782348074, 1669211576, 1776565560 y 1723363511) eran digests de React: errores del servidor dentro de `<Suspense>`, que responden 200 y React repinta en el navegador.
  - **Error:** el log del servidor decía `column "debe_cambiar_clave" does not exist`.
  - **Causa:** `seguridad.sh` usa siempre el proyecto `rs-seguridad` y solo reconstruía `web`. El migrador y la semilla eran imágenes de días antes, sin la migración 0012.
  - **Por qué parecía intermitente:** ZAP solo avisaba cuando el digest caía en su rango de fechas.
  - **Efecto:** desde el cambio de contraseña, el recorrido con sesión no revisaba las páginas reales; llegaba a 24 URL con despachador y 23 con operador.
  - **Corrección en `seguridad.sh`:**
    - construye `web`, `migrate`, `semilla`, `mapa-prueba-osm`, `mapa-prueba` y `osrm`;
    - guarda el log del servidor (`web.log`) y falla si registró errores durante ZAP;
    - un gancho (`infra/seguridad/zap-gancho.py`) guarda la petición y la respuesta completas de cada alerta no aceptada.
  - **Resultado:** con la corrección, ZAP recorre 80 URL con despachador y 31 con operador, sin errores ni avisos.
  - **Producción no se afectó:** `docker compose up -d --build` también reconstruye el migrador.
- **zlib fija en `1.4-r0`** en los dos Dockerfiles, por la regla de versiones exactas. Si Alpine la reemplaza, la construcción falla con un mensaje claro.

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
