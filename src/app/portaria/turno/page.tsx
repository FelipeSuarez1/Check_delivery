/**
 * /portaria/turno - quem está de turno e os últimos 20 turnos (23/10/2026).
 * O porteiro do turno aberto é o "recebida por" / "entregue por" gravado em cada
 * encomenda; esta página é onde se confere isso, troca de porteiro ou encerra.
 */
import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { AcoesTurno } from "./acoes-turno-client";
import { LinkVoltar } from "@/components/portaria/link-voltar";
import { exigirPapelNaPagina } from "@/lib/auth";
import { diaLocalISO, formatarDataHora, formatarHora, formatarRelativo } from "@/lib/datas";
import { formatarHa } from "@/lib/historico-portaria";
import { buscarTurnoAberto } from "@/lib/turno";
import { listarTurnosRecentes } from "@/lib/turnos-portaria";

export const metadata: Metadata = { title: "Turno" };

const TH = "border-b border-line px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[.08em] text-ink-3";

export default async function TurnoPage() {
  await exigirPapelNaPagina("portaria", "admin");
  const [turno, turnos] = await Promise.all([buscarTurnoAberto(), listarTurnosRecentes(20)]);
  const atual = turno ? turnos.find((t) => t.id === turno.id) : undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <LinkVoltar href="/portaria" />
        <h1 className="text-2xl">Turno da portaria</h1>
      </div>

      <section
        aria-label="Turno atual"
        className="flex flex-col gap-4 rounded-[14px] border border-line bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-4">
          <span
            className={
              "flex size-14 shrink-0 items-center justify-center rounded-full " +
              (turno ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")
            }
          >
            <UserRound className="size-7" aria-hidden />
          </span>
          {turno ? (
            <div>
              <div className="eyebrow">Turno aberto</div>
              <div className="font-heading text-2xl font-semibold">{turno.porteiroNome}</div>
              <div className="text-base tabular-nums text-ink-2">
                desde {formatarRelativo(turno.inicioISO)} · {formatarHa(turno.inicioISO)}
                {atual && ` · ${atual.recebidas} recebida${atual.recebidas === 1 ? "" : "s"}, ${atual.entregues} entregue${atual.entregues === 1 ? "" : "s"}`}
              </div>
            </div>
          ) : (
            <div>
              <div className="eyebrow">Sem turno</div>
              <div className="font-heading text-2xl font-semibold text-warn">Nenhum turno aberto</div>
              <div className="text-base text-ink-2">Abra o turno para registrar e entregar encomendas.</div>
            </div>
          )}
        </div>
        <AcoesTurno aberto={!!turno} porteiroNome={turno?.porteiroNome ?? null} />
      </section>

      <section aria-label="Últimos turnos" className="flex flex-col gap-2">
        <h2 className="eyebrow">Últimos turnos (até 20)</h2>
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
          <div className="overflow-x-auto [contain:layout]">
            <table className="w-full min-w-[640px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Porteiro
                  </th>
                  <th scope="col" className={TH}>
                    Início
                  </th>
                  <th scope="col" className={TH}>
                    Fim
                  </th>
                  <th scope="col" className={TH + " text-right"}>
                    Recebidas
                  </th>
                  <th scope="col" className={TH + " text-right"}>
                    Entregues
                  </th>
                </tr>
              </thead>
              <tbody>
                {turnos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-ink-2">
                      Nenhum turno registrado ainda.
                    </td>
                  </tr>
                )}
                {turnos.map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-3 font-semibold">{t.porteiroNome}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatarDataHora(t.inicio)}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      {t.fim ? (
                        diaLocalISO(t.fim) === diaLocalISO(t.inicio) ? formatarHora(t.fim) : formatarDataHora(t.fim)
                      ) : (
                        <span className="stamp stamp-done">Em andamento</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{t.recebidas}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{t.entregues}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
