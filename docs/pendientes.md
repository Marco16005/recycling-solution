# Pendientes de la aplicación

Lo que falta en el sistema. Lo del documento académico está en [pendientes-documento-integrador.md](pendientes-documento-integrador.md). Al resolver un pendiente, se borra de aquí en el mismo commit.

## Interfaz

- **Ícono propio de reciclaje** (pedido del 2026-11-07).
  - **Problema:** la pestaña del navegador muestra el ícono genérico (`src/app/favicon.ico`).
  - **Qué se quiere:** uno personalizado de reciclaje, con los colores del sistema, que se distinga a 16 px.
  - **Archivos:**
    - `src/app/icon.svg`;
    - `src/app/favicon.ico` (16 y 32 px);
    - `src/app/apple-icon.png` (180 px), para cuando el operador agregue `/operador` a la pantalla de inicio del teléfono.
  - **Restricción:** puede partir del símbolo universal de reciclaje, que es de uso libre, pero sin copiar el logotipo de otra empresa.
  - **Responsable:** Claude.

## Antes del piloto

- Revisión del aviso de privacidad por un abogado antes de publicarlo.
- Respaldos guardados fuera del servidor.
- Línea base de K2 con la hoja de cronometraje.
- Carga de la cartera real, siempre fuera del repositorio.
- Escaneo con nmap y ZAP contra el servidor ya desplegado, solo con autorización del dueño.

## Instalación en Windows

- `.gitattributes` con finales de línea LF para los scripts y `COMPOSE_PATH_SEPARATOR`, para que el proyecto corra igual en Windows.
