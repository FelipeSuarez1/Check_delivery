"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, SwitchCamera, TriangleAlert } from "lucide-react";
import { classeBotao } from "@/components/portaria/botao";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { validarCodigo } from "@/lib/codigo";

type Camera = "environment" | "user";
const CHAVE_CAMERA = "portaria:camera-qr";

/** Lê o QR do quadro de vídeo atual; devolve o texto ou null (nada legível neste quadro). */
type Leitor = (video: HTMLVideoElement) => Promise<string | null>;

// BarcodeDetector ainda não está no lib.dom do TypeScript
type DetectorNativo = { detect: (fonte: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type ConstrutorDetector = {
  new (opcoes?: { formats?: string[] }): DetectorNativo;
  getSupportedFormats?: () => Promise<string[]>;
};

/**
 * Prefere o `BarcodeDetector` do navegador (Android/Chrome: rápido e sem peso);
 * cai para o `@zxing/browser` (carregado só aqui, só no navegador) onde ele não existe.
 */
async function criarLeitor(): Promise<Leitor> {
  const Detector = (window as unknown as { BarcodeDetector?: ConstrutorDetector }).BarcodeDetector;
  if (Detector) {
    try {
      const formatos = (await Detector.getSupportedFormats?.()) ?? ["qr_code"];
      if (formatos.includes("qr_code")) {
        const detector = new Detector({ formats: ["qr_code"] });
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
      }
    } catch {
      /* cai para o zxing */
    }
  }
  const { BrowserQRCodeReader } = await import("@zxing/browser");
  const leitor = new BrowserQRCodeReader();
  return async (video) => {
    try {
      return leitor.decode(video).getText();
    } catch {
      return null; // "não achou QR neste quadro" é o caso normal
    }
  };
}

function mensagemDoErro(e: unknown): string {
  const nome = e instanceof DOMException ? e.name : e instanceof Error ? e.message : "";
  if (nome === "NotAllowedError" || nome === "SecurityError" || nome === "PermissionDeniedError") {
    return "A câmera está bloqueada. Libere o acesso à câmera nas configurações do navegador e tente de novo — ou digite o código.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError" || nome === "DevicesNotFoundError") {
    return "Este aparelho não tem a câmera pedida. Toque em “Trocar câmera” ou digite o código.";
  }
  if (nome === "NotReadableError" || nome === "TrackStartError") {
    return "A câmera está em uso por outro aplicativo. Feche-o e tente de novo — ou digite o código.";
  }
  if (nome === "sem-api") {
    return "Este navegador só libera a câmera em conexão segura (https). Digite o código.";
  }
  return "Não foi possível abrir a câmera. Digite o código.";
}

function lerPreferencia(): Camera {
  try {
    return window.localStorage.getItem(CHAVE_CAMERA) === "user" ? "user" : "environment";
  } catch {
    return "environment";
  }
}

/**
 * Leitor de QR do celular do morador (o QR contém SÓ o código de 4 caracteres).
 * Abre a câmera em um diálogo, lê continuamente e, ao achar um código válido,
 * chama `onCodigo` - quem chama fecha o diálogo (`aberto=false` desliga a câmera).
 */
export function ScannerQr({
  aberto,
  onFechar,
  onCodigo,
}: {
  aberto: boolean;
  onFechar: () => void;
  onCodigo: (codigo: string) => void;
}) {
  // o <video> só existe com o diálogo aberto: o ref avisa por estado quando ele aparece
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoPronto, setVideoPronto] = useState(false);
  const refVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    setVideoPronto(el !== null);
  }, []);
  const [camera, setCamera] = useState<Camera>(() => (typeof window === "undefined" ? "environment" : lerPreferencia()));
  const [estado, setEstado] = useState<"iniciando" | "lendo" | "erro">("iniciando");
  const [erro, setErro] = useState<string | null>(null);
  const [naoReconhecido, setNaoReconhecido] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!aberto || !videoPronto || !video) return;
    let cancelado = false;
    let achou = false;
    let timer: number | undefined;
    let stream: MediaStream | undefined;
    let ultimoInvalido = "";

    // reinicia o painel a cada abertura / troca de câmera
    setEstado("iniciando");
    setErro(null);
    setNaoReconhecido(null);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("sem-api");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: camera }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.muted = true;
        video.setAttribute("playsinline", "true");
        video.srcObject = stream;
        await video.play();
        const ler = await criarLeitor();
        if (cancelado) return;
        setEstado("lendo");

        const passo = async () => {
          if (cancelado || achou) return;
          if (video.readyState >= 2 && video.videoWidth > 0) {
            let texto: string | null = null;
            try {
              texto = await ler(video);
            } catch {
              texto = null;
            }
            if (texto && !cancelado && !achou) {
              const v = validarCodigo(texto);
              if (v.ok) {
                achou = true;
                onCodigo(v.codigo);
                return;
              }
              if (texto !== ultimoInvalido) {
                ultimoInvalido = texto;
                setNaoReconhecido("Esse QR não é de uma encomenda do Tangará. Tente outro ou digite o código.");
              }
            }
          }
          timer = window.setTimeout(passo, 120);
        };
        void passo();
      } catch (e) {
        if (cancelado) return;
        setEstado("erro");
        setErro(mensagemDoErro(e));
      }
    })();

    return () => {
      cancelado = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
    // onCodigo muda a cada render do pai; a câmera NÃO deve reiniciar por isso
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, videoPronto, camera]);

  function trocarCamera() {
    const proxima: Camera = camera === "environment" ? "user" : "environment";
    try {
      window.localStorage.setItem(CHAVE_CAMERA, proxima);
    } catch {
      /* sem armazenamento: vale só nesta abertura */
    }
    setCamera(proxima);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="gap-3 sm:max-w-[560px]">
        <div className="pr-10">
          <DialogTitle className="font-heading text-lg">Escanear o QR do celular</DialogTitle>
          <DialogDescription className="mt-1 text-[15px]">
            Peça ao morador para abrir a encomenda no app e aponte a câmera para o QR.
          </DialogDescription>
        </div>

        <div className="relative overflow-hidden rounded-[10px] bg-ink">
          <video ref={refVideo} className="aspect-[4/3] w-full object-cover" muted playsInline aria-label="Imagem da câmera" />
          {estado === "lendo" && (
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="size-[58%] rounded-2xl border-[3px] border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,.28)]" />
            </div>
          )}
          {estado === "iniciando" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
              <LoaderCircle className="size-8 animate-spin" aria-hidden />
              <span className="text-[15px]">Abrindo a câmera…</span>
            </div>
          )}
        </div>

        {erro && (
          <p role="alert" className="flex items-start gap-2 rounded-[10px] border border-warn/40 bg-warn-soft px-3.5 py-3 text-[15px] font-medium text-warn">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden /> {erro}
          </p>
        )}
        {naoReconhecido && !erro && (
          <p role="status" className="text-[15px] font-medium text-warn">
            {naoReconhecido}
          </p>
        )}
        {estado === "lendo" && !naoReconhecido && (
          <p role="status" className="text-[15px] text-ink-2">
            Procurando o QR… assim que ler, a encomenda abre sozinha.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={trocarCamera} className={classeBotao()}>
            <SwitchCamera aria-hidden /> Trocar câmera
          </button>
          <button type="button" onClick={onFechar} className={classeBotao({ variante: "escuro" })}>
            Digitar o código
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
