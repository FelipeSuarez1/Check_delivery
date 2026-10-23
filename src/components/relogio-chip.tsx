"use client";

import { useSyncExternalStore } from "react";
import { Clock } from "lucide-react";

const FUSO = "America/Sao_Paulo";

function assinar(avisar: () => void) {
  const id = window.setInterval(avisar, 15_000);
  return () => window.clearInterval(id);
}
// minuto corrente: o valor só muda a cada minuto, então o React não re-renderiza à toa
const minutoAgora = () => Math.floor(Date.now() / 60_000);
// no servidor (e na hidratação) não há relógio: evita divergência de texto
const semRelogio = () => null;

/** "qui 22/10 · 16:48" no fuso de Brasília, atualizado sozinho. */
export function RelogioChip({ className = "" }: { className?: string }) {
  const minuto = useSyncExternalStore(assinar, minutoAgora, semRelogio);

  let texto = "-- --/-- · --:--";
  if (minuto !== null) {
    const partes = new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(minuto * 60_000));
    const v = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
    texto = `${v("weekday").replace(".", "")} ${v("day")}/${v("month")} · ${v("hour")}:${v("minute")}`;
  }

  return (
    <div className={`chip ${className}`} aria-label="Data e hora">
      <Clock className="size-3.5" aria-hidden />
      <span className="tabular-nums" suppressHydrationWarning>
        {texto}
      </span>
    </div>
  );
}
