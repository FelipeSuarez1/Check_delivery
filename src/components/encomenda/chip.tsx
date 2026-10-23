/**
 * <Chip selected? onClick disabled?>texto</Chip>  (22/10/2026)
 * Chip de 36 px (mockup) com área de toque de 44 px (o pseudo-elemento estende
 * 4 px acima e abaixo sem mudar o visual). Base de ChipsTipo, ChipsTransportadora
 * e SeletorMoradores. Sem estado próprio: serve a server e client components.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Chip({
  selected = false,
  onClick,
  disabled,
  children,
  className,
  title,
}: {
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  /** dica ao passar o mouse (no tablet o aviso precisa estar também no conteúdo do chip) */
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        "relative inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
        "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
        "disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "border-ink bg-ink text-white"
          : "border-line bg-card text-ink hover:border-kraft hover:text-kraft-ink",
        className
      )}
    >
      {children}
    </button>
  );
}
