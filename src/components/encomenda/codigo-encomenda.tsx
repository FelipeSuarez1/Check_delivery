/**
 * <CodigoEncomenda codigo size? className? />  (22/10/2026)
 * O código da encomenda em mono com letter-spacing .06em, cor kraft-ink.
 *  - codigo: "K7M3"
 *  - size: "sm" (14 px) | "md" (22 px, cartões - padrão) | "lg" (40 px) | "xl" (72 px, tela do código gerado)
 *  - className: sobrescreve cor/margens (ex. "text-ink")
 * Leitor de tela soletra o código letra a letra.
 */
import { cn } from "@/lib/utils";

const TAMANHOS = {
  sm: "text-sm",
  md: "text-[22px]",
  lg: "text-[40px]",
  xl: "text-[72px]",
} as const;

export type TamanhoCodigo = keyof typeof TAMANHOS;

export function CodigoEncomenda({
  codigo,
  size = "md",
  className,
}: {
  codigo: string;
  size?: TamanhoCodigo;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono font-semibold leading-none tracking-[.06em] text-kraft-ink",
        TAMANHOS[size],
        className
      )}
    >
      <span aria-hidden="true">{codigo}</span>
      <span className="sr-only">{codigo.split("").join(" ")}</span>
    </span>
  );
}
