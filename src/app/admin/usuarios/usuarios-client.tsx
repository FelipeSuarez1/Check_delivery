"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { KeyRound, LoaderCircle, Pencil, Plus, Power, Trash2, UsersRound } from "lucide-react";
import {
  criarUsuario,
  desativarUsuario,
  editarUsuario,
  excluirUsuario,
  gerarLoginsFaltantes,
  reativarUsuario,
  redefinirSenha,
  type SenhaEmitida,
} from "@/actions/admin-usuarios";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OpcaoApartamento, ResumoUsuarios, SituacaoUsuario, UsuarioAdmin } from "@/lib/admin";
import { formatarDataHoraCompleta } from "@/lib/datas";
import { PAPEIS, ROTULO_PAPEL, type PapelUsuario } from "@/lib/papeis";
import { cn } from "@/lib/utils";
import { chamar } from "../_componentes/acao";
import { FaixaAviso, useAvisoTransitorio } from "../_componentes/aviso-transitorio";
import { DialogoConfirmar } from "../_componentes/dialogo-confirmar";
import { SenhasDialog } from "../_componentes/senhas-dialog";
import { FiltrosUsuarios } from "./filtros-usuarios";
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
  SELECT_CHEIO,
  Selo,
  TD,
  TH,
  TabelaRolavel,
} from "../_componentes/ui-admin";

type Alvo =
  | { tipo: "novo" }
  | { tipo: "editar"; u: UsuarioAdmin }
  | { tipo: "senha"; u: UsuarioAdmin }
  | { tipo: "desativar"; u: UsuarioAdmin }
  | { tipo: "reativar"; u: UsuarioAdmin }
  | { tipo: "excluir"; u: UsuarioAdmin }
  | { tipo: "faltantes" };

type Emissao = { emitidas: SenhaEmitida[]; titulo?: string };

const TOM_PAPEL = { admin: "info", portaria: "kraft", morador: "neutro" } as const;

const DESCRICAO_PAPEL: Record<PapelUsuario, string> = {
  admin: "tudo, inclusive esta área",
  portaria: "balcão: registra e entrega",
  morador: "vê só o próprio apartamento",
};

