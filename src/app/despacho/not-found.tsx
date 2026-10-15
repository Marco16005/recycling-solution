import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function RegistroNoEncontrado() {
  return (
    <section className="space-y-4 py-12">
      <h1 className="text-2xl font-semibold">Registro no encontrado</h1>
      <p className="text-sm text-muted-foreground">El registro no está disponible o el enlace no es válido.</p>
      <Link href="/despacho/clientes" className={buttonVariants({ variant: "outline" })}>Volver a despacho</Link>
    </section>
  );
}
