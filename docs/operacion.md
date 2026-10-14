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

En una máquina nueva, hacer primero los pasos de §1 con las mismas contraseñas de base de datos, pero sin levantar todavía la aplicación:

```bash
docker compose up -d db                          # crea los roles al iniciar el volumen
cp /ruta/al/respaldo.dump respaldos/
docker compose --profile respaldo run --rm --entrypoint sh respaldo -c \
  'pg_restore -h db -U rs_migrador -d recycling --clean --if-exists --no-owner /respaldos/respaldo.dump'
docker compose run --rm migrate                  # verifica migraciones y vuelve a aplicar permisos
docker compose up -d
```

`migrate` comprueba que las migraciones del respaldo coinciden con las del repositorio y deja a `rs_app` con sus permisos mínimos. Si el respaldo es de una versión anterior del sistema, `migrate` aplica las migraciones que falten.

## 5. HTTPS en producción

Caddy atiende `DOMINIO`:

- **Dominio público** (`rs.empresa.mx` apuntando a la máquina, puertos 80 y 443 abiertos): Caddy obtiene y renueva el certificado solo.
- **Red local sin dominio** (`localhost`, una IP o un nombre interno): Caddy firma con su propia autoridad. Cada teléfono y computadora debe instalar y confiar en esa autoridad, que está en el volumen `caddy_datos` (`/data/caddy/pki/authorities/local/root.crt`). Es la decisión abierta 11 de la especificación.

## 6. Mudar el sistema a otra máquina

1. En la máquina actual: `docker compose --profile respaldo run --rm respaldo`.
2. Copiar el último `respaldos/*.dump` y el archivo `.env` (por un medio seguro; contiene secretos).
3. En la máquina nueva: clonar el repositorio, poner el `.env` y restaurar con §4.
4. Entrar con un usuario conocido y revisar la lista de clientes antes de apagar la máquina anterior.

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

Construye las imágenes y corre tipos, lint, pruebas de unidad, integración con Postgres desechable, punta a punta contra la imagen de producción y búsqueda de secretos. No toca los datos de operación.
