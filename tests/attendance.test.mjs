// Testes da regra de atendimento (barbearia-cheres-main/attendance.js).
// Rodar: npm run test:schedule   (não precisa do emulador)
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const ctx = { window: {} };
vm.runInNewContext(readFileSync(new URL('../barbearia-cheres-main/attendance.js', import.meta.url), 'utf8'), ctx);
const A = ctx.window.CheresAttendance;

const prices = { Corte: 35, Barba: 20 };
const NOW = '2026-11-03 15:00';
const isPast = (date, time) => `${date} ${time}` <= NOW;

describe('situação do atendimento', () => {
    test('agendamento futuro fica "upcoming"', () => {
        assert.equal(A.outcome({ date: '2026-11-04', time: '10:00' }, isPast, false), 'upcoming');
    });
    test('horário de hoje que já começou e não foi marcado fica pendente (não vira concluído sozinho)', () => {
        assert.equal(A.outcome({ date: '2026-11-03', time: '14:00' }, isPast, false), 'pending');
    });
    test('histórico novo sem marcação fica pendente', () => {
        assert.equal(A.outcome({ date: '2026-11-01', time: '10:00', status: 'pending' }, isPast, true), 'pending');
    });
    test('histórico antigo ("completed", antes da fase 2) conta como atendido', () => {
        assert.equal(A.outcome({ date: '2026-10-01', time: '10:00', status: 'completed' }, isPast, true), 'attended');
    });
    test('marcação do barbeiro vale mais que tudo', () => {
        assert.equal(A.outcome({ date: '2026-11-03', time: '14:00', attendance: 'noshow' }, isPast, false), 'noshow');
        assert.equal(A.outcome({ date: '2026-10-01', status: 'completed', attendance: 'noshow' }, isPast, true), 'noshow');
        assert.equal(A.outcome({ date: '2026-11-01', status: 'pending', attendance: 'attended' }, isPast, true), 'attended');
    });
});

describe('valor pago', () => {
    test('atendido com desconto usa o valor pago', () => {
        const rec = { service: 'Corte', attendance: 'attended', payment: { method: 'pix', amount: 30 } };
        assert.equal(A.paidValue(rec, prices, 'attended'), 30);
        assert.equal(A.methodLabel(rec), 'Pix');
    });
    test('atendido antigo sem pagamento usa o preço da tabela', () => {
        assert.equal(A.paidValue({ service: 'Corte', status: 'completed' }, prices, 'attended'), 35);
    });
    test('preço guardado na época vale mais que a tabela atual', () => {
        assert.equal(A.paidValue({ service: 'Corte', price: 30 }, prices, 'attended'), 30);
    });
    test('falta e pendente não contam dinheiro', () => {
        assert.equal(A.paidValue({ service: 'Corte' }, prices, 'noshow'), 0);
        assert.equal(A.paidValue({ service: 'Corte' }, prices, 'pending'), 0);
    });
    test('valor zero (cortesia) é aceito', () => {
        assert.equal(A.paidValue({ service: 'Corte', payment: { method: 'cash', amount: 0 } }, prices, 'attended'), 0);
    });
});

describe('valor digitado', () => {
    test('aceita formatos comuns', () => {
        assert.equal(A.parseAmount('30'), 30);
        assert.equal(A.parseAmount('30,50'), 30.5);
        assert.equal(A.parseAmount('R$ 1.250,00'), 1250);
        assert.equal(A.parseAmount('0'), 0);
    });
    test('recusa vazio, negativo e absurdo', () => {
        assert.equal(A.parseAmount(''), null);
        assert.equal(A.parseAmount('abc'), null);
        assert.equal(A.parseAmount('-5'), null);
        assert.equal(A.parseAmount('999999'), null);
    });
});
