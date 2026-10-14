# Recycling Solution — reglas para agentes

Piloto de un asistente de logística para una recicladora de cartón. Lo desarrollan Claude y Codex en conjunto.

## Leer antes de cambiar algo

1. `docs/superpowers/specs/2026-10-07-recycling-solution-piloto-design.md` (revisión 2): qué debe hacer el sistema.
2. `docs/superpowers/plans/2026-10-13-plan-1-v2-fundaciones-y-crm.md`: contratos (§3) y tareas con responsable (§4).
3. `docs/guia-de-auditoria.md`: invariantes que siempre deben cumplirse.

## Responsables (especificación §15)

| Responsable | Carpetas |
|---|---|
| Claude | Archivos raíz, `package*.json`, Docker y Compose, `infra/`, `src/datos`, `drizzle/`, `src/seguridad`, `src/acciones`, `src/consultas`, `src/components/sesion`, `src/components/ui`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/entrar`, `src/app/sin-acceso`, `src/app/api`, `scripts/`, `e2e/ayudas` |
| Codex | `src/dominio`, `src/app/despacho`, `src/components/clientes`, `e2e/*.spec.ts` funcionales del CRM |

- No se editan archivos del otro. Si hace falta un cambio ahí, se pide.
- Cambiar un contrato de §3 del plan requiere acuerdo de ambos y un commit que actualice el plan.
- Solo Claude modifica el esquema, genera migraciones y resuelve `package-lock.json`.

## Cómo se ejecuta

- Todo corre en contenedores con `docker compose`; no se instala nada en la máquina. Comandos en el plan, §6.
- Versiones exactas: nada de `@latest` ni imágenes sin versión.
- En un worktree, usar `-p rs-<rama>` en cada comando de Compose.

## Reglas de código

- `src/dominio` es puro: sin acceso a datos, red, `Date.now()`, `new Date()` sin argumentos ni `Math.random()`.
- Las pantallas solo llaman a `src/consultas` y `src/acciones`; nunca a `src/datos`.
- Toda acción y consulta autoriza con un permiso de `src/seguridad/permisos.ts` antes de leer o escribir.
- Toda escritura va en una sola transacción con su renglón de bitácora; la bitácora guarda nombres de campos, nunca valores.
- Textos de la interfaz, nombres y comentarios en español.
- Ningún secreto ni dato real de clientes en el repositorio; solo datos sintéticos.
- Lo que lea sesión o base en una página va dentro de `<Suspense>` (Cache Components está activado).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
