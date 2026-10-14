import { toNextJsHandler } from "better-auth/next-js";
import { authDeLaAplicacion } from "@/seguridad/auth";

export async function GET(peticion: Request) {
  return toNextJsHandler(authDeLaAplicacion()).GET(peticion);
}

export async function POST(peticion: Request) {
  return toNextJsHandler(authDeLaAplicacion()).POST(peticion);
}
