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
| [Catálogo de documentos](catalogo-de-documentos.md) | Qué documentos pide el sistema a unidades, operadores y clientes, y por qué |
| [Documentos legales](legal/README.md) | Aviso de privacidad integral y simplificado, procedimiento interno y formato ARCO |
| [Operación](operacion.md) | Levantar, respaldar, restaurar y mudar el sistema con Docker |
| [Guía de auditoría](guia-de-auditoria.md) | Cómo revisar el proyecto con otra persona u otro modelo |
| [Pendientes del Documento Integrador](pendientes-documento-integrador.md) | Decisiones por confirmar y datos reales que faltan en el documento académico |

Estado al 2026-10-13: especificación revisión 2 y Plan 1 v2 validados técnicamente por Claude y Codex; inicia el desarrollo conjunto del Plan 1. Las decisiones de producto (especificación §14) siguen abiertas con el dueño y ninguna bloquea el Plan 1. Todo se ejecuta con Docker (ver el Plan 1 v2, §6).
