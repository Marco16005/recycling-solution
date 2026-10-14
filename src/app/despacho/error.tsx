"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

export default function ErrorDespacho({ retry }: { retry: () => void }) {
  return (
    <section role="alert" className="space-y-4 py-12">
      <h1 className="text-2xl font-semibold">No pudimos cargar esta pantalla</h1>
      <p className="text-sm text-muted-foreground">Revisa la conexión y vuelve a intentarlo.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={retry}>Reintentar</Button>
        <Link href="/despacho/clientes" className={buttonVariants({ variant: "outline" })}>Volver a clientes</Link>
      </div>
    </section>
  );
}
