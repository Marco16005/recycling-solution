# Recycling Solution — documentación

Piloto de un asistente de logística para una recicladora: CRM de clientes, catálogo de unidades y motor de ruteo.

| Documento | Para qué |
|---|---|
| `../../7°_LII_CF Solutions_DocumentoIntegrador (unificado).docx` | Documento académico; es la fuente de los requisitos |
| [Especificación de diseño](superpowers/specs/2026-10-07-recycling-solution-piloto-design.md) | Qué se construye, con qué y por qué: alcance, decisión de base, stack en contenedores, arquitectura, datos, motor, seguridad, indicadores y colaboración Claude–Codex (revisión 2) |
| [Hoja de ruta](superpowers/plans/2026-10-07-hoja-de-ruta.md) | Los seis planes, su orden, sus criterios de aceptación y qué recortar si falta tiempo |
| [Plan 1 v2: fundaciones y CRM](superpowers/plans/2026-10-13-plan-1-v2-fundaciones-y-crm.md) | Contratos y tareas T0 a T8 del primer hito, repartidas entre Claude y Codex |
| [Plan 1 v1](superpowers/plans/2026-10-07-plan-1-fundaciones-y-crm.md) | Sustituido; se conserva por el código verificado que sirvió de base |
| [Plan 2: flota, solicitudes y administración](superpowers/plans/2026-10-14-plan-2-flota-solicitudes-y-administracion.md) | Unidades, operadores, jornada, solicitudes FIFO, documentos, usuarios, configuración, aviso público, VPS |
| [Plan 3: motor de ruteo](superpowers/plans/2026-10-14-plan-3-motor-de-ruteo.md) | Contrato, algoritmo, propiedades y simulación del motor |
| [Plan 4: plan del día](superpowers/plans/2026-10-15-plan-4-plan-del-dia.md) | Generar, revisar en lista y mapa, ajustar y validar; candados, versiones y K6/K7 |
| [Plan 5: operador, incidentes y re-ruteo](superpowers/plans/2026-10-15-plan-5-operador-incidentes-y-reruteo.md) | Mi ruta en el teléfono sin señal, eventos idempotentes, rechazos conciliables, incidentes y re-ruteo sin tocar lo congelado |
| [Plan 6: indicadores y panel](superpowers/plans/2026-10-15-plan-6-indicadores-y-panel.md) | K1 a K7 y ciclo, panel de gerencia, CSV para cartas X̄-R e instantánea diaria de K5 |
| [Catálogo de documentos](catalogo-de-documentos.md) | Qué documentos pide el sistema a unidades, operadores y clientes, y por qué |
| [Documentos legales](legal/README.md) | Aviso de privacidad integral y simplificado, procedimiento interno y formato ARCO |
| [Operación](operacion.md) | Levantar, respaldar, restaurar y mudar el sistema con Docker |
| [Guía de auditoría](guia-de-auditoria.md) | Cómo revisar el proyecto con otra persona u otro modelo |
| [Pendientes del Documento Integrador](pendientes-documento-integrador.md) | Decisiones por confirmar y datos reales que faltan en el documento académico |

Estado al 2026-10-15: Planes 1 a 6 validados por Claude y Codex en `main`; sigue la preparación del piloto. Las decisiones de producto están en la especificación §14. Todo se ejecuta con Docker (`scripts/verificar-todo.sh`); la operación en el VPS está en [operacion.md](operacion.md).
