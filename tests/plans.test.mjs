// Testes das assinaturas dos planos (plans.js), da fidelidade sem cortes do plano e dos campos novos dos planos.
// Rodar: npm run test:schedule   (não precisa do emulador)
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const ctx = { window: {} };
for (const f of ['attendance.js', 'services.js', 'plans.js']) vm.runInNewContext(readFileSync(new URL(`../barbearia-cheres-main/${f}`, import.meta.url), 'utf8'), ctx);
const P = ctx.window.CheresPlans, A = ctx.window.CheresAttendance, S = ctx.window.CheresServices;
const plain = v => JSON.parse(JSON.stringify(v));

const plan = S.normalizePlans(null)[0];   // Plano 4 Cortes: 4 usos, só "Corte"
const sub = P.normalizeSubscription(P.newSubscription(plan, '2026-11-05', 10, 'x'));
const planCut = (date, key = date) => ({ key, date, service: 'Corte', payment: { method: 'plan', amount: 0 } });

describe('planos com regra de uso', () => {
    test('padrão: 4 cortes por mês e serviços incluídos', () => {
        const [p1, p2] = S.normalizePlans(null);
        assert.equal(p1.uses, 4); assert.deepEqual(plain(p1.services), ['Corte']);
        assert.deepEqual(plain(p2.services), ['Corte', 'Barba', 'Corte e barba']);
    });
    test('plano salvo sem os campos novos (Fase 3) fica com 4 usos e nenhum serviço', () => {
        const [p] = S.normalizePlans({ p: { name: 'P', price: 100 } });
        assert.equal(p.uses, 4); assert.deepEqual(plain(p.services), []);
    });
    test('validação: usos de 1 a 31 e pelo menos um serviço', () => {
        assert.equal(S.validatePlans(S.defaultPlans()), '');
        assert.match(S.validatePlans([{ ...plan, uses: 0 }]), /cortes por mês/);
        assert.match(S.validatePlans([{ ...plan, uses: 2.5 }]), /cortes por mês/);
        assert.match(S.validatePlans([{ ...plan, services: [] }]), /serviço incluído/);
    });
    test('gravação mantém usos e serviços e volta igual', () => {
        assert.deepEqual(plain(S.normalizePlans(S.toPlansData(S.defaultPlans()))), plain(S.defaultPlans()));
    });
});

describe('assinatura', () => {
    test('copia nome, preço, usos e serviços do plano na adesão', () => {
        assert.deepEqual(plain(P.newSubscription(plan, '2026-11-05', 10, 'agora')), {
            planId: 'plano-4-cortes', planName: 'Plano 4 Cortes', price: 110, uses: 4, services: ['Corte'],
            dueDay: 10, startDate: '2026-11-05', billFrom: '2026-11', status: 'active', statusAt: '2026-11-05', createdAt: 'agora'
        });
    });
    test('normalize recusa registro incompleto', () => {
        assert.equal(P.normalizeSubscription(null), null);
        assert.equal(P.normalizeSubscription({ planName: 'X', price: 1 }), null);
    });
    test('retomar recomeça a cobrança no mês da retomada', () => {
        const paused = { ...sub, status: 'paused' };
        assert.deepEqual(plain(P.statusChange(paused, 'active', '2027-02-03')), { status: 'active', statusAt: '2027-02-03', billFrom: '2027-02' });
        assert.deepEqual(plain(P.statusChange(sub, 'paused', '2026-12-01')), { status: 'paused', statusAt: '2026-12-01', owed: { '2026-11': true } });
    });
});

