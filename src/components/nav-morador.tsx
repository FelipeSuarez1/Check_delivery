"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUser, History, Package } from "lucide-react";

export type AbaMorador = "portaria" | "historico" | "conta";

/**
 * Navegação inferior do morador (3 itens). Como no cabeçalho da portaria, o item
 * ativo sai da URL no cliente: o layout não re-renderiza a cada navegação.
 * `ativo` (opcional) força o valor. Detalhe de encomenda conta como "Na portaria".
 */
export function NavMorador({
  apartamentoNumero,
  aguardando,
  ativo,
}: {
  apartamentoNumero: string | null;
  aguardando: number;
  ativo?: AbaMorador;
}) {
  const pathname = usePathname();
  const derivado: AbaMorador = pathname.startsWith("/app/historico")
    ? "historico"
    : pathname.startsWith("/app/conta")
      ? "conta"
      : "portaria";
  const atual = ativo ?? derivado;

  const itens: {
    chave: AbaMorador;
    href: string;
    rotulo: string;
    Icone: typeof Package;
    badge?: number;
  }[] = [
    { chave: "portaria", href: "/app", rotulo: "Na portaria", Icone: Package, badge: aguardando },
    { chave: "historico", href: "/app/historico", rotulo: "Histórico", Icone: History },
    {
      chave: "conta",
      href: "/app/conta",
      rotulo: apartamentoNumero ? `Apto ${apartamentoNumero}` : "Conta",
      Icone: CircleUser,
    },
  ];

  return (
    <nav
      aria-label="Navegação do morador"
      className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-[390px] -translate-x-1/2 border-t border-line bg-card px-2 pt-1.5 pb-[max(14px,env(safe-area-inset-bottom))]"
    >
      {itens.map(({ chave, href, rotulo, Icone, badge }) => {
        const ligado = atual === chave;
        return (
          <Link
            key={chave}
            href={href}
            aria-current={ligado ? "page" : undefined}
            className={
              "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[10px] py-2 text-[11px] font-semibold " +
              (ligado ? "text-kraft-ink" : "text-ink-3 hover:text-ink-2")
            }
          >
            <Icone className="size-[22px]" aria-hidden />
            {rotulo}
            {badge !== undefined && badge > 0 && (
              <span
                className="absolute left-[calc(50%+6px)] top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-kraft px-[5px] text-[11px] text-white tabular-nums"
                aria-label={`${badge} na portaria`}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
