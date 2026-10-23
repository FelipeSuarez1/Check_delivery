import Link from "next/link";
import { ArrowRightLeft, LogOut, Package } from "lucide-react";
import { sair } from "@/actions/auth";
import { NavAdmin } from "@/components/nav-admin";

/**
 * Casca do administrador (síndico/Felipe/Achilles): barra superior simples com
 * os cadastros, "Ir para a portaria" (admin também opera o balcão) e Sair.
 * Em tela estreita a navegação desce para uma segunda linha com rolagem lateral.
 */
export function ShellAdmin({ nome, children }: { nome: string; children: React.ReactNode }) {
  return (
    <div data-shell="admin" className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-card">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 md:px-6">
          <Link href="/admin" className="flex min-h-11 items-center gap-2.5" aria-label="Administração — Espaço Tangará">
            <span className="flex size-[38px] items-center justify-center rounded-[10px] bg-ink text-white">
              <Package className="size-5" aria-hidden />
            </span>
            <span className="leading-[1.15]">
              <span className="block font-heading text-base font-semibold">Administração</span>
              <span className="block text-xs text-ink-3">Encomendas · Espaço Tangará</span>
            </span>
          </Link>

          <div className="order-last w-full min-w-0 lg:order-none lg:ml-2 lg:w-auto lg:flex-1">
            <NavAdmin />
          </div>

          <span className="hidden text-sm text-ink-3 xl:inline">{nome}</span>

          <Link
            href="/portaria"
            className="ml-auto inline-flex h-11 items-center gap-2 rounded-[10px] border border-line bg-card px-3.5 text-sm font-semibold transition-colors hover:bg-muted lg:ml-0"
          >
            <ArrowRightLeft className="size-4" aria-hidden />
            Ir para a portaria
          </Link>

          <form action={sair}>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-ink-2 transition-colors hover:bg-muted hover:text-ink"
            >
              <LogOut className="size-4" aria-hidden />
              Sair
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 px-4 py-5 md:px-6">{children}</main>
    </div>
  );
}
