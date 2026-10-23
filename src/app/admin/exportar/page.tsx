import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { exigirPapelNaPagina } from "@/lib/auth";
import {
  contarParaExportacao,
  lerFiltroExportacao,
  listarParaExportacao,
  type FiltroExportacao,
} from "@/lib/admin";
import { diaLocalISO, formatarDataHoraCompleta, partesLocais, somarDiasLocal } from "@/lib/datas";
import { ROTULO_STATUS, STATUS, ehStatus } from "@/lib/encomenda-constantes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AvisoErro,
  BTN_PRIMARIO,
  BTN_SECUNDARIO,
  CAMPO,
  CARTAO,
  CHIP_FILTRO,
  CHIP_FILTRO_OFF,
  CHIP_FILTRO_ON,
  CabecalhoPagina,
  EstadoVazio,
  ROTULO_CAMPO,
  SELECT_CHEIO,
  Selo,
  TD,
  TH,
  TabelaRolavel,
} from "../_componentes/ui-admin";

export const metadata: Metadata = { title: "Exportar" };

type Params = Record<string, string | string[] | undefined>;
const PREVIA = 8;

const dois = (n: number) => String(n).padStart(2, "0");

/** Atalhos de período (todos em dias de calendário de São Paulo, pontas inclusivas). */
function atalhos(agora: Date): { rotulo: string; de: string; ate: string }[] {
  const hoje = diaLocalISO(agora);
  const p = partesLocais(agora);
  const primeiroDoMes = `${p.ano}-${dois(p.mes)}-01`;
  const anterior = new Date(Date.UTC(p.ano, p.mes - 2, 1));
  const ultimoAnterior = new Date(Date.UTC(p.ano, p.mes - 1, 0));
  const iso = (d: Date) => `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
  return [
    { rotulo: "Hoje", de: hoje, ate: hoje },
    { rotulo: "Últimos 7 dias", de: diaLocalISO(somarDiasLocal(agora, -6)), ate: hoje },
    { rotulo: "Últimos 30 dias", de: diaLocalISO(somarDiasLocal(agora, -29)), ate: hoje },
    { rotulo: "Este mês", de: primeiroDoMes, ate: hoje },
    { rotulo: "Mês anterior", de: iso(anterior), ate: iso(ultimoAnterior) },
    { rotulo: "Tudo", de: "", ate: "" },
  ];
}

export default async function ExportarPage({ searchParams }: { searchParams: Promise<Params> }) {
  await exigirPapelNaPagina("admin");
  const sp = await searchParams;
  const agora = new Date();

  // primeira visita (sem de/ate na URL): últimos 30 dias; "Tudo" manda de/ate vazios de propósito
  const semPeriodo = !("de" in sp) && !("ate" in sp);
  const efetivos: Params = semPeriodo
    ? { ...sp, de: diaLocalISO(somarDiasLocal(agora, -29)), ate: diaLocalISO(agora) }
    : sp;

  const lido = lerFiltroExportacao(efetivos);
  const filtro: FiltroExportacao | null = lido.ok ? lido.filtro : null;
  const [total, previa] = filtro
    ? await Promise.all([contarParaExportacao(filtro), listarParaExportacao(filtro, PREVIA)])
    : [0, []];

  const valor = (k: string) => {
    const v = efetivos[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const hrefAtalho = (de: string, ate: string) => {
    const p = new URLSearchParams({ de, ate });
    if (filtro?.torre) p.set("torre", filtro.torre);
    if (filtro?.status) p.set("status", filtro.status);
    return `/admin/exportar?${p.toString()}`;
  };

  return (
    <>
      <CabecalhoPagina
        titulo="Exportar encomendas"
        descricao="Planilha CSV em português (separador “;”, acentos certos no Excel). O período vale para o dia em que a encomenda foi recebida, com as duas pontas incluídas. Cada exportação fica registrada em Logs."
      />

      <section className={`${CARTAO} space-y-4 p-4 sm:p-5`} aria-label="Filtros da exportação">
        <nav aria-label="Atalhos de período" className="flex flex-wrap gap-2">
          {atalhos(agora).map((a) => {
            const ativo = filtro !== null && (filtro.de ?? "") === a.de && (filtro.ate ?? "") === a.ate;
            return (
              <Link
                key={a.rotulo}
                href={hrefAtalho(a.de, a.ate)}
                aria-current={ativo ? "true" : undefined}
                className={`${CHIP_FILTRO} ${ativo ? CHIP_FILTRO_ON : CHIP_FILTRO_OFF}`}
              >
                {a.rotulo}
              </Link>
            );
          })}
        </nav>

        <form method="get" action="/admin/exportar" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="exp-de" className={ROTULO_CAMPO}>
                De (recebida a partir de)
              </Label>
              <Input id="exp-de" type="date" name="de" defaultValue={valor("de")} className={CAMPO} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-ate" className={ROTULO_CAMPO}>
                Até (inclusive)
              </Label>
              <Input id="exp-ate" type="date" name="ate" defaultValue={valor("ate")} className={CAMPO} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-torre" className={ROTULO_CAMPO}>
                Torre
              </Label>
              <select id="exp-torre" name="torre" defaultValue={valor("torre").toUpperCase()} className={SELECT_CHEIO}>
                <option value="">Todas</option>
                <option value="A">Torre A</option>
                <option value="B">Torre B</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-status" className={ROTULO_CAMPO}>
                Status
              </Label>
              <select id="exp-status" name="status" defaultValue={valor("status").toLowerCase()} className={SELECT_CHEIO}>
                <option value="">Todos</option>
                {STATUS.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* o 1º botão do formulário é o do Enter: prévia primeiro, download depois */}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={BTN_SECUNDARIO}>
              <RefreshCw className="size-4" aria-hidden />
              Atualizar prévia
            </button>
            <button type="submit" formAction="/admin/exportar/csv" className={BTN_PRIMARIO}>
              <Download className="size-4" aria-hidden />
              Baixar CSV
            </button>
          </div>
        </form>
      </section>

      {!lido.ok ? (
        <AvisoErro>{lido.erro}</AvisoErro>
      ) : total === 0 ? (
        <EstadoVazio icone={<FileSpreadsheet className="size-6 text-ink-3" aria-hidden />}>
          Nenhuma encomenda recebida nesse recorte. O arquivo sairia só com o cabeçalho.
        </EstadoVazio>
      ) : (
        <section aria-label="Prévia" className="space-y-2">
          <p className="text-sm text-ink-2">
            <b className="text-ink tabular-nums" data-testid="total-exportacao">
              {total}
            </b>{" "}
            encomenda{total === 1 ? "" : "s"} no recorte
            {total > previa.length && <> · prévia das {previa.length} mais antigas — o arquivo traz todas</>}.
          </p>
          <div className={`${CARTAO} overflow-hidden`}>
            <TabelaRolavel>
              <thead className="border-b border-line bg-paper">
                <tr>
                  <th className={TH}>Código</th>
                  <th className={TH}>Apto</th>
                  <th className={TH}>Destinatário</th>
                  <th className={TH}>Recebida em</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {previa.map((r) => (
                  <tr key={r.id}>
                    <td className={`${TD} codigo`}>{r.codigo}</td>
                    <td className={`${TD} codigo`}>{r.apartamento.numero}</td>
                    <td className={`${TD} max-w-[18rem] truncate`}>{r.destinatarioNome}</td>
                    <td className={`${TD} tabular-nums`}>{formatarDataHoraCompleta(r.recebidaEm)}</td>
                    <td className={TD}>
                      <Selo tom={r.status === "entregue" ? "ok" : r.status === "cancelada" ? "neutro" : "kraft"}>
                        {ehStatus(r.status) ? ROTULO_STATUS[r.status] : r.status}
                      </Selo>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TabelaRolavel>
          </div>
        </section>
      )}
    </>
  );
}
