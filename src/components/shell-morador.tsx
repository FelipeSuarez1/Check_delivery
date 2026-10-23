import { AtualizaPeriodico } from "@/components/atualiza-periodico";
import { EscutaInstalacao } from "@/components/instalar-app-estado";
import { NavMorador, type AbaMorador } from "@/components/nav-morador";

/**
 * Casca do morador (celular, 390 px úteis centralizados em telas largas, fundo
 * paper) com navegação inferior fixa de 3 itens. Server component; a navegação é
 * client (item ativo derivado da URL). `apartamentoNumero` é null só para o admin
 * olhando a área do morador (sem apartamento na sessão).
 *
 * iPhone instalado (viewport-fit=cover): o conteúdo respeita o recorte do topo
 * (`safe-area-inset-top`) e o nav inferior a barra de gestos (`safe-area-inset-bottom`,
 * dentro do próprio nav). O padding de baixo do conteúdo reserva a altura do nav.
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
        <main className="flex flex-1 flex-col gap-3.5 px-[18px] pt-[max(20px,env(safe-area-inset-top))] pb-[calc(92px+env(safe-area-inset-bottom))]">
          {children}
        </main>
        <NavMorador apartamentoNumero={apartamentoNumero} aguardando={aguardando} ativo={ativo} />
        <AtualizaPeriodico segundos={60} />
        <EscutaInstalacao />
      </div>
    </div>
  );
}
