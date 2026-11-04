// Financeiro e exportação (só o painel do barbeiro usa).
// Depende de CheresAttendance (attendance.js). Funções puras, testadas em tests/reports.test.mjs.
(function (root) {
    'use strict';
    var A = root.CheresAttendance;

    // Junta os atendidos de appointments (dia em andamento) e appointmentHistory numa lista única de entradas.
    function attendedEntries(appointments, history, prices, isPast) {
        var out = [];
        var add = function (list, inHistory) {
            (list || []).forEach(function (rec) {
                if (!rec || !rec.date) return;
                var outcome = A.outcome(rec, isPast, inHistory);
                if (outcome !== 'attended') return;
                out.push({
                    date: rec.date, time: rec.time || '', service: rec.service || '',
                    phone: rec.phone || '', name: rec.name || '',
                    amount: A.paidValue(rec, prices, outcome),
                    method: (rec.payment && rec.payment.method) || 'unknown'
                });
            });
        };
        add(appointments, false);
        add(history, true);
        return out;
    }

    // Mensalidades pagas viram entradas do Financeiro (kind 'subscription'), na data do pagamento.
    // payments: lista de CheresPlans.paymentsInRange; nameOf(telefone) devolve o nome do cliente.
    var SUBSCRIPTION_LABEL = 'Mensalidades dos planos';
    function subscriptionEntries(payments, nameOf) {
        return (payments || []).map(function (p) {
            return { kind: 'subscription', date: p.paidAt, time: '', service: SUBSCRIPTION_LABEL, phone: p.phoneKey,
                name: nameOf ? nameOf(p.phoneKey) : '', amount: p.amount, method: p.method, month: p.month };
        });
    }

    // Resumo de um período [from, to] (datas AAAA-MM-DD, inclusive).
    // total = atendimentos + mensalidades. count/average olham só os atendimentos; o ticket médio ignora
    // os cortes pagos pelo plano (valor 0), para não puxar a média para baixo.
    function summarize(entries, from, to) {
        var list = entries.filter(function (e) { return e.date >= from && e.date <= to; });
        var total = 0, byMethod = { pix: 0, cash: 0, card: 0, plan: 0, unknown: 0 }, byService = {};
        var count = 0, paidCount = 0, paidTotal = 0, planUses = 0, subscriptions = 0, subscriptionCount = 0;
        list.forEach(function (e) {
            total += e.amount;
            byMethod[Object.prototype.hasOwnProperty.call(byMethod, e.method) ? e.method : 'unknown'] += e.amount;
            byService[e.service] = (byService[e.service] || 0) + e.amount;
            if (e.kind === 'subscription') { subscriptions += e.amount; subscriptionCount++; return; }
            count++;
            if (e.method === 'plan') planUses++;
            else { paidCount++; paidTotal += e.amount; }
        });
        var round = function (n) { return Math.round(n * 100) / 100; };
        Object.keys(byMethod).forEach(function (k) { byMethod[k] = round(byMethod[k]); });
        return {
            count: count, total: round(total), average: paidCount ? round(paidTotal / paidCount) : 0,
            byMethod: byMethod, byService: byService, planUses: planUses,
            subscriptions: round(subscriptions), subscriptionCount: subscriptionCount
        };
    }

    function sumExpenses(monthExpenses) {
        var total = 0;
        Object.keys(monthExpenses || {}).forEach(function (k) {
            var v = monthExpenses[k];
            if (v && typeof v.amount === 'number') total += v.amount;
        });
        return Math.round(total * 100) / 100;
    }

    function iso(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    // Semana de domingo a sábado que contém "date"; mês da data.
    function weekRange(date) {
        var d = new Date(date + 'T00:00:00');
        var start = new Date(d); start.setDate(d.getDate() - d.getDay());
        var end = new Date(start); end.setDate(start.getDate() + 6);
        return [iso(start), iso(end)];
    }
    function monthRange(date) {
        var d = new Date(date + 'T00:00:00');
        return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
    }

    function addDays(date, n) {
        var d = new Date(date + 'T00:00:00');
        d.setDate(d.getDate() + n);
        return iso(d);
    }

    // Atalhos do filtro de período. Devolve [de, até] (inclusive) ou null se o atalho não existir.
    function presetRange(preset, today) {
        switch (preset) {
            case 'today': return [today, today];
            case 'yesterday': { var y = addDays(today, -1); return [y, y]; }
            case 'week': return weekRange(today);
            case 'lastweek': return weekRange(addDays(today, -7));
            case 'month': return monthRange(today);
            case 'lastmonth': return monthRange(addDays(monthRange(today)[0], -1));
            default: return null;
        }
    }

    // Dia da despesa: campo "date" (novas) ou o dia local em que foi criada (antigas) ou o 1º do mês.
    function expenseDate(e, monthKey) {
        if (e && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) return e.date;
        if (e && e.createdAt) {
            var d = new Date(e.createdAt);
            if (!isNaN(d.getTime())) {
                var local = iso(d);
                if (local.slice(0, 7) === monthKey) return local;
            }
        }
        return monthKey + '-01';
    }

    // Despesas (expenses = { "AAAA-MM": { id: {...} } }) dentro de [from, to], já com a data e a chave.
    function expensesInRange(expenses, from, to) {
        var out = [];
        Object.keys(expenses || {}).forEach(function (month) {
            if (month + '-31' < from || month + '-01' > to) return;
            var items = expenses[month] || {};
            Object.keys(items).forEach(function (id) {
                var e = items[id];
                if (!e || typeof e.amount !== 'number') return;
                var date = expenseDate(e, month);
                if (date >= from && date <= to) out.push({ id: id, month: month, date: date, label: e.label || '', amount: e.amount });
            });
        });
        return out.sort(function (a, b) { return b.date.localeCompare(a.date); });
    }

    // Totais por dia do período (todos os dias, inclusive os sem faturamento).
    function dailySeries(entries, from, to) {
        var map = {};
        entries.forEach(function (e) { if (e.date >= from && e.date <= to) map[e.date] = (map[e.date] || 0) + e.amount; });
        var days = [], values = [];
        for (var d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) { days.push(d); values.push(Math.round((map[d] || 0) * 100) / 100); }
        return { days: days, values: values };
    }

    // Serviço mais vendido (por quantidade) e clientes distintos atendidos no período.
    function periodHighlights(entries, from, to) {
        var count = {}, clients = {};
        entries.forEach(function (e) {
            if (e.date < from || e.date > to || e.kind === 'subscription') return;
            count[e.service] = (count[e.service] || 0) + 1;
            var key = String(e.phone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '') || (e.name ? 'nome:' + e.name : '');
            if (key) clients[key] = true;
        });
        var top = Object.keys(count).sort(function (a, b) { return count[b] - count[a] || a.localeCompare(b); })[0] || '';
        return { topService: top, topCount: top ? count[top] : 0, uniqueClients: Object.keys(clients).length };
    }

    // ---- CSV (abre no Excel brasileiro: separador ";" e BOM para os acentos) ----
    function csvCell(value) {
        var s = value == null ? '' : String(value);
        // Evita que o Excel trate um nome digitado como fórmula (=, +, -, @, tab, CR).
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
    }
    function toCsv(header, rows) {
        return '﻿' + [header].concat(rows).map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
    }
    function csvNumber(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ','); }

    root.CheresReports = {
        attendedEntries: attendedEntries,
        subscriptionEntries: subscriptionEntries,
        SUBSCRIPTION_LABEL: SUBSCRIPTION_LABEL,
        summarize: summarize,
        sumExpenses: sumExpenses,
        weekRange: weekRange,
        monthRange: monthRange,
        addDays: addDays,
        presetRange: presetRange,
        expenseDate: expenseDate,
        expensesInRange: expensesInRange,
        dailySeries: dailySeries,
        periodHighlights: periodHighlights,
        csvCell: csvCell,
        toCsv: toCsv,
        csvNumber: csvNumber
    };
})(typeof window !== 'undefined' ? window : globalThis);
