/* ============================================================
   STORAGE.JS — Memory Card Engine
   Dados vivem no Excel (.xlsx). localStorage só como cache
   da sessão atual (apagado ao importar novo arquivo).
   ============================================================ */

const DB_KEY = 'planner_session_cache';

const defaultData = {
    accounts: [],
    cards: [],
    transactions: [],
    cardBillings: []   // histórico de faturas fechadas por cartão
};

/* ---------- Core ---------- */
function getData() {
    const raw = sessionStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : structuredClone(defaultData);
}

function saveData(data) {
    sessionStorage.setItem(DB_KEY, JSON.stringify(data));
}

function generateId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

/* ---------- Accounts ---------- */
function saveAccount(id, name, balance) {
    const data = getData();
    const parsed = parseFloat(balance);
    if (id) {
        const item = data.accounts.find(a => a.id === id);
        if (item) { item.name = name; item.balance = parsed; }
    } else {
        data.accounts.push({ id: generateId(), name, balance: parsed });
    }
    saveData(data);
}

function deleteAccount(id) {
    const data = getData();
    data.accounts = data.accounts.filter(a => a.id !== id);
    saveData(data);
}

/* ---------- Cards ---------- */
function saveCard(id, name, limit, closingDay, dueDay) {
    const data = getData();
    if (id) {
        const item = data.cards.find(c => c.id === id);
        if (item) {
            item.name = name;
            item.limit = parseFloat(limit);
            item.closingDay = parseInt(closingDay);
            item.dueDay = parseInt(dueDay);
        }
    } else {
        data.cards.push({
            id: generateId(),
            name,
            limit: parseFloat(limit),
            closingDay: parseInt(closingDay),
            dueDay: parseInt(dueDay)
        });
    }
    saveData(data);
}

function deleteCard(id) {
    const data = getData();
    data.cards = data.cards.filter(c => c.id !== id);
    data.cardBillings = (data.cardBillings || []).filter(b => b.cardId !== id);
    saveData(data);
}

/* ---------- Credit Card Billing Helpers ---------- */
/**
 * Retorna o período de fatura para uma data de transação dado o dia de fechamento.
 * Ex: closingDay=10, data=2025-03-15 → período Mar/2025 (15 > 10 → fatura de Março)
 *     closingDay=10, data=2025-03-08 → período Fev/2025 (8 <= 10 → fatura de Fevereiro)
 * Retorna string "YYYY-MM" do mês de referência da fatura.
 */
function getBillingPeriod(dateStr, closingDay) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (d > closingDay) {
        // Fatura do mês atual
        return `${y}-${String(m).padStart(2, '0')}`;
    } else {
        // Fatura do mês anterior
        const dt = new Date(y, m - 2, 1);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }
}

/**
 * Calcula a fatura de um cartão para um período (YYYY-MM).
 * Retorna { period, total, transactions[], isPaid, dueDate }
 */
