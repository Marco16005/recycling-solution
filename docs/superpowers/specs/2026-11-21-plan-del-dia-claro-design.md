# Plan del día claro: pasos, «Cómo va el día» primero y detalle plegado — diseño

- **Fecha:** 2026-11-21.
- **Base:** `main` en 9e292f2, con el tablero del día ya integrado.
- **Pedido del usuario:** "lo que sea para que todo quede mucho más entendible, legible, *user friendly* y que cualquiera pueda entender todo sin mayor dificultad (…) que no sea sobrecomplicado y difícil para cierto público". Quien opera y valida el sistema lo revisa con una cuenta de **admin**.
- **Regla de este cambio:** no se quita ningún dato ni ninguna función. Lo que no hace falta para decidir **ahora** se pliega o baja de lugar, y las palabras técnicas se cambian por palabras de todos los días. No cambian las consultas, las acciones, los datos ni los permisos.

## 1. Qué se ve hoy (capturas del 2026-11-21, cuenta de admin)

- **Plan validado.** La página mide unos 6,300 px de alto en computadora y el tablero ("Seguimiento") empieza después de unos 4,000 px. Antes aparecen:
  - "Solo lectura";
  - la última ejecución del motor, en milisegundos;
  - el modo de los tiempos ("Tiempos aproximados: mapa de calles sin configurar");
  - el resumen con un comparativo simulado;
  - el reacomodo, con una tabla de métricas;
  - el mapa;
  - el detalle por camión, con siete datos por parada que nunca cambian, aunque también dice "Viaje 1" y "Viaje 2";
  - pospuestas, bloqueadas y requisitos.

  Después del tablero viene "Re-rutear", con una casilla abierta por cada camión y por cada parada. Hay dos listas de los mismos camiones, y la que se actualiza queda al fondo.
- **Plan propuesto.** Sigue el mismo orden. Cada parada trae siete datos y los controles para mover (unidad, viaje y posición) y posponer, siempre abiertos. "Validar" queda al final y aparece desactivado hasta que se confirman los requisitos, sin decir por qué.
- **Sin plan.** "Pospuestas" y "Bloqueadas" aparecen vacías, aunque sin plan siempre lo están.
- **`/operador` con una cuenta que no es de operador** (admin): dice "No tienes una ruta asignada para hoy", sin explicar qué hacer.
- **Palabras técnicas en toda la página:** "Ruteadas", "Ventana", "motor", "ms", y "Llegada proyectada" junto a "Llegada estimada" (dos palabras casi iguales para dos horas distintas).

## 2. Cambios

### 2.1 Pasos del plan del día (todas las fechas y estados)

Bajo el título "Plan del día" va una franja con tres pasos, con el actual resaltado: **1. Generar → 2. Revisar y validar → 3. Seguir el día.**

Debajo, una frase que empieza con "Ahora:" y dice qué hacer:

| Estado | Puede generar (despacho, admin) | No puede generar (gerencia) |
|---|---|---|
| Sin plan | "Ahora: revisa la lista de abajo y presiona «Generar plan»." | "Ahora: el despacho todavía no genera el plan de este día." |
| Propuesto | "Ahora: revisa las rutas. Si algo no te convence, mueve o pospone recolecciones. Cuando estén bien, confirma los requisitos al final y presiona «Validar»." | "Ahora: el despacho está revisando el plan." |
| Propuesto (re-ruteo) | "Ahora: revisa el re-ruteo y valídalo al final; reemplaza al plan que estaba vigente." | "Ahora: el despacho está revisando un re-ruteo." |
| Validado | "Ahora: sigue cada camión en «Cómo va el día». El avance lo marca el operador en su teléfono o tú con «Marcar»." | "Ahora: sigue cada camión en «Cómo va el día»." |

El paso actual se resalta así:
- validado: paso 3;
- propuesto, incluido el re-ruteo: paso 2;
- sin plan: paso 1.

