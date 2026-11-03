// Testes de fidelidade (attendance.js), financeiro e CSV (reports.js).
// Rodar: npm run test:schedule   (não precisa do emulador)
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const ctx = { window: {} };
for (const f of ['attendance.js', 'reports.js']) vm.runInNewContext(readFileSync(new URL(`../barbearia-cheres-main/${f}`, import.meta.url), 'utf8'), ctx);
const A = ctx.window.CheresAttendance, R = ctx.window.CheresReports;
const plain = v => JSON.parse(JSON.stringify(v));
const prices = { Corte: 35, Barba: 20, 'Corte e barba': 45 };
const isPast = (d, t) => `${d} ${t}` <= '2026-11-20 12:00';

describe('fidelidade (a cada 7 cortes, contando a partir de 03/11/2026)', () => {
    const cut = (date, service = 'Corte', outcome = 'attended') => ({ date, service, outcome });
    test('padrão: 7 cortes, início em 03/11/2026', () => {
        assert.deepEqual(plain(A.loyaltySettings(null)), { every: 7, since: '2026-11-03' });
    });
    test('só conta serviço com "Corte" no nome', () => {
        assert.equal(A.isCut('Corte'), true);
        assert.equal(A.isCut('Corte e barba'), true);
        assert.equal(A.isCut('Corte + nevou'), true);
        assert.equal(A.isCut('Barba'), false);
        assert.equal(A.isCut('Sobrancelha'), false);
        assert.equal(A.isCut('Pé'), false);
    });
    test('histórico antes do início não conta (começa do zero)', () => {
        const st = A.loyaltyStatus([cut('2026-10-20'), cut('2026-10-31'), cut('2026-11-03')], 0, null);
        assert.equal(st.cuts, 1);
        assert.equal(st.remaining, 6);
    });
    test('faltas, pendentes e barba não contam', () => {
        const st = A.loyaltyStatus([cut('2026-11-04', 'Corte', 'noshow'), cut('2026-11-05', 'Corte', 'pending'), cut('2026-11-06', 'Barba')], 0, null);
        assert.equal(st.cuts, 0);
    });
    test('7 cortes = 1 brinde disponível; depois de usar, zera o disponível e o progresso segue', () => {
        const seven = Array.from({ length: 7 }, (_, i) => cut(`2026-11-${String(4 + i).padStart(2, '0')}`));
        let st = A.loyaltyStatus(seven, 0, null);
        assert.equal(st.earned, 1); assert.equal(st.available, 1); assert.equal(st.progress, 0);
        st = A.loyaltyStatus([...seven, cut('2026-11-20')], 1, null);
        assert.equal(st.available, 0); assert.equal(st.progress, 1); assert.equal(st.remaining, 6);
    });
    test('número de cortes editável', () => {
        const st = A.loyaltyStatus([cut('2026-11-04'), cut('2026-11-05')], 0, { every: 2 });
        assert.equal(st.available, 1);
        assert.equal(A.loyaltySettings({ every: 0 }).every, 7, 'valor inválido volta para 7');
    });
});

describe('financeiro', () => {
    const appointments = [
        { date: '2026-11-20', time: '09:00', service: 'Corte', attendance: 'attended', payment: { method: 'pix', amount: 30 } },
        { date: '2026-11-20', time: '10:00', service: 'Corte' },                       // pendente: não conta
        { date: '2026-11-21', time: '10:00', service: 'Corte' }                        // futuro: não conta
    ];
    const history = [
        { date: '2026-11-18', time: '10:00', service: 'Barba', status: 'attended', attendance: 'attended', payment: { method: 'cash', amount: 20 } },
        { date: '2026-11-17', time: '10:00', service: 'Corte', status: 'noshow', attendance: 'noshow' },
        { date: '2026-10-10', time: '10:00', service: 'Corte e barba', status: 'completed' }   // antigo: tabela
    ];
    const entries = R.attendedEntries(appointments, history, prices, isPast);
    test('só atendidos entram, com o valor pago (antigo pela tabela)', () => {
        assert.equal(entries.length, 3);
        assert.deepEqual(plain(entries.map(e => e.amount).sort((a, b) => a - b)), [20, 30, 45]);
    });
    test('resumo do mês: total, ticket médio e forma de pagamento', () => {
        const [from, to] = R.monthRange('2026-11-20');
        assert.equal(from, '2026-11-01'); assert.equal(to, '2026-11-30');
        const s = R.summarize(entries, from, to);
        assert.equal(s.count, 2); assert.equal(s.total, 50); assert.equal(s.average, 25);
        assert.deepEqual(plain(s.byMethod), { pix: 30, cash: 20, card: 0, unknown: 0 });
    });
    test('histórico antigo aparece como "não informado"', () => {
        const s = R.summarize(entries, '2026-10-01', '2026-10-31');
        assert.equal(s.byMethod.unknown, 45);
    });
    test('semana de domingo a sábado', () => {
        assert.deepEqual(plain(R.weekRange('2026-11-20')), ['2026-11-15', '2026-11-21']);
    });
    test('despesas do mês', () => {
        assert.equal(R.sumExpenses({ a: { label: 'Aluguel', amount: 800 }, b: { label: 'Produtos', amount: 150.5 }, c: null }), 950.5);
    });
});

