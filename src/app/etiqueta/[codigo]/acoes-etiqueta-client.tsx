"use client";

/**
 * Botões da página de etiqueta (somem na impressão): Imprimir (window.print) e
 * Voltar (histórico; se a página foi aberta direto, vai para `voltarPara`).
 * Cores com fallback em hex: a página de impressão não depende dos tokens globais.
 */
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";

export function AcoesEtiquetaClient({ voltarPara }: { voltarPara: string }) {
  const router = useRouter();
  const base =
    "inline-flex h-12 items-center justify-center gap-2 rounded-[10px] border px-5 text-[15px] font-semibold transition-colors";
  return (
    <>
      <button
        type="button"
        onClick={() => window.print()}
        className={`${base} border-[var(--kraft,#C47A2C)] bg-[var(--kraft,#C47A2C)] text-white hover:opacity-90`}
      >
        <Printer className="size-[18px]" aria-hidden /> Imprimir
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.history.length > 1) router.back();
          else router.push(voltarPara);
        }}
        className={`${base} border-[var(--line,#E6E1D8)] bg-white text-[var(--ink,#1F1D1A)] hover:bg-[#F6F3EC]`}
      >
        <ArrowLeft className="size-[18px]" aria-hidden /> Voltar
      </button>
    </>
  );
}
