"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LoaderCircle, TriangleAlert, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEhAdmin } from "@/components/sessao-provider";
import { encerrarTurno, iniciarTurno } from "@/actions/turno";

export type TurnoAberto = { porteiroNome: string; inicioISO: string; porteiroId?: number };
export type PorteiroOpcao = { id: number; nome: string };

const FUSO = "America/Sao_Paulo";

// A action só "lança" quando a resposta nem chega como esperado — o caso comum é a
// sessão de 30 dias vencida com a tela aberta (o middleware devolve o login).
const MSG_FALHA_DE_REDE =
  "Não foi possível concluir. Recarregue a página e tente de novo (a sessão pode ter expirado).";

const EVENTO_ABRIR = "portaria:abrir-dialogo-turno";

/**
 * Abre o diálogo de turno do cabeçalho a partir de QUALQUER tela da portaria
 * (faixa "Abra o turno…", botão Salvar sem turno, página /portaria/turno). O
 * diálogo vive uma vez só no layout; isto só avisa por evento da janela.
 */
export function abrirDialogoTurno(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_ABRIR));
}

/** "14:00" no fuso de Brasília — mesmo texto no servidor e no cliente. */
function horaDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/**
 * Chip "Turno: José · desde 14:00" do cabeçalho da portaria + diálogo para
 * iniciar, trocar ou encerrar o turno. O porteiro do turno aberto é gravado em
 * cada encomenda registrada/entregue (login único da portaria, fase 1).
 * A autorização é das actions (`@/actions/turno`); aqui é só interface.
 */
export function TurnoDialog({ turno, porteiros }: { turno: TurnoAberto | null; porteiros: PorteiroOpcao[] }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const ehAdmin = useEhAdmin();

  useEffect(() => {
    const abrir = () => setAberto(true);
    window.addEventListener(EVENTO_ABRIR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR, abrir);
  }, []);

  function fechar(valor: boolean) {
    if (pendente) return;
    setAberto(valor);
    if (!valor) setErro(null);
  }

  function concluir(r: { ok: boolean; erro?: string }) {
    if (!r.ok) {
      setErro(r.erro ?? "Não foi possível concluir");
      return;
    }
    setErro(null);
    setAberto(false);
    router.refresh();
  }

  function escolher(p: PorteiroOpcao) {
    if (pendente) return;
    if (turno?.porteiroId === p.id) return;
    setErro(null);
    iniciar(async () => {
      try {
        // iniciarTurno já encerra o turno aberto na mesma transação (trocar = iniciar)
        concluir(await iniciarTurno({ porteiroId: p.id }));
      } catch {
        setErro(MSG_FALHA_DE_REDE);
      }
    });
  }

  function encerrar() {
    if (pendente) return;
    setErro(null);
    iniciar(async () => {
      try {
        concluir(await encerrarTurno());
      } catch {
        setErro(MSG_FALHA_DE_REDE);
      }
    });
  }

  const semTurno = turno === null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Porteiro de turno — gravado em cada encomenda"
        className={
          "chip h-11 cursor-pointer " +
          (semTurno ? "border-warn bg-warn-soft font-semibold text-warn" : "hover:bg-muted")
        }
      >
        <UserRound className="size-3.5 shrink-0" aria-hidden />
        {turno ? (
          <>
            <span>Turno:</span>
            <b className="max-w-[9rem] truncate">{turno.porteiroNome}</b>
            <span className="tabular-nums">· desde {horaDe(turno.inicioISO)}</span>
          </>
        ) : (
          <span>Sem turno — escolher porteiro</span>
        )}
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </button>

      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pr-10">
            <DialogTitle className="font-heading text-lg">
              {turno ? "Turno da portaria" : "Quem está de turno?"}
            </DialogTitle>
            <DialogDescription>
              {turno ? (
                <>
                  Aberto por <b className="text-ink">{turno.porteiroNome}</b> desde {horaDe(turno.inicioISO)}. Tudo
                  que for registrado ou entregue agora fica no nome dele.
                </>
              ) : (
                "Cada encomenda registrada ou entregue fica gravada com o nome do porteiro do turno."
              )}
            </DialogDescription>
          </DialogHeader>

          {erro && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[10px] border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {erro}
            </div>
          )}

          <div className="space-y-2">
            {turno && <p className="eyebrow">Trocar para</p>}
            {porteiros.length === 0 ? (
              <p className="rounded-[10px] border border-dashed border-line px-3 py-3 text-sm text-ink-2">
                Nenhum porteiro cadastrado.{" "}
                {ehAdmin ? (
                  <Link href="/admin/porteiros" className="font-semibold text-kraft-ink underline">
                    Cadastrar porteiros
                  </Link>
                ) : (
                  "Peça ao síndico para cadastrar."
                )}
              </p>
            ) : (
              <ul className="grid gap-2">
                {porteiros.map((p) => {
                  const atual = turno?.porteiroId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => escolher(p)}
                        disabled={pendente || atual}
                        className={
                          "flex min-h-14 w-full items-center justify-between gap-3 rounded-[10px] border px-4 text-left text-base font-semibold transition-colors disabled:cursor-default " +
                          (atual
                            ? "border-ok bg-ok-soft text-ok"
                            : "border-line bg-card hover:border-kraft hover:bg-kraft-soft disabled:opacity-60")
                        }
                      >
                        <span className="truncate">{p.nome}</span>
                        {atual ? (
                          <span className="inline-flex items-center gap-1 text-sm">
                            <Check className="size-4" aria-hidden /> Em turno
                          </span>
                        ) : pendente ? (
                          <LoaderCircle className="size-4 animate-spin text-ink-3" aria-hidden />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {turno && (
            <button
              type="button"
              onClick={encerrar}
              disabled={pendente}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-warn/40 bg-card px-4 font-semibold text-warn transition-colors hover:bg-warn-soft disabled:opacity-60"
            >
              {pendente && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              Encerrar turno
            </button>
          )}

          <Link
            href="/portaria/turno"
            onClick={() => setAberto(false)}
            className="-mb-1 inline-flex h-11 items-center justify-center rounded-[10px] text-sm font-semibold text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            Ver os últimos turnos
          </Link>
        </DialogContent>
      </Dialog>
    </>
  );
}