Accesibilidad: `<ol aria-label="Pasos del plan del día">`, con `aria-current="step"` en el paso actual.

### 2.2 Encabezado

- **Se queda:** el título, la fecha y el estado, el selector de fecha, el botón para generar o regenerar, el aviso de solicitudes nuevas desde la generación y los errores.
- **Se quita:** "Solo lectura". Los pasos ya dicen qué se puede hacer.
- **Pasa a "Detalles técnicos"** (§2.3 y §2.4):
  - "Generado … · Ajustes …";
  - la última ejecución del motor;
  - el modo de los tiempos (`textoTiempos`).

### 2.3 Plan validado: «Cómo va el día» primero

Orden de la página:

1. Pasos (paso 3).
2. **«Cómo va el día»** (hoy "Seguimiento"):
   - la línea de quién marca y cada cuánto se actualiza;
   - **alertas:** si las tres cuentas están en cero, solo "Sin alertas"; si no, las cuentas como hoy;
   - las tarjetas por camión;
   - incidentes abiertos y eventos por conciliar, **solo si hay alguno**.
3. **"¿Un camión ya no puede seguir? Re-rutear"**: un `<details>` plegado que adentro trae lo mismo que hoy. Solo aparece donde hoy aparece "Re-rutear".
4. **"Ver el plan validado: rutas, mapa y resumen"**: un `<details>` plegado con todo lo demás, en este orden:
   1. el mapa y el detalle por camión;
   2. pospuestas y bloqueadas, si hay;
   3. requisitos;
   4. el resumen, el comparativo y el reacomodo;
   5. "Detalles técnicos".

En computadora (1280 × 900), el principio de la primera tarjeta de camión se ve sin desplazarse.

### 2.4 Plan propuesto: lo que hay que revisar, sin ruido

Orden de la página:

1. Pasos (paso 2).
2. **Resumen en palabras:** tres tarjetas:
   - "En ruta", hoy "Ruteadas";
   - "Pospuestas", con la nota "pasan al siguiente día";
   - "Bloqueadas", con la nota "no se pueden planear".
3. **Mapa y rutas por camión.** Cada parada:
   - **Línea principal:** "1. Cliente · llega 08:09 · horario 08:00–14:00 · 800 kg".
   - **Debajo, en texto pequeño:** "Espera 0 min · termina 08:29 · 2.1 km desde la anterior".
   - **Si es editable y no está congelada:** los controles de mover y posponer van en un `<details>` "Mover o posponer". "Congelada · sin ajustes" se queda visible.
4. **Pospuestas y bloqueadas:** solo si hay alguna, con la explicación de hoy.
5. **"Último paso: validar":**
   - los requisitos por operador, con su casilla;
   - los botones "Validar" y "Descartar";
   - si "Validar" está desactivado porque faltan requisitos, la línea "Para validar, confirma los requisitos de cada operador".
6. **"Comparativo y reacomodo (para análisis)":** un `<details>` plegado con el comparativo simulado, el reacomodo con "Readmitidas" y "Detalles técnicos".

### 2.5 Sin plan

"Pospuestas" y "Bloqueadas" no aparecen. Lo demás sigue igual: la lista "Antes de generar" con "¿Cómo funciona el plan del día?".

### 2.6 Palabras

- **Tablero, parada pendiente o en camino:** "Llegada prevista 08:12". Si difiere de la hora del plan, se agrega "(plan: 08:10)". Si son iguales, solo "Llegada prevista 08:10". Los datos son los mismos de hoy (`hora` y `horaPlan`).
- **"Ventana"** cambia a **"Horario del cliente"**, en el tablero y en el plan.
- **Tablero, viaje:** se muestran solo las horas que existen ("Salió 08:00", "Regresó 10:15"). Nada de "Salió — · Regresó —".
- **"Seguimiento"** cambia a **"Cómo va el día"**. El `aria-label` de la región también se llama "Cómo va el día".
- **"Ruteadas"** cambia a **"En ruta"** en el resumen. La tabla del reacomodo, ya plegada, puede conservar sus nombres.

