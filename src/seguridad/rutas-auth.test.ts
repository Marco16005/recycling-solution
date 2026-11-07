import { describe, expect, it } from "vitest";
import { rutaPermitida } from "./rutas-auth";

const pide = (metodo: string, ruta: string) => rutaPermitida(new Request(`http://localhost:3000${ruta}`, { method: metodo }));

describe("rutas de Better Auth que pasan por manejar", () => {
  it("pasan solo entrar, salir y leer la sesión, con su método", () => {
    expect(pide("POST", "/api/auth/sign-in/email")).toBe(true);
    expect(pide("POST", "/api/auth/sign-in/email?x=1")).toBe(true);
    expect(pide("POST", "/api/auth/sign-out")).toBe(true);
    expect(pide("GET", "/api/auth/get-session")).toBe(true);
  });

  it.each([
    ["GET", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/get-session"],
    ["POST", "/api/auth/sign-up/email"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/auth/update-user"],
    ["POST", "/api/auth/revoke-sessions"],
    ["GET", "/api/auth/list-sessions"],
    ["POST", "/api/auth/sign-in/email/"],
    ["POST", "/api/auth/sign-in/email////"],
    ["POST", "/api/auth//sign-in/email"],
    ["POST", "/api/auth/SIGN-IN/EMAIL"],
    ["POST", "/api/auth/sign-in%2Femail"],
    ["POST", "/api/auth/sign-in/%65mail"],
    ["POST", "/api/auth"],
    ["POST", "/api/authsign-in/email"],
    ["POST", "/otra/api/auth/sign-in/email"],
  ])("%s %s responde 404", (metodo, ruta) => {
    expect(pide(metodo, ruta)).toBe(false);
  });
});
