"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { registrarEncomenda, type ResultadoRegistro } from "@/actions/encomendas";
import { ChipsTipo } from "@/components/encomenda/chips-tipo";
import { ChipsTransportadora } from "@/components/encomenda/chips-transportadora";
import { FotoCaptura } from "@/components/encomenda/foto-captura-client";
import { SeletorMoradores, type ValorDestinatario } from "@/components/encomenda/seletor-moradores";
import { classeBotao, CLASSE_SEG, classeSegItem } from "@/components/portaria/botao";
import { FaixaSemTurno } from "@/components/portaria/faixa-sem-turno";
import { LinkVoltar } from "@/components/portaria/link-voltar";
import { useHoraAgora } from "@/components/portaria/use-agora";
import { Input } from "@/components/ui/input";
import { abrirDialogoTurno } from "@/components/turno-dialog";
import type { TipoEncomenda } from "@/lib/encomenda-constantes";
import type { ApartamentoComMoradores } from "@/lib/encomendas";
import { cn } from "@/lib/utils";
import { CodigoGerado, type Registrada } from "./codigo-gerado";

const MSG_SEM_TURNO = "Abra o turno antes de registrar: escolha quem está na portaria.";
const MSG_FALHA = "Não foi possível salvar. Recarregue a página e tente de novo (a sessão pode ter expirado).";

type Falta = "foto" | "apto" | "dest" | "tipo";
const TEXTO_FALTA: Record<Falta, string> = {
  foto: "tirar a foto da etiqueta",
  apto: "informar o apartamento",
  dest: "escolher para quem é",
  tipo: "escolher o tipo",
};

function Campo({
  rotulo,
  dica,
  id,
  falta,
  htmlFor,
  children,
  className,
}: {
  rotulo: string;
  dica?: string;
  id?: string;
  falta?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-[10px] transition-shadow",
        falta && "ring-2 ring-warn ring-offset-4 ring-offset-paper",
        className
      )}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-semibold text-ink-2">
          {rotulo} {dica && <span className="font-normal text-ink-3">{dica}</span>}
        </label>
      ) : (
        <span className="text-sm font-semibold text-ink-2">
          {rotulo} {dica && <span className="font-normal text-ink-3">{dica}</span>}
        </span>
      )}
      {children}
    </div>
  );
}

export function RegistrarClient({
  turno,
  apartamentos,
}: {
  turno: { porteiroNome: string; inicioISO: string } | null;
  apartamentos: ApartamentoComMoradores[];
}) {
  // `chave` troca ao tocar em "Registrar outra": remonta o formulário zerado
  const [chave, setChave] = useState(0);
  const [registrada, setRegistrada] = useState<Registrada | null>(null);

  if (registrada) {
    return (
      <CodigoGerado
        registrada={registrada}
        onRegistrarOutra={() => {
          setRegistrada(null);
          setChave((c) => c + 1);
        }}
      />
    );
  }
  return <Formulario key={chave} turno={turno} apartamentos={apartamentos} aoRegistrar={setRegistrada} />;
}

