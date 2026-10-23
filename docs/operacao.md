# Operação do servidor — Encomendas Tangará

Runbook da **máquina do Aquiles** (o servidor). A máquina do Felipe é só desenvolvimento: nunca
roda dado real. Escrito em 23/10/2026. Comandos em **PowerShell 5.1** (sem `&&`; um comando por
linha). Seções 3 e 6 pedem **PowerShell como Administrador**.

| Item | Valor |
|---|---|
| Porta do app | **3001** (o site financeiro fica na 3000) |
| Endereço público | `https://encomendas.tangaracondominio.com.br` (túnel Cloudflare, **sem** Access) |
| Pasta do app | `C:\apps\encomendas-tangara` — **fora do OneDrive** (o `.env` tem o segredo de sessão; o banco e as fotos têm dado de morador) |
| Banco | `prisma\dev.db` (SQLite) |
| Fotos | `uploads\encomendas\` (fora de `public`; só `/fotos/[id]`, com login, serve) |
| Backups | `backups\encomendas-AAAA-MM-DD.db` + `backups\backup.log` |
| Logins fixos | `felipe` e `achilles` (admin), `portaria` (balcão), `ap<número>` por apartamento (`ap11a`…`ap261b`) |

---

## 1. Instalar (primeira vez)

Pré-requisitos: Node 22 LTS, git e o repositório `encomendas-tangara` (privado). Os arquivos
`dados\apartamentos.csv` e `dados\moradores.csv` **não vão no git** (têm nome e telefone): vêm da
máquina do Felipe por pendrive, para a pasta `dados\`.

```powershell
git clone <url-do-repositorio> C:\apps\encomendas-tangara
cd C:\apps\encomendas-tangara
```

**`.env`** (arquivo novo na raiz; nunca commitar):

```
DATABASE_URL="file:./dev.db"
AUTH_SECRET="<gere com o comando abaixo>"
ORIGENS_PERMITIDAS="encomendas.tangaracondominio.com.br"
```

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

- `AUTH_SECRET` precisa ter 32+ caracteres e **não** pode ser o valor de exemplo — o app recusa
  subir (503) com um segredo fraco. Quem souber o segredo forja a sessão de um admin: não
  copie para chat, e-mail ou pasta sincronizada.
- `ORIGENS_PERMITIDAS` é **só o domínio, sem `https://`**: o Next compara com o `host` da
  origem (`new URL(origin).host`); com o esquema na frente a comparação nunca bate e o app
  "lê mas não salva" (todo formulário falha). Vários domínios: separar por vírgula.

```powershell
npm ci
npx prisma generate
npx prisma migrate deploy
npx tsx scripts/importa-cadastro.ts
npx tsx scripts/importa-cadastro.ts --aplicar
npx tsx scripts/cria-usuarios.ts
npx tsx scripts/cria-porteiros.ts "Nome Real 1" "Nome Real 2" --dry-run
npx tsx scripts/cria-porteiros.ts "Nome Real 1" "Nome Real 2"
npm run build
```

- `importa-cadastro` sem `--aplicar` é simulação (só conta). Esperado: 52 apartamentos, 95 moradores.
- `cria-usuarios` gera a senha inicial **de cada login** e grava tudo em
  `dados\senhas-iniciais-AAAA-MM-DD.txt` (veja a seção 5).
- `cria-porteiros`: use os **nomes reais** (sem argumentos ele cria os exemplos José e Marcos).
  Depois, pelo painel (`/admin/porteiros`), dá para criar, renomear e desativar.
- Primeiro acesso do administrador: entrar com `felipe` ou `achilles` e a senha do arquivo; o app
  obriga a escolher a senha própria.

Suba o app (seção 2) e confira o checklist da seção 7.

---

## 2. Publicar e atualizar

### 2.1 Parar a porta 3001 — conferindo QUEM está nela

Nunca mate "o node" às cegas: o site financeiro (porta 3000) e o túnel também são processos
Node/Windows. Confira a linha de comando antes:

```powershell
$donos = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $donos) { Get-CimInstance Win32_Process -Filter "ProcessId=$p" | Select-Object ProcessId, CommandLine }
```

A `CommandLine` precisa conter `encomendas-tangara`. Só então:

```powershell
foreach ($p in $donos) { Stop-Process -Id $p -Force }
```

Feche também a janela de console "Encomendas Espaco Tangara" (o `iniciar-app.cmd` tem `pause`).
Sem processo na porta: `Get-NetTCPConnection -LocalPort 3001 -State Listen` deve dar erro de "não encontrado".

