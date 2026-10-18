// Testes das regras do Realtime Database (database.rules.json) no emulador do Firebase.
// Rodar a partir da raiz do repositório: npm test
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { equalTo, get, orderByChild, push, query, ref, remove, runTransaction, set, update } from 'firebase/database';

const ALICE = { uid: 'uid-alice', phone: '21911111111' };
const BOB = { uid: 'uid-bob', phone: '21922222222' };
const ANDRE = { uid: 'uid-andre', email: 'andre.cheres13@gmail.com' };

let env;
const db = (uid, token) => (uid ? env.authenticatedContext(uid, token) : env.unauthenticatedContext()).database();
const appt = (who, date = '2026-10-21', time = '10:00') => ({
    name: 'Cliente', phone: who.phone, phoneKey: who.phone, service: 'Corte', date, time, status: 'active'
});

before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'barbearia-cheres-test',
        database: { rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9000 }
    });
});
after(() => env.cleanup());

beforeEach(async () => {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(ctx => set(ref(ctx.database()), {
        owner: ANDRE.uid,
        admins: { [ANDRE.uid]: ANDRE.email },
        adminInvites: { 'novo@x,com': { email: 'novo@x.com', invitedBy: ANDRE.email } },
        clients: {
            [ALICE.phone]: { name: 'Alice', email: 'alice@x.com', uid: ALICE.uid },
            [BOB.phone]: { name: 'Bob', email: 'bob@x.com', uid: BOB.uid }
        },
        appointments: { a1: appt(ALICE), b1: appt(BOB, '2026-10-21', '11:00') },
        appointmentHistory: { h1: { ...appt(ALICE, '2026-10-01'), status: 'completed' } },
        bookedSlots: { '2026-10-21_1000': ALICE.uid, '2026-10-21_1100': BOB.uid, '2026-10-22_0900': true },
        blockedDates: { d1: '2026-12-25' }
    }));
});

describe('visitante (sem login)', () => {
    test('vê horários ocupados e datas bloqueadas', async () => {
        await assertSucceeds(get(ref(db(), 'bookedSlots')));
        await assertSucceeds(get(ref(db(), 'blockedDates')));
        await assertSucceeds(get(ref(db(), 'blockedTimeSlots')));
    });
    test('não lê dados pessoais nem o banco inteiro', async () => {
        await assertFails(get(ref(db())));
        await assertFails(get(ref(db(), 'clients')));
        await assertFails(get(ref(db(), `clients/${ALICE.phone}`)));
        await assertFails(get(ref(db(), 'appointments')));
        await assertFails(get(query(ref(db(), 'appointments'), orderByChild('phoneKey'), equalTo(ALICE.phone))));
        await assertFails(get(ref(db(), 'adminSetupCode')));
    });
    test('não escreve nada', async () => {
        await assertFails(set(ref(db(), 'bookedSlots/2026-10-23_0900'), true));
        await assertFails(push(ref(db(), 'appointments'), appt(ALICE)));
        await assertFails(remove(ref(db(), 'appointments/a1')));
        await assertFails(set(ref(db(), 'admins/x'), 'x@x.com'));
    });
});

