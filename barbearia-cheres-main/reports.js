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

    // Resumo de um período [from, to] (datas AAAA-MM-DD, inclusive).
    function summarize(entries, from, to) {
        var list = entries.filter(function (e) { return e.date >= from && e.date <= to; });
        var total = 0, byMethod = { pix: 0, cash: 0, card: 0, unknown: 0 }, byService = {};
        list.forEach(function (e) {
            total += e.amount;
            byMethod[Object.prototype.hasOwnProperty.call(byMethod, e.method) ? e.method : 'unknown'] += e.amount;
            byService[e.service] = (byService[e.service] || 0) + e.amount;
        });
        var round = function (n) { return Math.round(n * 100) / 100; };
        Object.keys(byMethod).forEach(function (k) { byMethod[k] = round(byMethod[k]); });
        return { count: list.length, total: round(total), average: list.length ? round(total / list.length) : 0, byMethod: byMethod, byService: byService };
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
        summarize: summarize,
        sumExpenses: sumExpenses,
        weekRange: weekRange,
        monthRange: monthRange,
        csvCell: csvCell,
        toCsv: toCsv,
        csvNumber: csvNumber
    };
})(typeof window !== 'undefined' ? window : globalThis);
