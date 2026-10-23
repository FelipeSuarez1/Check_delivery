"use client";

/**
 * <FotoCaptura value onChange max? disabled? className? />  (22/10/2026)
 * Captura de 1 a 3 fotos da etiqueta/volume na tela de registro.
 *  - value: File[] controlado pelo pai (já REDUZIDOS: use-os direto no FormData, campo "fotos")
 *  - onChange: recebe o novo array (adicionar/remover)
 *  - max: padrão 3 (FOTOS_MAX)
 *  - disabled: trava tudo enquanto o pai está enviando
 * Fluxo: botão grande (360 px no tablet) abre a câmera traseira
 * (`capture="environment"`; no desktop abre o seletor de arquivo). Cada foto é
 * REDUZIDA no navegador antes de virar File: lado maior 1280 px, JPEG 0,8 -
 * um celular de 4 MB vira ~200 KB. O tamanho resultante aparece na legenda.
 * Observação: o servidor valida de novo (tipo real, 10 MB) - isto aqui é só conforto/velocidade.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, LoaderCircle, Plus, X } from "lucide-react";
import { FOTOS_MAX } from "@/lib/encomenda-constantes";
import { MSG_ILEGIVEL, formatarTamanho, reduzirImagem } from "@/lib/reduzir-imagem";
import { cn } from "@/lib/utils";

type Medidas = { largura: number; altura: number };
/** dimensões das fotos que ESTE componente gerou (File não carrega isso) */
const MEDIDAS = new WeakMap<File, Medidas>();

/**
 * URL de pré-visualização do File, revogada ao trocar/desmontar (seguro no
 * StrictMode). Guarda o par {file, url}: durante a troca nunca devolve a URL
 * já revogada do arquivo anterior.
 */