function Formulario({
  turno,
  apartamentos,
  aoRegistrar,
}: {
  turno: { porteiroNome: string; inicioISO: string } | null;
  apartamentos: ApartamentoComMoradores[];
  aoRegistrar: (r: Registrada) => void;
}) {
  const hora = useHoraAgora();
  const [fotos, setFotos] = useState<File[]>([]);
  const [torre, setTorre] = useState<"A" | "B">("A");
  const [numero, setNumero] = useState("");
  const [destino, setDestino] = useState<{ aptoId: number | null; valor: ValorDestinatario }>({ aptoId: null, valor: {} });
  const [tipo, setTipo] = useState<TipoEncomenda | null>("caixa");
  const [transportadora, setTransportadora] = useState("");
  const [local, setLocal] = useState("");
  const [observacao, setObservacao] = useState("");
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const enviando = useRef(false);
  const numeroRef = useRef<HTMLInputElement>(null);

  const alvo = numero ? `${numero}${torre}` : "";
  const apto = alvo ? (apartamentos.find((a) => a.numero === alvo) ?? null) : null;
  // "26" quase sempre é o 26º andar → 261 (os finais são sempre 1)
  const sugestao =
    numero && !apto ? (apartamentos.find((a) => a.numero === `${numero}1${torre}`) ?? null) : null;
  // dígitos que ainda podem virar um apartamento real (ex. "26" → 261): não é erro, é digitação em curso
  const emDigitacao = !!numero && !apto && apartamentos.some((a) => a.torre === torre && a.numero.startsWith(numero));
  const dest: ValorDestinatario = apto && destino.aptoId === apto.id ? destino.valor : {};

  const faltas: Falta[] = [];
  if (fotos.length < 1) faltas.push("foto");
  if (!apto) faltas.push("apto");
  else if (dest.moradorId == null && (dest.nome ?? "").trim().length < 2) faltas.push("dest");
  if (!tipo) faltas.push("tipo");
  const destaque = (f: Falta) => tentou && faltas.includes(f);

  function aoMudarFotos(novas: File[]) {
    const primeira = fotos.length === 0 && novas.length > 0;
    setFotos(novas);
    setErro(null);
    // depois da 1ª foto o próximo passo é o apartamento: já deixa o cursor lá
    if (primeira && !numero) window.setTimeout(() => numeroRef.current?.focus(), 150);
  }

  function aoDigitarNumero(bruto: string) {
    const letra = /[abAB]/.exec(bruto);
    if (letra) setTorre(letra[0].toUpperCase() as "A" | "B"); // teclado físico: "11b" já escolhe a Torre B
    setNumero(bruto.replace(/\D/g, "").slice(0, 3));
    setErro(null);
  }

  function irParaPrimeiraFalta(lista: Falta[]) {
    const id = { foto: "campo-foto", apto: "campo-apto", dest: "campo-dest", tipo: "campo-tipo" }[lista[0]];
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  }

  function salvar() {
    if (pendente || enviando.current) return;
    setTentou(true);
    if (faltas.length > 0) {
      setErro(`Falta ${faltas.map((f) => TEXTO_FALTA[f]).join(", ")}.`);
      irParaPrimeiraFalta(faltas);
      return;
    }
    if (!turno) {
      setErro(MSG_SEM_TURNO);
      abrirDialogoTurno();
      return;
    }
    if (!apto || !tipo) return;

    const fd = new FormData();
    fd.set("apartamentoId", String(apto.id));
    if (dest.moradorId != null) fd.set("destinatarioMoradorId", String(dest.moradorId));
    else fd.set("destinatarioNome", (dest.nome ?? "").trim());
    fd.set("tipo", tipo);
    if (transportadora.trim()) fd.set("transportadora", transportadora.trim());
    if (local.trim()) fd.set("local", local.trim());
    if (observacao.trim()) fd.set("observacao", observacao.trim());
    for (const f of fotos) fd.append("fotos", f);

    setErro(null);
    enviando.current = true;
    iniciar(async () => {
      try {
        const r: ResultadoRegistro = await registrarEncomenda(fd);
        if (r.ok) aoRegistrar({ ...r, registradaEm: new Date().toISOString() });
        else setErro(r.erro);
      } catch {
        setErro(MSG_FALHA);
      } finally {
        enviando.current = false;
      }
    });
  }

  return (
    <>
      {!turno && <FaixaSemTurno texto="Abra o turno para registrar a encomenda" />}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <LinkVoltar href="/portaria" />
        <h1 className="text-2xl">Registrar encomenda</h1>
        {turno ? (
          <span className="text-ink-3">
            · recebida por {turno.porteiroNome}
            {hora ? `, ${hora}` : ""}
          </span>
        ) : (
          <span className="font-semibold text-warn">· sem turno aberto</span>
        )}
      </div>

      <form
        className="grid grid-cols-1 gap-5 lg:grid-cols-[460px_minmax(0,1fr)]"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          salvar();
        }}
        // "Ok/Ir" do teclado numa caixa de texto NÃO salva: só o botão Salvar salva
        onKeyDown={(ev) => {
          if (ev.key === "Enter" && ev.target instanceof HTMLInputElement) ev.preventDefault();
        }}
      >
        <div id="campo-foto" className={cn("flex min-w-0 flex-col gap-3 self-start rounded-[10px]", destaque("foto") && "ring-2 ring-warn ring-offset-4 ring-offset-paper")}>
          <FotoCaptura value={fotos} onChange={aoMudarFotos} disabled={pendente} />
          <p className="text-[13px] text-ink-2">A foto é a prova: aparece para o morador e fica no histórico.</p>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-1 gap-x-3.5 gap-y-4 md:grid-cols-2">
            <Campo rotulo="Apartamento" id="campo-apto" falta={destaque("apto")} htmlFor="numero-apto">
              <div className="flex flex-wrap gap-2">
                <div className={CLASSE_SEG} role="radiogroup" aria-label="Torre">
                  {(["A", "B"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={torre === t}
                      disabled={pendente}
                      onClick={() => setTorre(t)}
                      className={classeSegItem(torre === t)}
                    >
                      Torre {t}
                    </button>
                  ))}
                </div>
                <div className="flex h-[52px] min-w-[128px] flex-1 items-center gap-2 rounded-[10px] border border-input bg-card px-3.5 focus-within:border-kraft focus-within:ring-3 focus-within:ring-kraft/30">
                  <input
                    ref={numeroRef}
                    id="numero-apto"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    maxLength={5}
                    value={numero}
                    disabled={pendente}
                    onChange={(ev) => aoDigitarNumero(ev.target.value)}
                    placeholder="11"
                    aria-label="Número do apartamento, sem a letra da torre"
                    className="w-full min-w-0 flex-1 bg-transparent font-mono text-[26px] font-semibold tracking-[.06em] outline-none placeholder:text-ink-3/60"
                  />
                  <span className="shrink-0 whitespace-nowrap text-ink-3">
                    →{" "}
                    <b className={cn("font-heading text-xl", apto ? "text-ink" : "text-ink-3")}>
                      {apto ? apto.numero : emDigitacao ? "…" : numero ? "?" : "—"}
                    </b>
                  </span>
                </div>
              </div>
              {numero && !apto && (
                <p className={cn("text-[15px]", emDigitacao ? "text-ink-2" : "font-medium text-warn")} role="status">
                  {!emDigitacao && <>Não existe o apartamento {alvo}. Confira a torre e o número. </>}
                  {sugestao && (
                    <button
                      type="button"
                      onClick={() => setNumero(sugestao.numero.slice(0, -1))}
                      className="inline-flex min-h-11 items-center font-semibold text-kraft-ink underline underline-offset-4"
                    >
                      Quis dizer {sugestao.numero}?
                    </button>
                  )}
                </p>
              )}
            </Campo>

            <Campo rotulo="Tipo" id="campo-tipo" falta={destaque("tipo")}>
              <ChipsTipo valor={tipo} onChange={setTipo} disabled={pendente} />
            </Campo>
          </div>

          <Campo
            rotulo="Para quem?"
            dica={apto ? `(moradores do ${apto.numero})` : "(escolha o apartamento primeiro)"}
            id="campo-dest"
            falta={destaque("dest")}
          >
            {apto ? (
              <SeletorMoradores
                moradores={apto.moradores}
                valor={dest}
                onChange={(valor) => setDestino({ aptoId: apto.id, valor })}
                disabled={pendente}
              />
            ) : (
              <p className="rounded-[10px] border border-dashed border-line px-3.5 py-3 text-[15px] text-ink-3">
                Os moradores aparecem aqui quando você digitar o apartamento.
              </p>
            )}
          </Campo>

          <div className="grid grid-cols-1 gap-x-3.5 gap-y-4 md:grid-cols-2">
            <Campo rotulo="Transportadora / remetente">
              <ChipsTransportadora valor={transportadora} onChange={setTransportadora} disabled={pendente} />
            </Campo>
            <Campo rotulo="Onde guardou" htmlFor="local-guardado">
              <Input
                id="local-guardado"
                value={local}
                onChange={(ev) => setLocal(ev.target.value)}
                disabled={pendente}
                maxLength={60}
                autoComplete="off"
                placeholder="ex.: Prateleira A3"
                className="h-12 rounded-[10px] bg-card px-3.5 text-base md:text-base"
              />
            </Campo>
          </div>

          <Campo rotulo="Observação" dica="(opcional)" htmlFor="observacao-encomenda">
            <Input
              id="observacao-encomenda"
              value={observacao}
              onChange={(ev) => setObservacao(ev.target.value)}
              disabled={pendente}
              maxLength={300}
              autoComplete="off"
              placeholder="ex.: caixa amassada, frágil, 2 volumes"
              className="h-12 rounded-[10px] bg-card px-3.5 text-base md:text-base"
            />
          </Campo>

          {/* o aviso de "abra o turno" some sozinho assim que o turno abre */}
          {erro && !(erro === MSG_SEM_TURNO && turno) && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[10px] border border-warn/40 bg-warn-soft px-3.5 py-3 text-base font-medium text-warn"
            >
              <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
              {erro}
            </p>
          )}

          <div className="flex flex-wrap gap-3 pt-1 lg:mt-auto">
            <button
              type="submit"
              disabled={pendente}
              className={classeBotao({ variante: "primary", grande: true, className: "min-w-[240px] flex-1" })}
            >
              {pendente ? <LoaderCircle className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              {pendente ? "Salvando…" : "Salvar e gerar código"}
            </button>
            <Link
              href="/portaria"
              aria-disabled={pendente}
              // enviando as fotos: sair agora perderia o registro em andamento
              onClick={(ev) => pendente && ev.preventDefault()}
              className={classeBotao({ variante: "fantasma", grande: true })}
            >
              Cancelar
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}
