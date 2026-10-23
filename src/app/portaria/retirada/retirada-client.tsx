"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, LoaderCircle, Search, ScanQrCode, TriangleAlert, X } from "lucide-react";
import { buscarEncomendaParaRetirada, confirmarRetirada } from "@/actions/encomendas";
import { Chip } from "@/components/encomenda/chip";
import { CodigoEncomenda } from "@/components/encomenda/codigo-encomenda";
import { FotoEncomenda } from "@/components/encomenda/foto-encomenda";
import { StampStatus } from "@/components/encomenda/stamp-status";
import { classeBotao } from "@/components/portaria/botao";
import { EstadoVazio } from "@/components/portaria/estado-vazio";
import { FaixaSemTurno } from "@/components/portaria/faixa-sem-turno";
import { LinkVoltar } from "@/components/portaria/link-voltar";
import { useAgora, useHoraAgora } from "@/components/portaria/use-agora";
import { Input } from "@/components/ui/input";
import { abrirDialogoTurno } from "@/components/turno-dialog";
import { correspondeBusca } from "@/lib/busca-encomenda";
import { validarCodigo } from "@/lib/codigo";
import { formatarHora, formatarRelativo } from "@/lib/datas";
import type { BuscaParaRetirada, EncomendaDetalhe, EncomendaResumo, MoradorInfo } from "@/lib/encomendas";
import { formatarHa } from "@/lib/historico-portaria";
import { cn } from "@/lib/utils";
import { ScannerQr } from "./scanner-qr-client";
import { TecladoCodigo } from "./teclado-codigo";

const MSG_SEM_TURNO = "Abra o turno antes de confirmar: escolha quem está na portaria.";
const MSG_FALHA = "Não foi possível concluir. Recarregue a página e tente de novo (a sessão pode ter expirado).";

type Busca =
  | { tipo: "ocioso" }
  | { tipo: "carregando"; codigo: string }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "achada"; encomenda: EncomendaDetalhe; moradores: MoradorInfo[] };

type Quem = { tipo: "morador"; id: number; nome: string } | { tipo: "terceiro" } | null;

type Sucesso = { codigo: string; apartamento: string; paraNome: string; terceiro: boolean; destinatarioNome: string; quando: string };

function buscaInicial(inicial: { codigo: string; resultado: BuscaParaRetirada } | null): Busca {
  if (!inicial) return { tipo: "ocioso" };
  const r = inicial.resultado;
  return r.ok ? { tipo: "achada", encomenda: r.encomenda, moradores: r.moradores } : { tipo: "erro", mensagem: r.erro };
}

const limparCodigo = (bruto: string) => bruto.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

