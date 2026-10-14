import { marked } from "marked";
import Link from "next/link";
import { Suspense } from "react";
import { avisoVigente, historialAvisos } from "@/consultas/aviso";

const fecha = (d: Date) => d.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long" });

/** Lee la base; por eso va dentro de <Suspense>. El texto lo publica scripts/publicar-aviso.mts (no lo escribe rs_app). */
async function Aviso() {
  const [vigente, historial] = await Promise.all([avisoVigente(), historialAvisos()]);
  if (vigente === null) {
    return <p>El aviso de privacidad aún no se ha publicado. Pídelo en el domicilio de la empresa.</p>;
  }
  return (
    <>
      <p className="text-sm text-muted-foreground">Versión {vigente.version}, publicada el {fecha(vigente.publicadoEn)}.</p>
      <article
        className="prose prose-neutral max-w-none text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_table]:my-4 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_th]:text-left [&_ul]:list-disc"
        dangerouslySetInnerHTML={{ __html: await marked.parse(vigente.texto) }}
      />
      {historial.length > 1 && (
        <section className="mt-10 space-y-2 text-sm">
          <h2 className="font-semibold">Versiones anteriores</h2>
          <ul className="list-disc pl-5">
            {historial.slice(1).map((v) => <li key={v.version}>Versión {v.version}, publicada el {fecha(v.publicadoEn)}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}

export default function PaginaAviso() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-6">
      <Link href="/entrar" className="text-sm text-muted-foreground hover:underline">Recycling Solution</Link>
      <Suspense fallback={<p role="status">Cargando el aviso…</p>}>
        <Aviso />
      </Suspense>
    </main>
  );
}