describe('cliente logado', () => {
    const alice = () => db(ALICE.uid, { email: 'alice@x.com', email_verified: true });

    test('encontra o próprio cadastro pelo uid, mas não o de outros', async () => {
        await assertSucceeds(get(query(ref(alice(), 'clients'), orderByChild('uid'), equalTo(ALICE.uid))));
        await assertFails(get(query(ref(alice(), 'clients'), orderByChild('uid'), equalTo(BOB.uid))));
        await assertSucceeds(get(ref(alice(), `clients/${ALICE.phone}`)));
        await assertFails(get(ref(alice(), `clients/${BOB.phone}`)));
        await assertFails(get(ref(alice(), 'clients')));
    });
    test('cadastro novo: consulta telefone livre e grava o próprio registro', async () => {
        const carol = db('uid-carol');
        await assertSucceeds(get(ref(carol, 'clients/21933333333')));
        await assertSucceeds(set(ref(carol, 'clients/21933333333'), { name: 'Carol', phone: '(21) 93333-3333', email: 'c@x.com', uid: 'uid-carol' }));
    });
    test('não sobrescreve nem rouba o cadastro de outro telefone', async () => {
        const carol = db('uid-carol');
        await assertFails(set(ref(carol, `clients/${BOB.phone}`), { name: 'Carol', email: 'c@x.com', uid: 'uid-carol' }));
        await assertFails(set(ref(carol, 'clients/21933333333'), { name: 'Carol', email: 'c@x.com', uid: BOB.uid }));
    });
    test('lê só os próprios agendamentos, histórico e cancelamentos', async () => {
        for (const node of ['appointments', 'appointmentHistory', 'cancelledAppointments']) {
            await assertSucceeds(get(query(ref(alice(), node), orderByChild('phoneKey'), equalTo(ALICE.phone))));
            await assertFails(get(query(ref(alice(), node), orderByChild('phoneKey'), equalTo(BOB.phone))));
            await assertFails(get(ref(alice(), node)));
        }
    });
    test('agenda: reserva o horário com o próprio uid e cria o agendamento', async () => {
        await assertSucceeds(set(ref(alice(), 'bookedSlots/2026-10-23_0900'), ALICE.uid));
        await assertSucceeds(push(ref(alice(), 'appointments'), appt(ALICE, '2026-10-23', '09:00')));
    });
    test('não agenda sem reservar o horário, em nome de outro, nem em horário ocupado', async () => {
        await assertFails(push(ref(alice(), 'appointments'), appt(ALICE, '2026-10-24', '09:00')));
        await assertFails(push(ref(alice(), 'appointments'), appt(BOB, '2026-10-21', '10:00')));
        await assertFails(set(ref(alice(), 'bookedSlots/2026-10-21_1100'), ALICE.uid));
        await assertFails(set(ref(alice(), 'bookedSlots/2026-10-23_0900'), BOB.uid));
    });
    test('não reserva horário fora da grade nem com chave inventada', async () => {
        await assertFails(set(ref(alice(), 'bookedSlots/2026-10-23_0715'), ALICE.uid));
        await assertFails(set(ref(alice(), 'bookedSlots/lixo'), ALICE.uid));
    });
    test('não grava campos extras nem textos gigantes no agendamento', async () => {
        await assertSucceeds(set(ref(alice(), 'bookedSlots/2026-10-23_0900'), ALICE.uid));
        await assertFails(push(ref(alice(), 'appointments'), { ...appt(ALICE, '2026-10-23', '09:00'), createdBy: 'barber' }));
        await assertFails(push(ref(alice(), 'appointments'), { ...appt(ALICE, '2026-10-23', '09:00'), name: 'x'.repeat(500) }));
        await assertFails(push(ref(alice(), 'cancelledAppointments'), { ...appt(ALICE), cancelledBy: 'barber' }));
    });
    test('disputa pelo mesmo horário: só um cliente consegue (transaction)', async () => {
        const slot = '2026-10-23_1000';
        const tryBook = (ctx, uid) => runTransaction(ref(ctx, `bookedSlots/${slot}`), cur => (cur ? undefined : uid));
        const [r1, r2] = await Promise.allSettled([tryBook(alice(), ALICE.uid), tryBook(db(BOB.uid, { email: 'bob@x.com', email_verified: true }), BOB.uid)]);
        const won = [r1, r2].filter(r => r.status === 'fulfilled' && r.value.committed).length;
        if (won !== 1) throw new Error(`esperado 1 vencedor, houve ${won}`);
    });
    test('remarca o próprio agendamento para um horário que reservou', async () => {
        await assertSucceeds(set(ref(alice(), 'bookedSlots/2026-10-23_1400'), ALICE.uid));
        await assertSucceeds(update(ref(alice(), 'appointments/a1'), { date: '2026-10-23', time: '14:00' }));
        await assertSucceeds(remove(ref(alice(), 'bookedSlots/2026-10-21_1000')));
    });
    test('cancela o próprio agendamento', async () => {
        // mesmo formato gravado por cancelMyAppointment() no index.html
        const { status, ...rest } = appt(ALICE);
        await assertSucceeds(push(ref(alice(), 'cancelledAppointments'), { ...rest, email: 'alice@x.com', cancelledAt: new Date().toISOString(), cancelledBy: 'client' }));
        await assertSucceeds(remove(ref(alice(), 'appointments/a1')));
        await assertSucceeds(remove(ref(alice(), 'bookedSlots/2026-10-21_1000')));
    });
    test('libera horário antigo (sem dono gravado)', async () => {
        await assertSucceeds(remove(ref(alice(), 'bookedSlots/2026-10-22_0900')));
    });
    test('não mexe em agendamento, horário ou histórico de outro cliente', async () => {
        await assertFails(remove(ref(alice(), 'appointments/b1')));
        await assertFails(update(ref(alice(), 'appointments/b1'), { time: '12:00' }));
        await assertFails(remove(ref(alice(), 'bookedSlots/2026-10-21_1100')));
        await assertFails(push(ref(alice(), 'cancelledAppointments'), appt(BOB)));
        await assertFails(set(ref(alice(), 'appointmentHistory/h2'), appt(ALICE)));
        await assertFails(set(ref(alice(), 'blockedDates/d2'), '2026-12-31'));
    });
    test('sem e-mail confirmado: não agenda nem remarca, mas cancela', async () => {
        const naoConfirmada = db(ALICE.uid, { email: 'alice@x.com', email_verified: false });
        await assertFails(set(ref(naoConfirmada, 'bookedSlots/2026-10-23_0900'), ALICE.uid));
        await env.withSecurityRulesDisabled(ctx => set(ref(ctx.database(), 'bookedSlots/2026-10-23_1400'), ALICE.uid));
        await assertFails(update(ref(naoConfirmada, 'appointments/a1'), { date: '2026-10-23', time: '14:00' }));
        await assertSucceeds(remove(ref(naoConfirmada, 'appointments/a1')));
        await assertSucceeds(remove(ref(naoConfirmada, 'bookedSlots/2026-10-21_1000')));
    });
    test('cliente antigo (verifiedExempt) agenda sem confirmar o e-mail', async () => {
        await env.withSecurityRulesDisabled(ctx => set(ref(ctx.database(), `verifiedExempt/${ALICE.uid}`), true));
        const antiga = db(ALICE.uid, { email: 'alice@x.com', email_verified: false });
        await assertSucceeds(get(ref(antiga, `verifiedExempt/${ALICE.uid}`)));
        await assertSucceeds(set(ref(antiga, 'bookedSlots/2026-10-23_0900'), ALICE.uid));
        await assertSucceeds(push(ref(antiga, 'appointments'), appt(ALICE, '2026-10-23', '09:00')));
    });
    test('cliente não se coloca na lista de liberados nem lê a de outros', async () => {
        const nova = db('uid-carol', { email: 'c@x.com', email_verified: false });
        await assertFails(set(ref(nova, 'verifiedExempt/uid-carol'), true));
        await assertFails(get(ref(nova, `verifiedExempt/${ALICE.uid}`)));
        await assertFails(get(ref(nova, 'verifiedExempt')));
    });
    test('não vira admin sem convite nem lê dados de admin', async () => {
        await assertFails(set(ref(alice(), `admins/${ALICE.uid}`), 'alice@x.com'));
        await assertFails(get(ref(alice(), 'admins')));
        await assertFails(get(ref(alice(), 'adminInvites')));
        await assertFails(set(ref(alice(), 'adminInvites/alice@x,com'), { email: 'alice@x.com', invitedBy: 'alice@x.com' }));
    });
});

