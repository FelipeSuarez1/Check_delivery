"use client";

import { useState, useTransition, type FormEvent } from "react";
import { LoaderCircle, Pencil, Plus, Power } from "lucide-react";
import { criarPorteiro, desativarPorteiro, reativarPorteiro, renomearPorteiro } from "@/actions/admin-cadastros";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PorteiroAdmin } from "@/lib/admin";
import { cn } from "@/lib/utils";
import { chamar } from "../_componentes/acao";
import { FaixaAviso, useAvisoTransitorio } from "../_componentes/aviso-transitorio";
import { DialogoConfirmar } from "../_componentes/dialogo-confirmar";
import {
  AvisoErro,
  BTN_ICONE,
  BTN_PRIMARIO,
  BTN_SECUNDARIO,
  CAMPO,
  CARTAO,
  CabecalhoPagina,
  EstadoVazio,
  ROTULO_CAMPO,
  Selo,
  TD,
  TH,
  TabelaRolavel,
} from "../_componentes/ui-admin";

type Alvo =
  | { tipo: "novo" }
  | { tipo: "renomear"; porteiro: PorteiroAdmin }
  | { tipo: "desativar"; porteiro: PorteiroAdmin }
  | { tipo: "reativar"; porteiro: PorteiroAdmin };

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function PorteirosClient({ porteiros }: { porteiros: PorteiroAdmin[] }) {
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const { aviso, mostrar, limpar } = useAvisoTransitorio();
  const ativos = porteiros.filter((p) => p.ativo).length;

  function concluido(texto: string, avisoAcao?: string) {
    setAlvo(null);
    mostrar(avisoAcao ? `${texto} (${avisoAcao})` : texto);
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Porteiros"
        descricao={
          <>
            Quem fica no balcão — {ativos} ativo{ativos === 1 ? "" : "s"} de {porteiros.length}. A portaria entra com um
            login único e escolhe o porteiro do turno na tela; o nome dele fica gravado em cada encomenda recebida e
            entregue.
          </>
        }
      >
        <button type="button" className={BTN_PRIMARIO} onClick={() => setAlvo({ tipo: "novo" })}>
          <Plus className="size-4" aria-hidden />
          Novo porteiro
        </button>
      </CabecalhoPagina>

      <FaixaAviso aviso={aviso} aoFechar={limpar} />

      {porteiros.length === 0 ? (
        <EstadoVazio>
          Nenhum porteiro cadastrado. Sem porteiro a portaria não consegue abrir o turno — cadastre pelo menos um.
        </EstadoVazio>
      ) : (
        <div className={cn(CARTAO, "overflow-hidden")}>
          <TabelaRolavel>
            <thead className="border-b border-line bg-paper">
              <tr>
                <th className={TH}>Porteiro</th>
                <th className={TH}>Situação</th>
                <th className={cn(TH, "text-right")}>Recebidas</th>
                <th className={cn(TH, "text-right")}>Entregues</th>
                <th className={TH}>Cadastro</th>
                <th className={cn(TH, "text-right")}>Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {porteiros.map((p) => (
                <tr key={p.id} className={cn(!p.ativo && "bg-paper/60 text-ink-3")}>
                  <td className={cn(TD, "font-semibold")}>
                    <span className={cn(!p.ativo && "line-through")}>{p.nome}</span>
                    {p.deTurno && (
                      <Selo tom="ok" className="ml-2">
                        De turno agora
                      </Selo>
                    )}
                  </td>
                  <td className={TD}>
                    <Selo tom={p.ativo ? "ok" : "neutro"}>{p.ativo ? "Ativo" : "Inativo"}</Selo>
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>{p.recebidas}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{p.entregues}</td>
                  <td className={cn(TD, "tabular-nums")}>{dataCurta(p.criadoEm)}</td>
                  <td className={TD}>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className={BTN_ICONE}
                        aria-label={`Renomear ${p.nome}`}
                        title="Renomear"
                        onClick={() => setAlvo({ tipo: "renomear", porteiro: p })}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={cn(BTN_ICONE, p.ativo ? "hover:text-warn" : "text-ok hover:text-ok")}
                        aria-label={p.ativo ? `Desativar ${p.nome}` : `Reativar ${p.nome}`}
                        title={p.ativo ? "Desativar" : "Reativar"}
                        onClick={() => setAlvo({ tipo: p.ativo ? "desativar" : "reativar", porteiro: p })}
                      >
                        <Power className="size-4" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TabelaRolavel>
        </div>
      )}
      <p className="text-xs text-ink-3">
        Contagens do histórico inteiro (encomendas canceladas não entram em “Recebidas”). Porteiro nunca é apagado: desativado, ele
        sai da lista do turno mas continua nos registros antigos.
      </p>

      {(alvo?.tipo === "novo" || alvo?.tipo === "renomear") && (
        <NomeDialog
          key={alvo.tipo === "renomear" ? `r${alvo.porteiro.id}` : "novo"}
          porteiro={alvo.tipo === "renomear" ? alvo.porteiro : null}
          aoFechar={() => setAlvo(null)}
          aoSalvar={concluido}
        />
      )}

      {alvo?.tipo === "desativar" && (
        <DialogoConfirmar
          titulo={`Desativar ${alvo.porteiro.nome}?`}
          rotuloConfirmar="Desativar porteiro"
          perigo
          aoFechar={() => setAlvo(null)}
          aoConfirmar={() => desativarPorteiro({ id: alvo.porteiro.id })}
          aoConcluir={(a) => concluido(`${alvo.porteiro.nome} foi desativado`, a)}
        >
          <p>
            Ele some da lista de quem pode assumir o turno. As encomendas que já recebeu ou entregou continuam com o nome dele.
            Quem está de turno agora não pode ser desativado.
          </p>
        </DialogoConfirmar>
      )}

      {alvo?.tipo === "reativar" && (
        <DialogoConfirmar
          titulo={`Reativar ${alvo.porteiro.nome}?`}
          rotuloConfirmar="Reativar porteiro"
          aoFechar={() => setAlvo(null)}
          aoConfirmar={() => reativarPorteiro({ id: alvo.porteiro.id })}
          aoConcluir={(a) => concluido(`${alvo.porteiro.nome} foi reativado`, a)}
        >
          <p>Ele volta à lista de quem pode assumir o turno na portaria.</p>
        </DialogoConfirmar>
      )}
    </>
  );
}

/* -------------------------------------------------------------- novo / nome */

function NomeDialog({
  porteiro,
  aoFechar,
  aoSalvar,
}: {
  porteiro: PorteiroAdmin | null;
  aoFechar: () => void;
  aoSalvar: (texto: string, aviso?: string) => void;
}) {
  const [nome, setNome] = useState(porteiro?.nome ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (pendente) return;
    setErro(null);
    iniciar(async () => {
      const r = await chamar(() => (porteiro ? renomearPorteiro({ id: porteiro.id, nome }) : criarPorteiro({ nome })));
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      aoSalvar(porteiro ? `Porteiro renomeado para “${nome.trim()}”.` : `Porteiro “${nome.trim()}” criado.`, r.aviso);
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !pendente && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-heading text-lg">{porteiro ? "Renomear porteiro" : "Novo porteiro"}</DialogTitle>
          <DialogDescription>
            {porteiro
              ? "O novo nome aparece também nas encomendas antigas que ele recebeu ou entregou."
              : "Use o nome como a portaria o conhece (ex.: José, Marcos)."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          {erro && <AvisoErro>{erro}</AvisoErro>}
          <div className="space-y-1.5">
            <Label htmlFor="porteiro-nome" className={ROTULO_CAMPO}>
              Nome
            </Label>
            <Input
              id="porteiro-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className={CAMPO}
              maxLength={80}
              autoComplete="off"
              autoFocus
              required
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={BTN_SECUNDARIO} onClick={aoFechar} disabled={pendente}>
              Cancelar
            </button>
            <button type="submit" className={BTN_PRIMARIO} disabled={pendente}>
              {pendente && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              Salvar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
