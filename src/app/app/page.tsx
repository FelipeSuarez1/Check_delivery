import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PackageCheck, User } from "lucide-react";
import { exigirPapelNaPagina } from "@/lib/auth";
import { formatarDataHora } from "@/lib/datas";
import { listarDoApartamento } from "@/lib/encomendas";
import { apartamentoDaTela, moradoresDoApartamento, nomesCurtos, ultimaEntrega } from "@/lib/morador";
import { BannerInstalar } from "@/components/instalar-app-banner-client";
import { CardNaPortaria } from "./_componentes/card-na-portaria";
import { EscolherApartamento } from "./_componentes/escolher-apartamento";

export const metadata: Metadata = { title: "Na portaria" };

/**
 * Início do morador: o que está esperando na portaria. O apartamento vem da
 * sessão (nunca da URL); `?apto=` só vale para o admin conferindo a tela.
 */
export default async function NaPortariaPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const sessao = await exigirPapelNaPagina("morador", "admin");
  const sp = await searchParams;
  const apto = await apartamentoDaTela(sessao, sp.apto);
  if (!apto) {
    if (sessao.papel === "admin") return <EscolherApartamento rota="/app" />;
    notFound();
  }

  const [{ aguardando }, nomes] = await Promise.all([
    listarDoApartamento(apto.id, { limiteHistorico: 1 }),
    moradoresDoApartamento(apto.id),
  ]);
  const ultima = aguardando.length === 0 ? await ultimaEntrega(apto.id) : null;
  const curtos = nomesCurtos(nomes);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow">Espaço Tangará</div>
          <h1 className="text-[22px]">Apto {apto.numero}</h1>
        </div>
        {curtos.length > 0 && (
          <span className="chip min-w-0 max-w-[62%]" title={nomes.join(" · ")}>
            <User className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{curtos.join(" · ")}</span>
          </span>
        )}
      </div>

      {aguardando.length > 0 ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-[17px]">
              {aguardando.length} {aguardando.length === 1 ? "encomenda" : "encomendas"} na portaria
            </h2>
            <span className="text-[13px] text-ink-3">qualquer um do apto retira</span>
          </div>
          {aguardando.map((e) => (
            <CardNaPortaria key={e.id} encomenda={e} />
          ))}
        </>
      ) : (
        <section className="flex flex-col items-center gap-3 rounded-[14px] border border-line bg-card px-5 py-8 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-ok-soft text-ok">
            <PackageCheck className="size-7" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-[17px]">Nenhuma encomenda na portaria</h2>
            <p className="text-[13px] text-ink-2">
              Quando chegar algo para o apartamento, aparece aqui com o código para retirar.
            </p>
          </div>
          {ultima && (
            <Link
              href={`/app/encomenda/${ultima.codigo}`}
              className="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-[10px] border border-line bg-paper px-3 py-2 text-[13px] hover:border-kraft"
            >
              <span className="text-ink-2">
                Última entrega: <span className="codigo text-ink">{ultima.codigo}</span>
              </span>
              <span className="tabular-nums text-ink-3">
                retirada por {ultima.retiradaPor ?? "—"}
                {ultima.retiradaPorTerceiro ? " (terceiro)" : ""} · {formatarDataHora(ultima.entregueEm)}
              </span>
            </Link>
          )}
        </section>
      )}

      <BannerInstalar />

      <p className="rounded-[10px] border border-dashed border-line bg-white/60 px-3.5 py-2.5 text-xs text-ink-2">
        Todos do apartamento veem as mesmas encomendas e os mesmos códigos. O nome diz para quem veio; o código é o
        que se mostra no balcão.
      </p>
    </>
  );
}
