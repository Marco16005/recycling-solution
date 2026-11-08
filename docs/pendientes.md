# Pendientes de la aplicación

Lo que falta en el sistema. Lo del documento académico está en [pendientes-documento-integrador.md](pendientes-documento-integrador.md). Al resolver un pendiente, se borra de aquí en el mismo commit.

## Antes del piloto

- Revisión del aviso de privacidad por un abogado antes de publicarlo.
- Respaldos guardados fuera del servidor.
- Línea base de K2 con la hoja de cronometraje.
- Carga de la cartera real, siempre fuera del repositorio.
- Registro CAA en el DNS de Hostinger para feruga.tech, que limita qué autoridades pueden emitir sus certificados:
  - `0 issue "letsencrypt.org"`, la que usa Caddy;
  - `0 issue "sectigo.com"`, la de ZeroSSL, su respaldo.

  Lo marcó testssl en la prueba del 2026-11-07 (plan de seguridad §7).
