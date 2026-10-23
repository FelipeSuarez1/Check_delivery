/**
 * Só para o ADMIN: ele não tem apartamento na sessão, então a área do morador
 * pede qual apartamento conferir (`?apto=11A`). Formulário GET — nada é gravado.
 * Para o morador o parâmetro é ignorado (o apto vem sempre da sessão).
 */
import { Search } from "lucide-react";

export function EscolherApartamento({ rota, secao = false }: { rota: string; secao?: boolean }) {
  const Titulo = secao ? "h2" : "h1";
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-line bg-card p-4">
      <div>
        <p className="eyebrow">Visão do administrador</p>
        <Titulo className="text-[22px]">Qual apartamento?</Titulo>
      </div>
      <p className="text-[13px] text-ink-2">
        Você está na área do morador. Digite o apartamento para ver as telas como ele vê (ex.: 11A).
      </p>
      <form method="get" action={rota} role="search" className="flex gap-2">
        <input
          type="text"
          name="apto"
          required
          maxLength={4}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="11A"
          aria-label="Número do apartamento"
          className="h-12 min-w-0 flex-1 rounded-[10px] border border-input bg-card px-3.5 font-mono text-base uppercase tracking-[.06em] outline-none focus-visible:border-kraft focus-visible:ring-2 focus-visible:ring-kraft/40"
        />
        <button
          type="submit"
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-kraft bg-kraft px-4 font-semibold text-white hover:opacity-90"
        >
          <Search className="size-[18px]" aria-hidden />
          Ver
        </button>
      </form>
    </section>
  );
}
