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

    root.CheresAttendance = {
        METHODS: METHODS,
        outcome: outcome,
        listPrice: listPrice,
        paidValue: paidValue,
        methodLabel: methodLabel,
        parseAmount: parseAmount
    };
})(typeof window !== 'undefined' ? window : globalThis);
