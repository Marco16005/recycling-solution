# Documentos legales

| Archivo | Para qué |
|---|---|
| [aviso-de-privacidad-integral.md](aviso-de-privacidad-integral.md) | Aviso integral (artículo 15 de la LFPDPPP 2025). Lo publica el sistema en `/aviso-de-privacidad` |
| [aviso-de-privacidad-simplificado.md](aviso-de-privacidad-simplificado.md) | Versión simplificada para teléfono, WhatsApp, correo y sistema (artículo 16, fracción II) |
| [procedimiento-datos-personales.md](procedimiento-datos-personales.md) | Procedimiento interno: solicitudes ARCO, registro de exclusión, vulneraciones, medidas de seguridad |
| [solicitud-derechos-arco.md](solicitud-derechos-arco.md) | Formato para que la persona titular presente su solicitud |

## Antes de usarlos

1. **Revisión legal.** Los redactó un asistente de IA a partir del texto vigente de la ley: DOF del 20 de marzo de 2025, última reforma del 14 de noviembre de 2025. Una persona abogada debe revisarlos. Cuando se publique el nuevo Reglamento, hay que revisar sus requisitos, sobre todo los de transferencias y medidas compensatorias.
2. **Datos de la empresa.** Llenar los campos `{{…}}`:
   - razón social y nombre comercial;
   - domicilio;
   - responsable de datos y su suplente;
   - correo y teléfono de privacidad;
   - horario de atención;
   - proveedores de hospedaje, respaldos y mapas;
   - plazos de conservación;
   - URL del aviso.

   En el sistema se configuran con variables de entorno (Plan 2).
3. **Plazos de conservación** (decisión 10 de la especificación). Valores propuestos, confirmables por la empresa:
   - clientes y aceptaciones: 5 años después de la última recolección (equivalente al plazo de conservación de la contabilidad del Código Fiscal de la Federación);
   - bitácora: 5 años;
   - rutas y ubicaciones: 12 meses.

## Versiones en el sistema

Cada versión publicada se guarda completa en la tabla `avisos_privacidad`, con su huella SHA-256 y su fecha. Así se puede demostrar qué decía el aviso que aceptó cada cliente. Publicar una versión nueva:

- deja como faltante el aviso de todos los clientes que aceptaron la versión anterior (especificación §6);
- solo debe hacerse cuando el cambio lo requiera.

Corregir una errata sin cambiar el contenido no exige una versión nueva.
