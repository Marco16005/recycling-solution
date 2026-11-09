# Operación: levantar, respaldar y mudar Recycling Solution

Todo corre en contenedores. La máquina solo necesita Docker (con Compose 2.24 o posterior) y git. En Windows sirve Docker Desktop: `.gitattributes` mantiene los scripts con finales de línea LF y `COMPOSE_PATH_SEPARATOR=:` (ya en `.env.example`) hace que `COMPOSE_FILE` se lea igual que en Linux y macOS. Si el proyecto se clonó antes de que existiera `.gitattributes` y la base no arranca: hacer un respaldo si ya hay datos (§3), detener con `docker compose down` (sin `-v`), renombrar la carpeta, clonar de nuevo **con el mismo nombre de carpeta** y copiar el `.env`. Compose toma el nombre del proyecto de la carpeta, así que vuelve a encontrar los mismos volúmenes y la base. Los contenedores se pueden borrar y recrear sin perder nada; los datos viven en el volumen de Postgres y en los respaldos (especificación §2, supuesto "efímero").

## 1. Primera vez en una máquina

```bash
git clone <repositorio> recycling-solution
cd recycling-solution
cp .env.example .env
```

Llenar `.env`:

| Variable | Qué poner |
|---|---|
| `COMPOSE_FILE` | `compose.yaml:compose.dev.yaml` para desarrollo; `compose.yaml:compose.prod.yaml` para operar |
| `COMPOSE_PATH_SEPARATOR` | `:` (déjalo así; hace que `COMPOSE_FILE` funcione también en Windows) |
| `POSTGRES_PASSWORD`, `RS_MIGRADOR_PASSWORD`, `RS_APP_PASSWORD` | Contraseñas distintas, solo letras y números (`openssl rand -hex 24`) |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | La dirección con la que se abre la aplicación: `http://localhost:3000` en desarrollo; `https://<DOMINIO>` en producción |
| `ADMIN_CORREO`, `ADMIN_NOMBRE`, `ADMIN_CLAVE` | Primer administrador; la clave puede borrarse de `.env` después del primer arranque |
| `DOMINIO` | Solo producción: nombre que atiende Caddy (ver §5) |
| `DOMINIO_ALTERNO` | Opcional, solo producción con Caddy: otro nombre (p. ej. `www.`) que redirige a `DOMINIO` (ver §5) |

Después:

```bash
docker compose up -d        # desarrollo: http://localhost:3000 ; producción: https://<DOMINIO>
docker compose logs -f web  # (o app en desarrollo)
```

Al arrancar, `migrate` aplica las migraciones y los permisos, y `bootstrap` crea el administrador si no existe. La aplicación espera a que ambos terminen bien.

## 2. Usuarios (Plan 1, desde la terminal)

```bash
docker compose run --rm bootstrap npm run alta-usuario -- --correo ana@empresa.mx --nombre "Ana López" --rol despachador
docker compose run --rm bootstrap npm run desactivar-usuario -- --correo ana@empresa.mx
docker compose run --rm bootstrap npm run desactivar-usuario -- --correo ana@empresa.mx --reactivar
docker compose run --rm bootstrap npm run restablecer-clave -- --correo ana@empresa.mx
```

Lo normal es hacerlo desde la aplicación: el administrador da de alta y restablece en Usuarios, y la contraseña temporal obliga al usuario a elegir una nueva al entrar. Cada usuario cambia la suya en "Mi contraseña", junto a Salir. El administrador no puede restablecerse a sí mismo desde la pantalla; si olvidó la suya, se usa `restablecer-clave` en la terminal.

Roles: `admin`, `despachador`, `operador`, `gerencia`. Si no se da `CLAVE_NUEVA` (`-e CLAVE_NUEVA=…`), el script genera una contraseña y la muestra una sola vez: entregarla en persona. Desactivar y restablecer cierran todas las sesiones del usuario. El script no desactiva al último administrador activo. Todo queda en la bitácora con la acción `…_por_script`. Una contraseña puesta por script no obliga a cambiarla; pide a la persona que la cambie en "Mi contraseña".

