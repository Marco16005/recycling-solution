/**
 * Genera los íconos rasterizados a partir de src/app/icon.svg, que es la fuente (pendiente del 2026-11-07):
 * - src/app/favicon.ico: 16, 32 y 48 px, PNG dentro de ICO (lo leen todos los navegadores actuales);
 * - src/app/apple-icon.png: 180 px y sin transparencia, porque iOS pinta de negro lo transparente al agregar
 *   /operador a la pantalla de inicio.
 * Next sirve los tres por convención de nombres (src/app/icon.svg, favicon.ico y apple-icon.png).
 *
 * Corre en contenedor, con el sharp que ya instala Next para optimizar imágenes:
 *   docker compose -f compose.yaml -f compose.test.yaml run --rm unit npm run iconos
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const FUENTE = "src/app/icon.svg";
/** El verde del fondo del ícono: rellena las esquinas redondeadas en el ícono de iOS, que las recorta solo. */
const FONDO = "#15803d";
const svg = readFileSync(FUENTE);

/** Se dibuja a cuatro veces el tamaño y se reduce, para bordes suaves también en 16 px. */
function png(lado: number): Promise<Buffer> {
  return sharp(svg, { density: ((72 * lado) / 100) * 4 }).resize(lado, lado).png({ compressionLevel: 9 }).toBuffer();
}

/** Archivo ICO con imágenes PNG: cabecera de 6 bytes, una entrada de 16 bytes por imagen y luego los PNG. */
function ico(imagenes: { lado: number; datos: Buffer }[]): Buffer {
  const cabecera = Buffer.alloc(6 + 16 * imagenes.length);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(imagenes.length, 4);
  let desplazamiento = cabecera.length;
  imagenes.forEach(({ lado, datos }, i) => {
    const e = 6 + 16 * i;
    cabecera.writeUInt8(lado, e);
    cabecera.writeUInt8(lado, e + 1);
    cabecera.writeUInt16LE(1, e + 4);
    cabecera.writeUInt16LE(32, e + 6);
    cabecera.writeUInt32LE(datos.length, e + 8);
    cabecera.writeUInt32LE(desplazamiento, e + 12);
    desplazamiento += datos.length;
  });
  return Buffer.concat([cabecera, ...imagenes.map((i) => i.datos)]);
}

const favicon = await Promise.all([16, 32, 48].map(async (lado) => ({ lado, datos: await png(lado) })));
writeFileSync("src/app/favicon.ico", ico(favicon));
writeFileSync("src/app/apple-icon.png", await sharp(await png(180)).flatten({ background: FONDO }).png({ compressionLevel: 9 }).toBuffer());
console.log(`Íconos generados desde ${FUENTE}: src/app/favicon.ico (16, 32 y 48 px) y src/app/apple-icon.png (180 px).`);
