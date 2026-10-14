import { createHash } from "node:crypto";
import { Client } from "pg";

/** Campos de la plantilla del aviso que llena la empresa; cada uno se toma de la variable AVISO_<CAMPO>. */
export const CAMPOS_AVISO = [
  "RAZON_SOCIAL", "DOMICILIO", "NOMBRE_RESPONSABLE_DATOS", "CORREO_PRIVACIDAD", "TELEFONO_PRIVACIDAD", "HORARIO_ATENCION",
  "PROVEEDOR_HOSPEDAJE", "PROVEEDOR_RESPALDOS", "PROVEEDOR_MAPAS", "URL_AVISO",
  "PLAZO_CLIENTES", "PLAZO_ACEPTACIONES", "PLAZO_USUARIOS", "PLAZO_OPERADORES", "PLAZO_BITACORA", "PLAZO_RUTAS",
] as const;

const VERSION = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Llena la plantilla: quita la nota inicial de plantilla (bloque que empieza con "> **Plantilla.**"), pone versión y fecha
 * y reemplaza cada {{CAMPO}}. Lanza un error si falta un valor o si queda algún campo sin llenar.
 */
export function llenarPlantilla(plantilla: string, version: string, fechaVigencia: string, valores: Partial<Record<string, string>>): string {
  if (!VERSION.test(version)) throw new Error("La versión debe tener el formato AAAA-MM-DD");
  const faltan = CAMPOS_AVISO.filter((c) => !valores[c]?.trim());
  if (faltan.length > 0) throw new Error(`Faltan datos del aviso: ${faltan.map((c) => `AVISO_${c}`).join(", ")}`);
  const sinNota = plantilla.replace(/^> \*\*Plantilla\.\*\*.*\n(?:>.*\n)*\n?/m, "");
  const texto = sinNota
    .replaceAll("{{VERSION_AVISO}}", version)
    .replaceAll("{{FECHA_VIGENCIA}}", fechaVigencia)
    .replace(/\{\{([A-Z_]+)\}\}/g, (todo, campo: string) => valores[campo]?.trim() ?? todo);
  const pendientes = texto.match(/\{\{[A-Z_]+\}\}/g);
  if (pendientes) throw new Error(`Quedaron campos sin llenar: ${[...new Set(pendientes)].join(", ")}`);
  return texto;
}

/**
 * Publica una versión nueva del aviso como rs_migrador, en una transacción que bloquea la configuración:
 * inserta la versión con su texto y huella, la hace vigente y deja bitácora. Nunca modifica una versión existente.
 */
export async function publicarAviso(
  url: string,
  datos: { version: string; texto: string; motivo: string; publicadoPor: string },
): Promise<{ huella: string }> {
  const huella = createHash("sha256").update(datos.texto).digest("hex");
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT id FROM configuracion WHERE id = 1 FOR UPDATE");
    const existe = await cliente.query("SELECT 1 FROM avisos_privacidad WHERE version = $1", [datos.version]);
    if (existe.rowCount) throw new Error(`La versión ${datos.version} ya existe; las versiones publicadas no se modifican`);
    await cliente.query(
      "INSERT INTO avisos_privacidad (version, descripcion, huella_sha256, texto) VALUES ($1, $2, $3, $4)",
      [datos.version, `${datos.motivo} (publicó: ${datos.publicadoPor})`, huella, datos.texto],
    );
    await cliente.query(
      "UPDATE configuracion SET version_aviso_privacidad = $1, version = version + 1, actualizado_en = now() WHERE id = 1",
      [datos.version],
    );
    await cliente.query(
      "INSERT INTO bitacora (entidad, accion, campos) VALUES ('aviso_privacidad', 'publicar_por_script', ARRAY['version', 'texto'])",
    );
    await cliente.query("COMMIT");
    return { huella };
  } catch (error) {
    await cliente.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await cliente.end();
  }
}