## 3. Respaldo

```bash
docker compose --profile respaldo run --rm respaldo
```

Deja `respaldos/recycling-AAAAMMDD-HHMMSS.dump` (formato de `pg_dump -Fc`). La carpeta `respaldos/` no se versiona. Copiarla fuera de la máquina (otra computadora o almacenamiento externo). Frecuencia recomendada durante el piloto: diaria, al cierre del turno.

## 4. Restauración (misma máquina o una nueva)

```bash
cp /ruta/al/respaldo.dump respaldos/          # el respaldo debe quedar dentro de respaldos/
scripts/restaurar.sh respaldos/respaldo.dump
```

El script:

1. Detiene todos los servicios en marcha salvo la base (en producción y en desarrollo) y se niega a seguir si queda alguna conexión abierta de la aplicación o del migrador, por ejemplo un `docker compose run` olvidado.
2. Restaura con `pg_restore --single-transaction --exit-on-error`: o queda todo el respaldo o la base sigue como estaba.
3. Solo si la restauración salió bien, corre `migrate` (verifica que las migraciones del respaldo coinciden con las del repositorio, aplica las que falten y vuelve a dar a `rs_app` sus permisos mínimos) y arranca la aplicación.

Si falla, la aplicación queda detenida y la base sin cambios: revisar el mensaje, conseguir un respaldo bueno y repetir. En una máquina nueva, antes de restaurar, hacer los pasos de §1 con las mismas contraseñas de base de datos. `scripts/verificar-todo.sh` prueba una restauración con la aplicación encendida, otra con una conexión abierta (no restaura) y otra con un respaldo dañado (no cambia nada).

## 5. HTTPS en producción

Caddy atiende `DOMINIO`:

- **Dominio público** (`rs.empresa.mx` apuntando a la máquina, puertos 80 y 443 abiertos): Caddy obtiene y renueva el certificado solo.
- **Nombre alterno** (opcional, por ejemplo `www.rs.empresa.mx`): con `DOMINIO_ALTERNO` en `.env`, Caddy también obtiene su certificado y lo redirige a `https://<DOMINIO>` con la misma ruta (301; si se entra por `http://`, antes pasa a HTTPS con un 308). Antes, el registro DNS del alterno debe apuntar a la máquina, por ejemplo un CNAME `www` hacia el dominio. Si no apunta, Caddy no consigue el certificado y lo reintenta en el log, aunque el dominio principal sigue funcionando. Se aplica con `docker compose up -d proxy`.
- **Red local sin dominio** (`localhost`, una IP o un nombre interno): Caddy firma con su propia autoridad. Cada teléfono y computadora debe instalar y confiar en esa autoridad, que está en el volumen `caddy_datos` (`/data/caddy/pki/authorities/local/root.crt`). Es la decisión abierta 11 de la especificación. Por HSTS, un nombre interno queda fijado a HTTPS durante un año: si cambia la autoridad de Caddy, cada equipo debe instalar la nueva antes de volver a entrar.

