import Link from "next/link";
import { LayoutDashboard, LogOut, Package } from "lucide-react";
import { sair } from "@/actions/auth";
import { AtualizaPeriodico } from "@/components/atualiza-periodico";
import { NavPortaria, type AbaPortaria } from "@/components/nav-portaria";
import { RelogioChip } from "@/components/relogio-chip";
import { TurnoDialog, type PorteiroOpcao, type TurnoAberto } from "@/components/turno-dialog";

/**
 * Casca da portaria (tablet do balcão, ~1180 px): cabeçalho de 72 px com logo,
 * abas, turno, data/hora e Sair. Server component — os pedaços interativos são
 * client (NavPortaria, TurnoDialog, RelogioChip, AtualizaPeriodico).
 *
 * `abaAtiva` é opcional: sem ele a aba vem da URL no cliente (o layout não
 * re-renderiza a cada navegação). Os contadores vêm do layout e se atualizam
 * por router.refresh (AtualizaPeriodico a cada 30 s e as actions que chamam
 * revalidatePath).
 */
export function ShellPortaria({
  turno,
  porteiros,
  contadores,
  abaAtiva,
  ehAdmin = false,
  children,
}: {
  turno: TurnoAberto | null;
  porteiros: PorteiroOpcao[];
  contadores: { aguardando: number; entreguesHoje: number };
  abaAtiva?: AbaPortaria;
  /** admin também abre o balcão: ganha o atalho de volta ao painel */
  ehAdmin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div data-shell="portaria" className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-card px-4 py-2 md:min-h-[72px] md:gap-x-4 md:px-6">
        <Link href="/portaria" className="flex items-center gap-2.5" aria-label="Portaria — Espaço Tangará">
          <span className="flex size-[38px] items-center justify-center rounded-[10px] bg-kraft text-white">
            <Package className="size-5" aria-hidden />
          </span>
          <span className="leading-[1.15]">
            <span className="block font-heading text-base font-semibold">Portaria</span>
            <span className="block text-xs text-ink-3">Espaço Tangará</span>
          </span>
        </Link>

        {/* celular: as abas descem para uma linha própria, com rolagem lateral se não couberem */}
        <div className="order-last w-full min-w-0 overflow-x-auto md:order-none md:ml-4 md:w-auto md:overflow-visible">
          <NavPortaria contadores={contadores} abaAtiva={abaAtiva} />
        </div>

        <span className="flex-1" />

        <TurnoDialog turno={turno} porteiros={porteiros} />
        <RelogioChip className="hidden min-[1060px]:inline-flex" />

        {ehAdmin && (
          <Link
            href="/admin"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-ink-2 transition-colors hover:bg-muted hover:text-ink"
            aria-label="Painel do administrador"
          >
            <LayoutDashboard className="size-5" aria-hidden />
            <span className="hidden xl:inline">Painel</span>
          </Link>
        )}

        <form action={sair}>
          <button
            type="submit"
            className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-ink-2 transition-colors hover:bg-muted hover:text-ink"
            aria-label="Sair"
          >
            <LogOut className="size-5" aria-hidden />
            <span className="hidden xl:inline">Sair</span>
          </button>
        </form>
      </header>

      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 px-4 py-5 md:px-6">{children}</main>

      <AtualizaPeriodico segundos={30} />
    </div>
  );
}
