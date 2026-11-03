// Regra única dos horários de atendimento da Barbearia Cheres.
// Usada pelo site (index.html) e pelo painel (admin.html). Não depende do Firebase:
// recebe os dados já lidos de settings/schedule e scheduleExceptions e devolve os horários do dia.
//
// Formato no banco (horários como chave "HHMM"):
//   settings/schedule/days/{0-6} = { open: true, times: { "0900": true, ... } }   (0 = domingo)
//   scheduleExceptions/{AAAA-MM-DD} = { closed: true }  ou  { times: { "0900": true, ... } }
// Ordem de prioridade: data especial > dia da semana salvo > padrão (ter a sáb, 09:00 a 18:00).
(function (root) {
    'use strict';

    var SLOT_MINUTES = 30;
    var TIME_RE = /^([01][0-9]|2[0-3]):(00|30)$/;
    var KEY_RE = /^([01][0-9]|2[0-3])(00|30)$/;
    var DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    var DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    function toMinutes(t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
    function fromMinutes(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
    function isValidTime(t) { return typeof t === 'string' && TIME_RE.test(t); }
    function toKey(t) { return t.replace(':', ''); }
    function fromKey(k) { return k.slice(0, 2) + ':' + k.slice(2); }

    // Todos os horários de "first" até "last" (inclusive), de 30 em 30 minutos.
    function range(first, last) {
        var out = [];
        if (!isValidTime(first) || !isValidTime(last)) return out;
        for (var m = toMinutes(first); m <= toMinutes(last); m += SLOT_MINUTES) out.push(fromMinutes(m));
        return out;
    }

    function sortTimes(list) {
        var seen = {};
        return list.filter(function (t) { if (!isValidTime(t) || seen[t]) return false; seen[t] = true; return true; })
            .sort(function (a, b) { return toMinutes(a) - toMinutes(b); });
    }

    // { "0900": true } -> ["09:00"]
    function parseTimes(obj) {
        if (!obj || typeof obj !== 'object') return [];
        return sortTimes(Object.keys(obj).filter(function (k) { return KEY_RE.test(k) && obj[k] === true; }).map(fromKey));
    }

    // ["09:00"] -> { "0900": true }
    function timesToStore(list) {
        var obj = {};
        sortTimes(list).forEach(function (t) { obj[toKey(t)] = true; });
        return obj;
    }

    var DEFAULT_TIMES = range('09:00', '18:00');
    function defaultDay(dow) {
        return (dow === 0 || dow === 1) ? { open: false, times: [] } : { open: true, times: DEFAULT_TIMES.slice() };
    }

    function dayOfWeek(date) { return new Date(date + 'T00:00:00').getDay(); }

    // Configuração de um dia da semana (0-6): o que estiver salvo ou o padrão.
    function weekday(settings, dow) {
        var days = settings && settings.days;
        var saved = days ? days[dow] : null;   // o Firebase pode devolver "days" como array
        if (!saved || typeof saved !== 'object') {
            var d = defaultDay(dow);
            d.source = 'default';
            return d;
        }
        var times = parseTimes(saved.times);
        return { open: saved.open === true && times.length > 0, times: saved.open === true ? times : [], source: 'weekday' };
    }

    // Horários de uma data, já combinando padrão, dia da semana e data especial.
    // Não olha ocupados/bloqueados/passados: isso fica com cada página.
    function forDate(date, settings, exceptions) {
        var ex = exceptions && exceptions[date];
        if (ex && typeof ex === 'object') {
            if (ex.closed === true) return { open: false, times: [], source: 'exception' };
            var times = parseTimes(ex.times);
            return { open: times.length > 0, times: times, source: 'exception' };
        }
        return weekday(settings, dayOfWeek(date));
    }

    // Datas de "from" até "to" (inclusive), em AAAA-MM-DD.
    function datesBetween(from, to) {
        var out = [];
        if (!from || !to || from > to) return out;
        var d = new Date(from + 'T00:00:00');
        for (var i = 0; i < 400; i++) {
            var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            if (iso > to) break;
            out.push(iso);
            d.setDate(d.getDate() + 1);
        }
        return out;
    }

    // "Ter a Sáb", "Ter, Qui e Sáb", "Todos os dias"
    function describeOpenDays(settings) {
        var open = [];
        for (var i = 0; i < 7; i++) if (weekday(settings, i).open) open.push(i);
        if (!open.length) return 'Sem dias fixos';
        if (open.length === 7) return 'Todos os dias';
        // Agrupa dias seguidos (a semana começa na segunda para o texto ficar natural).
        var order = [1, 2, 3, 4, 5, 6, 0].filter(function (d) { return open.indexOf(d) !== -1; });
        var pos = function (d) { return d === 0 ? 7 : d; };
        var groups = [];
        order.forEach(function (d) {
            var g = groups[groups.length - 1];
            if (g && pos(d) === pos(g[g.length - 1]) + 1) g.push(d); else groups.push([d]);
        });
        var parts = groups.map(function (g) {
            if (g.length >= 3) return DAY_SHORT[g[0]] + ' a ' + DAY_SHORT[g[g.length - 1]];
            return g.map(function (d) { return DAY_SHORT[d]; }).join(', ');
        });
        if (parts.length === 1) return parts[0];
        return parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
    }

    // "9h às 18h" (primeiro e último horário dos dias abertos da semana)
    function describeHours(settings) {
        var all = [];
        for (var i = 0; i < 7; i++) all = all.concat(weekday(settings, i).times);
        all = sortTimes(all);
        if (!all.length) return '';
        var fmt = function (t) { var p = t.split(':'); return Number(p[0]) + 'h' + (p[1] === '00' ? '' : p[1]); };
        return fmt(all[0]) + ' às ' + fmt(all[all.length - 1]);
    }

    root.CheresSchedule = {
        SLOT_MINUTES: SLOT_MINUTES,
        DAY_NAMES: DAY_NAMES,
        DAY_SHORT: DAY_SHORT,
        DEFAULT_TIMES: DEFAULT_TIMES,
        isValidTime: isValidTime,
        toKey: toKey,
        fromKey: fromKey,
        range: range,
        sortTimes: sortTimes,
        parseTimes: parseTimes,
        timesToStore: timesToStore,
        defaultDay: defaultDay,
        dayOfWeek: dayOfWeek,
        weekday: weekday,
        forDate: forDate,
        datesBetween: datesBetween,
        describeOpenDays: describeOpenDays,
        describeHours: describeHours
    };
})(typeof window !== 'undefined' ? window : globalThis);
