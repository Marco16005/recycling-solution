# Pendientes del Documento Integrador unificado

Archivo: `../../7°_LII_CF Solutions_DocumentoIntegrador (unificado).docx` (2026-10-07).

Se armó con el contenido del PDF versión 12 como base, más lo rescatado del `.docx (editado)`. Las secciones 1 a 7 quedaron unificadas; las secciones 8 a 17 y el Resumen siguen como plantilla.

## A. Decisiones tomadas al unificar que hay que confirmar

| # | Decisión | Dónde | Por qué |
|---|---|---|---|
| 1 | Turno de 480 min en todo el documento | §3, §4, Tablas 8 y 11 | La versión 12 usaba 450, 480 y "7 horas" en lugares distintos. Si el turno efectivo es de 450 min, cambian el Takt Time y la capacidad. |
| 2 | "Tiempos muertos" = espera de asignación (15 min) + traslado (45 min); la meta de 20% es bajar de 60 a 48 min | §1 Alcance, Tabla 8 | La meta no decía contra qué base se medía. |
| 3 | Takt Time = 120 min (demanda pico) y 144 min (demanda mínima); los 96 min son el ciclo objetivo de la gerencia | §4, Tabla 8 | El takt se calcula con la demanda, no con la meta interna. |
| 4 | Nombre único: "Recycling Solution" | Todo | Aparecía de seis formas; se tomó el de la portada. |
| 5 | Seis módulos en el piloto: se agregaron el catálogo de unidades y operadores y la aplicación del operador | Tabla 9, Figura 10 | El texto decía "5 módulos" y listaba 4; el motor necesita los datos de las unidades. |
| 6 | El componente de inteligencia artificial es el agrupamiento k-means | §6 Arquitectura | Había que nombrar el algoritmo. |
| 7 | Calificaciones de 1 a 5 de cada alternativa | Tabla 14 | La matriz solo tenía pesos. Las calificaciones son una propuesta derivada de la Tabla 12; el equipo debe validarlas. |
| 8 | Costo mensual con 20 días hábiles; se quitó "tomando en cuenta 10 unidades" | §5 | La flotilla es de 15 y la cuenta no dependía de ese dato. |
| 9 | Tamaño de muestra: 20 subgrupos de 3 a 5 recolecciones | Tabla 8 | "20 rutas por día" no es alcanzable con 2 o 3 unidades. |
| 10 | La competencia se describe igual en §2, §3 y §5: ya hay plataformas con ruteo y cumplimiento (Reko); el diferenciador es la asignación por restricciones del cliente | §2, §3, §5 | §2 y §5 decían que nadie lo combinaba y §3 decía lo contrario. |
| 11 | El VRPTW salió de la tabla de software y quedó como referencia académica en un párrafo | §3 | Es un modelo matemático, no un producto. |
| 12 | Se quitó la referencia a CRO Software (ninguna fila la citaba) y se agregó la de la NOM-012-SCT-2-2017 (se menciona en el texto) | §3 Referencias | Verificar la ficha de la NOM-012 y agregar su liga. |
| 13 | "Micro, pequeñas y medianas empresas" | §1 | La empresa del caso tiene cerca de 60 colaboradores. |
| 14 | Frases que estaban como opciones quedaron afirmadas: la brecha de capacidad "se cubre con horas extra, pasando recolecciones al día siguiente o atendiendo a varios clientes en un mismo viaje"; en la visita "se conversó con el despachador, con operadores y con la gerencia" | §3, §4 | Confirmar que así ocurrió. |
| 15 | Capacitación por rol | Tabla 6 | La columna venía cortada. |
| 16 | Cada sección principal inicia en página nueva | Secciones 2 a 8 | Presentación. |

## B. Valores ilustrativos que deben sustituirse por datos reales

| Elemento | Qué falta |
|---|---|
| Figura 3, carta X̄-R y el Cpk del texto | Cronometraje real del ciclo por recolección: 20 a 25 subgrupos de 5 |
| Figura 5, Pareto | Tres meses de datos: número de recolecciones y tiempo perdido por causa (lo pidió la revisión de la versión 12) |
| Figura 8, demanda mensual | Histórico real de solicitudes por mes; hoy solo es real el rango de 50 a 60 por día |
| Costo de $250 MXN por hora-unidad | Sustento: sueldo del operador, depreciación y, si aplica, combustible |
| Línea base del tiempo administrativo por cliente | Cronometrar el método actual antes del piloto; es la base del objetivo de 30% |

## C. Observaciones de la revisión de la versión 12 que siguen abiertas

- Tabla 4: agregar costo, tiempo de implementación, tipo de empresa recomendada y flexibilidad de cada software.
- Perfil de usuarios: se agregó un párrafo; ampliarlo si el docente lo pide.

## D. Formato

- Portada: "mes de año" y el aviso "BORRAR ESTE MENSAJE".
- Resumen / Brief: sin escribir.
- Los bloques de guía de la plantilla (ejemplos gráficos, cómo elaborarlos, profundidad por semestre) siguen en las secciones 1 a 7.
- Sección 2: no hay diagrama de Gantt.
- Figura 12: no incluye la pantalla del operador. A la imagen se le recortó la franja del título, que tenía una errata.
- El archivo pasó las verificaciones de estructura, pero no se pudo abrir en Word desde el entorno de trabajo. Revisar la paginación al abrirlo.

## E. Calendario

Los objetivos dicen "primeras 6 semanas", "meses 2 y 3" y "mes 4". Hay que anclarlos al calendario real, porque el desarrollo empieza en octubre.
