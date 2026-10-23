/**
 * Peças visuais compartilhadas das telas de /admin (23/10/2026). Sem estado e
 * sem "use client": servem a server e client components. Alvos de toque 44 px.
 */
import type { ReactNode } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Cartão padrão (papel branco com filete). */
export const CARTAO = "rounded-[14px] border border-line bg-card";

const BTN_BASE =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] border px-4 text-sm font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55";
export const BTN_PRIMARIO = `${BTN_BASE} border-kraft bg-kraft text-white hover:opacity-90`;
export const BTN_SECUNDARIO = `${BTN_BASE} border-line bg-card text-ink hover:bg-muted`;
export const BTN_PERIGO = `${BTN_BASE} border-warn bg-warn text-white hover:opacity-90`;
export const BTN_ESCURO = `${BTN_BASE} border-ink bg-ink text-white hover:opacity-90`;
/** Botão só com ícone: 44 × 44. */
export const BTN_ICONE =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-2 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-2";

/** Campo de formulário: altura 44, borda firme, mesmo desenho do login. */
export const CAMPO = "h-11 rounded-[10px] bg-card px-3 text-base md:text-sm";
export const ROTULO_CAMPO = "text-[13px] font-semibold text-ink-2";
/** <select> nativo (lista longa de aptos funciona melhor no celular do que um popup). */
export const SELECT_NATIVO =
  "h-11 rounded-[10px] border border-input bg-card px-3 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
/** Idem, ocupando a largura do campo (formulários e diálogos). */
export const SELECT_CHEIO = `${SELECT_NATIVO} w-full`;

/** Título de página + subtítulo + ação à direita. */
export function CabecalhoPagina({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl leading-tight font-semibold">{titulo}</h1>
        {descricao && <p className="mt-1 max-w-3xl text-sm text-ink-2">{descricao}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Aviso de erro (role=alert), no mesmo tom do login. */
export function AvisoErro({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-[10px] border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn",
        className
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Aviso de sucesso (role=status). */
export function AvisoOk({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-[10px] border border-ok/30 bg-ok-soft px-3 py-2.5 text-sm text-ok",
        className
      )}
    >
      <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Caixa tracejada de "nada por aqui". */
export function EstadoVazio({ icone, children }: { icone?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-line px-4 py-10 text-center text-sm text-ink-2">
      {icone}
      <div className="max-w-md">{children}</div>
    </div>
  );
}

/** Pílula pequena de situação (Ativo, Inativo, Pendente…). */
const TONS_SELO = {
  ok: "bg-ok-soft text-ok",
  aviso: "bg-warn-soft text-warn",
  kraft: "bg-kraft-soft text-kraft-ink",
  info: "bg-info-soft text-info",
  neutro: "bg-muted text-ink-2",
} as const;

export function Selo({
  tom = "neutro",
  children,
  className,
}: {
  tom?: keyof typeof TONS_SELO;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold whitespace-nowrap",
        TONS_SELO[tom],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Tabela larga com rolagem PRÓPRIA (a página nunca rola de lado). */
export function TabelaRolavel({
  children,
  className,
  larguraMin = "min-w-max",
}: {
  children: ReactNode;
  className?: string;
  /** classe de largura mínima da tabela: padrão = conteúdo sem quebra; use um valor fixo quando houver coluna de texto longo que deve quebrar */
  larguraMin?: string;
}) {
  return (
    <div className={cn("overflow-x-auto [contain:layout]", className)}>
      <table className={cn("w-full text-sm", larguraMin)}>{children}</table>
    </div>
  );
}

export const TH = "px-3 py-2.5 text-left text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase whitespace-nowrap";
export const TD = "px-3 py-2.5 align-middle";

/** Chip-link de filtro (36 px visuais, 44 de toque). */
export const CHIP_FILTRO =
  "relative inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";
export const CHIP_FILTRO_ON = "border-ink bg-ink text-white";
export const CHIP_FILTRO_OFF = "border-line bg-card text-ink hover:border-kraft hover:text-kraft-ink";
