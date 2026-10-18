# Barbearia Cheres

Site de agendamento da Barbearia Cheres (barbeiro: André). HTML + JavaScript puro, sem build.

## Estrutura
- `barbearia-cheres-main/index.html`: site público (agendar, conta do cliente, remarcar, cancelar).
- `barbearia-cheres-main/admin.html`: painel do barbeiro (agenda, CRM, gráficos, bloqueios, administradores).
- `database.rules.json`: regras do Realtime Database (fonte única das regras).
- `tests/rules.test.mjs`: testes das regras no emulador.

## Deploy
- Vercel publica **só a subpasta `barbearia-cheres-main/`** a cada push na `main`. Push na main = produção.
- Domínio: https://barbearia-cheres-barbearia-cheres-m.vercel.app
- Regras do banco: `firebase deploy --only database` (projeto `barbearia-cheres-ab0c0`, já definido em `.firebaserc`).
- Não mover arquivos da subpasta sem ajustar o Root Directory na Vercel.

## Firebase
- SDK compat 10.13.1 via CDN; Realtime Database + Authentication (e-mail/senha).
- A `apiKey` no HTML é pública por natureza; a segurança está nas regras.
- Nós: `appointments`, `appointmentHistory`, `cancelledAppointments`, `clients` (chave = telefone, com `uid`),
  `contacts` (clientes cadastrados pelo barbeiro), `bookedSlots` (horários ocupados, valor = uid do dono ou `'barber'`),
  `blockedDates`, `blockedTimeSlots`, `admins` (uid → e-mail), `owner` (uid do André), `adminInvites`
  (chave = e-mail com "." trocado por ","), `verifiedExempt` (clientes antigos liberados da confirmação de e-mail).

## Regras de segurança (não quebrar)
- Visitante lê só `bookedSlots`, `blockedDates`, `blockedTimeSlots`.
- Cliente lê/escreve só os próprios dados, via query `orderByChild('phoneKey').equalTo(...)`.
- Agendar/remarcar exige e-mail confirmado ou estar em `verifiedExempt`. Cancelar não exige.
- Admin tem permissão **por nó**, não na raiz: no RTDB uma permissão dada na raiz não pode ser revogada abaixo,
  e isso protege o `owner` (André), que ninguém pode remover.
- Novos admins só por convite no painel; o convidado precisa confirmar o e-mail. `owner` e `verifiedExempt`
  só são gravados pelo Firebase CLI.
- Ao mudar regras: rodar `npm test` antes de publicar. Ao publicar regras + código juntos, gravar os dados
  necessários antes, publicar regras e fazer o push logo em seguida.

## Testes
- `npm test` na raiz (sobe o emulador do Database). Precisa de Java 21:
  `JAVA_HOME` = `C:\Program Files\Eclipse Adoptium\jdk-21*` (o Java 8 da máquina não serve).
- Para as páginas não há build nem lint; checar sintaxe dos `<script>` e testar no navegador.

## Pendências conhecidas
- Telefone do cliente não é verificado (o dono escolheu confirmar só o e-mail): uma conta nova com o telefone
  de um cliente sem conta enxerga o histórico dele.
- Ideias de evolução em `../adnre.txt` (duração dos serviços ocupando mais de um horário, lembretes, fidelidade etc.).