describe('filtro de período', () => {
    const today = '2026-11-20';   // sexta-feira
    test('atalhos', () => {
        assert.deepEqual(plain(R.presetRange('today', today)), ['2026-11-20', '2026-11-20']);
        assert.deepEqual(plain(R.presetRange('yesterday', today)), ['2026-11-19', '2026-11-19']);
        assert.deepEqual(plain(R.presetRange('week', today)), ['2026-11-15', '2026-11-21']);
        assert.deepEqual(plain(R.presetRange('lastweek', today)), ['2026-11-08', '2026-11-14']);
        assert.deepEqual(plain(R.presetRange('month', today)), ['2026-11-01', '2026-11-30']);
        assert.deepEqual(plain(R.presetRange('lastmonth', today)), ['2026-10-01', '2026-10-31']);
        assert.deepEqual(plain(R.presetRange('lastmonth', '2027-01-10')), ['2026-12-01', '2026-12-31'], 'virada de ano');
        assert.equal(R.presetRange('custom', today), null);
    });
    test('despesas por dia: campo date, criação (antigas) ou 1º do mês', () => {
        assert.equal(R.expenseDate({ date: '2026-11-12' }, '2026-11'), '2026-11-12');
        assert.equal(R.expenseDate({ createdAt: '2026-11-05T15:00:00' }, '2026-11'), '2026-11-05');
        assert.equal(R.expenseDate({ createdAt: '2026-12-02T10:00:00' }, '2026-11'), '2026-11-01', 'criada em outro mês: usa o 1º do mês');
        assert.equal(R.expenseDate({}, '2026-11'), '2026-11-01');
    });
    test('despesas dentro do período', () => {
        const exp = {
            '2026-10': { a: { label: 'Out', amount: 50, date: '2026-10-31' } },
            '2026-11': { b: { label: 'Aluguel', amount: 800, date: '2026-11-05' }, c: { label: 'Produtos', amount: 100, date: '2026-11-15' }, d: null }
        };
        const list = R.expensesInRange(exp, '2026-11-10', '2026-11-20');
        assert.deepEqual(plain(list.map(e => e.label)), ['Produtos']);
        assert.equal(R.expensesInRange(exp, '2026-10-01', '2026-11-30').reduce((s, e) => s + e.amount, 0), 950);
    });
    test('faturamento por dia, com dias zerados', () => {
        const s = R.dailySeries([{ date: '2026-11-02', amount: 30 }, { date: '2026-11-02', amount: 20 }, { date: '2026-11-04', amount: 35 }], '2026-11-01', '2026-11-04');
        assert.deepEqual(plain(s.days), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
        assert.deepEqual(plain(s.values), [0, 50, 0, 35]);
    });
    test('destaques do período: serviço mais vendido e clientes distintos', () => {
        const e = [
            { date: '2026-11-02', service: 'Corte', phone: '(21) 98888-7777', name: 'João' },
            { date: '2026-11-03', service: 'Corte', phone: '21988887777', name: 'João' },
            { date: '2026-11-03', service: 'Barba', phone: '(21) 97777-6666', name: 'Pedro' },
            { date: '2026-12-01', service: 'Barba', phone: '1', name: 'X' }
        ];
        const h = R.periodHighlights(e, '2026-11-01', '2026-11-30');
        assert.equal(h.topService, 'Corte'); assert.equal(h.topCount, 2); assert.equal(h.uniqueClients, 2);
        const semNada = R.periodHighlights([{ date: '2026-11-02', service: 'Corte' }, { date: '2026-11-03', service: 'Corte' }], '2026-11-01', '2026-11-30');
        assert.equal(semNada.uniqueClients, 0, 'sem telefone e sem nome não vira "um cliente"');
    });
});

describe('CSV', () => {
    test('separador ; e acentos (BOM)', () => {
        const csv = R.toCsv(['Nome', 'Valor'], [['João', R.csvNumber(35)]]);
        assert.equal(csv, '﻿Nome;Valor\r\nJoão;35,00');
    });
    test('aspas, ponto e vírgula e quebra de linha', () => {
        assert.equal(R.csvCell('a;b'), '"a;b"');
        assert.equal(R.csvCell('diz "oi"'), '"diz ""oi"""');
        assert.equal(R.csvCell('linha1\nlinha2'), '"linha1\nlinha2"');
    });
    test('nome que parece fórmula não vira fórmula no Excel', () => {
        assert.equal(R.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
        assert.equal(R.csvCell('+5521999'), "'+5521999");
        assert.equal(R.csvCell('@soma'), "'@soma");
    });
});
