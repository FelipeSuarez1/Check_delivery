# Encomendas Tangará — controle de encomendas da portaria (PWA)

App SEPARADO do site financeiro do condomínio Espaço Tangará (repo
`condominio-tangara`). Substitui o livro de encomendas da portaria: o porteiro
registra cada volume com foto, apartamento e destinatário; o sistema gera um
**código único por encomenda**; os moradores do apartamento veem suas
encomendas no celular (app instalável, sem loja) e retiram mostrando o código.
Plano técnico de origem: `docs/plano-encomendas-portaria.md` do repo do site
(cópia em `docs/plano.md` aqui). Mockup aprovado pelo Felipe em 22/10/2026:
https://claude.ai/artifact/39HB2MNevfcbzGVjMPSZsF

## 1. Decisões de produto (não re-perguntar)

- **Portaria** entra com UM login (`portaria`) e escolhe o **porteiro de turno**
  na tela; cada encomenda grava o porteiro que recebeu e o que entregou. Login
  individual por porteiro = fase 4.
- **Código**: 4 caracteres do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  (sem 0/O/1/I), gerado no servidor, único para sempre. **Não é segredo**: vai
  na etiqueta da caixa e na mensagem do WhatsApp. A segurança é QUEM retira.
- **Retirada**: porteiro digita o código (ou lê o QR do celular do morador),
  confere a encomenda e registra quem retirou — morador do apto (lista) ou
  **terceiro** (nome obrigatório, documento opcional).
- **Aviso**: o morador vê ao abrir o app + botão "Avisar no WhatsApp" que abre
  `wa.me` com mensagem pronta (envio manual pelo porteiro). Push = fase 4.
- **Todos os moradores do apartamento veem todas as encomendas do apartamento**
  (login é por apartamento: `ap11a`, `ap261b`…). Cada card diz para quem veio.
- **Nada se apaga**: cancelar = status `cancelada` + motivo. Foto é apagada do
  disco 90 dias após a entrega (registro fica).
- **Alerta de parada**: aguardando há mais de 3 dias = vermelho na portaria e
  no painel do admin.
- Tablet Android dedicado no balcão; etiqueta impressa é opcional (página de
  impressão simples); apartamentos/moradores/telefones vêm do site por CSV.

## 2. Stack e convenções

Next.js 16 (App Router) + TypeScript · Tailwind 4 + shadcn/ui · Prisma +
SQLite (`prisma/dev.db`) · **Server Actions** (sem API routes de CRUD; route
handlers só para servir arquivo/manifest/etiqueta) · PWA (manifest + service
worker que cacheia SÓ assets estáticos, nunca página nem dado).

- Identificadores em pt-BR **sem acento**; strings de UI **com acento**.
- Datas em UTC no banco; exibição pt-BR (`dd/MM HH:mm`). Sem dinheiro neste app.
- Comentários só para o que o código não diz (invariantes, decisões com data).
- Server component busca dados e passa props serializáveis; client components
  com `"use client"` e sufixo `-client.tsx` quando pareados a uma page.
- **Toda action de escrita** começa com a guarda de papel e devolve
  `{ ok: boolean; erro?: string; ... }`; zod em todo input; `revalidatePath`
  de todas as rotas afetadas.
- Tabela larga: `div.overflow-x-auto` + `[contain:layout]`. `tabular-nums` em
  colunas de número/hora. Alvos de toque ≥ 44 px (tablet e celular).
- Windows + PowerShell 5.1 na máquina de dev: NUNCA editar arquivo com acento
  via Get-Content/Set-Content (mojibake) — usar as ferramentas de edição;
  console é cp1252 (scripts imprimem ASCII ou gravam UTF-8 em arquivo).
- Scripts de dados: idempotentes, dry-run por padrão, `--aplicar` grava.

## 3. Modelo de dados

`prisma/schema.prisma` é a fonte da verdade. Resumo:

