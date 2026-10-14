// Publica una versión nueva del aviso de privacidad integral (docs/legal/README.md):
//   docker compose run --rm migrate npm run publicar-aviso -- --version 2026-11-01 --motivo "Primera publicación"
// Toma los datos de la empresa de las variables AVISO_* (.env) y quién publica de PUBLICADO_POR.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CAMPOS_AVISO, llenarPlantilla, publicarAviso } from "../src/datos/avisos";
import { fechaEnMexico } from "../src/dominio/tiempo";
import { ejecutar } from "./comun";

await ejecutar(async () => {
  const { values } = parseArgs({ options: { version: { type: "string" }, motivo: { type: "string" } } });
  if (!values.version || !values.motivo) throw new Error('Uso: publicar-aviso --version AAAA-MM-DD --motivo "…"');
  const url = process.env.MIGRADOR_DATABASE_URL;
  if (!url) throw new Error("Falta MIGRADOR_DATABASE_URL (corre el script en el servicio migrate)");
  const publicadoPor = process.env.PUBLICADO_POR?.trim();
  if (!publicadoPor) throw new Error("Falta PUBLICADO_POR: nombre de quien publica");

  const valores = Object.fromEntries(CAMPOS_AVISO.map((c) => [c, process.env[`AVISO_${c}`]]));
  const plantilla = readFileSync("docs/legal/aviso-de-privacidad-integral.md", "utf8");
  const texto = llenarPlantilla(plantilla, values.version, fechaEnMexico(new Date()), valores);
  const { huella } = await publicarAviso(url, { version: values.version, texto, motivo: values.motivo, publicadoPor });
  console.log(`Aviso ${values.version} publicado y vigente. Huella SHA-256: ${huella}`);
  console.log("Las aceptaciones de versiones anteriores dejan de contar: avisa a los contactos de los clientes.");
});