export function RetiradaClient({
  turno,
  pendentes,
  inicial,
}: {
  turno: { porteiroNome: string; inicioISO: string } | null;
  pendentes: EncomendaResumo[];
  inicial: { codigo: string; resultado: BuscaParaRetirada } | null;
}) {
  const router = useRouter();
  const agora = useAgora();
  const hora = useHoraAgora();

  const [codigo, setCodigo] = useState(() => (inicial ? limparCodigo(inicial.codigo) : ""));
  const [busca, setBusca] = useState<Busca>(() => buscaInicial(inicial));
  const [quem, setQuem] = useState<Quem>(null);
  const [terceiroNome, setTerceiroNome] = useState("");
  const [terceiroDoc, setTerceiroDoc] = useState("");
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<Sucesso | null>(null);
  const [scanner, setScanner] = useState(false);
  const [pendente, iniciar] = useTransition();
  const enviando = useRef(false);
  const token = useRef(0);
  const campoRef = useRef<HTMLInputElement>(null);

  // computador com mouse/teclado: já cai no campo; tablet (toque): não abre o teclado sozinho
  useEffect(() => {
    if (!inicial && window.matchMedia("(pointer: fine)").matches) campoRef.current?.focus();
  }, [inicial]);

  function zerarEscolha() {
    setQuem(null);
    setTerceiroNome("");
    setTerceiroDoc("");
    setTentou(false);
    setErro(null);
  }

  async function procurar(bruto: string) {
    const v = validarCodigo(bruto);
    if (!v.ok) {
      setBusca({ tipo: "erro", mensagem: v.erro });
      return;
    }
    const meu = ++token.current;
    zerarEscolha();
    setBusca({ tipo: "carregando", codigo: v.codigo });
    try {
      const r = await buscarEncomendaParaRetirada(v.codigo);
      if (meu !== token.current) return; // o porteiro já mudou o código
      setBusca(r.ok ? { tipo: "achada", encomenda: r.encomenda, moradores: r.moradores } : { tipo: "erro", mensagem: r.erro });
    } catch {
      if (meu === token.current) setBusca({ tipo: "erro", mensagem: MSG_FALHA });
    }
  }

  function aoMudarCodigo(bruto: string) {
    const novo = limparCodigo(bruto);
    if (novo === codigo) return;
    setCodigo(novo);
    // editou o código: o que estava na tela deixa de valer
    token.current++;
    if (busca.tipo !== "ocioso") {
      zerarEscolha();
      setBusca({ tipo: "ocioso" });
    }
    if (novo.length === 4) void procurar(novo);
  }

  function aoOk() {
    if (codigo.length === 4) {
      void procurar(codigo);
      return;
    }
    const v = validarCodigo(codigo);
    setBusca({ tipo: "erro", mensagem: v.ok ? "Informe o código da encomenda" : v.erro });
  }

  /** Código vindo de fora do campo (QR lido, "Entregar" da lista): ocupa o campo e procura na hora. */
  function definirCodigo(c: string) {
    setCodigo(limparCodigo(c));
    token.current++;
    zerarEscolha();
    void procurar(c);
  }

  function reiniciar() {
    token.current++;
    setCodigo("");
    setBusca({ tipo: "ocioso" });
    zerarEscolha();
    setSucesso(null);
    if (inicial) router.replace("/portaria/retirada");
    else if (window.matchMedia("(pointer: fine)").matches) {
      // tablet (toque): não abre o teclado do sistema sozinho a cada entrega
      window.setTimeout(() => campoRef.current?.focus({ preventScroll: true }), 50);
    }
  }

  function confirmar() {
    if (pendente || enviando.current || busca.tipo !== "achada") return;
    const e = busca.encomenda;
    setTentou(true);
    if (!quem) {
      setErro("Escolha quem está retirando.");
      return;
    }
    if (quem.tipo === "terceiro" && terceiroNome.trim().length < 2) {
      setErro("Informe o nome de quem está retirando.");
      return;
    }
    if (!turno) {
      setErro(MSG_SEM_TURNO);
      abrirDialogoTurno();
      return;
    }

    setErro(null);
    enviando.current = true;
    iniciar(async () => {
      try {
        const r = await confirmarRetirada({
          codigo: e.codigo,
          ...(quem.tipo === "morador"
            ? { retiradaPorMoradorId: quem.id }
            : { terceiroNome: terceiroNome.trim(), terceiroDoc: terceiroDoc.trim() || undefined }),
        });
        if (r.ok) {
          setSucesso({
            codigo: r.codigo,
            apartamento: r.apartamento,
            paraNome: r.retiradaPor,
            terceiro: r.terceiro,
            destinatarioNome: e.destinatarioNome,
            quando: new Date().toISOString(),
          });
        } else {
          setErro(r.erro);
        }
      } catch {
        setErro(MSG_FALHA);
      } finally {
        enviando.current = false;
      }
    });
  }

  /* ------------------------------------------------------------- sucesso */

  if (sucesso) {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-4 pt-6 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-ok-soft text-ok">
          <Check className="size-10" strokeWidth={2.5} aria-hidden />
        </span>
        <h1 className="text-3xl">Entregue</h1>
        <p className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-xl">
          <CodigoEncomenda codigo={sucesso.codigo} size="lg" />
          <span className="text-ink-2">· para</span>
          <b>{sucesso.paraNome}</b>
          {sucesso.terceiro && <span className="text-base text-ink-2">(terceiro)</span>}
        </p>
        <p className="text-base text-ink-2">
          {sucesso.apartamento} · encomenda de {sucesso.destinatarioNome} · registrado por {turno?.porteiroNome ?? "—"} às{" "}
          {formatarHora(sucesso.quando)}.
        </p>
        <div className="mt-2 flex w-full flex-wrap gap-3">
          <button
            type="button"
            onClick={reiniciar}
            autoFocus
            className={classeBotao({ variante: "primary", grande: true, className: "min-w-[220px] flex-1" })}
          >
            <ScanQrCode aria-hidden /> Próxima retirada
          </button>
          <Link href="/portaria" className={classeBotao({ grande: true })}>
            Voltar à lista
          </Link>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- tela */

  const buscando = busca.tipo === "carregando";

  return (
    <>
      {!turno && <FaixaSemTurno texto="Abra o turno para confirmar entregas" />}

      <div className="flex flex-wrap items-center gap-3">
        <LinkVoltar href="/portaria" />
        <h1 className="text-2xl">Confirmar retirada</h1>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* --------------------------------------------- coluna do código */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="codigo-retirada" className="text-sm font-semibold text-ink-2">
              Código que o morador mostrou
            </label>
            <input
              ref={campoRef}
              id="codigo-retirada"
              value={codigo}
              onChange={(ev) => aoMudarCodigo(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  aoOk();
                }
              }}
              inputMode="text"
              enterKeyHint="go"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={8}
              placeholder="K7M3"
              aria-describedby="ajuda-codigo"
              className={cn(
                "h-[72px] w-full rounded-[10px] border bg-card text-center font-mono text-[40px] font-semibold uppercase tracking-[.06em] text-kraft-ink outline-none",
                "placeholder:font-medium placeholder:text-ink-3/40 focus-visible:border-kraft focus-visible:ring-3 focus-visible:ring-kraft/30",
                busca.tipo === "erro" ? "border-warn" : "border-input"
              )}
            />
          </div>

          <button
            type="button"
            onClick={() => setScanner(true)}
            className={classeBotao({ grande: true, bloco: true })}
          >
            <ScanQrCode aria-hidden /> Escanear o QR do celular
          </button>

          <TecladoCodigo
            className="mt-1"
            desabilitado={buscando}
            onTecla={(c) => aoMudarCodigo(codigo + c)}
            onApagar={() => aoMudarCodigo(codigo.slice(0, -1))}
            onLimpar={() => aoMudarCodigo("")}
            onOk={aoOk}
          />

          <p id="ajuda-codigo" className="text-[13px] text-ink-2">
            Sem o código? Busque pelo apartamento: a lista mostra as encomendas pendentes dele. O código tem 4
            caracteres e nunca usa 0, O, 1 nem I.
          </p>
        </div>

        {/* ------------------------------------------- coluna da encomenda */}
        <div className="flex min-w-0 flex-col gap-4">
          {busca.tipo === "achada" ? (
            <Conferencia
              e={busca.encomenda}
              moradores={busca.moradores}
              quem={quem}
              setQuem={(q) => {
                setQuem(q);
                setErro(null);
              }}
              terceiroNome={terceiroNome}
              setTerceiroNome={(v) => {
                setTerceiroNome(v);
                setErro(null);
              }}
              terceiroDoc={terceiroDoc}
              setTerceiroDoc={setTerceiroDoc}
              tentou={tentou}
              // o aviso de "abra o turno" some sozinho assim que o turno abre
              erro={erro === MSG_SEM_TURNO && turno ? null : erro}
              pendente={pendente}
              turnoNome={turno?.porteiroNome ?? null}
              hora={hora}
              agora={agora}
              onConfirmar={confirmar}
            />
          ) : (
            <>
              {buscando && (
                <div role="status" className="flex items-center gap-3 rounded-[14px] border border-line bg-card px-5 py-6 text-lg">
                  <LoaderCircle className="size-6 animate-spin text-kraft-ink" aria-hidden />
                  Procurando a encomenda {busca.codigo}…
                </div>
              )}
              {busca.tipo === "erro" && busca.mensagem && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-[14px] border border-warn bg-warn-soft px-5 py-4 text-warn"
                >
                  <TriangleAlert className="mt-0.5 size-6 shrink-0" aria-hidden />
                  <div>
                    <p className="text-lg font-semibold">{busca.mensagem}</p>
                    <button
                      type="button"
                      onClick={() => aoMudarCodigo("")}
                      className="mt-1 inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-4"
                    >
                      Digitar outro código
                    </button>
                  </div>
                </div>
              )}
              {(busca.tipo === "ocioso" || busca.tipo === "erro") && (
                <BuscaPorApartamento
                  pendentes={pendentes}
                  vazioDeTudo={busca.tipo === "ocioso"}
                  onEscolher={definirCodigo}
                />
              )}
            </>
          )}
        </div>
      </div>

      <ScannerQr
        aberto={scanner}
        onFechar={() => setScanner(false)}
        onCodigo={(c) => {
          setScanner(false);
          definirCodigo(c);
        }}
      />
    </>
  );
}

