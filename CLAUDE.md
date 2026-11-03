# Barbearia Cheres

Site de agendamento da Barbearia Cheres (barbeiro: André). HTML + JavaScript puro, sem build.

## Estrutura
- `barbearia-cheres-main/index.html`: site público (agendar, conta do cliente, remarcar, cancelar).
- `barbearia-cheres-main/admin.html`: painel do barbeiro (Hoje, agenda, horários, CRM, gráficos, bloqueios, administradores).
- `barbearia-cheres-main/attendance.js`: **regra única de atendido/faltou/pendente e valor pago** (`window.CheresAttendance`),
  usada pelo painel (CRM, tela Hoje) e pelo perfil do cliente. Também tem a **fidelidade** (`loyaltyStatus`).
- `barbearia-cheres-main/reports.js`: financeiro (faturamento, ticket médio, formas de pagamento) e CSV (`window.CheresReports`), só no painel.
- `barbearia-cheres-main/manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`: "Adicionar à tela inicial" do painel
  (abre em `/admin`). `sw.js`: service worker mínimo só para notificações no Android (sem `fetch`, sem cache offline).
- `barbearia-cheres-main/schedule.js`: **regra única dos horários** (`window.CheresSchedule`), carregada pelas duas páginas.
  Nunca escrever listas de horários fixas no HTML: usar `CheresSchedule.forDate(date, settings, exceptions)`.
- `database.rules.json`: regras do Realtime Database (fonte única das regras).
- `tests/rules.test.mjs`: testes das regras no emulador. `tests/schedule.test.mjs`, `tests/attendance.test.mjs` e `tests/reports.test.mjs`: testes das funções puras.
- `backups/` (fora do Git): backups do banco antes de mexer em dados existentes.

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
- Horário de funcionamento (leitura pública, escrita só admin, formato validado nas regras):
  - `settings/schedule/days/{0-6}` = `{ open, times: { "HHMM": true } }` (0 = domingo). Dia sem nada salvo = padrão.
  - `scheduleExceptions/{AAAA-MM-DD}` = `{ closed: true }` ou `{ times: { "HHMM": true } }`.
  - Prioridade: data especial > dia da semana salvo > padrão (ter a sáb, 09:00 a 18:00, último horário 18:00).
  - O Firebase pode devolver `days` como array; o `schedule.js` já trata.
  - Mudança de horário nunca apaga agendamentos: o painel lista os que ficam de fora e pede confirmação.
  - As regras não sabem se um horário está aberto (isso depende do `schedule.js`); `bookedSlots` aceita
    qualquer HH:00/HH:30 de 00 a 23h, e o site confere a grade antes de reservar.

- Atendimento (Fase 2), campos gravados só pelo barbeiro no próprio agendamento e levados para o histórico:
  - `attendance` (`attended` | `noshow`), `payment` (`{ method: pix|cash|card, amount }`), `price` (preço da época),
    `attendanceAt`, `remindedFor` (`"AAAA-MM-DD HH:MM"`: lembrete vale só para esse horário), `rescheduledBy: 'barber'`.
  - A limpeza diária (`cleanupPastAppointments`) move o dia encerrado para `appointmentHistory` com `status: 'pending'`
    (ou o `attendance` já marcado). Nada vira concluído sozinho.
  - Histórico antigo com `status: 'completed'` (antes de 03/11/2026) conta como atendido pelo preço da tabela.
  - Visitas e total gasto contam só atendidos (valor pago). Para "tempo sem vir", pendente também conta.
  - O cliente vê falta como "Não compareceu" e pendente como "Concluído".
  - Avisos de agendar/remarcar/cancelar: comparam leituras do banco; o que o próprio painel faz não gera aviso.
  - Gravações em registro que pode sumir (marcação, lembrete, remarcar, mudança para o histórico) usam transação
    "só se existir". Na transação, devolver `null` (não `undefined`) quando vier vazio: vazio pode ser só falta de
    cache, e `undefined` aborta sem consultar o servidor.
  - As regras recusam `appointments/$id` sem `date` e `time`, mesmo do admin (um registro órfão travava o painel).

- Gestão (Fase 4A):
  - `clientNotes/{telefone}` = `{ notes, birthday: "MM-DD", updatedAt }` — só admin (anotações na ficha e na tela Hoje).
  - `expenses/{AAAA-MM}/{id}` = `{ label, amount, date: "AAAA-MM-DD" (dentro do mês da chave), createdAt }` — só admin.
    Despesas antigas sem `date` usam o dia local de `createdAt` (`CheresReports.expenseDate`).
  - Aba Financeiro (a Visão Geral foi incorporada nela): filtro de período (Hoje, Ontem, semanas, meses, De/Até) que vale
    para cartões, despesas, lucro e gráficos. Só atendidos, pelo valor pago (histórico antigo pela tabela, forma "não informada").
    "Próximos agendamentos" e "Próximos 7 dias" olham para frente e não dependem do filtro.
  - Fidelidade: `settings/loyalty` = `{ every: 7, since: "2026-11-03" }` (público lê). Conta cortes atendidos
    (serviço com "Corte" no nome) desde `since`. `loyalty/{telefone}/redeemed/{id}` = `{ date, at }`: admin grava, cliente lê o dele.
  - Lista de espera: `waitlist/{data}/{telefone}` = `{ name, uid, createdAt, notifiedAt? }`. O cliente (e-mail confirmado)
    entra/sai só da própria vaga; `notifiedAt` só admin. Dias passados são apagados pelo painel (dado temporário).
  - Fica para a Fase 4B (depois da Fase 3): assinantes dos planos e receita dos planos.

## Regras de segurança (não quebrar)
- Visitante lê só `bookedSlots`, `blockedDates`, `blockedTimeSlots`, `settings` e `scheduleExceptions`.
- `settings/$other` é recusado: ao criar um nó novo em `settings` (ex.: serviços), acrescentar a regra dele.
- Cliente lê/escreve só os próprios dados, via query `orderByChild('phoneKey').equalTo(...)`.
- Agendar/remarcar exige e-mail confirmado ou estar em `verifiedExempt`. Cancelar não exige.
- Admin tem permissão **por nó**, não na raiz: no RTDB uma permissão dada na raiz não pode ser revogada abaixo,
  e isso protege o `owner` (André), que ninguém pode remover.
- Novos admins só por convite no painel; o convidado precisa confirmar o e-mail. `owner` e `verifiedExempt`
  só são gravados pelo Firebase CLI.
- Ao mudar regras: rodar `npm test` antes de publicar. Ao publicar regras + código juntos, gravar os dados
  necessários antes, publicar regras e fazer o push logo em seguida.

## Testes
- `npm test` na raiz: roda `test:schedule` (só Node) e `test:rules` (sobe o emulador do Database). Precisa de Java 21:
  `JAVA_HOME` = `C:\Program Files\Eclipse Adoptium\jdk-21*` (o Java 8 da máquina não serve).
- Para as páginas não há build nem lint; checar sintaxe dos `<script>` e testar no navegador.

## Pendências conhecidas
- Telefone do cliente não é verificado (o dono escolheu confirmar só o e-mail): uma conta nova com o telefone
  de um cliente sem conta enxerga o histórico dele.
- Ideias de evolução em `../adnre.txt` (duração dos serviços ocupando mais de um horário, lembretes, fidelidade etc.).
