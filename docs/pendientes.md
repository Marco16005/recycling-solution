# Pendientes de la aplicación

Lo que falta en el sistema. Lo del documento académico está en [pendientes-documento-integrador.md](pendientes-documento-integrador.md). Al resolver un pendiente, se borra de aquí en el mismo commit.

## Antes del piloto

- Revisión del aviso de privacidad por un abogado antes de publicarlo.
- Respaldos guardados fuera del servidor.
- Línea base de K2 con la hoja de cronometraje.
- Carga de la cartera real, siempre fuera del repositorio.
- Correo del dominio en el DNS de Hostinger. Hoy nadie impide mandar correos que parezcan de `@feruga.tech`. Si el dominio no manda ni recibe correo:
  - un TXT `v=spf1 -all` en `feruga.tech`;
  - un TXT `v=DMARC1; p=reject` en `_dmarc.feruga.tech`;
  - cambiar el MX, que apunta al propio servidor (y este no recibe correo), por un MX nulo: prioridad `0` y destino `.` (RFC 7505). Quitarlo no basta: sin MX, los remitentes intentan entregar en la IP del dominio.

  Si el dominio sí usa correo, los registros los da el proveedor. Lo encontró la prueba del 2026-11-11 (plan de seguridad §7).