function useUrlDoArquivo(file: File | undefined): string | null {
  const [par, setPar] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // sincroniza com um recurso externo (blob URL) que só existe depois da montagem
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPar({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return file && par && par.file === file ? par.url : null;
}

function Miniatura({
  file,
  indice,
  selecionada,
  onSelecionar,
  onRemover,
  disabled,
}: {
  file: File;
  indice: number;
  selecionada: boolean;
  onSelecionar: () => void;
  onRemover: () => void;
  disabled?: boolean;
}) {
  const url = useUrlDoArquivo(file);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelecionar}
        aria-label={`Ver foto ${indice + 1}`}
        aria-current={selecionada}
        className={cn(
          "flex h-[72px] w-[92px] items-center justify-center overflow-hidden rounded-[10px] bg-[#EFEAE0]",
          selecionada ? "border-2 border-kraft" : "border border-line"
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- pré-visualização local (blob:)
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon className="size-5 text-ink-3" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={onRemover}
        disabled={disabled}
        aria-label={`Remover foto ${indice + 1}`}
        className="absolute -right-2.5 -top-2.5 flex size-11 items-center justify-center disabled:opacity-50"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-ink text-white shadow">
          <X className="size-4" aria-hidden="true" />
        </span>
      </button>
    </div>
  );
}

export function FotoCaptura({
  value,
  onChange,
  max = FOTOS_MAX,
  disabled = false,
  className,
}: {
  value: File[];
  onChange: (files: File[]) => void;
  max?: number;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState(0);

  // a redução é assíncrona: ao terminar, vale o estado MAIS RECENTE do pai
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  const indice = Math.min(escolhida, Math.max(0, value.length - 1));
  const principal = value[indice];
  const urlPrincipal = useUrlDoArquivo(principal);
  const medidas = principal ? MEDIDAS.get(principal) : undefined;
  const travado = disabled || processando;

  function abrirCamera() {
    if (travado) return;
    setErro(null);
    inputRef.current?.click();
  }

  async function aoEscolher(ev: React.ChangeEvent<HTMLInputElement>) {
    const escolhidos = Array.from(ev.target.files ?? []);
    ev.target.value = ""; // permite tirar a mesma foto de novo
    if (escolhidos.length === 0 || disabled) return;
    const vagas = max - valueRef.current.length;
    if (vagas <= 0) {
      setErro(`No máximo ${max} fotos.`);
      return;
    }
    setErro(null);
    setProcessando(true);
    const novos: File[] = [];
    try {
      for (const f of escolhidos.slice(0, vagas)) {
        const r = await reduzirImagem(f);
        MEDIDAS.set(r.file, { largura: r.largura, altura: r.altura });
        novos.push(r.file);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : MSG_ILEGIVEL);
    } finally {
      setProcessando(false);
    }
    if (novos.length > 0) {
      const proximo = [...valueRef.current, ...novos].slice(0, max);
      onChangeRef.current(proximo);
      setEscolhida(proximo.length - 1);
    }
  }

  function remover(i: number) {
    if (disabled) return;
    setErro(null);
    const proximo = valueRef.current.filter((_, k) => k !== i);
    onChangeRef.current(proximo);
    setEscolhida((atual) => (atual >= i ? Math.max(0, atual - 1) : atual));
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={aoEscolher}
      />

      {value.length === 0 ? (
        <button
          type="button"
          onClick={abrirCamera}
          disabled={travado}
          className="flex h-64 w-full flex-col items-center justify-center gap-2.5 rounded-[10px] border-2 border-dashed border-kraft bg-kraft-soft text-kraft-ink transition-colors hover:bg-kraft-soft/70 disabled:opacity-60 md:h-[360px]"
        >
          {processando ? (
            <LoaderCircle className="size-[34px] animate-spin" aria-hidden="true" />
          ) : (
            <Camera className="size-[34px]" aria-hidden="true" />
          )}
          <b className="text-[17px]">{processando ? "Preparando a foto…" : "Tirar foto da etiqueta"}</b>
          <span className="text-[13px] text-ink-2">câmera do tablet · obrigatória</span>
        </button>
      ) : (
        <figure className="m-0 flex flex-col overflow-hidden rounded-[10px] border border-line bg-card">
          <div className="relative flex h-64 items-center justify-center bg-[#EFEAE0] md:h-[360px]">
            {urlPrincipal && (
              // eslint-disable-next-line @next/next/no-img-element -- pré-visualização local (blob:)
              <img src={urlPrincipal} alt={`Foto ${indice + 1} da encomenda`} className="size-full object-contain" />
            )}
            {processando && (
              <div className="absolute inset-0 flex items-center justify-center bg-card/70">
                <LoaderCircle className="size-8 animate-spin text-kraft-ink" aria-label="Preparando a foto" />
              </div>
            )}
          </div>
          <figcaption className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs tabular-nums text-ink-2">
            <span>
              Foto {indice + 1} de {value.length}
            </span>
            <span>
              {formatarTamanho(principal.size)}
              {medidas ? ` · ${medidas.largura}×${medidas.altura}` : ""}
            </span>
          </figcaption>
        </figure>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {value.map((f, i) => (
          <Miniatura
            key={`${i}-${f.name}-${f.size}-${f.lastModified}`}
            file={f}
            indice={i}
            selecionada={i === indice}
            onSelecionar={() => setEscolhida(i)}
            onRemover={() => remover(i)}
            disabled={disabled}
          />
        ))}
        {value.length > 0 && value.length < max && (
          <button
            type="button"
            onClick={abrirCamera}
            disabled={travado}
            aria-label="Adicionar outra foto"
            className="flex h-[72px] w-[92px] items-center justify-center rounded-[10px] border border-dashed border-ink-3 bg-card text-ink-3 transition-colors hover:border-kraft hover:text-kraft-ink disabled:opacity-60"
          >
            {processando ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-5" aria-hidden="true" />
            )}
          </button>
        )}
        <span className="self-center text-xs text-ink-3">até {max} fotos (etiqueta + volume)</span>
      </div>

      {erro && (
        <p role="alert" className="text-sm font-medium text-warn">
          {erro}
        </p>
      )}
    </div>
  );
}
