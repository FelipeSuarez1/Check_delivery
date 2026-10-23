import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bloco central para listas vazias: ícone num círculo kraft, título, texto e ação opcional. */
export function EstadoVazio({
  icone,
  titulo,
  texto,
  acao,
  className,
}: {
  icone: ReactNode;
  titulo: string;
  texto?: string;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-line bg-card px-6 py-14 text-center",
        className
      )}
    >
      <span className="flex size-16 items-center justify-center rounded-full bg-kraft-soft text-kraft-ink [&_svg]:size-8">
        {icone}
      </span>
      <h2 className="font-heading text-xl">{titulo}</h2>
      {texto && <p className="max-w-md text-base text-ink-2">{texto}</p>}
      {acao && <div className="mt-1">{acao}</div>}
    </div>
  );
}