- `Apartamento` (numero "11A", torre "A"|"B", andar, ativo) · `Morador`
  (apartamentoId, nome, telefone?, ativo) — importados do site.
- `Usuario` (login único, senhaHash/senhaSalt scrypt, papel
  `admin`|`portaria`|`morador`, apartamentoId? p/ morador, ativo,
  precisaTrocarSenha).
- `Porteiro` (nome, ativo) · `Turno` (porteiroId, inicio, fim?) — um turno
  aberto por vez; o porteiro do turno aberto é gravado em cada registro.
- `Encomenda` (codigo único, apartamentoId, destinatarioMoradorId?,
  destinatarioNome, tipo, transportadora?, observacao?, local?, status
  `aguardando`|`entregue`|`cancelada`, recebidaEm, recebidaPorPorteiroId,
  entregueEm?, entreguePorPorteiroId?, retiradaPorMoradorId?,
  retiradaTerceiroNome?, retiradaTerceiroDoc?, canceladaEm?,
  canceladaMotivo?, avisoWhatsAppEm?).
- `FotoEncomenda` (encomendaId, arquivo, ordem, apagadaEm?) — arquivo em
  `uploads/encomendas/` (FORA de /public), nome gerado no servidor.
- `LogEvento` (usuarioId?, usuarioNome, papel, tipo, rota, detalhe) — toda
  escrita gera um evento: é o "livro" auditável.
- `PushInscricao` — fase 4 (já no schema, sem uso).

## 4. Papéis e rotas (allowlist no middleware — fora dela = 404)

| Papel | Rotas | Tela inicial |
|---|---|---|
| `portaria` | `/portaria`, `/portaria/registrar`, `/portaria/retirada`, `/portaria/historico`, `/portaria/historico/[apto]`, `/portaria/turno`, `/etiqueta/[codigo]` | `/portaria` |
| `morador` | `/app`, `/app/encomenda/[codigo]`, `/app/historico`, `/app/conta` | `/app` |
| `admin` | tudo acima + `/admin`, `/admin/moradores`, `/admin/porteiros`, `/admin/usuarios`, `/admin/exportar`, `/admin/logs` | `/admin` |
| todos logados | `/fotos/[id]` (checa o apto do morador), `/conta/senha` | — |
| públicas | `/login`, `/manifest.webmanifest`, `/sw.js`, `/icons/*` | — |

Fonte única dos papéis/allowlist: `src/lib/papeis.ts`. Guardas em
`src/lib/auth.ts`: `lerSessaoVerificada()`, `exigirPapel("portaria"|"admin"|"morador")`,
`exigirPortariaOuAdmin()`, `exigirAdmin()`. UI só esconde; o servidor decide.

## 5. Contrato das actions e libs (assinaturas fixas — quem precisa, usa)

`src/lib/encomendas.ts` (regra de negócio pura, sem UI):
- `gerarCodigo(): Promise<string>` — único, alfabeto sem ambíguos.
- `listarAguardando(filtro?: { torre?: "A"|"B"; apartamentoId?: number; busca?: string })`
- `listarHistoricoApartamento(apartamentoId, periodo?)` e `listarHistoricoGeral(periodo, filtros)`
- `buscarPorCodigo(codigo)` · `encomendaParaMorador(id, apartamentoIdDaSessao)` (null se não for do apto)
- `diasParada(encomenda): number` · `PARADA_DIAS = 3`
- `mensagemWhatsApp(encomenda): string` e `linkWhatsApp(telefone, mensagem): string` (DDI 55 assumido)

`src/actions/encomendas.ts` (escrita, guarda `portaria|admin`):
- `registrarEncomenda(formData)` → `{ ok, codigo?, id?, erro? }` (campos: apartamentoId, destinatarioMoradorId|destinatarioNome, tipo, transportadora?, observacao?, local?, fotos[] (1–3))
- `confirmarRetirada({ codigo, retiradaPorMoradorId? , terceiroNome?, terceiroDoc? })`
- `cancelarEncomenda({ id, motivo })` — portaria só no turno em que foi registrada; admin sempre
- `marcarAvisoWhatsApp({ id })` → `{ ok, link }`

