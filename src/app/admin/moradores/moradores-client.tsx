"use client";

import { useState, useTransition, type FormEvent } from "react";
import { LoaderCircle, Pencil, Power, UserPlus } from "lucide-react";
import { criarMorador, desativarMorador, editarMorador, reativarMorador } from "@/actions/admin-cadastros";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApartamentoAdmin, MoradorAdmin, OpcaoApartamento } from "@/lib/admin";
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
  ROTULO_CAMPO,
  SELECT_CHEIO,
  Selo,
} from "../_componentes/ui-admin";

export type SecaoTorre = { torre: "A" | "B"; aptos: ApartamentoAdmin[] };

type Alvo =
  | { tipo: "novo"; aptoId: number }
  | { tipo: "editar"; aptoId: number; morador: MoradorAdmin }
  | { tipo: "desativar"; aptoNumero: string; morador: MoradorAdmin }
  | { tipo: "reativar"; aptoNumero: string; morador: MoradorAdmin };

export function MoradoresClient({ secoes, opcoes }: { secoes: SecaoTorre[]; opcoes: OpcaoApartamento[] }) {
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const { aviso, mostrar, limpar } = useAvisoTransitorio();

  function concluido(texto: string, avisoAcao?: string) {
    setAlvo(null);
    mostrar(avisoAcao ? `${texto} (${avisoAcao})` : texto);
  }

  return (
    <div className="space-y-6">
      <FaixaAviso aviso={aviso} aoFechar={limpar} />

      {secoes.map((s) => (
        <section key={s.torre} aria-labelledby={`torre-${s.torre}`} className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 id={`torre-${s.torre}`} className="font-heading text-lg font-semibold">
              Torre {s.torre}
            </h2>
            <span className="text-sm text-ink-3">
              {s.aptos.length} apartamento{s.aptos.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {s.aptos.map((a) => {
              const semAtivo = a.ativo && !a.moradores.some((m) => m.ativo);
              return (
                <article key={a.id} aria-label={`Apartamento ${a.numero}`} className={cn(CARTAO, "flex flex-col overflow-hidden")}>
                  <header className="flex items-center gap-2 border-b border-line bg-paper px-4 py-1.5">
                    <span className="codigo text-xl">{a.numero}</span>
                    <span className="text-xs text-ink-3">{a.andar}º andar</span>
                    {!a.ativo && <Selo tom="aviso">Apto inativo</Selo>}
                    {semAtivo && <Selo tom="aviso">Sem morador ativo</Selo>}
                    <button
                      type="button"
                      className={cn(BTN_ICONE, "ml-auto")}
                      aria-label={`Novo morador no apto ${a.numero}`}
                      title="Novo morador"
                      disabled={!a.ativo}
                      onClick={() => setAlvo({ tipo: "novo", aptoId: a.id })}
                    >
                      <UserPlus className="size-5" aria-hidden />
                    </button>
                  </header>
                  {a.moradores.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-ink-3">Nenhum morador cadastrado.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {a.moradores.map((m) => (
                        <li key={m.id} className="flex items-center gap-1 py-1 pr-1 pl-4">
                          <div className="min-w-0 flex-1 py-1">
                            <p className={cn("truncate font-semibold", !m.ativo && "text-ink-3 line-through")}>{m.nome}</p>
                            <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                              {m.telefoneMascarado ? (
                                <span className="tabular-nums">{m.telefoneMascarado}</span>
                              ) : (
                                <span className="font-semibold text-warn">sem telefone</span>
                              )}
                              {!m.ativo && <Selo>Inativo</Selo>}
                            </p>
                          </div>
                          <button
                            type="button"
                            className={BTN_ICONE}
                            aria-label={`Editar ${m.nome}`}
                            title="Editar"
                            onClick={() => setAlvo({ tipo: "editar", aptoId: a.id, morador: m })}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className={cn(BTN_ICONE, m.ativo ? "hover:text-warn" : "text-ok hover:text-ok")}
                            aria-label={m.ativo ? `Desativar ${m.nome}` : `Reativar ${m.nome}`}
                            title={m.ativo ? "Desativar" : "Reativar"}
                            onClick={() =>
                              setAlvo({ tipo: m.ativo ? "desativar" : "reativar", aptoNumero: a.numero, morador: m })
                            }
                          >
                            <Power className="size-4" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {(alvo?.tipo === "novo" || alvo?.tipo === "editar") && (
        <MoradorDialog
          key={alvo.tipo === "editar" ? `e${alvo.morador.id}` : `n${alvo.aptoId}`}
          alvo={alvo}
          opcoes={opcoes}
          aoFechar={() => setAlvo(null)}
          aoSalvar={(texto, avisoAcao) => concluido(texto, avisoAcao)}
        />
      )}

      {alvo?.tipo === "desativar" && (
        <DialogoConfirmar
          titulo={`Desativar ${alvo.morador.nome}?`}
          rotuloConfirmar="Desativar morador"
          perigo
          aoFechar={() => setAlvo(null)}
          aoConfirmar={() => desativarMorador({ id: alvo.morador.id })}
          aoConcluir={(a) => concluido(`${alvo.morador.nome} foi desativado`, a)}
        >
          <p>
            O morador deixa de aparecer nas opções da portaria (“Para quem?” e “Quem retirou?”) do apto {alvo.aptoNumero}.
            As encomendas antigas continuam com o nome dele — nada é apagado.
          </p>
        </DialogoConfirmar>
      )}

      {alvo?.tipo === "reativar" && (
        <DialogoConfirmar
          titulo={`Reativar ${alvo.morador.nome}?`}
          rotuloConfirmar="Reativar morador"
          aoFechar={() => setAlvo(null)}
          aoConfirmar={() => reativarMorador({ id: alvo.morador.id })}
          aoConcluir={(a) => concluido(`${alvo.morador.nome} foi reativado`, a)}
        >
          <p>O morador volta a aparecer nas opções da portaria do apto {alvo.aptoNumero}.</p>
        </DialogoConfirmar>
      )}
    </div>
  );
}

/* ----------------------------------------------------- novo / editar morador */

function MoradorDialog({
  alvo,
  opcoes,
  aoFechar,
  aoSalvar,
}: {
  alvo: Extract<Alvo, { tipo: "novo" | "editar" }>;
  opcoes: OpcaoApartamento[];
  aoFechar: () => void;
  aoSalvar: (texto: string, aviso?: string) => void;
}) {
  const editando = alvo.tipo === "editar";
  const [nome, setNome] = useState(editando ? alvo.morador.nome : "");
  const [telefone, setTelefone] = useState(editando ? alvo.morador.telefoneCompleto : "");
  const [aptoId, setAptoId] = useState(alvo.aptoId);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  // o apto atual pode estar inativo (fora das opções): mantém a opção para não trocar sem querer
  const temAtual = opcoes.some((o) => o.id === aptoId);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (pendente) return;
    setErro(null);
    iniciar(async () => {
      const r = await chamar(() =>
        editando
          ? editarMorador({ id: alvo.morador.id, apartamentoId: aptoId, nome, telefone })
          : criarMorador({ apartamentoId: aptoId, nome, telefone })
      );
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      const apto = opcoes.find((o) => o.id === aptoId)?.numero;
      aoSalvar(
        editando ? `Morador “${nome.trim()}” atualizado.` : `Morador “${nome.trim()}” criado${apto ? ` no apto ${apto}` : ""}.`,
        r.aviso
      );
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !pendente && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-heading text-lg">{editando ? "Editar morador" : "Novo morador"}</DialogTitle>
          <DialogDescription>
            {editando
              ? "O telefone completo só aparece aqui; na lista ele fica mascarado."
              : "Entra ativo e já aparece nas opções da portaria."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={enviar} className="space-y-4" noValidate>
          {erro && <AvisoErro>{erro}</AvisoErro>}

          <div className="space-y-1.5">
            <Label htmlFor="morador-nome" className={ROTULO_CAMPO}>
              Nome
            </Label>
            <Input
              id="morador-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className={CAMPO}
              maxLength={80}
              autoComplete="off"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="morador-telefone" className={ROTULO_CAMPO}>
              Telefone (WhatsApp)
            </Label>
            <Input
              id="morador-telefone"
              type="tel"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className={CAMPO}
              placeholder="(11) 91234-5678"
              maxLength={40}
              autoComplete="off"
            />
            <p className="text-xs text-ink-3">DDD + número. Sem telefone o aviso por WhatsApp não é gerado.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="morador-apto" className={ROTULO_CAMPO}>
              Apartamento
            </Label>
            <select
              id="morador-apto"
              value={aptoId}
              onChange={(e) => setAptoId(Number(e.target.value))}
              className={SELECT_CHEIO}
            >
              {!temAtual && <option value={aptoId}>Apartamento atual (inativo)</option>}
              {(["A", "B"] as const).map((t) => (
                <optgroup key={t} label={`Torre ${t}`}>
                  {opcoes
                    .filter((o) => o.torre === t)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.numero}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {editando && aptoId !== alvo.aptoId && (
              <p className="text-xs text-kraft-ink">
                As encomendas antigas continuam no apartamento onde foram registradas.
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
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
