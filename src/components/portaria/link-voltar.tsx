import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Chip "← Voltar" do cabeçalho das telas internas (44 px de altura de toque). */
export function LinkVoltar({
  href,
  children = "Voltar",
  className,
}: {
  href: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("chip h-11 shrink-0 cursor-pointer transition-colors hover:bg-muted", className)}>
      <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
      {children}
    </Link>
  );
}
