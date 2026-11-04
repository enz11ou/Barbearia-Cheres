// Regra única das assinaturas dos planos da Barbearia Cheres (Fase 4B).
// Usada pelo painel (admin.html) e pela "Minha Conta" do cliente (index.html). Não depende do Firebase.
//
// Formato no banco (só o barbeiro grava; o cliente lê só o dele):
//   subscriptions/{telefone} = { planId, planName, price, uses, services: ["Corte", ...], dueDay (1-28),
//                                startDate "AAAA-MM-DD", billFrom "AAAA-MM", status: active|paused|cancelled,
//                                statusAt "AAAA-MM-DD", createdAt, owed?: { "AAAA-MM": true } }
//     owed = mensalidades vencidas e não pagas guardadas ao pausar/cancelar (continuam cobráveis depois).
//     planName/price/uses/services são copiados do plano na adesão: mudar o plano depois não muda quem já assina.
//   subscriptionPayments/{telefone}/{AAAA-MM} = { amount, method: pix|cash|card, paidAt "AAAA-MM-DD", recordedAt }
//
// Regras do negócio (decididas com o dono):
//   - ciclo = mês do calendário; a mensalidade vence num dia fixo (dueDay);
//   - cortes do plano não acumulam de um mês para o outro;
//   - corte pago pelo plano (payment.method === 'plan') não conta na fidelidade (ver attendance.js).
(function (root) {
    'use strict';

    var DATE_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
    var MONTH_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])$/;
    var STATUS = { active: 'Ativo', paused: 'Pausado', cancelled: 'Cancelado' };
    var MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    var SOON_DAYS = 5;        // "vence em breve" = até 5 dias antes do vencimento

    function pad(n) { return String(n).padStart(2, '0'); }
    function monthOf(date) { return String(date || '').slice(0, 7); }
    function addMonths(month, n) {
        var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1 + n;
        y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
        return y + '-' + pad(m + 1);
    }
    function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
    function monthLabel(month) { return MONTH_NAMES[Number(month.slice(5, 7)) - 1] + '/' + month.slice(0, 4); }
    function dateBR(date) { return date.slice(8, 10) + '/' + date.slice(5, 7); }

    function cleanServices(list) {
        var arr = Array.isArray(list) ? list : list && typeof list === 'object' ? Object.keys(list).sort(function (a, b) { return a - b; }).map(function (k) { return list[k]; }) : [];
        var seen = {};
        return arr.filter(function (s) { if (typeof s !== 'string' || !s || seen[s]) return false; seen[s] = true; return true; });
    }

    // Lê subscriptions/{telefone}; devolve null se faltar o essencial.
    function normalizeSubscription(raw) {
        if (!raw || typeof raw !== 'object') return null;
        if (typeof raw.planName !== 'string' || !raw.planName || typeof raw.price !== 'number' || !DATE_RE.test(raw.startDate || '')) return null;
        var due = Number(raw.dueDay);
        return {
            planId: typeof raw.planId === 'string' ? raw.planId : '',
            planName: raw.planName, price: raw.price,
            uses: Number.isInteger(raw.uses) && raw.uses > 0 ? raw.uses : 0,
            services: cleanServices(raw.services),
            dueDay: Number.isInteger(due) && due >= 1 && due <= 28 ? due : 10,
            startDate: raw.startDate,
            billFrom: MONTH_RE.test(raw.billFrom || '') ? raw.billFrom : monthOf(raw.startDate),
            status: STATUS[raw.status] ? raw.status : 'active',
            statusAt: DATE_RE.test(raw.statusAt || '') ? raw.statusAt : raw.startDate,
            owed: cleanOwed(raw.owed)
        };
    }

    function cleanOwed(raw) {
        var out = {};
        Object.keys(raw && typeof raw === 'object' ? raw : {}).forEach(function (m) { if (MONTH_RE.test(m) && raw[m] === true) out[m] = true; });
        return out;
    }

    // Dados para gravar uma assinatura nova a partir de um plano (já normalizado pelo services.js).
    // carryOwed: mensalidades ainda devidas de uma assinatura anterior (não somem ao reassinar).
    function newSubscription(plan, startDate, dueDay, nowIso, carryOwed) {
        var sub = {
            planId: plan.id, planName: plan.name, price: plan.price,
            uses: plan.uses, services: plan.services.slice(),
            dueDay: dueDay, startDate: startDate, billFrom: monthOf(startDate),
            status: 'active', statusAt: startDate, createdAt: nowIso
        };
        if (carryOwed && Object.keys(carryOwed).length) sub.owed = carryOwed;
        return sub;
    }

    // Mensalidades vencidas e ainda não pagas (guardadas ao pausar/cancelar e levadas ao reassinar).
    function unpaidOwed(sub, payments, today) {
        var out = {};
        billing(sub, payments, today).months.forEach(function (m) { if (m.state === 'late') out[m.month] = true; });
        return out;
    }

    // Mudança de situação. Meses pausados não são cobrados: ao retomar, a cobrança recomeça no mês da retomada.
    // Ao sair de "ativo", o que já venceu e não foi pago fica guardado em owed (a dívida não some).
    function statusChange(sub, status, today, payments) {
        var out = { status: status, statusAt: today };
        if (status === 'active' && sub.status !== 'active') out.billFrom = monthOf(today);
        if (status !== 'active' && sub.status === 'active') {
            var owed = unpaidOwed(sub, payments, today);
            if (Object.keys(owed).length) out.owed = owed;
        }
        return out;
    }

    function viaPlan(rec) { return !!(rec && rec.payment && rec.payment.method === 'plan'); }
    function covers(sub, service) { return !!sub && sub.services.indexOf(service) >= 0; }

    // Cortes do plano usados no mês (registros pagos com "Plano"). exceptKey: ignora o próprio registro (ao editar).
    // sinceDate: conta só a partir do início da assinatura atual (cortes de um plano anterior não contam).
    function usedInMonth(records, month, exceptKey, sinceDate) {
        return (records || []).filter(function (r) {
            return viaPlan(r) && monthOf(r.date) === month && (!exceptKey || r.key !== exceptKey) && (!sinceDate || String(r.date) >= sinceDate);
        }).length;
    }

    // Este atendimento pode ser pago pelo plano? (assinatura ativa desde a data, serviço incluído, ainda há uso no mês)
    function planUse(sub, records, rec) {
        var res = { eligible: false, used: 0, uses: sub ? sub.uses : 0, reason: '' };
        if (!sub || !rec) return res;
        res.used = usedInMonth(records, monthOf(rec.date), rec.key, sub.startDate);
        if (sub.status !== 'active') res.reason = 'Assinatura ' + STATUS[sub.status].toLowerCase();
        else if (String(rec.date) < sub.startDate) res.reason = 'Antes do início do plano';
        else if (!covers(sub, rec.service)) res.reason = 'Serviço fora do plano';
        else if (res.used >= sub.uses) res.reason = 'Cortes do mês já usados';
        else res.eligible = true;
        return res;
    }

    function dueDate(sub, month) { return month + '-' + pad(sub.dueDay); }

    // Data a partir da qual a cobrança atual vale (início ou retomada).
    function billAnchor(sub) {
        if (monthOf(sub.startDate) === sub.billFrom) return sub.startDate;
        if (monthOf(sub.statusAt) === sub.billFrom) return sub.statusAt;
        return sub.billFrom + '-01';
    }

    // Vencimento de um mês. No primeiro mês da cobrança, nunca antes do início ou da retomada:
    // assinar no dia 30 com vencimento no dia 28 não nasce atrasado, vence no próprio dia 30.
    function dueFor(sub, month) {
        var due = dueDate(sub, month);
        if (month === sub.billFrom) { var anchor = billAnchor(sub); if (anchor > due) due = anchor; }
        return due;
    }

    function stateOf(due, pay, today) {
        return pay ? 'paid' : today > due ? 'late' : daysBetween(today, due) <= SOON_DAYS ? 'soon' : 'open';
    }

    // Mensalidades: as guardadas como devidas (owed) + as do período ativo, do mês de início/retomada até o atual.
    // state: paid | late | soon | open. Pausada ou cancelada: só as devidas. next = a próxima a pagar.
    function billing(sub, payments, today) {
        if (!sub) return { months: [], late: 0, open: null, next: null };
        var cur = monthOf(today), byMonth = {};
        Object.keys(sub.owed || {}).forEach(function (m) {
            if (!(payments && payments[m])) byMonth[m] = { month: m, due: dueDate(sub, m), state: 'late', payment: null };
        });
        if (sub.status === 'active') {
            for (var m = sub.billFrom; m <= cur; m = addMonths(m, 1)) {
                var due = dueFor(sub, m), pay = payments && payments[m];
                byMonth[m] = { month: m, due: due, state: stateOf(due, pay, today), payment: pay || null };
            }
        }
        var months = Object.keys(byMonth).sort().map(function (k) { return byMonth[k]; });
        var late = months.filter(function (x) { return x.state === 'late'; }).length;
        var open = null;
        for (var i = 0; i < months.length; i++) if (months[i].state !== 'paid') { open = months[i]; break; }
        var next = open;
        if (!next && sub.status === 'active') {
            // Tudo pago: a próxima é a do mês seguinte (ou a primeira, se o plano começa no futuro).
            var nm = sub.billFrom > cur ? sub.billFrom : addMonths(cur, 1), nd = dueFor(sub, nm);
            next = { month: nm, due: nd, state: stateOf(nd, null, today), payment: null };
        }
        return { months: months, late: late, open: open, next: next };
    }

    // Mensalidades pagas dentro do período [from, to] (pela data do pagamento), para o Financeiro.
    function paymentsInRange(all, from, to) {
        var out = [];
        Object.keys(all || {}).forEach(function (pk) {
            var months = all[pk] || {};
            Object.keys(months).forEach(function (m) {
                var p = months[m];
                if (!p || typeof p.amount !== 'number' || !DATE_RE.test(p.paidAt || '')) return;
                if (p.paidAt >= from && p.paidAt <= to) out.push({ phoneKey: pk, month: m, amount: p.amount, method: p.method || 'unknown', paidAt: p.paidAt });
            });
        });
        return out.sort(function (a, b) { return a.paidAt.localeCompare(b.paidAt); });
    }

    // Assinantes ativos e receita mensal prevista (soma dos preços gravados nas assinaturas).
    function summary(subs) {
        var count = 0, monthly = 0;
        Object.keys(subs || {}).forEach(function (pk) {
            var s = normalizeSubscription(subs[pk]);
            if (s && s.status === 'active') { count++; monthly += s.price; }
        });
        return { count: count, monthly: Math.round(monthly * 100) / 100 };
    }

    function money(n) { return 'R$ ' + Number(n).toFixed(2).replace('.', ','); }

    // Mensagem pronta de cobrança para o WhatsApp.
    function chargeMessage(name, sub, item) {
        var first = String(name || '').trim().split(/\s+/)[0] || 'tudo bem';
        var when = item.state === 'late' ? 'que venceu em ' + dateBR(item.due) : 'com vencimento em ' + dateBR(item.due);
        return 'Olá, ' + first + '! Tudo bem? Passando para lembrar da mensalidade do ' + sub.planName + ' (' + money(sub.price) + ') de ' +
            monthLabel(item.month) + ', ' + when + '. Qualquer dúvida é só me chamar. Obrigado! André, Barbearia Cheres';
    }

    root.CheresPlans = {
        STATUS: STATUS, SOON_DAYS: SOON_DAYS,
        monthOf: monthOf, addMonths: addMonths, monthLabel: monthLabel,
        normalizeSubscription: normalizeSubscription, newSubscription: newSubscription, statusChange: statusChange, unpaidOwed: unpaidOwed,
        viaPlan: viaPlan, covers: covers, usedInMonth: usedInMonth, planUse: planUse,
        dueDate: dueDate, dueFor: dueFor, billing: billing, paymentsInRange: paymentsInRange, summary: summary,
        chargeMessage: chargeMessage
    };
})(typeof window !== 'undefined' ? window : globalThis);