Para obtener el certificado que se instala en los teléfonos (es público; la llave privada no sale del volumen):

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt respaldos/caddy-raiz.crt
```

## 6. Mudar el sistema a otra máquina

1. En la máquina actual: `docker compose --profile respaldo run --rm respaldo`.
2. Si se usa HTTPS de red local (§5), decidir qué pasa con la autoridad de Caddy:
   - **Conservarla** para que los teléfonos no tengan que reinstalar nada. Copiar el volumen, que contiene la llave privada de la autoridad (tratarlo como un secreto):

     ```bash
     docker compose stop proxy
     docker compose run --rm --no-deps --user root --entrypoint tar -v "$PWD/respaldos:/salida" proxy czf /salida/caddy-datos.tgz -C /data .
     ```

     En la máquina nueva, antes del primer arranque de `proxy`:

     ```bash
     docker compose run --rm --no-deps --user root --entrypoint sh -v "$PWD/respaldos:/entrada" proxy \
       -c 'tar xzf /entrada/caddy-datos.tgz -C /data && chown -R caddy:caddy /data'
     ```

     Caddy corre sin privilegios (Plan de seguridad): `--user root` solo es para leer y escribir el respaldo, y el `chown` le devuelve sus archivos.

   - **Crear una nueva**: no copiar nada; en la máquina nueva Caddy genera otra autoridad y hay que instalar su certificado (§5) en cada teléfono y computadora antes del cambio.
3. Copiar el último `respaldos/*.dump`, el archivo `.env` y, si aplica, `caddy-datos.tgz`, por un medio seguro (contienen secretos).
4. En la máquina nueva: clonar el repositorio, poner el `.env` y restaurar con §4.
5. Comprobar desde una computadora **y desde un teléfono de operador** que la aplicación abre por HTTPS sin advertencias, entrar con un usuario conocido y revisar la lista de clientes antes de apagar la máquina anterior.

## 7. Actualizar a una versión nueva del código

```bash
docker compose --profile respaldo run --rm respaldo   # siempre antes de actualizar
git pull
docker compose up -d --build
```

**Al pasar a la versión del Plan de seguridad (2026-11):** OSRM sirve ahora sin privilegios (usuario `nobody`) y necesita que el mapa sea legible para todos. Si el mapa ya estaba preparado, correr una vez `scripts/preparar-mapa.sh`: con la misma fecha no descarga nada, solo corrige los permisos. Caddy ahora es una imagen propia (`infra/caddy/Dockerfile`), que `--build` construye.

**Al pasar a la versión de seguridad del 2026-11-07** (Caddy 2.11.9, zlib 1.4 y la imagen `rs-postgres:17.11`):

- **Qué cambia:** se recrean los contenedores `db` y `proxy`. La base sigue en Postgres 17.11 con el mismo volumen, sin migración de datos, y la aplicación deja de responder unos segundos.
- **Compilación:** Caddy se compila con Go, lo que puede ocupar de 1 a 2 GB de memoria durante unos minutos.

Pasos:

1. **Respaldo:** `docker compose --profile respaldo run --rm respaldo`. Se hace antes del `git pull`, mientras la imagen de respaldo sigue siendo la anterior.
2. **Código:** `git pull`.
3. **Construir y arrancar**, según el servidor:
   - **Dedicado y con memoria suficiente** (o swap): `docker compose up -d --build`.
   - **Compartido con el punto de venta, o con poca memoria:** construir fuera del servidor (§9, "Construir la imagen sin cargar el VPS"), cargar las imágenes y arrancar con `docker compose up -d --no-build`.
4. **Comprobar:**
   - `docker compose ps`: todos sanos.
   - Solo en el modo A, con Caddy propio: `docker compose exec proxy caddy version` debe dar `v2.11.9`. En el modo B no hay contenedor `proxy`; ahí se comprueba que la aplicación abre por el proxy del punto de venta.
   - `docker compose exec db sh -c 'apk info -v zlib'`: `zlib-1.4-r0`.
   - Entrar a la aplicación y revisar la lista de clientes.

## 8. Verificación completa

```bash
scripts/verificar-todo.sh
```

Construye las imágenes y corre tipos, lint, pruebas de unidad, integración con Postgres desechable, punta a punta contra la imagen de producción, la prueba de respaldo y restauración, y la búsqueda de secretos. No toca los datos de operación.

## 9. Piloto en el VPS de Hostinger compartido con el punto de venta

Decisión 1 de la especificación §14. Antes de instalar, comprobar:

| Qué | Cómo | Para qué |
|---|---|---|
| Docker y Compose | `docker compose version` (2.24 o posterior) | Todo corre en contenedores |
| Arquitectura | `uname -m` (normalmente `x86_64`) | La imagen debe ser `linux/amd64` |
| Memoria libre | `free -h` | El piloto usa como máximo unos 1.2 GB (límites en `compose.prod.yaml`: 512 MB la aplicación, 512 MB la base y 128 MB Caddy) |
| Puertos 80 y 443 | `sudo ss -ltnp \| grep -E ':(80\|443) '` | Decide el modo de HTTPS (abajo) |

### Nombre sin dominio propio

`sslip.io` resuelve cualquier nombre con la IP incrustada: para la IP `203.0.113.25`, el nombre `203-0-113-25.sslip.io` apunta al VPS. Con ese nombre se obtiene un certificado público de Let's Encrypt sin comprar un dominio. En `.env`:

```
DOMINIO=203-0-113-25.sslip.io
BETTER_AUTH_URL=https://203-0-113-25.sslip.io
```

Cuando haya dominio propio, solo cambian esas dos líneas. Riesgo conocido: si `sslip.io` dejara de funcionar, el sistema queda inaccesible por nombre hasta tener un dominio; por eso conviene comprar uno antes de terminar el piloto.

### Modo A: los puertos 80 y 443 están libres

```
COMPOSE_PROFILES=caddy
```

`docker compose up -d` levanta también Caddy, que obtiene y renueva el certificado solo. Comprobar: `curl -I https://203-0-113-25.sslip.io/entrar` responde `200`.

### Modo B: el punto de venta ya usa 80 y 443 con su proxy

Dejar `COMPOSE_PROFILES` vacío. La aplicación queda solo en `127.0.0.1:3001` (`PUERTO_WEB_LOCAL`) y el proxy existente le envía el tráfico de su nombre.

El proxy existente debe hacer lo que en el modo A hace Caddy (plan de seguridad §7):

1. **IP real del cliente.** El límite de 5 intentos de entrada por minuto se cuenta por la IP que llega en `X-Forwarded-For`. El proxy debe **reemplazar** ese encabezado con la IP real, nunca agregarla al que trae la petición: con `$proxy_add_x_forwarded_for`, un atacante podría inventar una IP distinta en cada intento y saltarse el límite.
2. **HSTS en todo.** La aplicación lo pone en las páginas; los archivos estáticos no pasan por ella. Hay que mandarlo una sola vez por respuesta.
3. **Comprimir solo los archivos estáticos (BREACH).** Next pone la dirección completa en cada página, así que una página comprimida puede reunir texto controlado desde otro sitio con datos privados. La aplicación no comprime por su cuenta.

Ejemplo completo para nginx:

```nginx
server {
    server_name 203-0-113-25.sslip.io;
    # 2. HSTS una sola vez en toda respuesta: se quita el de la aplicación y se pone aquí (always incluye errores).
    proxy_hide_header Strict-Transport-Security;
    add_header Strict-Transport-Security "max-age=31536000" always;
    # 3. Sin compresión salvo en los estáticos.
    gzip off;
    location /_next/static/ {
        gzip on;
        gzip_types text/css application/javascript;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        # 1. Reemplaza (no agrega) la IP del cliente: el límite de intentos depende de ella.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # El certificado lo emite el mismo proxy, por ejemplo: sudo certbot --nginx -d 203-0-113-25.sslip.io
}
```

Si el proxy existente es Caddy, el bloque es el siguiente. Caddy ignora el `X-Forwarded-For` de los clientes y pone la IP real, salvo que tenga configurado `trusted_proxies`.

```caddyfile
203-0-113-25.sslip.io {
	header ?Strict-Transport-Security "max-age=31536000"
	@estaticos path /_next/static/* /favicon.ico /icon.svg /apple-icon.png /maplibre-gl-worker.mjs /sw-operador.js
	encode @estaticos zstd gzip
	reverse_proxy 127.0.0.1:3001
}
```

Antes de tocar el proxy del punto de venta, respaldar su configuración y coordinar con quien lo administra.

**Comprobación obligatoria** en cualquiera de los dos modos: seis intentos de entrada con una IP falsa distinta en cada uno. El sexto debe responder `429`:

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://203-0-113-25.sslip.io/api/auth/sign-in/email \
    -H 'content-type: application/json' -H 'origin: https://203-0-113-25.sslip.io' \
    -H "X-Forwarded-For: 10.0.0.$i" -d '{"email":"nadie@ejemplo.mx","password":"clave-equivocada-123"}'
done; echo   # esperado: 401 401 401 401 401 429
```

Si los seis responden `401`, el proxy está pasando la IP falsa: corregir su configuración antes de abrir el sistema. Comprobado el 2026-10-15 con el modo A (Caddy): `401 401 401 401 401 429`. La aplicación misma escucha solo en `127.0.0.1`, así que desde fuera del servidor no se puede llegar a ella sin pasar por el proxy.

### Feruga detrás del mismo Caddy

En el servidor de producción vive también feruga (gestión de la recicladora), en `gestion.feruga.tech`. El Caddy de Recycling sigue siendo la única puerta en 80 y 443:

- obtiene ese certificado;
- le pasa el tráfico al proxy de feruga (`feruga-proxy`, puerto 80) por la red interna `feruga-entrada`, que solo comparten los dos proxies.

Es opcional: en desarrollo y en las pruebas no se activa (diseño en `docs/superpowers/specs/2026-11-09-vecino-feruga-design.md`).

**Activar.** En este orden: sin la red, el proxy no arranca y Recycling se queda sin entrada.

1. El DNS de `gestion.feruga.tech` debe apuntar al servidor. Si no, Caddy no obtiene ese certificado y lo reintenta en el log, aunque `feruga.tech` sigue igual.
2. `docker network create --internal feruga-entrada`, y comprobar que existe con `docker network inspect feruga-entrada`.
3. `git pull`.
4. En `.env`, agregar `:compose.feruga.yaml` al final de `COMPOSE_FILE` (queda `compose.yaml:compose.prod.yaml:compose.feruga.yaml`).
5. `docker compose up -d --force-recreate --no-deps proxy`: unos segundos sin servicio, en una hora tranquila.
6. Comprobar:
   - Recycling abre como siempre;
   - `curl -sI https://gestion.feruga.tech` responde 502, con certificado válido, hasta que feruga se publique.

**Cambios posteriores** en `infra/caddy/vecinos/*.caddy`: `git pull` y `docker compose exec proxy caddy reload --config /etc/caddy/Caddyfile`, sin recrear el contenedor; la carpeta está montada. Caddy aplica la configuración nueva sin cortar las peticiones normales, aunque puede cerrar conexiones largas, como WebSockets. Un cambio al `Caddyfile` principal sí necesita recrear el proxy, como en el paso 5: está montado como archivo suelto.

**Volver atrás:** quitar `:compose.feruga.yaml` de `COMPOSE_FILE` y repetir el paso 5. La red se puede borrar después con `docker network rm feruga-entrada`, cuando feruga ya no la use.

**Lo que le toca a feruga:**

- su proxy se llama `feruga-proxy` en `feruga-entrada` y escucha en el puerto 80;
- confía en `X-Forwarded-For` solo si viene de este Caddy, que reemplaza el de los clientes con su IP real;
- pone sus propios encabezados (CSP, marcos y demás) y decide la compresión, por BREACH (plan de seguridad §7). Este Caddy solo quita `Server` y pone HSTS si falta.

### Construir la imagen sin cargar el VPS

Compilar la aplicación consume más memoria de la que conviene usar en un servidor compartido. Se puede construir en otra computadora para `linux/amd64` y copiar las imágenes:

```bash
# En la computadora de desarrollo, con el mismo .env de producción (COMPOSE_FILE=compose.yaml:compose.prod.yaml):
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose --profile caddy build   # con el perfil, también construye Caddy
docker save recycling-solution-web recycling-solution-migrate recycling-solution-bootstrap rs-caddy:2.11.9 rs-postgres:17.11 | gzip | ssh usuario@vps 'gunzip | docker load'

# En el VPS:
docker compose up -d --no-build
```

### Respaldo diario

En el VPS, con `crontab -e` (a las 17:00, al cierre del turno):

```
0 17 * * * cd /ruta/recycling-solution && docker compose --profile respaldo run --rm respaldo >> respaldos/respaldo.log 2>&1
5 17 * * * cd /ruta/recycling-solution && docker compose run --rm bootstrap npm run instantanea-k5 >> respaldos/k5.log 2>&1
```

La segunda línea guarda la instantánea diaria de K5 para la serie del panel (Plan 6). Si un día no corre, la primera consulta del panel de ese día la toma; un día sin ninguna de las dos queda como hueco en la serie.

Copiar la carpeta `respaldos/` fuera del VPS al menos una vez por semana (otra computadora o almacenamiento externo).

## 10. Mapa de calles (OSRM, Plan 7)

El motor planea con distancias y tiempos por calle real que calcula OSRM, un servicio de rutas libre que corre en un contenedor propio. Ninguna coordenada sale de la máquina. Sin el mapa, el sistema sigue funcionando con la fórmula aproximada (línea recta × factor de circuidad) y el plan lo avisa.

### Preparar el mapa (una vez, y al actualizarlo)

1. En `.env`, poner `MAPA_FECHA` con un extracto **fechado** de México listado en <https://download.geofabrik.de/north-america/mexico.html> (por ejemplo `261019`). `MAPA_CAJA` ya trae la zona de Querétaro y El Marqués (`-100.65,20.45,-100.05,20.85`, en el orden oeste,sur,este,norte); se cambia si la operación crece.
2. Correr `scripts/preparar-mapa.sh`. Si los servicios se levantan con otro nombre de proyecto (`-p`, por ejemplo en un worktree), se usa el mismo: `scripts/preparar-mapa.sh -p rs-<rama>`. El script:
   - descarga unos 620 MB y verifica su md5;
   - recorta la caja y procesa el recorte, y luego borra el extracto completo;
   - es idempotente: con la misma fecha y caja no repite nada.
3. Activar el perfil: `COMPOSE_PROFILES=mapa` (o `caddy,mapa`) y `OSRM_URL=http://osrm:5000` en `.env`.
4. Levantar todo con `docker compose up -d`.

El plan del día muestra "Tiempos por calle (mapa geofabrik-mexico-AAMMDD …)". Si dice "Tiempos aproximados", el motivo explica qué falló: sin configurar, sin respuesta, respuesta inválida, error de OSRM o demasiados puntos.

**Actualizar.** Se recomienda una vez al mes: cambiar `MAPA_FECHA`, volver a correr el script y luego `docker compose restart osrm`. Los planes ya guardados conservan su matriz y el mapa con que se planearon. Los trazos de un plan viejo dibujados con un mapa nuevo se marcan "dibujado con otro mapa".

**Preparar en otra máquina.** Si el VPS anda corto de memoria o de red, se prepara en otra computadora con Docker y se copia el volumen `mapa_datos` como en la §6.

**Memoria y disco.** Medición del 2026-10-20 con el extracto `261019` y la caja por omisión:
- `osrm` sirviendo: 63 MiB, por debajo de su límite `LIMITE_MEMORIA_OSRM` (256m por omisión);
- preparación: pico de 84 MB y unos 15 minutos con la descarga;
- mapa procesado: 86 MB en el volumen.

Ejemplo real: del centro de Querétaro a El Marqués, 24.5 km y 24 min en auto, antes del factor de camión.

**Atribución.** Los datos del mapa son © colaboradores de OpenStreetMap, con licencia ODbL. La atribución aparece en el mapa de la aplicación y en el aviso de privacidad.

**Navegación del operador.** Los botones "Navegar con Waze" y "Navegar con Google Maps" de `/operador` abren esas aplicaciones en el teléfono con el destino de la parada. La aplicación no las consulta. Al tocarlos, el teléfono envía el destino a ese proveedor; así lo dice el aviso para operadores.
