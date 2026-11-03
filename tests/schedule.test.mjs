// Testes da regra única de horários (barbearia-cheres-main/schedule.js).
// Rodar: npm run test:schedule   (não precisa do emulador)
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const code = readFileSync(new URL('../barbearia-cheres-main/schedule.js', import.meta.url), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(code, ctx);
const S = ctx.window.CheresSchedule;

const store = list => S.timesToStore(list);
// Datas de referência: 2026-12-08 é terça; 2026-12-12 sábado; 2026-12-13 domingo; 2026-12-14 segunda.
const TUE = '2026-12-08', SAT = '2026-12-12', SUN = '2026-12-13', MON = '2026-12-14';
const plain = v => JSON.parse(JSON.stringify(v));   // objetos do vm têm outro protótipo

describe('padrão (nada salvo no banco)', () => {
    test('dia normal: terça das 09:00 às 18:00, de 30 em 30 min (19 horários, igual ao site antigo)', () => {
        const day = S.forDate(TUE, null, {});
        assert.equal(day.open, true);
        assert.equal(day.source, 'default');
        assert.equal(day.times.length, 19);
        assert.equal(day.times[0], '09:00');
        assert.equal(day.times[1], '09:30');
        assert.equal(day.times[18], '18:00');
    });
    test('domingo e segunda fechados', () => {
        assert.equal(S.forDate(SUN, null, {}).open, false);
        assert.equal(S.forDate(MON, null, {}).open, false);
        assert.equal(S.forDate(SAT, null, {}).open, true);
    });
    test('texto do site: "Ter a Sáb" e "9h às 18h"', () => {
        assert.equal(S.describeOpenDays(null), 'Ter a Sáb');
        assert.equal(S.describeHours(null), '9h às 18h');
    });
});

describe('semana padrão editada', () => {
    test('sábado reduzido: só até 14:00', () => {
        const settings = { days: { 6: { open: true, times: store(S.range('09:00', '13:30')) } } };
        const day = S.forDate(SAT, settings, {});
        assert.equal(day.source, 'weekday');
        assert.deepEqual(plain(day.times), plain(S.range('09:00', '13:30')));
        assert.equal(S.forDate(TUE, settings, {}).times.length, 19, 'outros dias continuam no padrão');
    });
    test('almoço fixo: 12:00 e 12:30 desligados', () => {
        const times = S.range('09:00', '18:00').filter(t => t !== '12:00' && t !== '12:30');
        const day = S.forDate(TUE, { days: { 2: { open: true, times: store(times) } } }, {});
        assert.equal(day.times.includes('12:00'), false);
        assert.equal(day.times.includes('12:30'), false);
        assert.equal(day.times.length, 17);
    });
    test('dia da semana fechado', () => {
        const settings = { days: { 3: { open: false } } };
        assert.equal(S.forDate('2026-12-09', settings, {}).open, false);
        assert.equal(S.describeOpenDays(settings), 'Ter e Qui a Sáb');
    });
    test('"days" vindo do Firebase como array também funciona', () => {
        const days = []; days[6] = { open: true, times: store(['10:00']) };
        assert.deepEqual(plain(S.forDate(SAT, { days }, {}).times), ['10:00']);
    });
    test('aberto mas sem horários conta como fechado', () => {
        assert.equal(S.forDate(TUE, { days: { 2: { open: true, times: {} } } }, {}).open, false);
    });
});

describe('dias especiais (exceções por data)', () => {
    test('data aberta até as 21h', () => {
        const ex = { [TUE]: { times: store(S.range('09:00', '21:00')) } };
        const day = S.forDate(TUE, null, ex);
        assert.equal(day.source, 'exception');
        assert.equal(day.times[day.times.length - 1], '21:00');
        assert.equal(day.times.length, 25);
    });
    test('horário extra avulso (19:30) somado ao dia', () => {
        const ex = { [TUE]: { times: store([...S.range('09:00', '18:00'), '19:30']) } };
        const day = S.forDate(TUE, null, ex);
        assert.equal(day.times.includes('19:30'), true);
        assert.equal(day.times.includes('19:00'), false);
        assert.equal(day.times[day.times.length - 1], '19:30');
    });
    test('data fechada vale mais que a semana padrão', () => {
        const day = S.forDate(TUE, null, { [TUE]: { closed: true } });
        assert.equal(day.open, false);
        assert.equal(day.source, 'exception');
    });
    test('abrir uma segunda-feira específica', () => {
        const day = S.forDate(MON, null, { [MON]: { times: store(['10:00', '10:30']) } });
        assert.equal(day.open, true);
        assert.deepEqual(plain(day.times), ['10:00', '10:30']);
    });
    test('exceção de outra data não interfere', () => {
        assert.equal(S.forDate(SAT, null, { [TUE]: { closed: true } }).open, true);
    });
});

describe('auxiliares', () => {
    test('range e validação de 30 em 30 minutos', () => {
        assert.deepEqual(plain(S.range('20:00', '21:00')), ['20:00', '20:30', '21:00']);
        assert.equal(S.isValidTime('19:30'), true);
        assert.equal(S.isValidTime('19:15'), false);
        assert.equal(S.isValidTime('24:00'), false);
        assert.deepEqual(plain(S.range('18:00', '09:00')), [], 'fim antes do início não gera horários');
    });
    test('horários inválidos salvos no banco são ignorados', () => {
        const day = S.forDate(TUE, null, { [TUE]: { times: { '0900': true, '0915': true, abc: true, '1000': false } } });
        assert.deepEqual(plain(day.times), ['09:00']);
    });
    test('datas de um período (fim de ano, virada de mês e ano)', () => {
        const d = S.datesBetween('2026-12-30', '2027-01-02');
        assert.deepEqual(plain(d), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
        assert.deepEqual(plain(S.datesBetween('2026-12-20', '2026-12-19')), []);
    });
});