export function UsuariosClient({
  usuarios,
  resumo,
  faltantes,
  opcoes,
  meuId,
  filtroAtual,
}: {
  usuarios: UsuarioAdmin[];
  resumo: ResumoUsuarios;
  /** números dos aptos ativos sem o login padrão */
  faltantes: string[];
  opcoes: OpcaoApartamento[];
  meuId: number;
  /** valores atuais dos filtros (a barra é desenhada aqui, no cliente) */
  filtroAtual: { q: string; papel?: PapelUsuario; situacao?: SituacaoUsuario };
}) {
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [emissao, setEmissao] = useState<Emissao | null>(null);
  const { aviso, mostrar, limpar } = useAvisoTransitorio();

  function concluido(texto: string, avisoAcao?: string) {
    setAlvo(null);
    mostrar(avisoAcao ? `${texto} (${avisoAcao})` : texto);
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Usuários"
        descricao={
          <>
            {resumo.ativos} ativo{resumo.ativos === 1 ? "" : "s"} de {resumo.total}
            {resumo.pendentes > 0 && <> · {resumo.pendentes} ainda não trocaram a senha inicial</>}. Todo acesso nasce com senha
            provisória própria e a pessoa é obrigada a trocá-la no primeiro login. Tudo o que você faz aqui fica registrado em
            Logs.
          </>
        }
      >
        <button
          type="button"
          className={BTN_SECUNDARIO}
          disabled={faltantes.length === 0}
          title={faltantes.length === 0 ? "Todos os apartamentos ativos já têm login" : "Criar o login ap<número> dos aptos que não têm"}
          onClick={() => setAlvo({ tipo: "faltantes" })}
        >
          <UsersRound className="size-4" aria-hidden />
          Gerar logins faltantes
          <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums">{faltantes.length}</span>
        </button>
        <button type="button" className={BTN_PRIMARIO} onClick={() => setAlvo({ tipo: "novo" })}>
          <Plus className="size-4" aria-hidden />
          Novo usuário
        </button>
      </CabecalhoPagina>

      <FaixaAviso aviso={aviso} aoFechar={limpar} />
      <FiltrosUsuarios q={filtroAtual.q} papel={filtroAtual.papel} situacao={filtroAtual.situacao} />

      {usuarios.length === 0 ? (
        <EstadoVazio>Nenhum usuário encontrado com esses filtros.</EstadoVazio>
      ) : (
        <div className={cn(CARTAO, "overflow-hidden")}>
          <TabelaRolavel>
            <thead className="border-b border-line bg-paper">
              <tr>
                <th className={TH}>Usuário</th>
                <th className={TH}>Nome</th>
                <th className={TH}>Papel</th>
                <th className={TH}>Apto</th>
                <th className={TH}>Situação</th>
                <th className={TH}>Senha</th>
                <th className={TH}>Último acesso</th>
                <th className={cn(TH, "text-right")}>Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {usuarios.map((u) => {
                const eu = u.id === meuId;
                return (
                  <tr key={u.id} data-login={u.login} className={cn(!u.ativo && "bg-paper/60 text-ink-3")}>
                    <td className={cn(TD, "font-mono font-semibold")}>
                      {u.login}
                      {eu && <span className="ml-2 font-sans text-xs font-medium text-ink-3">(você)</span>}
                    </td>
                    <td className={cn(TD, "max-w-[16rem] truncate")} title={u.nome}>
                      {u.nome}
                    </td>
                    <td className={TD}>
                      <Selo tom={TOM_PAPEL[u.papel]}>{ROTULO_PAPEL[u.papel]}</Selo>
                    </td>
                    <td className={cn(TD, "codigo")}>{u.apartamento ?? <span className="font-sans text-ink-3">—</span>}</td>
                    <td className={TD}>
                      <Selo tom={u.ativo ? "ok" : "neutro"}>{u.ativo ? "Ativo" : "Desativado"}</Selo>
                    </td>
                    <td className={TD}>
                      {u.precisaTrocarSenha ? <Selo tom="kraft">Troca pendente</Selo> : <span className="text-xs text-ink-3">Própria</span>}
                    </td>
                    <td className={cn(TD, "text-xs tabular-nums text-ink-2")}>
                      {u.ultimoLogin ? formatarDataHoraCompleta(u.ultimoLogin) : <span className="text-ink-3">nunca</span>}
                    </td>
                    <td className={TD}>
                      <div className="flex justify-end gap-0.5">
                        <button
                          type="button"
                          className={BTN_ICONE}
                          aria-label={`Editar ${u.login}`}
                          title="Editar nome, papel e apartamento"
                          onClick={() => setAlvo({ tipo: "editar", u })}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </button>
                        {eu ? (
                          <Link href="/conta/senha" className={BTN_ICONE} aria-label="Trocar minha senha" title="Trocar minha senha (pede a senha atual)">
                            <KeyRound className="size-4" aria-hidden />
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className={BTN_ICONE}
                            aria-label={`Redefinir senha de ${u.login}`}
                            title="Redefinir senha"
                            onClick={() => setAlvo({ tipo: "senha", u })}
                          >
                            <KeyRound className="size-4" aria-hidden />
                          </button>
                        )}
                        <button
                          type="button"
                          className={cn(BTN_ICONE, u.ativo ? "hover:text-warn" : "text-ok hover:text-ok")}
                          aria-label={u.ativo ? `Desativar ${u.login}` : `Reativar ${u.login}`}
                          title={eu ? "Você não pode desativar a si mesmo" : u.ativo ? "Desativar acesso" : "Reativar acesso"}
                          disabled={eu}
                          onClick={() => setAlvo({ tipo: u.ativo ? "desativar" : "reativar", u })}
                        >
                          <Power className="size-4" aria-hidden />
                        </button>
                        {u.podeExcluir && !eu && (
                          <button
                            type="button"
                            className={cn(BTN_ICONE, "hover:text-warn")}
                            aria-label={`Excluir ${u.login}`}
                            title="Excluir definitivamente (desativado e sem nenhum evento)"
                            onClick={() => setAlvo({ tipo: "excluir", u })}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TabelaRolavel>
        </div>
      )}
      <p className="text-xs text-ink-3">
        Desativar corta o acesso na navegação seguinte e preserva a trilha em Logs. Só se exclui de vez quem está desativado e
        nunca fez nada no sistema. Redefinir a senha encerra as sessões abertas da pessoa.
      </p>

      {(alvo?.tipo === "novo" || alvo?.tipo === "editar") && (
        <UsuarioDialog
          key={alvo.tipo === "editar" ? `e${alvo.u.id}` : "novo"}
          usuario={alvo.tipo === "editar" ? alvo.u : null}
          eu={alvo.tipo === "editar" && alvo.u.id === meuId}
          opcoes={opcoes}
          aoFechar={() => setAlvo(null)}
          aoCriado={(e) => {
            setAlvo(null);
            setEmissao({ emitidas: [e] });
          }}
          aoEditado={concluido}
        />
      )}

      {alvo?.tipo === "senha" && (
        <DialogoConfirmar
          titulo={`Redefinir a senha de ${alvo.u.login}?`}
          rotuloConfirmar="Gerar nova senha"
          perigo
          aoFechar={() => setAlvo(null)}
          aoConfirmar={async () => {
            const r = await redefinirSenha({ id: alvo.u.id });
            if (r.ok) setEmissao({ emitidas: [r.emitida], titulo: `Nova senha de ${r.emitida.login}` });
            return r;
          }}
          aoConcluir={() => setAlvo(null)}
        >
          <p>
            A senha atual de <b className="text-ink">{alvo.u.nome}</b> deixa de valer agora, as sessões abertas dela são
            encerradas e a pessoa terá de escolher uma senha nova no próximo acesso.
          </p>
          <p>A nova senha aparece uma única vez, na próxima tela.</p>
        </DialogoConfirmar>
      )}

      {alvo?.tipo === "desativar" && (
        <DialogoConfirmar
          titulo={`Desativar ${alvo.u.login}?`}
          rotuloConfirmar="Desativar acesso"
          perigo
          aoFechar={() => setAlvo(null)}
          aoConfirmar={() => desativarUsuario({ id: alvo.u.id })}
          aoConcluir={(a) => concluido(`${alvo.u.login} foi desativado`, a)}
        >
          <p>
            <b className="text-ink">{alvo.u.nome}</b> não consegue mais entrar e, se estiver com o app aberto, é desconectado na
            próxima tela. Nada é apagado e dá para reativar depois.
          </p>
        </DialogoConfirmar>
      )}

      {alvo?.tipo === "reativar" && (
        <DialogoConfirmar
          titulo={`Reativar ${alvo.u.login}?`}
          rotuloConfirmar="Reativar acesso"
          aoFechar={() => setAlvo(null)}
          aoConfirmar={() => reativarUsuario({ id: alvo.u.id })}
          aoConcluir={(a) => concluido(`${alvo.u.login} foi reativado`, a)}
        >
          <p>
            <b className="text-ink">{alvo.u.nome}</b> volta a poder entrar com a senha que já tem. Se ela foi perdida, use
            “Redefinir senha”.
          </p>
        </DialogoConfirmar>
      )}

      {alvo?.tipo === "excluir" && (
        <DialogoConfirmar
          titulo={`Excluir ${alvo.u.login} de vez?`}
          rotuloConfirmar="Excluir definitivamente"
          perigo
          aoFechar={() => setAlvo(null)}
          aoConfirmar={async () => {
            const r = await excluirUsuario({ id: alvo.u.id });
            return r.ok ? { ok: true as const, aviso: r.aviso } : r;
          }}
          aoConcluir={(a) => concluido(a ?? `${alvo.u.login} foi excluído`)}
        >
          <p>
            Só é possível porque o usuário está desativado e nunca apareceu no livro de eventos. Não há como desfazer; para
            voltar a ter esse login, crie de novo.
          </p>
        </DialogoConfirmar>
      )}

      {alvo?.tipo === "faltantes" && (
        <DialogoConfirmar
          titulo={`Criar ${faltantes.length} login${faltantes.length === 1 ? "" : "s"} de moradores?`}
          rotuloConfirmar={`Criar ${faltantes.length} login${faltantes.length === 1 ? "" : "s"}`}
          aoFechar={() => setAlvo(null)}
          aoConfirmar={async () => {
            const r = await gerarLoginsFaltantes();
            if (r.ok && r.emitidas.length > 0) setEmissao({ emitidas: r.emitidas, titulo: `Logins criados (${r.emitidas.length})` });
            return r;
          }}
          aoConcluir={(a) => {
            setAlvo(null);
            if (a) mostrar(a);
          }}
        >
          <p>
            Cria o usuário <span className="font-mono text-ink">ap&lt;número&gt;</span> (papel Morador) para cada apartamento
            ativo que ainda não tem:
          </p>
          <p className="rounded-[10px] border border-line bg-paper px-3 py-2 font-mono text-xs break-words text-ink">
            {faltantes.join(" · ")}
          </p>
          <p>Cada login ganha uma senha provisória própria, mostrada uma única vez na próxima tela.</p>
        </DialogoConfirmar>
      )}

      {emissao && <SenhasDialog emitidas={emissao.emitidas} titulo={emissao.titulo} aoFechar={() => setEmissao(null)} />}
    </>
  );
}

/* ----------------------------------------------------- novo / editar usuário */

function UsuarioDialog({
  usuario,
  eu,
  opcoes,
  aoFechar,
  aoCriado,
  aoEditado,
}: {
  usuario: UsuarioAdmin | null;
  /** editando a própria conta: o papel fica travado */
  eu: boolean;
  opcoes: OpcaoApartamento[];
  aoFechar: () => void;
  aoCriado: (e: SenhaEmitida) => void;
  aoEditado: (texto: string, aviso?: string) => void;
}) {
  const editando = usuario !== null;
  const [login, setLogin] = useState(usuario?.login ?? "");
  const [nome, setNome] = useState(usuario?.nome ?? "");
  const [papel, setPapel] = useState<PapelUsuario>(usuario?.papel ?? "morador");
  const [aptoId, setAptoId] = useState<number | "">(usuario?.apartamentoId ?? "");
  const [tocouLogin, setTocouLogin] = useState(false);
  const [tocouNome, setTocouNome] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const temAtual = aptoId === "" || opcoes.some((o) => o.id === aptoId);

  function escolherApto(valor: string) {
    const id = valor === "" ? "" : Number(valor);
    setAptoId(id);
    // sugere o login/nome padrão do apto enquanto a pessoa não digitou os próprios
    const numero = opcoes.find((o) => o.id === id)?.numero;
    if (!editando && numero) {
      if (!tocouLogin) setLogin(`ap${numero.toLowerCase()}`);
      if (!tocouNome) setNome(`Apto ${numero}`);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (pendente) return;
    setErro(null);
    const apartamentoId = papel === "morador" && aptoId !== "" ? aptoId : null;
    iniciar(async () => {
      if (usuario) {
        const r = await chamar(() => editarUsuario({ id: usuario.id, nome, papel, apartamentoId }));
        if (!r.ok) return setErro(r.erro);
        aoEditado(`Usuário ${usuario.login} atualizado.`, r.aviso);
      } else {
        const r = await chamar(() => criarUsuario({ login, nome, papel, apartamentoId }));
        if (!r.ok) return setErro(r.erro);
        aoCriado(r.emitida);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !pendente && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-heading text-lg">{editando ? `Editar ${usuario.login}` : "Novo usuário"}</DialogTitle>
          <DialogDescription>
            {editando
              ? "O login não muda. A senha é redefinida pelo botão da chave."
              : "A senha provisória é gerada pelo sistema e aparece uma única vez, depois de salvar."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={enviar} className="space-y-4" noValidate>
          {erro && <AvisoErro>{erro}</AvisoErro>}

          <div className="space-y-1.5">
            <Label htmlFor="usuario-papel" className={ROTULO_CAMPO}>
              Papel
            </Label>
            <select
              id="usuario-papel"
              value={papel}
              onChange={(e) => setPapel(e.target.value as PapelUsuario)}
              disabled={eu}
              className={SELECT_CHEIO}
            >
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PAPEL[p]} — {DESCRICAO_PAPEL[p]}
                </option>
              ))}
            </select>
            {eu && <p className="text-xs text-ink-3">Você não pode tirar o seu próprio acesso de administrador.</p>}
          </div>

          {papel === "morador" && (
            <div className="space-y-1.5">
              <Label htmlFor="usuario-apto" className={ROTULO_CAMPO}>
                Apartamento
              </Label>
              <select
                id="usuario-apto"
                value={aptoId}
                onChange={(e) => escolherApto(e.target.value)}
                className={SELECT_CHEIO}
              >
                <option value="">Escolha o apartamento…</option>
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
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="usuario-login" className={ROTULO_CAMPO}>
                Login
              </Label>
              <Input
                id="usuario-login"
                value={login}
                onChange={(e) => {
                  setLogin(e.target.value);
                  setTocouLogin(true);
                }}
                readOnly={editando}
                className={cn(CAMPO, "font-mono lowercase", editando && "bg-muted text-ink-2")}
                maxLength={30}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usuario-nome" className={ROTULO_CAMPO}>
                Nome
              </Label>
              <Input
                id="usuario-nome"
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                  setTocouNome(true);
                }}
                className={CAMPO}
                maxLength={80}
                autoComplete="off"
                required
              />
            </div>
          </div>
          {!editando && (
            <p className="-mt-2 text-xs text-ink-3">
              Login: minúsculas, números, ponto, hífen ou _ (2 a 30 caracteres, começando por letra). Moradores usam ap&lt;número&gt;,
              ex.: ap11a.
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" className={BTN_SECUNDARIO} onClick={aoFechar} disabled={pendente}>
              Cancelar
            </button>
            <button type="submit" className={BTN_PRIMARIO} disabled={pendente}>
              {pendente && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              {editando ? "Salvar" : "Criar e gerar senha"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
