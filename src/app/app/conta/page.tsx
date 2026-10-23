import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, KeyRound, LogOut, User } from "lucide-react";
import { sair } from "@/actions/auth";
import { exigirPapelNaPagina } from "@/lib/auth";
import { apartamentoDaTela, moradoresDoApartamento } from "@/lib/morador";
import { InstalarApp } from "@/components/instalar-app-client";
import { EscolherApartamento } from "../_componentes/escolher-apartamento";

export const metadata: Metadata = { title: "Conta" };

/**
 * Conta do apartamento: quem mora (só nomes), trocar a senha, instalar o app e
 * sair. Nada aqui grava dado de encomenda; "Sair" e a troca de senha são as
 * únicas ações. O admin sem `?apto=` vê só o próprio acesso.
 */
export default async function ContaPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const sessao = await exigirPapelNaPagina("morador", "admin");
  const sp = await searchParams;
  const apto = await apartamentoDaTela(sessao, sp.apto);
  if (!apto && sessao.papel !== "admin") notFound();

  const nomes = apto ? await moradoresDoApartamento(apto.id) : [];

  return (
    <>
      <div>
        <div className="eyebrow">{apto ? "Espaço Tangará" : "Administrador"}</div>
        <h1 className="text-[22px]">{apto ? `Apto ${apto.numero}` : sessao.nome}</h1>
      </div>

      {apto ? (
        <section aria-label="Moradores" className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-card p-4">
          <span className="eyebrow">Moradores</span>
          {nomes.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {nomes.map((n, i) => (
                <li key={`${n}-${i}`} className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper text-ink-2">
                    <User className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 font-medium">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Nenhum morador cadastrado neste apartamento.</p>
          )}
          <p className="text-xs text-ink-3">
            Todos do apartamento veem as mesmas encomendas. Para mudar quem aparece aqui, fale com a administração.
          </p>
        </section>
      ) : (
        <EscolherApartamento rota="/app/conta" secao />
      )}

      <Link
        href="/conta/senha"
        className="flex min-h-14 items-center gap-3 rounded-[14px] border border-line bg-card px-4 py-3 hover:border-kraft"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-paper text-ink-2">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Trocar senha</span>
          <span className="block text-[13px] text-ink-2">Escolha uma senha só sua para este apartamento.</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
      </Link>

      <InstalarApp />

      <form action={sair}>
        <button
          type="submit"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-line bg-card px-4 font-semibold hover:border-warn hover:text-warn"
        >
          <LogOut className="size-[18px]" aria-hidden />
          Sair
        </button>
      </form>
    </>
  );
}
