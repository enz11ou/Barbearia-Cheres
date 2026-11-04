// Regra única de serviços, preços e planos da Barbearia Cheres.
// Usada pelo site (index.html) e pelo painel (admin.html). Não depende do Firebase:
// recebe os dados já lidos de settings/services e settings/plans.
//
// Formato no banco (chave = id gerado pelo painel):
//   settings/services/{id} = { name, price, category: 'individual'|'combo', order, active }
//   settings/plans/{id}    = { name, price, perks: ["4 cortes ao mês", ...], featured, order, active,
//                              uses: 4 (cortes por mês), services: ["Corte", ...] (serviços pagos pelo plano) }
// Sem nada salvo, valem as listas padrão abaixo (as mesmas de antes da Fase 3).
//
// O agendamento guarda só o NOME do serviço. Por isso:
//   - desativar esconde do site, mas o preço continua valendo para quem já agendou;
//   - registros até LEGACY_UNTIL sem preço gravado usam a tabela antiga (mudar preço não altera o passado).
(function (root) {
    'use strict';

    var LEGACY_UNTIL = '2026-11-03';
    var LEGACY_PRICES = {
        'Corte': 35, 'Sobrancelha': 10, 'Pigmentação': 15, 'Reflexo': 75,
        'Nevou': 85, 'Barba': 20, 'Pé': 15, 'Corte e barba': 45,
        'Corte barba e sobrancelha': 50, 'Corte + pigmentação': 45,
        'Corte + reflexo': 75, 'Corte + nevou': 85
    };
    var INDIVIDUAL = ['Corte', 'Sobrancelha', 'Pigmentação', 'Reflexo', 'Nevou', 'Barba', 'Pé'];

    var NAME_MAX = 60, PERK_MAX = 80, PERKS_MAX = 6, PRICE_MAX = 10000, USES_MAX = 31, PLAN_SERVICES_MAX = 50;
    var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

    function slug(s) {
        return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function defaultServices() {
        return Object.keys(LEGACY_PRICES).map(function (name, i) {
            return { id: slug(name), name: name, price: LEGACY_PRICES[name],
                category: INDIVIDUAL.indexOf(name) >= 0 ? 'individual' : 'combo', order: i, active: true };
        });
    }

    function defaultPlans() {
        return [
            { id: 'plano-4-cortes', name: 'Plano 4 Cortes', price: 110, perks: ['4 cortes ao mês', 'Atendimento prioritário'], featured: false, order: 0, active: true,
                uses: 4, services: ['Corte'] },
            { id: 'plano-4-cortes-e-barba', name: 'Plano 4 Cortes e Barba', price: 140, perks: ['4 cortes e barba ao mês', 'Atendimento VIP'], featured: true, order: 1, active: true,
                uses: 4, services: ['Corte', 'Barba', 'Corte e barba'] }
        ];
    }

    function cleanName(s, max) { return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
    function cleanPrice(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && n <= PRICE_MAX ? Math.round(n * 100) / 100 : null; }
    function cleanOrder(n) { return typeof n === 'number' && isFinite(n) ? n : 0; }
    function byOrder(a, b) { return a.order - b.order || a.name.localeCompare(b.name, 'pt-BR'); }

    // O Firebase pode devolver objeto ou array; itens inválidos são ignorados.
    function entries(raw) {
        if (!raw || typeof raw !== 'object') return [];
        return Object.keys(raw).map(function (k) { return [k, raw[k]]; })
            .filter(function (e) { return e[1] && typeof e[1] === 'object' && ID_RE.test(e[0]); });
    }

    // settings/services -> lista ordenada (individuais primeiro). Vazio = padrão.
    function normalizeServices(raw) {
        var list = entries(raw).map(function (e) {
            var v = e[1], name = cleanName(v.name, NAME_MAX), price = cleanPrice(v.price);
            if (!name || price === null) return null;
            return { id: e[0], name: name, price: price, category: v.category === 'combo' ? 'combo' : 'individual',
                order: cleanOrder(v.order), active: v.active !== false };
        }).filter(Boolean);
        if (!list.length) return defaultServices();
        return list.sort(function (a, b) {
            return (a.category === b.category ? 0 : a.category === 'individual' ? -1 : 1) || byOrder(a, b);
        });
    }

    function normalizePlans(raw) {
        var list = entries(raw).map(function (e) {
            var v = e[1], name = cleanName(v.name, NAME_MAX), price = cleanPrice(v.price);
            if (!name || price === null) return null;
            var perks = (Array.isArray(v.perks) ? v.perks : v.perks && typeof v.perks === 'object' ? Object.keys(v.perks).sort(function (a, b) { return a - b; }).map(function (k) { return v.perks[k]; }) : [])
                .map(function (p) { return cleanName(p, PERK_MAX); }).filter(Boolean).slice(0, PERKS_MAX);
            var uses = Number.isInteger(v.uses) && v.uses >= 1 && v.uses <= USES_MAX ? v.uses : 4;
            return { id: e[0], name: name, price: price, perks: perks, featured: v.featured === true,
                order: cleanOrder(v.order), active: v.active !== false, uses: uses, services: listOf(v.services) };
        }).filter(Boolean);
        if (!list.length) return defaultPlans();
        return list.sort(byOrder);
    }

    // Lista de textos (array ou objeto do Firebase), sem vazios nem repetidos.
    function listOf(raw) {
        var arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.keys(raw).sort(function (a, b) { return a - b; }).map(function (k) { return raw[k]; }) : [];
        var seen = {};
        return arr.filter(function (x) { if (typeof x !== 'string' || !x || seen[x]) return false; seen[x] = true; return true; }).slice(0, PLAN_SERVICES_MAX);
    }

    function active(list) { return list.filter(function (s) { return s.active; }); }

    // Preço atual pelo nome (inclui desativados: quem já agendou continua com preço).
    function priceByName(name, services) {
        for (var i = 0; i < services.length; i++) if (services[i].name === name) return services[i].price;
        return null;
    }

    // Preço de tabela de um agendamento/histórico: gravado > tabela antiga (até LEGACY_UNTIL) > tabela atual > tabela antiga.
    function priceOf(rec, services) {
        if (!rec) return 0;
        if (typeof rec.price === 'number') return rec.price;
        var name = rec.service, legacy = LEGACY_PRICES.hasOwnProperty(name) ? LEGACY_PRICES[name] : null;
        if (legacy !== null && typeof rec.date === 'string' && rec.date <= LEGACY_UNTIL) return legacy;
        var cur = priceByName(name, services || defaultServices());
        if (cur !== null) return cur;
        return legacy !== null ? legacy : 0;
    }

    // Confere a lista antes de salvar no painel. Devolve a mensagem do primeiro problema ou ''.
    function validateServices(list) {
        if (!active(list).length) return 'Deixe pelo menos um serviço ativo.';
        var seen = {};
        for (var i = 0; i < list.length; i++) {
            var s = list[i], name = cleanName(s.name, NAME_MAX + 1);
            if (!name) return 'Todo serviço precisa de nome.';
            if (name.length > NAME_MAX) return 'O nome "' + name.slice(0, 20) + '…" passa de ' + NAME_MAX + ' letras.';
            if (cleanPrice(s.price) === null) return 'Preço inválido em "' + name + '".';
            var k = name.toLowerCase();
            if (seen[k]) return 'O serviço "' + name + '" aparece duas vezes.';
            seen[k] = true;
        }
        return '';
    }

    function validatePlans(list) {
        var seen = {};
        for (var i = 0; i < list.length; i++) {
            var p = list[i], name = cleanName(p.name, NAME_MAX + 1);
            if (!name) return 'Todo plano precisa de nome.';
            if (name.length > NAME_MAX) return 'O nome "' + name.slice(0, 20) + '…" passa de ' + NAME_MAX + ' letras.';
            if (cleanPrice(p.price) === null) return 'Preço inválido em "' + name + '".';
            if ((p.perks || []).filter(function (x) { return cleanName(x, PERK_MAX + 1); }).length > PERKS_MAX) return 'Use no máximo ' + PERKS_MAX + ' itens por plano.';
            if ((p.perks || []).some(function (x) { return cleanName(x, PERK_MAX + 1).length > PERK_MAX; })) return 'Um item de "' + name + '" passa de ' + PERK_MAX + ' letras.';
            if (!Number.isInteger(p.uses) || p.uses < 1 || p.uses > USES_MAX) return 'Em "' + name + '", informe de 1 a ' + USES_MAX + ' cortes por mês.';
            if (!listOf(p.services).length) return 'Em "' + name + '", marque pelo menos um serviço incluído no plano.';
            var k = name.toLowerCase();
            if (seen[k]) return 'O plano "' + name + '" aparece duas vezes.';
            seen[k] = true;
        }
        return '';
    }

    // Lista do painel -> objeto para gravar (ordem = posição na lista).
    function toServicesData(list) {
        var out = {};
        list.forEach(function (s, i) {
            out[s.id] = { name: cleanName(s.name, NAME_MAX), price: cleanPrice(s.price),
                category: s.category === 'combo' ? 'combo' : 'individual', order: i, active: s.active !== false };
        });
        return out;
    }

    function toPlansData(list) {
        var out = {};
        list.forEach(function (p, i) {
            var perks = (p.perks || []).map(function (x) { return cleanName(x, PERK_MAX); }).filter(Boolean);
            var item = { name: cleanName(p.name, NAME_MAX), price: cleanPrice(p.price), featured: p.featured === true, order: i, active: p.active !== false };
            if (Number.isInteger(p.uses)) item.uses = p.uses;
            var svc = listOf(p.services);
            if (svc.length) item.services = svc;
            if (perks.length) item.perks = perks;
            out[p.id] = item;
        });
        return out;
    }

    // Id novo, único e aceito pelas regras.
    function newId(name, taken) {
        var base = (slug(name) || 'item').slice(0, 30), id = base, n = 2;
        while (taken.indexOf(id) >= 0) id = base + '-' + n++;
        return id;
    }

    root.CheresServices = {
        LEGACY_UNTIL: LEGACY_UNTIL, NAME_MAX: NAME_MAX, USES_MAX: USES_MAX, PERK_MAX: PERK_MAX, PERKS_MAX: PERKS_MAX, PRICE_MAX: PRICE_MAX,
        defaultServices: defaultServices, defaultPlans: defaultPlans,
        normalizeServices: normalizeServices, normalizePlans: normalizePlans, active: active,
        priceByName: priceByName, priceOf: priceOf,
        validateServices: validateServices, validatePlans: validatePlans,
        toServicesData: toServicesData, toPlansData: toPlansData, newId: newId
    };
})(typeof window !== 'undefined' ? window : this);
