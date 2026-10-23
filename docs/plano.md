# Encomendas na Portaria — plano técnico (PWA)

> Escrito em 22/10/2026 a partir do mockup aprovado pelo Felipe
> (https://claude.ai/artifact/39HB2MNevfcbzGVjMPSZsF). App SEPARADO do site
> financeiro, com login e banco próprios. Versão 1 = PWA (instalável sem loja);
> embrulhar para App Store / Play Store fica como fase futura (Capacitor).

## 1. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Onde vive | App separado, repositório próprio (`encomendas-tangara`, privado) |
| Portaria | Login único `portaria` + "porteiro de turno" escolhido na tela e gravado em cada encomenda; login individual por porteiro na fase 4 |
| Retirada | Código único por encomenda (4 caracteres, sem 0/O/1/I), conferido pelo porteiro (digitado ou QR), registrando quem retirou (morador do apto ou terceiro) |
| Aviso | Morador vê ao abrir o app + botão WhatsApp com mensagem pronta (envio manual pelo porteiro). Push na fase 4; WhatsApp automático (API paga) só se fizer falta |
| Código | Não é segredo: vai na etiqueta da caixa e no WhatsApp. A segurança é QUEM retira |
| Visual | Direção "etiqueta de despacho" (papel claro, kraft, código em mono) |

Assumidas até o Felipe dizer o contrário (perguntas abertas do canvas):

1. Tablet Android dedicado no balcão, com o app instalado em tela cheia.
2. Etiqueta impressa é opcional: página de impressão simples (funciona em impressora comum; térmica se houver).
3. Apartamentos, moradores e telefones vêm do cadastro do site financeiro (exportação CSV → importador), não se cadastra de novo.
4. Foto fica 90 dias depois da entrega; o registro fica para sempre.
5. Terceiro retirando: nome obrigatório, documento opcional.

## 2. Stack (igual ao site, de propósito)

- **Next.js (App Router) + TypeScript**, Tailwind + shadcn/ui, **Server Actions** (sem API routes de CRUD), Prisma + **SQLite** (um condomínio, 52 unidades, baixo volume).
- **PWA**: `manifest.webmanifest`, service worker que cacheia SÓ assets estáticos (`/_next/static`, ícones) — nunca página nem dado (lição LGPD do site: nada de encomenda legível após logout).
- **Câmera**: `<input type="file" accept="image/*" capture="environment">` (funciona em todo navegador, sem permissão especial) + redução no cliente via canvas para ~1200 px / ~200 KB antes de enviar.
- **QR**: gerar com a lib `qrcode` (SVG, no servidor ou no cliente); ler com `BarcodeDetector` do navegador quando existir (Android Chrome) e `@zxing/browser` como alternativa (iOS/Safari).
- **Auth**: copiar do site os módulos já endurecidos — `sessao-token.ts` (cookie HMAC-SHA256, 30 dias, `sv` da senha), `senha.ts` (scrypt), rate limit do login por login+origem, middleware com allowlist por papel, `x-rota-verificada`, matcher sem padrão genérico com ponto.
- **Hospedagem**: no servidor do Aquiles, ao lado do site — segundo processo Next na porta **3001**, `cloudflared` com ingress `encomendas.tangaracondominio.com.br → localhost:3001`. Sem Cloudflare Access (moradores demais; o login do app é a barreira). Backup diário com `VACUUM INTO` na mesma tarefa agendada. Alternativa: nuvem, se a máquina do Aquiles virar gargalo.

## 3. Modelo de dados (Prisma)

```
Apartamento   id · numero ("11A") · torre ("A"|"B") · andar · ativo
Morador       id · apartamentoId · nome · telefone? · ativo
Usuario       id · login · senhaHash · senhaSalt · papel ('admin'|'portaria'|'morador')
              · apartamentoId? (morador) · ativo · precisaTrocarSenha
Porteiro      id · nome · ativo · usuarioId? (fase 4)
Turno         id · porteiroId · inicio · fim? · abertoPorUsuarioId
Encomenda     id · codigo (unique) · apartamentoId · destinatarioMoradorId?
              · destinatarioNome (fallback "outro nome") · tipo
              ('caixa'|'envelope'|'sacola'|'mercado'|'perecivel') · transportadora?
              · observacao? · local? · status ('aguardando'|'entregue'|'cancelada')
              · recebidaEm · recebidaPorPorteiroId · entregueEm? · entreguePorPorteiroId?
              · retiradaPorMoradorId? · retiradaTerceiroNome? · retiradaTerceiroDoc?
              · canceladaEm? · canceladaMotivo? · avisoWhatsAppEm?
FotoEncomenda id · encomendaId · arquivo (nome gerado) · ordem · criadaEm · apagadaEm?
PushInscricao id · usuarioId · endpoint · p256dh · auth · criadaEm      (fase 4)
LogEvento     id · usuarioId? · usuarioNome · papel · tipo · rota · detalhe · criadoEm
```

- `codigo`: alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 símbolos, 4 posições ≈ 1 milhão), gerado no servidor, único para sempre, nunca reaproveitado.
- Nada se apaga: cancelar = status + motivo; morador desativado continua no histórico.
- Fotos em `uploads/encomendas/` (FORA de `/public`), nome gerado, extensão por allowlist, 10 MB no máximo por foto antes da redução.

