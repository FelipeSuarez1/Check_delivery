"use client";

/**
 * Estado de "instalar o app" compartilhado pelo banner de /app e pelo cartão de
 * /app/conta (23/10/2026). Um único ouvinte global:
 *  - Android/Chrome: `beforeinstallprompt` é capturado e guardado; o botão
 *    "Instalar" dispara o diálogo do próprio navegador;
 *  - iPhone/iPad (Safari): não existe evento — só instruções (Compartilhar →
 *    Adicionar à Tela de Início);
 *  - já instalado: `display-mode: standalone` (ou `navigator.standalone` no iOS)
 *    ou o evento `appinstalled`.
 * O servidor sempre renderiza o estado "ainda não sei" (`carregado: false`), então
 * não há diferença de hidratação: a tela se completa depois de montar.
 */
import { useEffect, useSyncExternalStore } from "react";

type EventoInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type EstadoInstalacao = {
  /** false até o cliente descobrir o ambiente (e no servidor) */
  carregado: boolean;
  /** já roda como app instalado (ou acabou de instalar) */
  instalado: boolean;
  /** iPhone/iPad (qualquer navegador) */
  ios: boolean;
  /** iPhone/iPad no Safari (o único que instala sem pegadinha) */
  iosSafari: boolean;
  /** o navegador entregou o diálogo de instalação: dá para mostrar o botão "Instalar" */
  podeInstalar: boolean;
};

const ESTADO_SERVIDOR: EstadoInstalacao = {
  carregado: false,
  instalado: false,
  ios: false,
  iosSafari: false,
  podeInstalar: false,
};

let estado: EstadoInstalacao = ESTADO_SERVIDOR;
let evento: EventoInstalacao | null = null;
let iniciado = false;
const ouvintes = new Set<() => void>();

function publicar(parcial: Partial<EstadoInstalacao>) {
  estado = { ...estado, ...parcial };
  ouvintes.forEach((f) => f());
}

function jaInstalado(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      document.referrer.startsWith("android-app://")
    );
  } catch {
    return false;
  }
}

/** Idempotente: registra os ouvintes globais uma vez só (o layout /app fica montado entre as telas). */
export function iniciarEscutaInstalacao(): void {
  if (iniciado || typeof window === "undefined") return;
  iniciado = true;

  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const iosSafari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|DuckDuckGo/.test(ua);
  publicar({ carregado: true, instalado: jaInstalado(), ios, iosSafari });

  window.addEventListener("beforeinstallprompt", (e) => {
    // segura o evento para o nosso botão (e some com a mini-barra do Chrome)
    e.preventDefault();
    evento = e as EventoInstalacao;
    publicar({ podeInstalar: true });
  });
  window.addEventListener("appinstalled", () => {
    evento = null;
    publicar({ instalado: true, podeInstalar: false });
  });
  try {
    window.matchMedia("(display-mode: standalone)").addEventListener("change", () => {
      publicar({ instalado: jaInstalado() });
    });
  } catch {
    /* navegador antigo: fica com a leitura inicial */
  }
}

export type ResultadoInstalacao = "aceito" | "recusado" | "indisponivel";

/** Abre o diálogo de instalação do navegador (só existe depois de `podeInstalar`). */
export async function instalarApp(): Promise<ResultadoInstalacao> {
  const e = evento;
  if (!e) return "indisponivel";
  // cada evento só pode ser usado uma vez
  evento = null;
  publicar({ podeInstalar: false });
  try {
    await e.prompt();
    const escolha = await e.userChoice;
    if (escolha.outcome === "accepted") {
      publicar({ instalado: true });
      return "aceito";
    }
    return "recusado";
  } catch {
    return "indisponivel";
  }
}

function assinar(aviso: () => void): () => void {
  iniciarEscutaInstalacao();
  ouvintes.add(aviso);
  return () => {
    ouvintes.delete(aviso);
  };
}

export function useInstalacao(): EstadoInstalacao {
  return useSyncExternalStore(
    assinar,
    () => estado,
    () => ESTADO_SERVIDOR
  );
}

/** Montado uma vez no layout de /app: garante que o evento do navegador não se perde entre as telas. */
export function EscutaInstalacao() {
  useEffect(() => {
    iniciarEscutaInstalacao();
  }, []);
  return null;
}

/* ------------------------------------------------- "dispensar" o banner */

const CHAVE_DISPENSADO = "encomendas.instalar.dispensado";
const ouvintesDispensa = new Set<() => void>();
// quando o armazenamento não grava (modo privado), o banner some até recarregar
let dispensadoNaSessao = false;

function lerDispensado(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DISPENSADO) === "1";
  } catch {
    return false;
  }
}

export function dispensarBannerInstalar(): void {
  try {
    window.localStorage.setItem(CHAVE_DISPENSADO, "1");
  } catch {
    /* sem armazenamento (modo privado): some só nesta visita */
  }
  dispensadoNaSessao = true;
  ouvintesDispensa.forEach((f) => f());
}

/** true quando o morador já dispensou o banner neste aparelho; null no servidor (ainda não sei). */
export function useBannerDispensado(): boolean | null {
  return useSyncExternalStore(
    (aviso) => {
      ouvintesDispensa.add(aviso);
      return () => {
        ouvintesDispensa.delete(aviso);
      };
    },
    () => dispensadoNaSessao || lerDispensado(),
    () => null
  );
}
