/**
 * /etiqueta/[codigo] - etiqueta para colar na caixa (22/10/2026).
 * A6 paisagem (148 x 105 mm), preto sobre branco (serve a impressora comum e a
 * térmica): código em mono enorme, QR do próprio código, apto e destinatário.
 * Só portaria/admin (a allowlist do middleware já barra os demais; aqui reforça).
 * Na tela cobre o cabeçalho do app; na impressão só a folha sai.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QrCodigo } from "@/components/encomenda/qr-codigo";
import { exigirPapelNaPagina } from "@/lib/auth";
import { validarCodigo } from "@/lib/codigo";
import { formatarDataHora } from "@/lib/datas";
import { buscarPorCodigo } from "@/lib/encomendas";
import { AcoesEtiquetaClient } from "./acoes-etiqueta-client";

export const metadata: Metadata = {
  title: "Etiqueta · Portaria",
  robots: { index: false, follow: false },
};

const CSS = `
.etiqueta-tela{position:fixed;inset:0;z-index:2147483000;overflow:auto;background:#EDE9E0;color:#000;
  font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;padding:20px 16px 40px;
  display:flex;flex-direction:column;align-items:center;gap:16px}
.etiqueta-barra{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;width:148mm;max-width:100%}
.etiqueta-aviso{flex-basis:100%;text-align:center;font-size:14px;font-weight:600;color:#B54A1F}
.etiqueta-folha{box-sizing:border-box;flex-shrink:0;width:148mm;height:105mm;background:#fff;color:#000;
  border:.4mm solid #000;padding:6mm 8mm 5mm;display:flex;flex-direction:column;box-shadow:0 6px 24px rgba(0,0,0,.15)}
.et-topo{display:flex;justify-content:space-between;align-items:baseline;font-size:3.4mm;font-weight:700;
  letter-spacing:.14em;text-transform:uppercase;border-bottom:.3mm solid #000;padding-bottom:2mm}
.et-topo .num{font-variant-numeric:tabular-nums;letter-spacing:.04em}
.et-corpo{flex:1;min-height:0;display:flex;justify-content:space-between;align-items:center;gap:5mm}
.et-esq{display:flex;flex-direction:column;min-width:0;flex:1}
.et-codigo{font-family:"IBM Plex Mono",ui-monospace,"SFMono-Regular",Consolas,monospace;font-weight:700;
  font-size:30mm;line-height:1;letter-spacing:.06em;margin-left:-1mm}
.et-apto{font-family:Sora,"IBM Plex Sans",system-ui,sans-serif;font-weight:700;font-size:14mm;line-height:1.05;margin-top:2mm}
.et-nome{font-size:6.2mm;font-weight:600;line-height:1.15;max-height:2.35em;overflow:hidden;margin-top:1mm}
.et-meta{font-size:4.4mm;margin-top:1mm}
.et-qr{flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1.5mm}
.et-qr > div{width:36mm !important;height:36mm !important}
.et-qr svg{width:100% !important;height:100% !important;display:block}
.et-qr small{font-size:3mm;letter-spacing:.08em;text-transform:uppercase}
.et-rodape{display:flex;justify-content:space-between;gap:4mm;font-size:3.3mm;border-top:.3mm solid #000;padding-top:2mm}
@page{size:148mm 105mm;margin:0}
@media print{
  html,body{margin:0 !important;padding:0 !important;background:#fff !important;height:105mm !important;overflow:hidden !important}
  body *{visibility:hidden !important}
  .etiqueta-tela{position:fixed;inset:0;overflow:visible;background:#fff;padding:0;display:block}
  .etiqueta-folha,.etiqueta-folha *{visibility:visible !important}
  .etiqueta-folha{position:fixed;left:0;top:0;box-shadow:none;border-width:.3mm}
  .etiqueta-barra{display:none !important}
}
`;

export default async function PaginaEtiqueta({ params }: { params: Promise<{ codigo: string }> }) {
  const sessao = await exigirPapelNaPagina("portaria", "admin");
  const { codigo: bruto } = await params;
  const v = validarCodigo(bruto);
  if (!v.ok) notFound();
  const e = await buscarPorCodigo(v.codigo);
  if (!e) notFound();

  const detalhe = [e.tipoRotulo, e.transportadora].filter(Boolean).join(" · ");
  return (
    <div className="etiqueta-tela">
      <style>{CSS}</style>
      <div className="etiqueta-barra">
        <AcoesEtiquetaClient voltarPara={sessao.papel === "admin" ? "/admin" : "/portaria"} />
        {e.status !== "aguardando" && (
          <p className="etiqueta-aviso">
            Atenção: esta encomenda está {e.status === "entregue" ? "ENTREGUE" : "CANCELADA"} - não cole esta etiqueta.
          </p>
        )}
      </div>
      <div className="etiqueta-folha">
        <div className="et-topo">
          <span>Espaço Tangará · Portaria</span>
          <span className="num">{formatarDataHora(e.recebidaEm)}</span>
        </div>
        <div className="et-corpo">
          <div className="et-esq">
            <div className="et-codigo">{e.codigo}</div>
            <div className="et-apto">{e.apartamento}</div>
            <div className="et-nome">{e.destinatarioNome}</div>
            <div className="et-meta">{detalhe}</div>
          </div>
          <div className="et-qr">
            <QrCodigo codigo={e.codigo} size={136} />
            <small>Mostre na portaria</small>
          </div>
        </div>
        <div className="et-rodape">
          <span>Recebida por {e.recebidaPor}</span>
          <span>Retire mostrando o código</span>
        </div>
      </div>
    </div>
  );
}