## 4. Papéis e rotas

| Papel | Rotas | Pode |
|---|---|---|
| `portaria` | `/portaria` (aguardando) · `/portaria/registrar` · `/portaria/retirada` · `/portaria/historico[/apto]` · `/portaria/turno` | registrar, confirmar retirada, cancelar no próprio turno, avisar WhatsApp, imprimir etiqueta, ver todos os aptos |
| `morador` | `/app` (na portaria) · `/app/encomenda/[codigo]` · `/app/historico` · `/app/conta` | ver SÓ o próprio apto (código, foto, linha do tempo), trocar senha |
| `admin` | tudo acima + `/admin` (painel) · `/admin/moradores` · `/admin/porteiros` · `/admin/usuarios` · `/admin/exportar` | cadastros, cancelar qualquer registro, exportar CSV, alertas |
| rotas de dado | `/fotos/[id]` (auth + checagem do apto) · `/etiqueta/[codigo]` (impressão) · `/manifest.webmanifest` · `/sw.js` | — |

Regras copiadas do site: toda action de escrita começa com a guarda de papel; rota que serve arquivo reconfere a sessão e o apartamento; middleware devolve 404 fora da allowlist do papel; UI só esconde.

## 5. Fluxos (server actions)

- `registrarEncomenda(form, fotos[])` → valida (zod), reduz/grava fotos, gera código, status `aguardando`, `recebidaPorPorteiroId` = porteiro do turno aberto, log. Devolve código + URL `wa.me` pronta.
- `avisarWhatsApp(id)` → marca `avisoWhatsAppEm`, devolve `https://wa.me/55<telefone>?text=<mensagem>`. Mensagem: "Olá, {nome}! Chegou uma encomenda para você na portaria do Espaço Tangará. Código {K7M3} · {tipo} · {transportadora}. Qualquer morador do {apto} pode retirar mostrando o código. — Portaria".
- `confirmarRetirada(codigo, retiradaPor)` → encomenda `aguardando` + código confere → `entregue`, `entreguePorPorteiroId`, quem retirou (morador do apto OU terceiro com nome/doc), log.
- `cancelarEncomenda(id, motivo)` → `cancelada` (portaria só no turno em que foi registrada; admin sempre).
- `iniciarTurno(porteiroId)` / `encerrarTurno()` → um turno aberto por vez; cada registro referencia o porteiro do turno.
- Morador: leitura por `apartamentoId` da sessão, nunca por parâmetro da URL.
- Admin: CRUD de moradores/porteiros/usuários, `exportarCsv(periodo)`, painel (aguardando por torre, paradas > 3 dias, entregas por dia e por porteiro, tempo médio de retirada).
- Job diário (tarefa agendada): apagar arquivos de foto de encomendas entregues/canceladas há mais de 90 dias (`apagadaEm` preenchido) + backup.