### 2.2 Atualizar o código e subir

```powershell
cd C:\apps\encomendas-tangara
git pull
npm ci
npx prisma migrate deploy
npm run build
Start-Process scripts\iniciar-app.cmd -WindowStyle Minimized
```

> **Ordem importa:** pare o app **antes** de `npm ci`. Com ele rodando, o Windows trava o binário
> do Next/Prisma e o `npm` falha com EPERM no meio, deixando `node_modules` quebrado. `npm ci`
> só é necessário quando `package-lock.json` mudou; `migrate deploy` só aplica migrações novas
> (e nunca apaga dado).

Faça um **backup manual antes de qualquer atualização** que traga migração:
`npx tsx scripts/backup-diario.ts`.

### 2.3 Iniciar com o Windows

Atalho na pasta Inicializar (uma vez):

```powershell
$ws = New-Object -ComObject WScript.Shell
$atalho = $ws.CreateShortcut("$([Environment]::GetFolderPath('Startup'))\Encomendas Tangara.lnk")
$atalho.TargetPath = "C:\apps\encomendas-tangara\scripts\iniciar-app.cmd"
$atalho.WorkingDirectory = "C:\apps\encomendas-tangara"
$atalho.WindowStyle = 7
$atalho.Save()
```

`scripts\iniciar-app.cmd` é o mesmo padrão do site (`iniciar-site.cmd`): entra na raiz do projeto
e roda `npm run start` (porta 3001, modo produção). Só inicia depois do logon do Windows.

---

## 3. Túnel Cloudflare (hostname novo no túnel que já existe)

Não crie outro túnel nem use `cloudflared tunnel --url`: acrescente **uma linha de ingress** ao
`config.yml` do `cloudflared` que já serve o site. PowerShell **como Administrador**.

1. Editar `C:\Users\<usuário>\.cloudflared\config.yml` — a regra nova vem **antes** do
   `http_status:404` final, que continua sendo a última:

   ```yaml
   ingress:
     - hostname: tangaracondominio.com.br            # o que já existe (site financeiro)
       service: http://localhost:3000
     - hostname: encomendas.tangaracondominio.com.br # NOVO
       service: http://localhost:3001
     - service: http_status:404
   ```

   (use o hostname do site exatamente como já está no arquivo; só acrescente o bloco novo.)

2. Criar o registro DNS do hostname novo (o nome do túnel é o do `config.yml`, no site foi `tangara`):

   ```powershell
   cloudflared tunnel route dns tangara encomendas.tangaracondominio.com.br
   ```

3. Reiniciar o serviço: `Restart-Service cloudflared` e conferir `Get-Service cloudflared` (Running).
   Se o serviço usa a cópia do perfil do sistema, atualize **também**
   `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml` antes de reiniciar.

4. **Sem Cloudflare Access neste hostname.** Moradores demais para PIN por e-mail; a barreira é o
   login do app (senha própria, limite de tentativas, sessão derrubada ao trocar a senha). Confira
   no painel Zero Trust que a Application do site cobre **só** o hostname dele — se estiver como
   curinga (`*.tangaracondominio.com.br`), o `encomendas` ficaria atrás do PIN e ninguém entraria.

Regras herdadas do site: nenhum ingress para RDP, SMB ou outra porta; o `.json` de credenciais do
túnel é segredo. Se o app estiver parado, o hostname responde 502 da Cloudflare (esperado).

---

## 4. Tarefas agendadas

Duas tarefas diárias, **com `StartWhenAvailable`** (a máquina não fica ligada 24 h: se o horário
passou, roda assim que ligar). Crie a pasta dos logs antes — o redirecionamento do `cmd` falha se a
pasta não existe:

```powershell
New-Item -ItemType Directory -Force C:\apps\encomendas-tangara\backups | Out-Null

$cfg = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

$backup = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c cd /d C:\apps\encomendas-tangara && npx tsx scripts\backup-diario.ts >> backups\backup.log 2>&1'
Register-ScheduledTask -TaskName "Encomendas - Backup diario" -Action $backup -Trigger (New-ScheduledTaskTrigger -Daily -At 02:30) -Settings $cfg -Description "VACUUM INTO do banco, confere a copia e mantem 30 dias"

$retencao = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c cd /d C:\apps\encomendas-tangara && npx tsx scripts\retencao-fotos.ts --aplicar >> backups\retencao.log 2>&1'
Register-ScheduledTask -TaskName "Encomendas - Retencao de fotos" -Action $retencao -Trigger (New-ScheduledTaskTrigger -Daily -At 03:00) -Settings $cfg -Description "Apaga do disco as fotos de encomendas entregues/canceladas ha mais de 90 dias"
```