`src/actions/turno.ts`: `iniciarTurno({ porteiroId })`, `encerrarTurno()`, `turnoAberto()`.
`src/actions/conta.ts`: `trocarSenha({ atual, nova })` (qualquer papel; reemite cookie).
`src/lib/fotos.ts`: `salvarFoto(file, encomendaId, ordem)` (allowlist jpg/png/webp, ≤10 MB, redimensiona no cliente antes), `caminhoFoto(foto)`, `apagarFotosAntigas(dias=90)`.

## 6. Visual (do mockup — fonte única em `src/app/globals.css` + `src/components/ui`)

Direção "etiqueta de despacho": papel claro, kraft como acento, código em mono.
Tokens: `--paper #FAF8F3 · --card #FFFFFF · --ink #1F1D1A · --ink-2 #5C574F ·
--ink-3 #8E887E · --line #E6E1D8 · --kraft #C47A2C · --kraft-ink #7A4712 ·
--kraft-soft #F6E9D8 · --ok #2E7D4F / #E3F2E8 · --warn #B54A1F / #FBE7DE ·
--info #2F5FB3 / #E4ECF9`. Fontes Google: **Sora** (títulos), **IBM Plex Sans**
(texto), **IBM Plex Mono** (códigos, `letter-spacing .06em`). Componentes
próprios em `src/components/`: `CodigoEncomenda` (mono grande), `StampStatus`
(carimbo aguardando/entregue/cancelada/parada), `CardEncomenda`,
`FotoEncomenda`, `SeletorMoradores` (chips), `ChipsTipo`. Badges/chips: altura
36 px; botões 48 px (grandes 60 px). Tablet: 1180 px de largura útil; celular:
390 px, nav inferior com 3 itens.

## 7. Segurança e LGPD (checklist de toda mudança)

1. Action de escrita → guarda de papel primeiro; zod depois; log por último.
2. Morador lê SÓ pelo `apartamentoId` da sessão — nunca por parâmetro de URL.
3. `/fotos/[id]` reconfere sessão + apto (morador) e devolve 404 sem vazar.
4. Middleware: matcher exclui só assets NOMEADOS; nunca padrão genérico com
   ponto (`/encomenda/12.` escapava no site); carimbo `x-rota-verificada`.
5. Senhas scrypt; senha inicial gerada por usuário + `precisaTrocarSenha`
   (nunca uma senha única para todos); rate limit do login por login+origem.
6. Uploads: allowlist de extensão, tamanho, nome gerado, fora de /public.
7. Service worker nunca cacheia página/dado. Cabeçalhos de segurança no
   `next.config.ts`; `serverActions.allowedOrigins` com o domínio antes de
   publicar. `.env`, `dev.db`, `uploads/`, `backups/` no `.gitignore`.
8. Telefone do morador nunca aparece para outro morador.

## 8. Validação

- `npx tsc --noEmit` limpo e `npm run build` antes de qualquer merge.
- `scripts/teste-perfis.ts` (Playwright): por papel, rotas proibidas = 404,
  zero controle de escrita para morador, fluxo registrar → ver no app →
  retirar. `scripts/screenshot.ts <pasta> <rotas…>` com `LOGIN_USUARIO`/`LOGIN_SENHA`.
- Contas de teste: `scripts/cria-usuarios-teste.ts <senha>` / `--remover`.

## 9. Operação (quando publicar)

Servidor = máquina do Aquiles, porta **3001**, túnel Cloudflare com ingress
`encomendas.tangaracondominio.com.br` (sem Access). Backup diário `VACUUM INTO`.
Job diário: `scripts/retencao-fotos.ts` (apaga arquivos de fotos de encomendas
entregues/canceladas há > 90 dias).
