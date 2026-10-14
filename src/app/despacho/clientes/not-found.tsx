import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function ClienteNoEncontrado() {
  return (
    <section className="space-y-4 py-12">
      <h1 className="text-2xl font-semibold">Cliente no encontrado</h1>
      <p className="text-sm text-muted-foreground">
        La ficha ya no está disponible o el enlace no corresponde a un cliente.
      </p>
      <Link href="/despacho/clientes" className={buttonVariants({ variant: "outline" })}>
        Volver a clientes
      </Link>
    </section>
  );
}
