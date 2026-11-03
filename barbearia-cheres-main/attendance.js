// Regra única da situação de um atendimento (compareceu, faltou, pendente) e do valor pago.
// Usada pelo painel (admin.html) e pelo perfil do cliente (index.html).
//
// Campos gravados pelo barbeiro no próprio agendamento (e levados junto para o histórico):
//   attendance: 'attended' | 'noshow'
//   payment: { method: 'pix' | 'cash' | 'card', amount: 30 }
//   price: preço do serviço na época
// Registros antigos do histórico com status 'completed' (antes da Fase 2) contam como atendidos.
(function (root) {
    'use strict';

    var METHODS = { pix: 'Pix', cash: 'Dinheiro', card: 'Cartão' };

    // isPast(date, time) é passado por cada página (usa a hora local do aparelho).
    // inHistory = o registro está em appointmentHistory (dia já encerrado).
    function outcome(rec, isPast, inHistory) {
        if (!rec) return 'upcoming';
        if (rec.attendance === 'attended') return 'attended';
        if (rec.attendance === 'noshow') return 'noshow';
        if (inHistory) return rec.status === 'pending' ? 'pending' : 'attended';   // 'completed' antigo = atendido
        return isPast(rec.date, rec.time || '00:00') ? 'pending' : 'upcoming';
    }

    // Valor de tabela do serviço na época (o gravado no registro vale mais que a tabela atual).
    function listPrice(rec, prices) {
        if (rec && typeof rec.price === 'number') return rec.price;
        return (prices && prices[rec && rec.service]) || 0;
    }

    // Quanto entrou de fato: só atendimentos; usa o valor pago (com desconto) quando houver.
    function paidValue(rec, prices, out) {
        if (out !== 'attended') return 0;
        if (rec.payment && typeof rec.payment.amount === 'number') return rec.payment.amount;
        return listPrice(rec, prices);
    }

    function methodLabel(rec) {
        return (rec && rec.payment && METHODS[rec.payment.method]) || '';
    }

    // Lê um valor digitado ("30", "30,50", "R$ 30") e devolve número com 2 casas, ou null se inválido.
    function parseAmount(text) {
        var s = String(text == null ? '' : text).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
        if (s === '' || s === '-') return null;
        var n = Number(s);
        if (!isFinite(n) || n < 0 || n > 100000) return null;
        return Math.round(n * 100) / 100;
    }

    // ---- Fidelidade ----
    // Conta cortes atendidos (serviços com "Corte" no nome) a partir da data de início do programa.
    var LOYALTY_DEFAULT = { every: 7, since: '2026-11-03' };

    function isCut(service) { return /corte/i.test(String(service || '')); }

    function loyaltySettings(saved) {
        var every = saved && Number(saved.every);
        var since = saved && typeof saved.since === 'string' ? saved.since : LOYALTY_DEFAULT.since;
        return { every: every >= 1 && every <= 50 ? Math.floor(every) : LOYALTY_DEFAULT.every, since: since };
    }

    // records: lista de { date, service, outcome }; redeemedCount: brindes já usados.
    function loyaltyStatus(records, redeemedCount, settings) {
        var cfg = loyaltySettings(settings);
        var cuts = (records || []).filter(function (r) {
            return r.outcome === 'attended' && isCut(r.service) && String(r.date || '') >= cfg.since;
        }).length;
        var earned = Math.floor(cuts / cfg.every);
        var used = Math.max(0, Number(redeemedCount) || 0);
        return {
            every: cfg.every, since: cfg.since, cuts: cuts, earned: earned, used: used,
            available: Math.max(0, earned - used),
            progress: cuts % cfg.every,                 // cortes rumo ao próximo brinde
            remaining: cfg.every - (cuts % cfg.every)
        };
    }

    root.CheresAttendance = {
        LOYALTY_DEFAULT: LOYALTY_DEFAULT,
        isCut: isCut,
        loyaltySettings: loyaltySettings,
        loyaltyStatus: loyaltyStatus,
        METHODS: METHODS,
        outcome: outcome,
        listPrice: listPrice,
        paidValue: paidValue,
        methodLabel: methodLabel,
        parseAmount: parseAmount
    };
})(typeof window !== 'undefined' ? window : globalThis);
