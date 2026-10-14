# Recycling Solution

Piloto de un asistente de logística para una recicladora de cartón: CRM de clientes, catálogo de unidades y, en una segunda etapa, motor de ruteo. La documentación está en [`docs/`](docs/README.md).

## Requisitos

Docker con Compose 2.24 o posterior, y git. Nada más: dependencias, base de datos, pruebas y servidor corren en contenedores.

## Arranque rápido (desarrollo)

```bash
cp .env.example .env     # llenar contraseñas, BETTER_AUTH_SECRET y ADMIN_*
docker compose up        # http://localhost:3000
```

Producción, respaldos, restauración y mudanza a otra máquina: [`docs/operacion.md`](docs/operacion.md).

## Verificación

```bash
scripts/verificar-todo.sh
```

Tipos, lint, pruebas de unidad, integración con Postgres, punta a punta contra la imagen de producción y búsqueda de secretos.

## Cómo se trabaja

Lo desarrollan Claude y Codex con responsables por carpeta; las reglas están en [`AGENTS.md`](AGENTS.md) y el plan vigente en [`docs/superpowers/plans/`](docs/superpowers/plans/).