### 2.6 bis Camión sin viajes (Claude, tras las capturas)

Un camión al que el plan no le dio viajes, o al que un re-ruteo se los quitó, mostraba "Sin llegar al patio" y "0 de 0 recolecciones", que parece un retraso. Ahora la frase dice "Sin recolecciones asignadas hoy", o "En el patio, sin recolecciones asignadas" si ya llegó. El botón "Marcar" sigue igual que en el teléfono.

### 2.7 `/operador` con una cuenta que no es de operador

Si el usuario de la sesión no tiene rol `operador`, en lugar de "No tienes una ruta asignada para hoy" se muestra:

> "Esta pantalla es la del teléfono de cada operador y tu cuenta no es de operador. Para ver y marcar el avance de los camiones, entra a «Plan del día»."

El mensaje lleva un enlace a `/despacho/plan`.

`src/app/operador/page.tsx` ya lee la sesión: le pasa `esOperador` a `MiRuta`, y la consulta no cambia. Un operador sin ruta hoy sigue viendo "No tienes una ruta asignada para hoy".

**Alcance (aclarado tras la revisión de Codex):** solo cubre las cuentas que hoy llegan a la página, es decir, la de admin, que tiene todos los permisos, incluido `ruta.operar`. El layout de `/operador` seguirá mandando a `/sin-acceso` al despacho y a la gerencia, y no cambia ni el layout ni la consulta.

### 2.8 "¿Cómo funciona el plan del día?" (Claude)

Se conservan los mismos cuatro pasos, con los nombres alineados a la franja: el paso 4 dice "En «Cómo va el día» ves cada camión".

## 3. Contratos

**Sin cambios** en `src/consultas`, `src/acciones`, `src/datos` ni `src/seguridad`. Cambian solo pantallas, textos y nombres accesibles. Las pruebas e2e que buscan "Seguimiento de operación", "Ventana", "Llegada proyectada", "Llegada estimada" o "Solo lectura" se actualizan. También las que esperan los controles de mover y posponer sin abrir "Mover o posponer".

## 4. Reparto

- **Codex:**
  - `src/components/plan/plan-del-dia.tsx`, `seguimiento.tsx` y, si hace falta, un componente nuevo de pasos en la misma carpeta;
  - `src/app/despacho/plan/page.tsx`, `src/app/operador/page.tsx` y `src/components/operador/mi-ruta.tsx`;
  - los e2e funcionales afectados: plan, calles, tablero y operador. En `tablero.spec`, una comprobación de que en 1280 × 900 la primera tarjeta empieza dentro de la pantalla (`boundingBox().y < 900`).
- **Claude:**
  - este documento y el texto de §2.8 (`src/components/preparacion`);
  - correr las pruebas y hacer el commit con "Autor: Codex";
  - capturas antes y después, en computadora y en teléfono, con admin y con despachador;
  - la revisión.

## 5. Criterios de aceptación

1. En cualquier estado, la franja de pasos dice dónde se está y qué sigue.
2. **Validado:** «Cómo va el día» es lo primero después de los pasos, y en 1280 × 900 la primera tarjeta empieza sin desplazarse. Re-rutear y el plan validado están plegados.
3. **Propuesto:** cada parada se lee en una línea. Mover y posponer están a un clic. Se entiende por qué "Validar" está desactivado.
4. Ningún dato ni función desaparece: todo lo de hoy sigue en la página, abierto o plegado.
5. **Permisos iguales:** gerencia no ve "Marcar", ni "Re-rutear", ni los controles de ajuste.
6. Las pruebas de unidad, de integración y e2e pasan en verde. Las capturas antes y después quedan para revisarlas el usuario y quien opera.

## 6. Seguridad

Sin cambios: mismas consultas, mismas acciones y mismos permisos. Plegar con `<details>` no oculta nada a quien no tiene permiso, porque las secciones que exigen permiso siguen sin dibujarse para quien no lo tiene.