| Tarefa | Horário | O que faz |
|---|---|---|
| Backup diário | 02:30 | `scripts\backup-diario.ts`: `VACUUM INTO` → `backups\encomendas-AAAA-MM-DD.db`, **confere a cópia** (`integrity_check` + contagem de usuários/encomendas/eventos), troca o `.tmp` pelo nome final e apaga as cópias do padrão com mais de 30 dias. Cópia que falha na conferência nunca apaga backup antigo; exit 1 em falha. Não precisa parar o app. |
| Retenção de fotos | 03:00 | `scripts\retencao-fotos.ts --aplicar`: remove o **arquivo** das fotos de encomendas entregues/canceladas há mais de 90 dias (o registro da encomenda e da foto fica). |

Antes de confiar na retenção, rode uma vez sem `--aplicar` (dry-run, só lista):
`npx tsx scripts\retencao-fotos.ts`.

Rodar agora, conferir o resultado e os próximos horários:

```powershell
Start-ScheduledTask -TaskName "Encomendas - Backup diario"
Get-Content C:\apps\encomendas-tangara\backups\backup.log -Tail 5
Get-ScheduledTask -TaskName "Encomendas*" | Get-ScheduledTaskInfo | Select-Object TaskName, LastRunTime, LastTaskResult, NextRunTime
```

`LastTaskResult` = 0 é sucesso. **Backup que ninguém abriu não é backup**: uma vez por mês, faça a
restauração de teste da seção 6 numa pasta à parte.

**Cópia fora da máquina.** `backups\` está no mesmo disco do banco. Copie para um HD externo ou
nuvem (a retenção de 30 dias vale lá também). O backup do banco **não inclui as fotos**
(`uploads\`); se quiser espelhá-las (elas expiram em 90 dias por desenho):

```powershell
robocopy C:\apps\encomendas-tangara\uploads D:\backups-encomendas\uploads /MIR /R:2 /W:5 /NFL /NDL /NJH /NP
```

(`robocopy` devolve códigos 0–7 em sucesso; 8 ou mais é falha. `/MIR` espelha também as remoções
da retenção.)

---

## 5. Entregar as senhas iniciais aos moradores

`cria-usuarios.ts` gera **uma senha própria para cada login** e a grava, em texto puro, em
`dados\senhas-iniciais-AAAA-MM-DD.txt` (pasta ignorada pelo git).
Cada senha só serve para o primeiro acesso: o app obriga a escolher uma senha própria antes de
qualquer tela.

1. Entregue cada senha **só ao apartamento dela**: bilhete impresso por unidade, ou mensagem
   individual (nunca uma lista geral num grupo). Modelo:
   > Espaço Tangará — encomendas da portaria. Acesse https://encomendas.tangaracondominio.com.br
   > Usuário: **ap11a** · Senha provisória: **xxxxxxxxxx**. No primeiro acesso você escolhe uma
   > senha só sua. No celular, use "Adicionar à tela inicial" para instalar como app.
2. Conforme as senhas forem entregues, acompanhe em **Admin → Usuários → situação "Senha inicial
   pendente"**: quem aparece ali ainda não trocou. Esqueceu ou perdeu? Chave (redefinir senha)
   na linha do usuário: gera nova senha, mostrada **uma única vez**, e derruba a sessão antiga.
3. **Depois de entregar, apague o arquivo** e não deixe cópia em e-mail, chat ou pasta de nuvem:

   ```powershell
   Remove-Item C:\apps\encomendas-tangara\dados\senhas-iniciais-*.txt
   ```

   O arquivo só guarda o que ainda vale: sem ele, qualquer senha extraviada se refaz pelo painel.
4. Apartamento novo ou login excluído: **Admin → Usuários → "Gerar logins faltantes"** cria o
   `ap<número>` de todo apartamento ativo sem login e mostra as senhas uma única vez (copiar
   lista ou baixar `.txt` — apague o `.txt` baixado depois de entregar).

Logins `felipe`, `achilles` e `portaria`: as senhas iniciais também vêm do arquivo; a da portaria
é digitada uma vez no tablet (sessão de 30 dias) e trocada no primeiro acesso, como as demais.

---

## 6. Rollback

### Código

```powershell
cd C:\apps\encomendas-tangara
git log --oneline -8                  # confirme para qual commit voltar
# pare o app (2.1)
git checkout <commit-anterior>
npm ci
npm run build
Start-Process scripts\iniciar-app.cmd -WindowStyle Minimized
```

Migrações do Prisma só andam para a frente: se a versão ruim trouxe uma migração, volte o
**banco** (abaixo) junto com o código.

### Banco (restaurar um backup)

Perde o que foi registrado depois do backup (até 24 h): mantenha o **livro de papel** da portaria
durante o piloto para refazer o dia.

```powershell
# 1) parar o app (2.1)
cd C:\apps\encomendas-tangara
Rename-Item prisma\dev.db dev.db.quebrado-$(Get-Date -Format yyyyMMdd-HHmm)
Remove-Item prisma\dev.db-wal, prisma\dev.db-shm -ErrorAction SilentlyContinue
Copy-Item backups\encomendas-AAAA-MM-DD.db prisma\dev.db
# 2) subir o app (2.2) e conferir login e /admin
```

Para **ensaiar** a restauração sem tocar no app: copie o backup para uma pasta temporária e abra
com `DATABASE_URL="file:C:/temp/ensaio.db"` num `npx tsx` qualquer (ou apenas rode
`npx tsx scripts/backup-diario.ts C:\temp\ensaio` e confira "Integridade: ok").

### Túnel

Tirar o app do ar para a internet sem derrubar o site: remover do `config.yml` o bloco do
`encomendas.` e `Restart-Service cloudflared`. O app segue em `http://localhost:3001`.

