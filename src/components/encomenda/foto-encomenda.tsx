"use client";

/**
 * <FotoEncomenda fotoId alt size? className? />  (22/10/2026)
 * Miniatura da foto (`/fotos/<id>`, autenticada). Sem foto (retenção já apagou,
 * ou nunca houve) ou arquivo que não carrega: placeholder listrado com ícone.
 *  - fotoId: EncomendaResumo.fotoId (number | null)
 *  - alt: texto alternativo (ex. "Foto da encomenda K7M3")
 *  - size: lado em px (padrão 72)
 * É client só para tratar o erro de carregamento; renderiza normal em server components.
 */
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function FotoEncomenda({
  fotoId,
  alt,
  size = 72,
  className,
}: {
  fotoId?: number | null;
  alt: string;
  size?: number;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // erro que aconteceu antes da hidratação não dispara onError: confere o elemento
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFalhou(true);
  }, [fotoId]);

  const mostrar = fotoId != null && !falhou;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-ink-3",
        "bg-[repeating-linear-gradient(135deg,#EFEAE0_0_10px,#E7E1D5_10px_20px)]",
        className
      )}
      style={{ width: size, height: size }}
    >
      {mostrar ? (
        // eslint-disable-next-line @next/next/no-img-element -- rota autenticada própria; o otimizador do Next não carrega o cookie
        <img
          ref={imgRef}
          src={`/fotos/${fotoId}`}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFalhou(true)}
          className="size-full object-cover"
        />
      ) : (
        <ImageIcon
          className="opacity-80"
          style={{ width: Math.max(16, Math.round(size * 0.47)), height: Math.max(16, Math.round(size * 0.47)) }}
          aria-label={alt}
          role="img"
        />
      )}
    </div>
  );
}
