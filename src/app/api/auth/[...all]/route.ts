import { manejarPeticionDeAuth } from "@/seguridad/auth";

export async function GET(peticion: Request) {
  return manejarPeticionDeAuth(peticion);
}

export async function POST(peticion: Request) {
  return manejarPeticionDeAuth(peticion);
}
