import { describe, expect, it } from "vitest";
import { resolverEnlaceCorto } from "./enlaces";

// Plan CRM, §4.2: un enlace corto de Google Maps se sigue con redirect manual, hasta 3 saltos, 3 s y solo hosts de Google.

const redirigir = (mapa: Record<string, string>, pedidas: string[] = []) => (async (url: string | URL | Request) => {
  const u = String(url);
  pedidas.push(u);
  const destino = mapa[u];
  return destino ? new Response(null, { status: 302, headers: { location: destino } }) : new Response("ok", { status: 200 });
}) as typeof fetch;

describe("resolverEnlaceCorto", () => {
  it("sigue maps.app.goo.gl hasta el enlace largo con coordenadas", async () => {
    const f = redirigir({ "https://maps.app.goo.gl/abc": "https://www.google.com/maps/place/X/@20.62,-100.3,17z" });
    expect(await resolverEnlaceCorto("https://maps.app.goo.gl/abc", { fetch: f })).toEqual({ ok: true, url: "https://www.google.com/maps/place/X/@20.62,-100.3,17z" });
  });
  it("corta tras 3 saltos", async () => {
    const f = redirigir({
      "https://maps.app.goo.gl/a": "https://maps.app.goo.gl/b", "https://maps.app.goo.gl/b": "https://maps.app.goo.gl/c",
      "https://maps.app.goo.gl/c": "https://maps.app.goo.gl/d", "https://maps.app.goo.gl/d": "https://www.google.com/maps/@20.62,-100.3",
    });
    expect(await resolverEnlaceCorto("https://maps.app.goo.gl/a", { fetch: f })).toMatchObject({ ok: false });
  });
  it("no sigue ni consulta un dominio que no es de Google", async () => {
    const pedidas: string[] = [];
    const f = redirigir({ "https://maps.app.goo.gl/abc": "https://otro.example/x?q=20.62,-100.3" }, pedidas);
    expect(await resolverEnlaceCorto("https://maps.app.goo.gl/abc", { fetch: f })).toMatchObject({ ok: false });
    expect(pedidas).toEqual(["https://maps.app.goo.gl/abc"]);
    expect(await resolverEnlaceCorto("https://evil.example/maps.app.goo.gl/x", { fetch: f })).toMatchObject({ ok: false });
  });
  it("un servidor que no responde se corta en el plazo", async () => {
    const colgado = ((_: unknown, init?: RequestInit) => new Promise<Response>((_r, rechazar) => {
      init?.signal?.addEventListener("abort", () => rechazar(new DOMException("abortado", "AbortError")));
    })) as typeof fetch;
    const inicio = performance.now();
    expect(await resolverEnlaceCorto("https://maps.app.goo.gl/abc", { fetch: colgado, plazoMs: 50 })).toMatchObject({ ok: false });
    expect(performance.now() - inicio).toBeLessThan(1000);
  });
});
