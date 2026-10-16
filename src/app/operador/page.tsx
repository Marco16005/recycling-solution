import { Suspense } from "react";
import { usuarioDeLaSesion } from "@/consultas/sesion";
import { miRutaConsulta } from "@/consultas/operador";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { MiRuta } from "@/components/operador/mi-ruta";
async function Contenido() {
  const usuario = await usuarioDeLaSesion();
  if (!usuario) return null;
  const resultado = await miRutaConsulta();
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  return <MiRuta usuarioId={usuario.id} inicial={resultado.valor} />;
}
export default function Pagina() {
  return <Suspense fallback={<p role="status">Cargando mi ruta…</p>}><Contenido /></Suspense>;
}
