import { AtualizaPeriodico } from "@/components/atualiza-periodico";
import { NavMorador, type AbaMorador } from "@/components/nav-morador";

/**
 * Casca do morador (celular, 390 px úteis centralizados em telas largas) com
 * navegação inferior fixa de 3 itens. Server component; a navegação é client
 * (item ativo derivado da URL). `apartamentoNumero` é null só para o admin
 * olhando a área do morador (sem apartamento na sessão).
 */
export function ShellMorador({
  apartamentoNumero,
  aguardando,
  ativo,
  children,
}: {
  apartamentoNumero: string | null;
  aguardando: number;
  ativo?: AbaMorador;
  children: React.ReactNode;
}) {
  return (
    <div data-shell="morador" className="min-h-dvh">
      <div className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col sm:border-x sm:border-line">
        <main className="flex flex-1 flex-col gap-3.5 px-[18px] pt-5 pb-[calc(92px+env(safe-area-inset-bottom))]">
          {children}
        </main>
        <NavMorador apartamentoNumero={apartamentoNumero} aguardando={aguardando} ativo={ativo} />
        <AtualizaPeriodico segundos={60} />
      </div>
    </div>
  );
}