/* ====================================================== conferência da encomenda */

function Conferencia({
  e,
  moradores,
  quem,
  setQuem,
  terceiroNome,
  setTerceiroNome,
  terceiroDoc,
  setTerceiroDoc,
  tentou,
  erro,
  pendente,
  turnoNome,
  hora,
  agora,
  onConfirmar,
}: {
  e: EncomendaDetalhe;
  moradores: MoradorInfo[];
  quem: Quem;
  setQuem: (q: Quem) => void;
  terceiroNome: string;
  setTerceiroNome: (v: string) => void;
  terceiroDoc: string;
  setTerceiroDoc: (v: string) => void;
  tentou: boolean;
  erro: string | null;
  pendente: boolean;
  turnoNome: string | null;
  hora: string | null;
  agora: number | null;
  onConfirmar: () => void;
}) {
  const origem = [e.tipoRotulo, e.transportadora, e.local ? `guardada em ${e.local}` : null].filter(Boolean).join(" · ");
  const paraNome = quem?.tipo === "morador" ? quem.nome : quem?.tipo === "terceiro" ? terceiroNome.trim() : "";
  const faltaQuem = tentou && !quem;
  const faltaNome = tentou && quem?.tipo === "terceiro" && terceiroNome.trim().length < 2;

  return (
    <>
      <section className="flex flex-col gap-4 rounded-[14px] border border-line bg-card p-4 sm:flex-row sm:items-center">
        <FotoEncomenda fotoId={e.fotoId} alt={`Foto da encomenda ${e.codigo}`} size={120} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CodigoEncomenda codigo={e.codigo} className="text-[26px]" />
            <span className="font-heading text-[26px] font-semibold leading-none">{e.apartamento}</span>
            <StampStatus status={e.status} diasParada={e.diasParada} />
          </div>
          <div className="text-[17px]">
            <b>{e.destinatarioNome}</b> <span className="text-ink-2">· {origem}</span>
          </div>
          {e.observacao && <div className="text-[15px] text-ink-2">Obs.: {e.observacao}</div>}
          <div className="text-[15px] tabular-nums text-ink-2">
            Recebida {formatarRelativo(e.recebidaEm)} por {e.recebidaPor}
            {agora !== null && ` · ${formatarHa(e.recebidaEm, new Date(agora))}`}
          </div>
        </div>
      </section>

      <div
        id="quem-retira"
        className={cn("flex flex-col gap-2 rounded-[10px]", faltaQuem && "ring-2 ring-warn ring-offset-4 ring-offset-paper")}
      >
        <span className="text-sm font-semibold text-ink-2">Quem está retirando?</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quem está retirando">
          {moradores.map((m) => (
            <Chip
              key={m.id}
              selected={quem?.tipo === "morador" && quem.id === m.id}
              disabled={pendente}
              onClick={() => setQuem({ tipo: "morador", id: m.id, nome: m.nome })}
            >
              {m.nome}
            </Chip>
          ))}
          <Chip selected={quem?.tipo === "terceiro"} disabled={pendente} onClick={() => setQuem({ tipo: "terceiro" })}>
            Terceiro autorizado…
          </Chip>
        </div>
        <p className="text-[13px] text-ink-2">
          {moradores.length === 0
            ? `Nenhum morador cadastrado no ${e.apartamento}: use “Terceiro autorizado”. `
            : `Qualquer morador do ${e.apartamento} pode retirar com o código. `}
          “Terceiro” pede o nome e, se houver, o documento.
        </p>
      </div>

      {quem?.tipo === "terceiro" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="terceiro-nome" className="text-sm font-semibold text-ink-2">
              Nome de quem retira
            </label>
            <Input
              id="terceiro-nome"
              value={terceiroNome}
              onChange={(ev) => setTerceiroNome(ev.target.value)}
              disabled={pendente}
              maxLength={80}
              autoFocus
              autoComplete="off"
              placeholder="Nome completo"
              aria-invalid={faltaNome}
              className="h-12 rounded-[10px] bg-card px-3.5 text-base md:text-base"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="terceiro-doc" className="text-sm font-semibold text-ink-2">
              Documento <span className="font-normal text-ink-3">(opcional)</span>
            </label>
            <Input
              id="terceiro-doc"
              value={terceiroDoc}
              onChange={(ev) => setTerceiroDoc(ev.target.value)}
              disabled={pendente}
              maxLength={30}
              autoComplete="off"
              placeholder="RG ou CPF"
              className="h-12 rounded-[10px] bg-card px-3.5 text-base md:text-base"
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          "rounded-[10px] border border-dashed px-3.5 py-3 text-[15px]",
          quem && turnoNome && paraNome
            ? "border-ok bg-ok-soft text-ok"
            : "border-line bg-card text-ink-2"
        )}
      >
        {!turnoNome ? (
          <>Sem turno aberto: abra o turno para registrar quem entregou.</>
        ) : quem && paraNome ? (
          <>
            Vai ficar registrado:{" "}
            <b>
              entregue por {turnoNome}
              {hora ? ` às ${hora}` : ""} para {paraNome}
              {quem.tipo === "terceiro" ? " (terceiro)" : ""}
            </b>{" "}
            (encomenda {e.codigo}, de {e.destinatarioNome}).
          </>
        ) : (
          <>
            Quando você escolher quem está retirando, aparece aqui o que vai ficar registrado (entregue por{" "}
            <b>{turnoNome}</b>).
          </>
        )}
      </div>

      {erro && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[10px] border border-warn/40 bg-warn-soft px-3.5 py-3 text-base font-medium text-warn"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          {erro}
        </p>
      )}

      <button
        type="button"
        onClick={onConfirmar}
        disabled={pendente}
        className={classeBotao({ variante: "ok", grande: true, bloco: true, className: "lg:mt-auto" })}
      >
        {pendente ? <LoaderCircle className="animate-spin" aria-hidden /> : <Check aria-hidden />}
        {pendente ? "Confirmando…" : "Confirmar entrega"}
      </button>
    </>
  );
}