describe('administradores e convites', () => {
    const andre = () => db(ANDRE.uid, { email: ANDRE.email, email_verified: true });
    const novo = (verified = true, uid = 'uid-novo') => db(uid, { email: 'novo@x.com', email_verified: verified });

    test('admin lê e altera os dados da barbearia', async () => {
        await assertSucceeds(get(ref(andre())));
        await assertSucceeds(get(ref(andre(), 'clients')));
        await assertSucceeds(set(ref(andre(), 'bookedSlots/2026-10-21_1100'), 'barber'));
        await assertSucceeds(remove(ref(andre(), 'appointments/b1')));
        await assertSucceeds(set(ref(andre(), 'appointmentHistory/h2'), appt(BOB)));
        await assertSucceeds(set(ref(andre(), 'contacts/21944444444'), { name: 'Dan' }));
        await assertSucceeds(set(ref(andre(), 'blockedDates/d2'), '2026-12-31'));
        await assertSucceeds(update(ref(andre()), { 'appointments/a1/phoneKey': ALICE.phone, 'bookedSlots/2026-10-21_1000': null }));
    });
    test('admin convida, lista e cancela convites', async () => {
        await assertSucceeds(set(ref(andre(), 'adminInvites/outro@x,com'), { email: 'outro@x.com', invitedBy: ANDRE.email, invitedAt: 'x' }));
        await assertSucceeds(get(ref(andre(), 'adminInvites')));
        await assertSucceeds(get(ref(andre(), 'admins')));
        await assertSucceeds(remove(ref(andre(), 'adminInvites/outro@x,com')));
        await assertFails(set(ref(andre(), 'adminInvites/outro@x,com'), { email: 'diferente@x.com', invitedBy: ANDRE.email }));
    });
    test('convidado com e-mail confirmado vira admin e apaga o convite', async () => {
        await assertSucceeds(set(ref(novo(), 'admins/uid-novo'), 'novo@x.com'));
        await assertSucceeds(remove(ref(novo(), 'adminInvites/novo@x,com')));
        await assertSucceeds(get(ref(novo(), 'clients')));
    });
    test('convidado sem confirmar o e-mail não vira admin', async () => {
        await assertFails(set(ref(novo(false), 'admins/uid-novo'), 'novo@x.com'));
    });
    test('convite não serve para outro e-mail nem grava e-mail falso', async () => {
        await assertFails(set(ref(db('uid-x', { email: 'x@x.com', email_verified: true }), 'admins/uid-x'), 'x@x.com'));
        await assertFails(set(ref(novo(), 'admins/uid-novo'), 'andre.cheres13@gmail.com'));
        await assertFails(set(ref(novo(), 'admins/uid-outro'), 'novo@x.com'));
    });
    test('ninguém remove o dono; admin remove outros admins', async () => {
        await assertSucceeds(set(ref(novo(), 'admins/uid-novo'), 'novo@x.com'));
        await assertFails(remove(ref(novo(), `admins/${ANDRE.uid}`)));
        await assertFails(set(ref(novo(), 'owner'), 'uid-novo'));
        await assertFails(remove(ref(andre(), `admins/${ANDRE.uid}`)));
        await assertSucceeds(remove(ref(andre(), 'admins/uid-novo')));
    });
    test('admin não cria admin direto (só por convite)', async () => {
        await assertFails(set(ref(andre(), 'admins/uid-qualquer'), 'qualquer@x.com'));
    });
});

