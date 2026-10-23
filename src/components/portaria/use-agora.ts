"use client";

import { useSyncExternalStore } from "react";
import { formatarHora } from "@/lib/datas";

function assinar(avisar: () => void) {
  const id = window.setInterval(avisar, 15_000);
  return () => window.clearInterval(id);
}
const minutoAgora = () => Math.floor(Date.now() / 60_000);
// no servidor (e na hidratação) não há relógio: evita divergência de texto
const semRelogio = () => null;

/**
 * Instante atual arredondado ao minuto (ms), ou null no servidor/hidratação.
 * Só muda a cada minuto, então não re-renderiza à toa. Textos que dependem da
 * hora ("entregue às 16:50", "há 2 h") usam isto para não divergir entre o
 * HTML do servidor e o do navegador.
 */
export function useAgora(): number | null {
  const minuto = useSyncExternalStore(assinar, minutoAgora, semRelogio);
  return minuto === null ? null : minuto * 60_000;
}

/** "16:50" no fuso de Brasília, ou null enquanto não há relógio. */
export function useHoraAgora(): string | null {
  const agora = useAgora();
  return agora === null ? null : formatarHora(agora);
}