/* ================================================ busca pelo apartamento */

const MAX_LISTA = 8;

function BuscaPorApartamento({
  pendentes,
  vazioDeTudo,
  onEscolher,
}: {
  pendentes: EncomendaResumo[];
  vazioDeTudo: boolean;
  onEscolher: (codigo: string) => void;
}) {
  const [termo, setTermo] = useState("");
  const achadas = termo.trim() ? pendentes.filter((e) => correspondeBusca(e, termo)) : [];

  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-line bg-card p-4" aria-labelledby="busca-apto-titulo">
      <h2 id="busca-apto-titulo" className="font-heading text-lg">
        Sem o código? Busque pelo apartamento
      </h2>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          type="search"
          value={termo}
          onChange={(ev) => setTermo(ev.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          placeholder="apartamento ou nome (ex.: 11A)"
          aria-label="Buscar encomendas pendentes por apartamento ou nome"
          className="h-12 w-full rounded-[10px] border border-input bg-card pl-10 pr-12 text-base outline-none placeholder:text-ink-3 focus-visible:border-kraft focus-visible:ring-3 focus-visible:ring-kraft/30 [&::-webkit-search-cancel-button]:hidden"
        />
        {termo && (
          <button
            type="button"
            onClick={() => setTermo("")}
            aria-label="Limpar a busca"
            className="absolute right-0 top-0 flex size-12 items-center justify-center text-ink-3 hover:text-ink"
          >
            <X className="size-[18px]" aria-hidden />
          </button>
        )}
      </div>

      {!termo.trim() ? (
        vazioDeTudo && (
          <EstadoVazio
            className="border-0 px-2 py-8"
            icone={<ScanQrCode aria-hidden />}
            titulo="Digite ou escaneie o código"
            texto={
              pendentes.length === 0
                ? "Não há encomendas aguardando agora."
                : `${pendentes.length} ${pendentes.length === 1 ? "encomenda aguardando" : "encomendas aguardando"} na portaria. Sem o código, digite o apartamento acima.`
            }
          />
        )
      ) : achadas.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-line px-3.5 py-4 text-base text-ink-2">
          Nenhuma encomenda aguardando para “{termo.trim()}”.
        </p>
      ) : (
        <ul className="flex flex-col">
          {achadas.slice(0, MAX_LISTA).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3 last:border-0">
              <div className="flex min-w-0 flex-1 basis-[220px] flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <CodigoEncomenda codigo={e.codigo} className="text-lg" />
                  <span className="font-heading text-lg font-semibold">{e.apartamento}</span>
                  <span className="min-w-0 truncate font-semibold">{e.destinatarioNome}</span>
                </div>
                <div className="truncate text-[13px] text-ink-2">
                  {[e.tipoRotulo, e.transportadora].filter(Boolean).join(" · ")} · {formatarRelativo(e.recebidaEm)}
                  {e.parada ? ` · ${e.diasParada} dias` : ""}
                </div>
              </div>
              <Link
                href={`/portaria/encomenda/${e.id}`}
                className="inline-flex h-11 items-center gap-1 rounded-[10px] px-2 text-[15px] font-semibold text-ink-2 hover:bg-muted hover:text-ink"
              >
                Detalhes <ChevronRight className="size-4" aria-hidden />
              </Link>
              <button type="button" onClick={() => onEscolher(e.codigo)} className={classeBotao({ variante: "ok", className: "h-11" })}>
                <Check aria-hidden /> Entregar
              </button>
            </li>
          ))}
          {achadas.length > MAX_LISTA && (
            <li className="pt-3 text-[15px] text-ink-2">
              Mais {achadas.length - MAX_LISTA} encomendas — digite o apartamento completo para refinar.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
