import { describe, expect, it } from "vitest";
import { ENCABEZADOS_FIJOS, encabezadosDinamicos, origenDe, politicaDeContenido } from "./encabezados";

const directiva = (politica: string, nombre: string) =>
  politica.split("; ").find((d) => d.split(" ")[0] === nombre);

describe("encabezados de seguridad (Plan de seguridad, S5)", () => {
  it("permite el mapa por omisión y nada externo más", () => {
    const politica = politicaDeContenido({});
    expect(directiva(politica, "default-src")).toBe("default-src 'self'");
    expect(directiva(politica, "connect-src")).toBe("connect-src 'self' https://tiles.openfreemap.org");
    expect(directiva(politica, "img-src")).toBe("img-src 'self' data: blob: https://tiles.openfreemap.org");
    expect(directiva(politica, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(directiva(politica, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directiva(politica, "object-src")).toBe("object-src 'none'");
    expect(directiva(politica, "form-action")).toBe("form-action 'self'");
    expect(directiva(politica, "upgrade-insecure-requests")).toBeUndefined();
  });

  it("usa solo el origen del estilo configurado, sin ruta ni consulta", () => {
    const politica = politicaDeContenido({ MAPA_ESTILO_URL: "http://teselas.local:8080/estilo.json?v=1" });
    expect(directiva(politica, "connect-src")).toBe("connect-src 'self' http://teselas.local:8080");
  });

  it("ignora un estilo que no es http(s) o no es URL, sin abrir la política", () => {
    for (const malo of ["javascript:alert(1)", "data:text/plain,x", "no es url; script-src *"]) {
      const politica = politicaDeContenido({ MAPA_ESTILO_URL: malo });
      expect(directiva(politica, "connect-src")).toBe("connect-src 'self'");
      expect(politica).not.toContain("*");
    }
  });

  it("agrega eval solo en desarrollo", () => {
    expect(directiva(politicaDeContenido({ NODE_ENV: "development" }), "script-src")).toContain("'unsafe-eval'");
    expect(directiva(politicaDeContenido({ NODE_ENV: "production" }), "script-src")).not.toContain("'unsafe-eval'");
  });

  it("con https agrega HSTS y la mejora de peticiones inseguras; con http no", () => {
    const https = new Map(encabezadosDinamicos({ BETTER_AUTH_URL: "https://203-0-113-7.sslip.io" }));
    expect(https.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(https.get("Content-Security-Policy")).toContain("upgrade-insecure-requests");
    const http = new Map(encabezadosDinamicos({ BETTER_AUTH_URL: "http://localhost:3000" }));
    expect(http.has("Strict-Transport-Security")).toBe(false);
    expect(http.get("Content-Security-Policy")).not.toContain("upgrade-insecure-requests");
  });

  it("origenDe rechaza lo que no es URL http(s)", () => {
    expect(origenDe("https://a.b/c")).toBe("https://a.b");
    expect(origenDe("ftp://a.b")).toBeNull();
    expect(origenDe(undefined)).toBeNull();
  });

  it("los fijos prohíben marcos, adivinar tipos y permisos del navegador", () => {
    const fijos = new Map(ENCABEZADOS_FIJOS.map((e) => [e.key, e.value]));
    expect(fijos.get("X-Frame-Options")).toBe("DENY");
    expect(fijos.get("X-Content-Type-Options")).toBe("nosniff");
    expect(fijos.get("Permissions-Policy")).toContain("geolocation=()");
  });
});