describe('uso do plano no mês (não acumula)', () => {
    const records = [planCut('2026-11-06'), planCut('2026-11-13'), planCut('2026-10-30'), { date: '2026-11-07', service: 'Corte', payment: { method: 'pix', amount: 35 } }];
    test('conta só os pagos pelo plano no mês', () => {
        assert.equal(P.usedInMonth(records, '2026-11'), 2);
        assert.equal(P.usedInMonth(records, '2026-12'), 0);
    });
    test('pode usar: ativo, depois do início, serviço incluído, com uso sobrando', () => {
        assert.equal(P.planUse(sub, records, { key: 'n', date: '2026-11-20', service: 'Corte' }).eligible, true);
    });
    test('não pode: serviço fora, antes do início, pausado, usos esgotados', () => {
        assert.match(P.planUse(sub, records, { key: 'n', date: '2026-11-20', service: 'Barba' }).reason, /fora/);
        assert.match(P.planUse(sub, [], { key: 'n', date: '2026-11-01', service: 'Corte' }).reason, /início/);
        assert.match(P.planUse({ ...sub, status: 'paused' }, [], { key: 'n', date: '2026-11-20', service: 'Corte' }).reason, /pausad/);
        const full = [1, 2, 3, 4].map(i => planCut(`2026-11-0${i + 5}`, 'k' + i));
        const r = P.planUse(sub, full, { key: 'n', date: '2026-11-20', service: 'Corte' });
        assert.equal(r.eligible, false); assert.equal(r.used, 4); assert.match(r.reason, /usados/);
    });
    test('reabrir um atendimento já pago pelo plano não conta ele mesmo', () => {
        const full = [1, 2, 3, 4].map(i => planCut(`2026-11-0${i + 5}`, 'k' + i));
        assert.equal(P.planUse(sub, full, { key: 'k4', date: '2026-11-09', service: 'Corte' }).eligible, true);
    });
});

describe('fidelidade ignora cortes do plano', () => {
    test('corte pago pelo plano não conta', () => {
        const recs = [
            { date: '2026-11-05', service: 'Corte', outcome: 'attended', payment: { method: 'plan', amount: 0 } },
            { date: '2026-11-06', service: 'Corte', outcome: 'attended', viaPlan: true },
            { date: '2026-11-07', service: 'Corte', outcome: 'attended', payment: { method: 'pix', amount: 35 } }
        ];
        assert.equal(A.loyaltyStatus(recs, 0, null).cuts, 1);
        assert.equal(A.METHODS.plan, 'Plano');
    });
});