### Ninguém entra / admin esqueceu a senha

```powershell
npx tsx scripts/cria-usuarios.ts --resetar=felipe,achilles
```

Reemite a senha desses logins (arquivo em `dados\`, mesma regra da seção 5); a sessão antiga deles
cai. Quem estiver ativo não é desativado por esse comando.

---

## 7. Checklist de saúde

Depois de instalar, de atualizar ou quando algo parecer estranho:

- [ ] **Login responde 200:** `Invoke-WebRequest http://localhost:3001/login -UseBasicParsing` e, de
      fora da rede (dados do celular), `https://encomendas.tangaracondominio.com.br/login`.
- [ ] **Service worker e manifest:** `/sw.js` e `/manifest.webmanifest` respondem 200 sem login
      (`/icons/icon-192.png` também). O celular oferece "Instalar app".
- [ ] **Login e escrita pelo domínio:** entrar como admin, abrir `/admin`, criar um porteiro de
      teste e desativá-lo. Se o formulário falha mas a tela abre, é `ORIGENS_PERMITIDAS` (seção 1).
- [ ] **Fotos servindo:** na portaria, registrar uma encomenda com foto e abrir o detalhe — a foto
      aparece (`/fotos/<id>` devolve a imagem). Sem login, a mesma URL **não** devolve a imagem.
- [ ] **Painel vivo:** `/admin` mostra números e o último evento é o de agora; `/admin/logs`
      registra o login que você acabou de fazer.
- [ ] **Backup:** `npx tsx scripts\backup-diario.ts` imprime `Backup OK` e `Integridade: ok`.
- [ ] **Tarefas:** `Get-ScheduledTask -TaskName "Encomendas*" | Get-ScheduledTaskInfo` mostra
      `NextRunTime` às 02:30 e 03:00 e `LastTaskResult` 0.
- [ ] **Reinício:** reiniciar a máquina e conferir que o app (3001) e o túnel sobem sozinhos.
- [ ] **Segurança:** `Invoke-WebRequest https://encomendas.tangaracondominio.com.br/admin -MaximumRedirection 0`
      sem cookie manda para `/login` (nunca 200); `.env`, `prisma\dev.db`, `uploads\`, `backups\` e
      `dados\*.txt` fora do git (`git status` limpo).

Sintomas comuns: **503 "Servidor sem AUTH_SECRET válido"** → `.env` ausente/curto/exemplo ·
**502 da Cloudflare** → app parado na 3001 · **página abre, formulário não salva** →
`ORIGENS_PERMITIDAS` com esquema/domínio errado · **todo mundo caiu da sessão** → `AUTH_SECRET`
foi trocado (esperado) · **`EPERM` no `npm ci`** → o app estava rodando (pare antes).
