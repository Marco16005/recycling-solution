# Operación: levantar, respaldar y mudar Recycling Solution

Todo corre en contenedores. La máquina solo necesita Docker (con Compose 2.24 o posterior) y git. Los contenedores se pueden borrar y recrear sin perder nada; los datos viven en el volumen de Postgres y en los respaldos (especificación §2, supuesto "efímero").

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
| `POSTGRES_PASSWORD`, `RS_MIGRADOR_PASSWORD`, `RS_APP_PASSWORD` | Contraseñas distintas, solo letras y números (`openssl rand -hex 24`) |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | La dirección con la que se abre la aplicación: `http://localhost:3000` en desarrollo; `https://<DOMINIO>` en producción |
| `ADMIN_CORREO`, `ADMIN_NOMBRE`, `ADMIN_CLAVE` | Primer administrador; la clave puede borrarse de `.env` después del primer arranque |
| `DOMINIO` | Solo producción: nombre que atiende Caddy (ver §5) |

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

Roles: `admin`, `despachador`, `operador`, `gerencia`. Si no se da `CLAVE_NUEVA` (`-e CLAVE_NUEVA=…`), el script genera una contraseña y la muestra una sola vez: entregarla en persona. Desactivar y restablecer cierran todas las sesiones del usuario. Todo queda en la bitácora con la acción `…_por_script`.

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
- **Red local sin dominio** (`localhost`, una IP o un nombre interno): Caddy firma con su propia autoridad. Cada teléfono y computadora debe instalar y confiar en esa autoridad, que está en el volumen `caddy_datos` (`/data/caddy/pki/authorities/local/root.crt`). Es la decisión abierta 11 de la especificación.

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
     docker compose run --rm --no-deps --entrypoint tar -v "$PWD/respaldos:/salida" proxy czf /salida/caddy-datos.tgz -C /data .
     ```

     En la máquina nueva, antes del primer arranque de `proxy`:

     ```bash
     docker compose run --rm --no-deps --entrypoint tar -v "$PWD/respaldos:/entrada" proxy xzf /entrada/caddy-datos.tgz -C /data
     ```

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

## 8. Verificación completa

```bash
scripts/verificar-todo.sh
```

Construye las imágenes y corre tipos, lint, pruebas de unidad, integración con Postgres desechable, punta a punta contra la imagen de producción, la prueba de respaldo y restauración, y la búsqueda de secretos. No toca los datos de operación.