## 6. PWA e tablet

- Manifest: nome "Encomendas Tangará", `display: standalone`, ícones 192/512 + maskable, `start_url` = `/` (o middleware manda cada papel para a sua tela inicial).
- Service worker: só `/_next/static` e `/icons`. Sem cache de página.
- Tablet da portaria: Android com Chrome, app "Adicionar à tela inicial", sessão de 30 dias, fixação de tela (modo quiosque) opcional. Nada de loja.
- Morador no iPhone: instalar pela tela de compartilhar do Safari; push só funciona instalado (iOS 16.4+) — fase 4.

## 7. Segurança e LGPD (checklist desde o 1º commit)

- Senhas scrypt; primeira senha gerada e `precisaTrocarSenha = true` (não repetir a senha única do site).
- Rate limit do login; sessão derrubada ao trocar senha; usuário desativado cai na navegação seguinte.
- Fotos e dados de encomenda só com login; morador só vê o próprio apto (checado no servidor pelo `apartamentoId` da sessão).
- Retenção: foto 90 dias após entrega; registro permanente. Telefone do morador nunca aparece para outros moradores.
- Logs de toda escrita (quem, quando, o quê) — é o "livro" auditável.
- Cabeçalhos de segurança (CSP, nosniff, frame-ancestors) e `serverActions.allowedOrigins` com o subdomínio ANTES de publicar.
- `.env`, `dev.db`, `uploads/` fora do git.

## 8. Fases e estimativa

| Fase | Entrega | Prazo |
|---|---|---|
| 0 · Base | Repo, scaffold, auth copiada, schema + migração, importador de aptos/moradores (CSV do site), deploy na porta 3001 + subdomínio | 1–2 dias |
| 1 · Portaria | Aguardando, registrar com fotos, código, turno, confirmar retirada (digitação + QR), histórico por apto, WhatsApp manual, etiqueta imprimível | 1 semana |
| 2 · Morador | Login por apto, lista, tela do código com QR, histórico, troca de senha, PWA instalável | 3–4 dias |
| 3 · Admin e operação | Painel, cadastros, exportação CSV, alerta de parada, job de retenção, backup, logs | 3–4 dias |
| Piloto | 1 semana na portaria em paralelo ao livro; ajustes do que o porteiro apontar | 1 semana |
| 4 · Depois | Push (Web Push/VAPID), login por porteiro com relatório de turno, WhatsApp automático, loja (Capacitor) | sob demanda |

Validação em cada fase como no site: `tsc` limpo, teste Playwright por papel (portaria/morador/admin: rotas proibidas = 404, zero botões de escrita para morador, fluxo registrar → ver no app → retirar), screenshots desktop/tablet/celular antes de publicar.

## 9. Custos

Subdomínio e túnel: já existem (grátis). Tablet Android básico se não houver (R$ 600–900). Impressora: opcional. Loja: só na fase 4 (Apple US$ 99/ano, Google US$ 25 uma vez).

## 10. Primeiros passos concretos

1. Criar o repositório `encomendas-tangara` (privado) e copiar `src/lib/{sessao-token,senha,acesso-local,rota-header}.ts` e o middleware do site como ponto de partida.
2. Exportar do site `Apartamento` + `Morador` (nome, telefone, apto) para CSV → importador do app novo.
3. Decidir o subdomínio e abrir o ingress no `cloudflared` do servidor (sem Access).
4. Implementar a fase 1 com validação Playwright; só depois dar o tablet para a portaria.