describe('mensalidades', () => {
    test('vencimento no dia fixo do mês', () => {
        assert.equal(P.dueDate(sub, '2026-12'), '2026-12-10');
    });
    test('situação: paga, atrasada, vence em breve, em aberto', () => {
        const pays = { '2026-11': { amount: 110, method: 'pix', paidAt: '2026-11-08' } };
        let b = P.billing(sub, pays, '2026-12-06');
        assert.deepEqual(plain(b.months.map(m => [m.month, m.state])), [['2026-11', 'paid'], ['2026-12', 'soon']]);
        assert.equal(b.open.month, '2026-12');
        b = P.billing(sub, {}, '2026-12-11');
        assert.deepEqual(plain(b.months.map(m => m.state)), ['late', 'late']);
        assert.equal(b.late, 2); assert.equal(b.open.month, '2026-11');
        b = P.billing({ ...sub, dueDay: 20 }, {}, '2026-11-05');
        assert.equal(b.months[0].state, 'open');
    });
    test('tudo pago: próxima é a do mês seguinte', () => {
        const b = P.billing(sub, { '2026-11': { amount: 110, method: 'pix', paidAt: '2026-11-08' } }, '2026-11-20');
        assert.equal(b.open, null); assert.equal(b.next.due, '2026-12-10');
    });
    test('dívida antiga não some: conta desde o início, sem limite de meses', () => {
        const b = P.billing(sub, {}, '2027-06-20');
        assert.equal(b.months[0].month, '2026-11'); assert.equal(b.late, 8);
    });
    test('pausado sem dívida não cobra nada', () => {
        assert.equal(P.billing({ ...sub, status: 'paused' }, {}, '2026-12-20').months.length, 0);
    });
    test('pausar guarda o que venceu; retomar não apaga e recomeça no mês da retomada', () => {
        const ch = P.statusChange(sub, 'paused', '2027-01-20', { '2026-11': { amount: 110, method: 'pix', paidAt: '2026-11-08' } });
        assert.deepEqual(plain(ch), { status: 'paused', statusAt: '2027-01-20', owed: { '2026-12': true, '2027-01': true } });
        const paused = P.normalizeSubscription({ ...P.newSubscription(plan, '2026-11-05', 10, 'x'), ...ch });
        assert.deepEqual(plain(P.billing(paused, {}, '2027-03-01').months.map(m => [m.month, m.state])), [['2026-12', 'late'], ['2027-01', 'late']]);
        const back = P.normalizeSubscription({ ...P.newSubscription(plan, '2026-11-05', 10, 'x'), ...ch, ...P.statusChange(paused, 'active', '2027-03-15') });
        const b = P.billing(back, { '2026-12': { amount: 110, method: 'pix', paidAt: '2027-03-15' } }, '2027-03-15');
        assert.deepEqual(plain(b.months.map(m => [m.month, m.state])), [['2027-01', 'late'], ['2027-03', 'soon']]);
        assert.equal(b.months[1].due, '2027-03-15');   // retomou depois do dia 10: vence no dia da retomada
    });
    test('cancelar guarda a dívida e ela passa para uma assinatura nova', () => {
        const ch = P.statusChange(sub, 'cancelled', '2026-12-20', {});
        const cancelled = P.normalizeSubscription({ ...P.newSubscription(plan, '2026-11-05', 10, 'x'), ...ch });
        assert.equal(P.billing(cancelled, {}, '2027-01-05').late, 2);
        const carry = P.unpaidOwed(cancelled, {}, '2027-01-05');
        const again = P.normalizeSubscription(P.newSubscription(plan, '2027-01-05', 10, 'x', carry));
        assert.deepEqual(plain(P.billing(again, {}, '2027-01-05').months.map(m => [m.month, m.state])), [['2026-11', 'late'], ['2026-12', 'late'], ['2027-01', 'soon']]);
    });
    test('assinar depois do dia de vencimento não nasce atrasado', () => {
        const late = P.normalizeSubscription(P.newSubscription(plan, '2026-11-30', 28, 'x'));
        const b = P.billing(late, {}, '2026-11-30');
        assert.equal(b.months[0].due, '2026-11-30'); assert.equal(b.months[0].state, 'soon'); assert.equal(b.late, 0);
        assert.equal(P.dueFor(late, '2026-12'), '2026-12-28');
    });
    test('início no futuro: próxima mensalidade é a do mês de início', () => {
        const fut = P.normalizeSubscription(P.newSubscription(plan, '2027-01-05', 10, 'x'));
        const b = P.billing(fut, {}, '2026-11-04');
        assert.equal(b.months.length, 0); assert.equal(b.next.due, '2027-01-10');
    });
    test('cortes de assinatura anterior não contam na atual', () => {
        assert.equal(P.usedInMonth([planCut('2026-11-02'), planCut('2026-11-20')], '2026-11', null, '2026-11-10'), 1);
    });
    test('pagamentos do período pela data do pagamento; resumo dos ativos', () => {
        const all = { '21911111111': { '2026-11': { amount: 110, method: 'pix', paidAt: '2026-11-08' }, '2026-12': { amount: 110, method: 'cash', paidAt: '2026-12-02' } } };
        assert.deepEqual(plain(P.paymentsInRange(all, '2026-11-01', '2026-11-30').map(p => p.month)), ['2026-11']);
        const subs = { a: P.newSubscription(plan, '2026-11-05', 10, 'x'), b: { ...P.newSubscription(plan, '2026-11-05', 10, 'x'), status: 'cancelled' } };
        assert.deepEqual(plain(P.summary(subs)), { count: 1, monthly: 110 });
    });
    test('mensagem de cobrança', () => {
        const msg = P.chargeMessage('Alice Souza', sub, { month: '2026-12', due: '2026-12-10', state: 'late' });
        assert.match(msg, /^Olá, Alice!/);
        assert.match(msg, /Plano 4 Cortes \(R\$ 110,00\) de dezembro\/2026, que venceu em 10\/12/);
    });
    test('virada de ano', () => {
        assert.equal(P.addMonths('2026-12', 1), '2027-01');
        assert.equal(P.addMonths('2027-01', -2), '2026-11');
    });
});