describe('correções da revisão', () => {
    const andre = () => db(ANDRE.uid, { email: ANDRE.email, email_verified: true });
    const novo = () => db('uid-novo', { email: 'novo@x.com', email_verified: true });

    test('sem "owner" gravado, nenhum admin é removido', async () => {
        await assertSucceeds(set(ref(novo(), 'admins/uid-novo'), 'novo@x.com'));
        await env.withSecurityRulesDisabled(ctx => remove(ref(ctx.database(), 'owner')));
        await assertFails(remove(ref(novo(), `admins/${ANDRE.uid}`)));
    });
    test('chave de convite com caracteres de código é recusada', async () => {
        const key = "x');alert(1);('";
        await assertFails(set(ref(andre(), `adminInvites/${key}`), { email: key, invitedBy: ANDRE.email }));
    });
    test('convidado vê só o próprio convite', async () => {
        await assertSucceeds(get(ref(novo(), 'adminInvites/novo@x,com')));
        await assertFails(get(ref(novo(), 'adminInvites/outro@x,com')));
        await assertFails(get(ref(db('uid-x', { email: 'x@x.com' }), 'adminInvites/novo@x,com')));
    });
    test('remover admin apaga junto o convite que sobrou', async () => {
        await assertSucceeds(set(ref(novo(), 'admins/uid-novo'), 'novo@x.com'));
        await assertSucceeds(update(ref(andre()), { 'admins/uid-novo': null, 'adminInvites/novo@x,com': null }));
        await assertFails(set(ref(novo(), 'admins/uid-novo'), 'novo@x.com'));
    });
});
