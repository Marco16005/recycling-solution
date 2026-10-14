import { migrar } from "../src/datos/migrar";

const url = process.env.MIGRADOR_DATABASE_URL;
if (!url) {
  console.error("Falta MIGRADOR_DATABASE_URL");
  process.exit(1);
}

try {
  const { aplicadas } = await migrar(url);
  console.log(`Base al día: ${aplicadas} migraciones verificadas y permisos aplicados.`);
} catch (error) {
  console.error("No se pudo migrar:", error instanceof Error ? error.message : error);
  process.exit(1);
}
