// Testes de serviços, preços e planos (services.js).
// Rodar: npm run test:schedule   (não precisa do emulador)
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const ctx = { window: {} };
for (const f of ['attendance.js', 'services.js']) vm.runInNewContext(readFileSync(new URL(`../barbearia-cheres-main/${f}`, import.meta.url), 'utf8'), ctx);
const S = ctx.window.CheresServices, A = ctx.window.CheresAttendance;
const plain = v => JSON.parse(JSON.stringify(v));

describe('listas padrão', () => {
    test('sem nada salvo valem os 12 serviços e 2 planos de antes', () => {
        const list = S.normalizeServices(null);
        assert.equal(list.length, 12);
        assert.equal(list.find(s => s.name === 'Corte').price, 35);
        assert.equal(list.filter(s => s.category === 'individual').length, 7);
        assert.equal(S.normalizePlans(undefined).length, 2);
        assert.equal(S.normalizePlans({}).length, 2);
    });
    test('ids padrão são aceitos pelas regras', () => {
        for (const s of S.defaultServices()) assert.match(s.id, /^[A-Za-z0-9_-]{1,40}$/);
    });
});

describe('normalizeServices', () => {
    test('ordena individuais primeiro e depois pela ordem', () => {
        const list = S.normalizeServices({
            b: { name: 'Combo', price: 50, category: 'combo', order: 0 },
            a: { name: 'Barba', price: 20, category: 'individual', order: 1 },
            c: { name: 'Corte', price: 40, category: 'individual', order: 0 }
        });
        assert.deepEqual(plain(list.map(s => s.name)), ['Corte', 'Barba', 'Combo']);
    });
    test('ignora itens inválidos e mantém desativados', () => {
        const list = S.normalizeServices({
            ok: { name: '  Corte   degradê ', price: 40 },
            off: { name: 'Pé', price: 15, active: false },
            semNome: { name: '', price: 10 },
            precoRuim: { name: 'X', price: -1 },
            'id inválido': { name: 'Y', price: 10 }
        });
        assert.deepEqual(plain(list.map(s => [s.name, s.active])), [['Corte degradê', true], ['Pé', false]]);
        assert.deepEqual(plain(S.active(list).map(s => s.name)), ['Corte degradê']);
    });
    test('tudo inválido = volta ao padrão', () => {
        assert.equal(S.normalizeServices({ x: { name: '' } }).length, 12);
    });
});

describe('normalizePlans', () => {
    test('aceita itens como array ou objeto do Firebase', () => {
        const list = S.normalizePlans({
            p2: { name: 'B', price: 140, perks: { 1: 'Barba', 0: '4 cortes' }, featured: true, order: 1 },
            p1: { name: 'A', price: 110, perks: ['4 cortes', ''], order: 0 }
        });
        assert.deepEqual(plain(list.map(p => [p.name, p.perks, p.featured])), [['A', ['4 cortes'], false], ['B', ['4 cortes', 'Barba'], true]]);
    });
});

describe('priceOf (preço da época)', () => {
    const services = S.normalizeServices({
        c: { name: 'Corte', price: 40 },
        n: { name: 'Corte navalhado', price: 50 },
        p: { name: 'Pé', price: 18, active: false }
    });
    test('preço gravado no registro sempre vale', () => {
        assert.equal(S.priceOf({ service: 'Corte', date: '2026-12-01', price: 30 }, services), 30);
    });
    test('até 03/11/2026 sem preço gravado usa a tabela antiga', () => {
        assert.equal(S.priceOf({ service: 'Corte', date: '2026-10-10' }, services), 35);
        assert.equal(S.priceOf({ service: 'Corte', date: '2026-11-03' }, services), 35);
    });
    test('depois disso usa a tabela atual, inclusive serviço desativado', () => {
        assert.equal(S.priceOf({ service: 'Corte', date: '2026-11-04' }, services), 40);
        assert.equal(S.priceOf({ service: 'Pé', date: '2026-12-01' }, services), 18);
        assert.equal(S.priceOf({ service: 'Corte navalhado', date: '2026-12-01' }, services), 50);
    });
    test('serviço renomeado/removido cai na tabela antiga; desconhecido = 0', () => {
        assert.equal(S.priceOf({ service: 'Barba', date: '2026-12-01' }, services), 20);
        assert.equal(S.priceOf({ service: 'Inexistente', date: '2026-12-01' }, services), 0);
        assert.equal(S.priceOf(null, services), 0);
    });
    test('attendance.listPrice aceita a função de preço', () => {
        const fn = rec => S.priceOf(rec, services);
        assert.equal(A.listPrice({ service: 'Corte', date: '2026-12-01' }, fn), 40);
        assert.equal(A.paidValue({ service: 'Corte', date: '2026-10-01' }, fn, 'attended'), 35);
        assert.equal(A.listPrice({ service: 'Corte' }, { Corte: 35 }), 35);
    });
});

describe('validação antes de salvar', () => {
    const base = () => S.defaultServices();
    test('lista padrão passa', () => {
        assert.equal(S.validateServices(base()), '');
        assert.equal(S.validatePlans(S.defaultPlans()), '');
    });
    test('recusa nome repetido (sem diferenciar maiúsculas), vazio, preço inválido, nenhum ativo', () => {
        assert.match(S.validateServices([...base(), { id: 'x', name: 'corte', price: 1 }]), /duas vezes/);
        assert.match(S.validateServices([{ id: 'x', name: ' ', price: 1, active: true }]), /nome/);
        assert.match(S.validateServices([{ id: 'x', name: 'A', price: NaN, active: true }]), /Preço/);
        assert.match(S.validateServices([{ id: 'x', name: 'A', price: 99999, active: true }]), /Preço/);
        assert.match(S.validateServices([{ id: 'x', name: 'A', price: 1, active: false }]), /ativo/);
    });
    test('planos: itens demais ou longos', () => {
        const p = { id: 'p', name: 'P', price: 100, perks: Array(7).fill('x') };
        assert.match(S.validatePlans([p]), /máximo/);
        assert.match(S.validatePlans([{ ...p, perks: ['x'.repeat(81)] }]), /passa/);
    });
});

describe('gravação', () => {
    test('toServicesData usa a posição como ordem e volta igual ao normalizar', () => {
        const data = S.toServicesData(S.defaultServices());
        assert.equal(data.corte.order, 0);
        assert.deepEqual(plain(S.normalizeServices(data)), plain(S.defaultServices()));
    });
    test('toPlansData omite perks vazio e volta igual', () => {
        const data = S.toPlansData([{ id: 'a', name: 'A', price: 10, perks: [' '] }]);
        assert.equal('perks' in data.a, false);
        assert.deepEqual(plain(S.normalizePlans(S.toPlansData(S.defaultPlans()))), plain(S.defaultPlans()));
    });
    test('newId gera id único e válido', () => {
        assert.equal(S.newId('Corte Degradê!', []), 'corte-degrade');
        assert.equal(S.newId('Corte', ['corte', 'corte-2']), 'corte-3');
        assert.equal(S.newId('***', []), 'item');
    });
});
