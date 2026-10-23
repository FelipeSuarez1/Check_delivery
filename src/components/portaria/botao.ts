/**
 * Classes dos botões do mockup (`.btn`): 48 px, ou 60 px com `grande`. Serve a
 * <Link>, <a> e <button> (server e client). Alvo de toque nunca abaixo de 48 px.
 *
 *   padrao  - branco com borda            primary - kraft (ação principal)
 *   ok      - verde cheio (confirmar)     okLinha - verde só no contorno (WhatsApp)
 *   escuro  - tinta (OK do teclado)       fantasma - transparente com borda
 *   perigo  - contorno vermelho (cancelar)
 */
import { cn } from "@/lib/utils";

export type VarianteBotao = "padrao" | "primary" | "ok" | "okLinha" | "escuro" | "fantasma" | "perigo";

const VARIANTES: Record<VarianteBotao, string> = {
  padrao: "border-line bg-card text-ink hover:bg-muted",
  primary: "border-kraft bg-kraft text-white hover:border-kraft-ink hover:bg-kraft-ink",
  ok: "border-ok bg-ok text-white hover:brightness-95",
  okLinha: "border-ok bg-card text-ok hover:bg-ok-soft",
  escuro: "border-ink bg-ink text-white hover:bg-ink-2",
  fantasma: "border-line bg-transparent text-ink hover:bg-muted",
  perigo: "border-warn/40 bg-card text-warn hover:bg-warn-soft",
};

export function classeBotao(
  opcoes: { variante?: VarianteBotao; grande?: boolean; bloco?: boolean; className?: string } = {}
): string {
  const { variante = "padrao", grande = false, bloco = false, className } = opcoes;
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap border font-semibold transition-colors",
    "[&_svg]:size-[18px] [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60",
    "outline-none focus-visible:ring-3 focus-visible:ring-kraft/40",
    grande ? "h-[60px] rounded-xl px-6 text-[17px]" : "h-12 rounded-[10px] px-[18px] text-[15px]",
    bloco && "w-full",
    VARIANTES[variante],
    className
  );
}

/** Segmentado do mockup (`.seg`): contêiner + item. */
export const CLASSE_SEG = "inline-flex gap-0.5 rounded-[10px] border border-line bg-card p-[3px]";

export function classeSegItem(ligado: boolean): string {
  return cn(
    "inline-flex h-11 items-center justify-center whitespace-nowrap rounded-lg px-3.5 font-semibold transition-colors",
    ligado ? "bg-ink text-white" : "text-ink-2 hover:bg-muted hover:text-ink"
  );
}