function getCardBilling(data, cardId, period) {
    const card = data.cards.find(c => c.id === cardId);
    if (!card) return null;

    const txs = data.transactions.filter(t => {
        if (t.accountId !== cardId || t.type !== 'expense') return false;
        return getBillingPeriod(t.date, card.closingDay) === period;
    });

    const total = txs.reduce((s, t) => s + t.amount, 0);
    const [y, m] = period.split('-').map(Number);
    const nextMonth = new Date(y, m, card.dueDay); // dueDay do próximo mês
    const dueDate = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-${String(card.dueDay).padStart(2, '0')}`;

    const billing = (data.cardBillings || []).find(b => b.cardId === cardId && b.period === period);
    return { period, total, transactions: txs, isPaid: billing?.isPaid || false, dueDate, paidAt: billing?.paidAt || null };
}

/**
 * Marca uma fatura como paga (registra transferência automática da conta de pagamento)
 */
function payCardBilling(cardId, period, fromAccountId, amount) {
    const data = getData();
    if (!data.cardBillings) data.cardBillings = [];

    const existing = data.cardBillings.find(b => b.cardId === cardId && b.period === period);
    const today = new Date().toISOString().split('T')[0];

    if (existing) {
        existing.isPaid = true;
        existing.paidAt = today;
        existing.paidAmount = amount;
        existing.fromAccountId = fromAccountId;
    } else {
        data.cardBillings.push({ cardId, period, isPaid: true, paidAt: today, paidAmount: amount, fromAccountId });
    }

    // Desconta da conta bancária
    const acc = data.accounts.find(a => a.id === fromAccountId);
    if (acc) acc.balance -= parseFloat(amount);

    // Registra como transação de pagamento de fatura
    const card = data.cards.find(c => c.id === cardId);
    const [y, mon] = period.split('-').map(Number);
    data.transactions.push({
        id: generateId(),
        type: 'transfer',
        description: `Pagamento fatura ${card?.name || ''} ${MONTH_LABELS[mon-1]}/${y}`,
        category: 'Pagamento de Fatura',
        amount: parseFloat(amount),
        date: today,
        accountId: fromAccountId,
        destinationId: cardId,
        currentInstallment: 1,
        totalInstallments: 1,
        groupId: null
    });

    saveData(data);
}

/**
 * Retorna todas as faturas de um cartão agrupadas por período, incluindo período atual
 */
function getAllCardBillings(data, cardId) {
    const card = data.cards.find(c => c.id === cardId);
    if (!card) return [];

    const periodsSet = new Set();
    // Coleta todos os períodos com transações neste cartão
    data.transactions.forEach(t => {
        if (t.accountId === cardId && t.type === 'expense') {
            periodsSet.add(getBillingPeriod(t.date, card.closingDay));
        }
    });
    // Inclui período atual
    const today = new Date().toISOString().split('T')[0];
    periodsSet.add(getBillingPeriod(today, card.closingDay));

    return Array.from(periodsSet)
        .sort()
        .reverse()
        .map(p => getCardBilling(data, cardId, p));
}

/* ---------- Balance helpers ---------- */
/**
 * Applies or reverts balance changes for a transaction.
 * @param {object} data - App data
 * @param {string} type - 'income' | 'expense' | 'transfer'
 * @param {number} amount
 * @param {string} accountId
 * @param {string|null} destinationId
 * @param {1|-1} sign - 1 to apply, -1 to revert
 */
function _adjustBalances(data, type, amount, accountId, destinationId, sign) {
    const isCardAccount = data.cards.some(c => c.id === accountId);
    const isCardDest = data.cards.some(c => c.id === destinationId);

    if (!isCardAccount) {
        const acc = data.accounts.find(a => a.id === accountId);
        if (acc) {
            if (type === 'income')   acc.balance += sign * amount;
            if (type === 'expense')  acc.balance -= sign * amount;
            if (type === 'transfer') acc.balance -= sign * amount;
        }
    }
    if (type === 'transfer' && destinationId && !isCardDest) {
        const dest = data.accounts.find(a => a.id === destinationId);
        if (dest) dest.balance += sign * amount;
    }
    // Transfer to card (invoice payment): adjust source bank account
    if (type === 'transfer' && isCardDest) {
        const src = data.accounts.find(a => a.id === accountId);
        if (src) src.balance -= sign * amount;
    }
}

function revertTransactionBalances(data, tx) {
    if (!tx) return;
    _adjustBalances(data, tx.type, tx.amount, tx.accountId, tx.destinationId, -1);
}

function applyTransactionBalances(data, type, amount, accountId, destinationId) {
    _adjustBalances(data, type, amount, accountId, destinationId, 1);
}

/* ---------- Transactions ---------- */
function saveTransaction(id, type, description, amount, date, accountId, category, currentInstallment, totalInstallments, groupId, destinationId, recurring) {
    const data = getData();
    const parsed = parseFloat(amount);

    if (id) {
        const old = data.transactions.find(t => t.id === id);
        if (old) {
            revertTransactionBalances(data, old);
            Object.assign(old, { type, description, amount: parsed, date, accountId, category: category || 'Sem Categoria', destinationId: destinationId || null, recurring: !!recurring });
        }
    } else {
        data.transactions.push({
            id: generateId(), type, description, amount: parsed, date, accountId,
            category: category || 'Sem Categoria',
            currentInstallment: currentInstallment || 1,
            totalInstallments: totalInstallments || 1,
            groupId: groupId || null,
            destinationId: destinationId || null,
            recurring: !!recurring
        });
    }

    applyTransactionBalances(data, type, parsed, accountId, destinationId);
    saveData(data);
}

function deleteTransaction(id) {
    const data = getData();
    const tx = data.transactions.find(t => t.id === id);
    if (tx) revertTransactionBalances(data, tx);
    data.transactions = data.transactions.filter(t => t.id !== id);
    saveData(data);
}

function deleteInstallmentGroup(groupId) {
    const data = getData();
    data.transactions.filter(t => t.groupId === groupId).forEach(tx => revertTransactionBalances(data, tx));
    data.transactions = data.transactions.filter(t => t.groupId !== groupId);
    saveData(data);
}

/* ---------- Formatters ---------- */
const MONTH_LABELS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
}

function formatPeriod(periodStr) {
    const [y, m] = periodStr.split('-').map(Number);
    return `${MONTH_LABELS[m-1]}/${y}`;
}
