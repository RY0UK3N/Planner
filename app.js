document.addEventListener('DOMContentLoaded', () => { initApp(); });

let _currentMonth = null;
let _summaryChart = null;
let _fluxoChart = null;
let _fluxoMode = 'sankey';
let _movViewMode = 'list'; // 'list', 'sankey', 'sunburst'
let _backupDone = false;

/* ============================================================
   INIT
   ============================================================ */
function initApp() {
    setupNavigation();
    setupModalEvents();
    setupForms();
    setupQuickAdd();
    setupCurrencyInput();
    loadFromLocalStorage();
    checkImportPrompt();
    setupBeforeUnload();
    renderAll();
    _navigateTo('dashboard');
}

/* ============================================================
   PERSISTÊNCIA — localStorage (autosave) + prompts
   ============================================================ */
const LS_KEY = 'planner_autosave';

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw && !sessionStorage.getItem('planner_session_cache')) {
            sessionStorage.setItem('planner_session_cache', raw);
        }
    } catch(e) { console.warn('Erro ao carregar autosave:', e); }
}

// Espelha no localStorage sempre que saveData é chamado
(function patchSaveData() {
    const orig = window.saveData;
    if (!orig) { setTimeout(patchSaveData, 50); return; }
    window.saveData = function(data) {
        orig(data);
        try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch(e) {}
    };
})();

function checkImportPrompt() {
    // Sempre exibe o welcome modal no início da sessão (cada recarregamento)
    // conforme solicitado pelo usuário.
    setTimeout(() => {
        const modalEl = document.getElementById('welcomeModal');
        if (modalEl) {
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        }
    }, 1000);
}

function setupBeforeUnload() {
    window.addEventListener('beforeunload', e => {
        const data = getData();
        // Se não houver dados, não precisa de aviso
        if (!data.transactions.length && !data.accounts.length && !data.cards.length) return;
        
        // Se já fez backup nesta sessão, pode sair tranquilo
        if (_backupDone) return;

        // Salva no localStorage como garantia extra
        try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch(ex) {}
        
        e.preventDefault();
        e.returnValue = 'Você ainda não salvou seu Memory Card (.xlsx). Deseja sair mesmo assim?';
    });
}

function handleExitClick() {
    // Função removida a pedido do usuário
}

/* ============================================================
   CAMPO DE VALOR FORMATADO (R$ 0,00)
   ============================================================ */
const AMOUNT_FIELDS = ['tx-amount', 'acc-balance', 'card-limit'];

function setupCurrencyInput() {
    AMOUNT_FIELDS.forEach(id => {
        const input = document.getElementById(id);
        if (input) input.addEventListener('input', handleCurrencyInput);
    });
}

function handleCurrencyInput(e) {
    const input = e.target;
    const digits = input.value.replace(/\D/g, '');
    if (!digits) { input.value = ''; input.dataset.rawValue = ''; updateInstallmentHelper(); return; }
    const reais = parseInt(digits, 10) / 100;
    input.value = reais.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    input.dataset.rawValue = String(reais);
    if (input.id === 'tx-amount') updateInstallmentHelper();
}

function getCurrencyValue(id) {
    const input = document.getElementById(id);
    if (!input) return 0;
    if (input.dataset.rawValue) return parseFloat(input.dataset.rawValue) || 0;
    const digits = input.value.replace(/\D/g, '');
    return digits ? parseInt(digits, 10) / 100 : 0;
}

function setCurrencyValue(id, val) {
    const input = document.getElementById(id);
    if (!input) return;
    const num = parseFloat(val) || 0;
    input.value = num > 0 ? num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    input.dataset.rawValue = String(num);
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function setupNavigation() {
    document.querySelectorAll('[data-target]').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            const target = item.getAttribute('data-target');
            _navigateTo(target);
        });
    });
}

function _navigateTo(target) {
    // Se sair da view de movimentação, descarta instância ECharts para evitar container órfão
    const leaving = document.querySelector('.content-view:not(.hidden)')?.id?.replace('-view', '');
    if (leaving === 'movimentacao' && target !== 'movimentacao' && _fluxoChart) {
        _fluxoChart.dispose();
        _fluxoChart = null;
    }

    // Desktop nav
    document.querySelectorAll('.planner-pill-nav [data-target]').forEach(n => n.classList.remove('active'));
    const desktopLink = document.querySelector(`.planner-pill-nav [data-target="${target}"]`);
    if (desktopLink) desktopLink.classList.add('active');

    // Mobile tab bar
    document.querySelectorAll('.mobile-tab-btn[data-target]').forEach(n => n.classList.remove('active'));
    const mobileBtn = document.querySelector(`.mobile-tab-btn[data-target="${target}"]`);
    if (mobileBtn) mobileBtn.classList.add('active');

    document.querySelectorAll('.content-view').forEach(v => {
        v.id === `${target}-view` ? v.classList.remove('hidden') : v.classList.add('hidden');
    });
    renderAll();
    // Projeção verifica se a view está visível — renderiza após mostrar
    if (target === 'projecao') renderProjection(getData());
}

// Called by mobile tab bar buttons (avoids duplicate event listeners)
function mobileNav(btn, target) {
    _navigateTo(target);
}

/* ============================================================
   VALORES DE DETALHE (Extratos / Faturas)
   ============================================================ */
window._detailContext = {
    id: null,
    type: 'account',
    period: null,
    onPeriodChange: function(newPeriod) {
        this.period = newPeriod;
        if (this.type === 'account') viewAccountStatement(this.id, this.period, true);
        else viewCardInvoice(this.id, this.period, true);
    }
};

function viewAccountStatement(accId, period = null, skipShow = false) {
    const data = getData();
    const acc = data.accounts.find(a => a.id === accId);
    if (!acc) return;

    // Get available months specifically for this account
    const monthsSet = new Set();
    data.transactions.forEach(t => {
        if (t.accountId === accId || t.destinationId === accId) monthsSet.add(t.date.slice(0, 7));
    });
    const sortedMonths = Array.from(monthsSet).sort().reverse();
    
    if (!period && sortedMonths.length > 0) period = sortedMonths[0];
    if (!period) period = new Date().toISOString().slice(0, 7);

    window._detailContext = { 
        id: accId, 
        type: 'account', 
        period: period,
        onPeriodChange: (p) => viewAccountStatement(accId, p, true)
    };

    document.getElementById('detail-title').textContent = acc.name;
    document.getElementById('detail-subtitle').textContent = 'Conta Bancária';
    document.getElementById('detail-icon').innerHTML = '<i class="ph ph-bank"></i>';
    document.getElementById('detail-icon').className = 'entity-icon';
    document.getElementById('summary-label').textContent = 'Saldo Disponível';
    document.getElementById('summary-amount').textContent = formatCurrency(acc.balance);
    document.getElementById('summary-amount').style.color = 'var(--color-primary)';
    document.getElementById('card-period-wrapper').classList.remove('d-none');
    document.getElementById('detail-footer-pay').classList.add('d-none');

    // Populate periods selector
    const select = document.getElementById('detail-period-select');
    if (sortedMonths.length > 0) {
        select.innerHTML = sortedMonths.map(m => `<option value="${m}" ${m === period ? 'selected' : ''}>${formatPeriod(m)}</option>`).join('');
    } else {
        select.innerHTML = `<option value="${period}">${formatPeriod(period)}</option>`;
    }

    const txList = document.getElementById('detail-tx-list');
    txList.innerHTML = '';
    
    // Filtra transações onde a conta é origem OU destino E o período bate
    const txs = data.transactions.filter(t => {
        const isFromAcc = t.accountId === accId || t.destinationId === accId;
        const matchesPeriod = t.date.startsWith(period);
        return isFromAcc && matchesPeriod;
    }).sort((a,b) => new Date(b.date) - new Date(a.date));

    document.getElementById('detail-tx-count').textContent = `${txs.length} transações`;

    if (!txs.length) {
        txList.innerHTML = `<li class="py-4 text-center text-muted small">Nenhuma transação nesta conta em ${formatPeriod(period)}.</li>`;
    } else {
        txs.forEach(tx => _renderTxItem(txList, tx, data));
    }

    if (!skipShow) bootstrap.Modal.getOrCreateInstance(document.getElementById('entityDetailModal')).show();
}

function viewCardInvoice(cardId, period = null, skipShow = false) {
    const data = getData();
    const card = data.cards.find(c => c.id === cardId);
    if (!card) return;

    const today = new Date().toISOString().split('T')[0];
    if (!period) period = getBillingPeriod(today, card.closingDay);

    window._detailContext = { 
        id: cardId, 
        type: 'card', 
        period: period,
        onPeriodChange: (p) => viewCardInvoice(cardId, p)
    };

    document.getElementById('detail-title').textContent = card.name;
    document.getElementById('detail-subtitle').textContent = 'Cartão de Crédito';
    document.getElementById('detail-icon').innerHTML = '<i class="ph ph-credit-card"></i>';
    document.getElementById('detail-icon').className = 'entity-icon card-type';
    document.getElementById('summary-label').textContent = `Fatura ${formatPeriod(period)}`;
    document.getElementById('card-period-wrapper').classList.remove('d-none');

    // Popular Períodos
    const allBillings = getAllCardBillings(data, cardId);
    const select = document.getElementById('detail-period-select');
    select.innerHTML = allBillings.map(b => `<option value="${b.period}" ${b.period === period ? 'selected' : ''}>${formatPeriod(b.period)}</option>`).join('');

    const billing = getCardBilling(data, cardId, period);
    document.getElementById('summary-amount').textContent = formatCurrency(billing.total);
    document.getElementById('summary-amount').style.color = 'var(--color-expense)';

    // Footer de Pagamento
    const footer = document.getElementById('detail-footer-pay');
    if (!billing.isPaid && billing.total > 0) {
        footer.classList.remove('d-none');
        document.getElementById('detail-pay-status').textContent = 'Pendente';
        document.getElementById('detail-pay-status').className = 'badge bg-danger p-1 px-2';
        
        const accSelect = document.getElementById('detail-pay-acc-select');
        accSelect.innerHTML = '<option value="">Debitar de...</option>' + 
            data.accounts.map(a => `<option value="${a.id}">${a.name} (${formatCurrency(a.balance)})</option>`).join('');
            
        document.getElementById('detail-pay-btn').onclick = () => {
            const fromId = accSelect.value;
            if (!fromId) { showToast('Selecione uma conta.', 'error'); return; }
            if (confirm(`Pagar fatura de ${formatCurrency(billing.total)} com ${data.accounts.find(a=>a.id===fromId).name}?`)) {
                payCardBilling(cardId, period, fromId, billing.total);
                showToast('Fatura paga com sucesso!');
                viewCardInvoice(cardId, period); // Reload modal content
                renderAll(); // Reload main UI
            }
        };
    } else if (billing.isPaid) {
        footer.classList.remove('d-none');
        document.getElementById('detail-pay-status').textContent = 'Paga';
        document.getElementById('detail-pay-status').className = 'badge bg-success p-1 px-2';
        document.getElementById('detail-pay-acc-select').innerHTML = `<option disabled selected>Paga em ${formatDate(billing.paidAt)}</option>`;
        document.getElementById('detail-pay-btn').onclick = null;
        document.getElementById('detail-pay-btn').style.opacity = '0.5';
    } else {
        footer.classList.add('d-none');
    }

    const txList = document.getElementById('detail-tx-list');
    txList.innerHTML = '';
    document.getElementById('detail-tx-count').textContent = `${billing.transactions.length} transações`;

    if (!billing.transactions.length) {
        txList.innerHTML = '<li class="py-4 text-center text-muted small">Nenhum gasto neste período.</li>';
    } else {
        billing.transactions.forEach(tx => _renderTxItem(txList, tx, data));
    }

    if (!skipShow) bootstrap.Modal.getOrCreateInstance(document.getElementById('entityDetailModal')).show();
}

function filterDashboardToTransactions(type) {
    _navigateTo('movimentacao');
    document.getElementById('tx-filter').value = type;
    renderMovimentacao(getData());
}

/* ============================================================
   QUICK ADD (atalhos rápidos no dashboard)
   ============================================================ */
function setupQuickAdd() {
    document.getElementById('qa-income')?.addEventListener('click', () => openTxModal('income'));
    document.getElementById('qa-expense')?.addEventListener('click', () => openTxModal('expense'));
    document.getElementById('qa-transfer')?.addEventListener('click', () => openTxModal('transfer'));
}

function openTxModal(preType) {
    document.getElementById('tx-id').value = '';
    _populateAccountDropdowns();

    if (preType) {
        document.querySelectorAll('input[name="type"]').forEach(r => r.checked = r.value === preType);
        document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('tx-fields-wrapper').classList.remove('hidden');
        toggleInstallmentField();
    } else {
        document.querySelectorAll('input[name="type"]').forEach(r => r.checked = false);
        document.getElementById('tx-fields-wrapper').classList.add('hidden');
        document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
    }

    document.getElementById('tx-installment-helper').textContent = '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('transactionModal')).show();
    // Foca no campo descrição
    setTimeout(() => document.getElementById('tx-desc')?.focus(), 350);
}

/* ============================================================
   MODAL SYSTEM
   ============================================================ */
function openModal(modalId) {
    if (modalId === 'transactionModal') {
        openTxModal(null);
        return;
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById(modalId)).show();
}

function closeModal(modalId) {
    const modal = bootstrap.Modal.getInstance(document.getElementById(modalId));
    if (modal) modal.hide();
}

function setupModalEvents() {
    document.getElementById('transactionModal').addEventListener('hidden.bs.modal', () => {
        document.getElementById('transactionForm').reset();
        document.getElementById('tx-id').value = '';
        document.getElementById('tx-modal-title').textContent = 'Nova Transação';
        document.getElementById('tx-fields-wrapper').classList.add('hidden');
        document.getElementById('tx-installment-helper').textContent = '';
        document.getElementById('tx-options-group').classList.add('hidden');
        document.getElementById('tx-installments-group').classList.add('hidden');
        clearFormError();
    });
    document.getElementById('accountModal').addEventListener('hidden.bs.modal', () => {
        document.getElementById('accountForm').reset();
        document.getElementById('acc-id').value = '';
        document.getElementById('acc-modal-title').textContent = 'Nova Conta';
    });
    document.getElementById('cardModal').addEventListener('hidden.bs.modal', () => {
        document.getElementById('cardForm').reset();
        document.getElementById('card-id').value = '';
        document.getElementById('card-modal-title').textContent = 'Novo Cartão de Crédito';
    });

    document.getElementById('entityDetailModal').addEventListener('hidden.bs.modal', () => {
        window._detailContext = { id: null, type: 'account' };
    });
}

function _populateAccountDropdowns() {
    const data = getData();
    let html = '<option value="" disabled selected>Selecione...</option>';
    if (data.accounts.length > 0) {
        html += '<optgroup label="Contas Bancárias">';
        data.accounts.forEach(a => { html += `<option value="${a.id}">${a.name}</option>`; });
        html += '</optgroup>';
    }
    if (data.cards.length > 0) {
        html += '<optgroup label="Cartões de Crédito">';
        data.cards.forEach(c => { html += `<option value="${c.id}">${c.name}</option>`; });
        html += '</optgroup>';
    }
    if (!html.includes('<option value=')) {
        html = '<option value="" disabled selected>Crie uma conta primeiro</option>';
    }
    document.getElementById('tx-account').innerHTML = html;
    document.getElementById('tx-destination').innerHTML = html;
}

/* ============================================================
   CATEGORIAS — Sistema customizável
   ============================================================ */
const DEFAULT_CATEGS_INCOME = ['Salário', 'Rendimentos / Freelance', 'Saldos Iniciais', 'Outros'];
const DEFAULT_CATEGS_EXPENSE = {
    'Contas Fixas': ['Assinaturas', 'Contabilidade', 'Energia / Água', 'Internet / Celular', 'Taxas Bancárias'],
    'Gastos Variáveis': ['Farmácia / Saúde', 'Manutenções', 'Restaurantes / Delivery', 'Supermercado', 'Transporte / Combustível', 'Outros']
};
const CAT_STORAGE_KEY = 'planner_categories';

function _loadCategories() {
    try {
        const raw = localStorage.getItem(CAT_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch(_) {}
    return {
        income: [...DEFAULT_CATEGS_INCOME],
        expense: structuredClone(DEFAULT_CATEGS_EXPENSE)
    };
}

function _saveCategories(cats) {
    try { localStorage.setItem(CAT_STORAGE_KEY, JSON.stringify(cats)); } catch(_) {}
}

function getCategoriesForType(type) {
    const cats = _loadCategories();
    return type === 'income' ? cats.income : cats.expense;
}

function _buildCategoryOptions(type, currentVal = '') {
    const cats = getCategoriesForType(type);
    let html = '<option value="" disabled selected>Selecione a categoria...</option>';
    if (type === 'income') {
        cats.forEach(c => html += `<option value="${c}" ${c === currentVal ? 'selected' : ''}>${c}</option>`);
    } else {
        Object.entries(cats).forEach(([g, list]) => {
            html += `<optgroup label="${g}">`;
            list.forEach(c => html += `<option value="${c}" ${c === currentVal ? 'selected' : ''}>${c}</option>`);
            html += '</optgroup>';
        });
    }
    return html;
}

/* ── Category Manager ── */
let _catTabActive = 'expense';

function openCategoryManager() {
    _catTabActive = document.querySelector('input[name="type"]:checked')?.value === 'income' ? 'income' : 'expense';
    renderCategoryManager();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('categoryModal')).show();
}

function switchCatTab(type) {
    _catTabActive = type;
    document.getElementById('cat-tab-expense').classList.toggle('btn-primary', type === 'expense');
    document.getElementById('cat-tab-expense').classList.toggle('btn-outline-primary', type !== 'expense');
    document.getElementById('cat-tab-income').classList.toggle('btn-primary', type === 'income');
    document.getElementById('cat-tab-income').classList.toggle('btn-outline-primary', type !== 'income');
    renderCategoryManager();
}

function renderCategoryManager() {
    const cats = _loadCategories();
    const groupSelect = document.getElementById('new-cat-group');
    const list = document.getElementById('cat-manager-list');

    if (_catTabActive === 'income') {
        groupSelect.innerHTML = '<option value="__income__">Entradas</option>';
        groupSelect.style.display = 'none';
        list.innerHTML = cats.income.map((c, i) => `
            <div class="cat-manager-row">
                <span class="cat-manager-name">${c}</span>
                <button type="button" class="btn-icon danger" onclick="deleteCategory('income', null, ${i})" title="Remover">
                    <i class="ph ph-trash"></i>
                </button>
            </div>`).join('');
    } else {
        const groups = Object.keys(cats.expense);
        groupSelect.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');
        groupSelect.style.display = '';
        list.innerHTML = groups.map(g => `
            <div class="cat-group-section">
                <div class="cat-group-label">${g}</div>
                ${cats.expense[g].map((c, i) => `
                    <div class="cat-manager-row">
                        <span class="cat-manager-name">${c}</span>
                        <button type="button" class="btn-icon danger" onclick="deleteCategory('expense', '${g}', ${i})" title="Remover">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>`).join('')}
            </div>`).join('');
    }
}

function addCustomCategory() {
    const name = document.getElementById('new-cat-name').value.trim();
    if (!name) { showToast('Informe o nome da categoria.', 'error'); return; }
    const cats = _loadCategories();
    if (_catTabActive === 'income') {
        if (cats.income.includes(name)) { showToast('Categoria já existe.', 'error'); return; }
        cats.income.push(name);
    } else {
        const group = document.getElementById('new-cat-group').value;
        if (!cats.expense[group]) cats.expense[group] = [];
        if (cats.expense[group].includes(name)) { showToast('Categoria já existe.', 'error'); return; }
        cats.expense[group].push(name);
    }
    _saveCategories(cats);
    document.getElementById('new-cat-name').value = '';
    renderCategoryManager();
    showToast(`Categoria "${name}" adicionada!`);
}

function deleteCategory(type, group, idx) {
    const cats = _loadCategories();
    if (type === 'income') {
        cats.income.splice(idx, 1);
    } else {
        cats.expense[group].splice(idx, 1);
    }
    _saveCategories(cats);
    renderCategoryManager();
}

/* ============================================================
   TRANSACTION FORM LOGIC
   ============================================================ */
function toggleTxFields() {
    const checked = document.querySelector('input[name="type"]:checked');
    if (!checked) return;
    const type = checked.value;
    document.getElementById('tx-fields-wrapper').classList.remove('hidden');

    const catGroup     = document.getElementById('tx-category-group');
    const destGroup    = document.getElementById('tx-destination-group');
    const accLabel     = document.getElementById('tx-account-label');
    const catSelect    = document.getElementById('tx-category');
    const optionsGroup = document.getElementById('tx-options-group');
    const instChip     = document.getElementById('tx-installment-chip');
    const instGroup    = document.getElementById('tx-installments-group');
    const isInstChecked = document.getElementById('tx-is-installment')?.checked;

    if (type === 'transfer') {
        catGroup.classList.add('hidden');
        destGroup.classList.remove('hidden');
        optionsGroup.classList.add('hidden');
        instGroup.classList.add('hidden');
        accLabel.innerHTML = '<i class="ph ph-bank me-1 opacity-75"></i>Conta de Origem';
        catSelect.removeAttribute('required');
        document.getElementById('tx-destination').setAttribute('required', 'true');
    } else {
        catGroup.classList.remove('hidden');
        destGroup.classList.add('hidden');
        optionsGroup.classList.remove('hidden');
        accLabel.innerHTML = '<i class="ph ph-bank me-1 opacity-75"></i>Conta ou Cartão';
        catSelect.setAttribute('required', 'true');
        document.getElementById('tx-destination').removeAttribute('required');

        // Parcelar só aparece para expense
        instChip.classList.toggle('hidden', type !== 'expense');
        if (type !== 'expense') {
            document.getElementById('tx-is-installment').checked = false;
            instGroup.classList.add('hidden');
        } else {
            isInstChecked ? instGroup.classList.remove('hidden') : instGroup.classList.add('hidden');
        }

        // Rebuild category list
        catSelect.innerHTML = _buildCategoryOptions(type, catSelect.value);
    }
    updateInstallmentHelper();
}

// Alias mantido para compatibilidade com eventos inline antigos
function toggleInstallmentField() { toggleTxFields(); }

function updateInstallmentHelper() {
    const amount = getCurrencyValue('tx-amount');
    const installments = parseInt(document.getElementById('tx-installments').value) || 1;
    const isInstChecked = document.getElementById('tx-is-installment')?.checked;
    const helperEl = document.getElementById('tx-installment-helper');
    if (!helperEl) return;

    if (!amount || amount <= 0 || !isInstChecked || installments <= 1) {
        helperEl.classList.add('hidden'); helperEl.innerHTML = ''; return;
    }
    const partValue = amount / installments;
    helperEl.classList.remove('hidden');
    helperEl.innerHTML = `
        <div class="inst-preview">
            <i class="ph ph-info"></i>
            <div>
                <strong>${installments}x de ${formatCurrency(partValue)}</strong>
                <span class="text-muted small"> · Total: ${formatCurrency(amount)}</span>
            </div>
        </div>`;
}

/* ============================================================
   FEEDBACK
   ============================================================ */
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const id = 'toast-' + Date.now();
    const color = type === 'success' ? 'var(--color-primary)' : (type === 'info' ? '#7c83fd' : 'var(--color-expense)');
    const icon = type === 'success' ? 'ph-check-circle' : (type === 'info' ? 'ph-info' : 'ph-warning-circle');
    const el = document.createElement('div');
    el.id = id; el.className = 'planner-toast';
    el.style.borderLeftColor = color;
    el.innerHTML = `<i class="ph ${icon}" style="color:${color};font-size:1.1rem;flex-shrink:0;"></i><span>${message}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 3200);
}

function showFormError(msg) {
    const el = document.getElementById('tx-form-error');
    if (!el) return;
    el.textContent = msg; el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => el.classList.add('hidden'), 5000);
}

function clearFormError() {
    document.getElementById('tx-form-error')?.classList.add('hidden');
}

/* ============================================================
   FORMS
   ============================================================ */
function setupForms() {
    document.getElementById('accountForm').addEventListener('submit', e => {
        e.preventDefault();
        saveAccount(
            document.getElementById('acc-id').value,
            document.getElementById('acc-name').value,
            getCurrencyValue('acc-balance')
        );
        closeModal('accountModal'); renderAll();
        showToast('Conta salva!');
    });

    document.getElementById('cardForm').addEventListener('submit', e => {
        e.preventDefault();
        saveCard(
            document.getElementById('card-id').value,
            document.getElementById('card-name').value,
            getCurrencyValue('card-limit'),
            document.getElementById('card-closing').value,
            document.getElementById('card-due').value
        );
        closeModal('cardModal'); renderAll();
        showToast('Cartão salvo!');
    });

    document.getElementById('transactionForm').addEventListener('submit', e => {
        e.preventDefault();
        clearFormError();

        const typeInput = document.querySelector('input[name="type"]:checked');
        if (!typeInput) { showFormError('Selecione o tipo de transação.'); return; }

        const id = document.getElementById('tx-id').value;
        const type = typeInput.value;
        const desc = document.getElementById('tx-desc').value.trim();
        const category = type === 'transfer' ? 'Transferência' : document.getElementById('tx-category').value;
        const amount = getCurrencyValue('tx-amount');
        const isInstCheckedForm = document.getElementById('tx-is-installment')?.checked;
        const isRecurring = document.getElementById('tx-is-recurring')?.checked && type !== 'transfer';
        const installments = (isInstCheckedForm && type === 'expense') ? (parseInt(document.getElementById('tx-installments').value) || 1) : 1;
        const dateStr = document.getElementById('tx-date').value;
        const account = document.getElementById('tx-account').value;
        const destination = type === 'transfer' ? document.getElementById('tx-destination').value : null;

        if (!desc) { showFormError('Informe a descrição.'); return; }
        if (type !== 'transfer' && !category) { showFormError('Selecione uma categoria.'); return; }
        if (!amount || amount <= 0) { showFormError('Informe um valor válido.'); return; }
        if (!dateStr) { showFormError('Informe a data.'); return; }
        if (!account) { showFormError('Selecione uma conta ou cartão.'); return; }
        if (type === 'transfer' && !destination) { showFormError('Selecione a conta de destino.'); return; }
        if (type === 'transfer' && account === destination) { showFormError('Origem e destino iguais.'); return; }

        try {
            if (id) {
                saveTransaction(id, type, desc, amount, dateStr, account, category, 1, 1, null, destination, isRecurring);
                showToast('Transação atualizada ✓');
            } else if (installments > 1 && type === 'expense') {
                const groupId = generateId();
                const partValue = amount / installments;
                let [y, m, d] = dateStr.split('-').map(Number);
                let dt = new Date(y, m - 1, d);
                for (let i = 1; i <= installments; i++) {
                    const instDate = dt.toISOString().split('T')[0];
                    saveTransaction(null, type, desc, partValue, instDate, account, category, i, installments, groupId, null, false);
                    dt.setMonth(dt.getMonth() + 1);
                }
                showToast(`${installments}x de ${formatCurrency(amount / installments)} salvas! 📅`);
            } else {
                saveTransaction(null, type, desc, amount, dateStr, account, category, 1, 1, null, destination, isRecurring);
                const verb = type === 'income' ? '✅ Entrada' : (type === 'transfer' ? '🔀 Transferência' : '💸 Gasto');
                const recurTag = isRecurring ? ' 🔁' : '';
                showToast(`${verb} de ${formatCurrency(amount)} salvo!${recurTag}`);
            }
            closeModal('transactionModal'); renderAll();
        } catch (err) {
            console.error(err);
            showFormError('Erro inesperado. Verifique o console (F12).');
        }
    });
}

/* ============================================================
   CRUD WRAPPERS
   ============================================================ */
function edAcc(id) {
    const acc = getData().accounts.find(a => a.id === id);
    if (!acc) return;
    document.getElementById('acc-id').value = acc.id;
    document.getElementById('acc-name').value = acc.name;
    setCurrencyValue('acc-balance', acc.balance);
    document.getElementById('acc-modal-title').textContent = 'Editar Conta';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('accountModal')).show();
}
function delAcc(id) {
    if (confirm('Apagar esta conta?')) { deleteAccount(id); renderAll(); showToast('Conta removida', 'error'); }
}

function edCard(id) {
    const c = getData().cards.find(c => c.id === id);
    if (!c) return;
    document.getElementById('card-id').value = c.id;
    document.getElementById('card-name').value = c.name;
    setCurrencyValue('card-limit', c.limit);
    document.getElementById('card-closing').value = c.closingDay || 1;
    document.getElementById('card-due').value = c.dueDay;
    document.getElementById('card-modal-title').textContent = 'Editar Cartão';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('cardModal')).show();
}
function delCard(id) {
    if (confirm('Apagar este cartão?')) { deleteCard(id); renderAll(); showToast('Cartão removido', 'error'); }
}

function edTx(id) {
    const tx = getData().transactions.find(t => t.id === id);
    if (!tx) return;
    document.getElementById('tx-id').value = tx.id;
    document.getElementById('tx-desc').value = tx.description;
    setCurrencyValue('tx-amount', tx.amount);
    document.getElementById('tx-date').value = tx.date;
    document.querySelector(`input[name="type"][value="${tx.type}"]`).checked = true;

    _populateAccountDropdowns();
    document.getElementById('tx-fields-wrapper').classList.remove('hidden');
    toggleTxFields();

    document.getElementById('tx-account').value = tx.accountId;
    if (tx.type === 'transfer' && tx.destinationId) document.getElementById('tx-destination').value = tx.destinationId;
    if (tx.category && tx.category !== 'Transferência') document.getElementById('tx-category').value = tx.category;

    const recurCheck = document.getElementById('tx-is-recurring');
    if (recurCheck) recurCheck.checked = !!tx.recurring;

    document.getElementById('tx-modal-title').textContent = 'Editar Transação';
    document.getElementById('tx-installments-group').classList.add('hidden');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('transactionModal')).show();
}
function delTx(id) {
    if (confirm('Excluir esta transação?')) { deleteTransaction(id); renderAll(); showToast('Transação excluída', 'error'); }
}

/* ============================================================
   RENDER ALL
   ============================================================ */
function renderAll() {
    const data = getData();
    renderTransactions(data);
    renderDashboard(data);
    renderAccounts(data);
    renderCards(data);
    renderMovimentacao(data);
    renderProjection(data);

    // Refresh detail modal if open
    if (window._detailContext?.id) {
        const modalEl = document.getElementById('entityDetailModal');
        const isVisible = modalEl.classList.contains('show');
        if (isVisible) {
            if (window._detailContext.type === 'account') {
                viewAccountStatement(window._detailContext.id, true);
            } else {
                viewCardInvoice(window._detailContext.id, window._detailContext.period, true);
            }
        }
    }
}

/* ============================================================
   PROJEÇÃO — Previsão de Patrimônio (12 meses)
   ============================================================ */
let _projectionChart = null;

function renderProjection(data) {
    const view = document.getElementById('projecao-view');
    if (!view || view.classList.contains('hidden')) return;
    if (!data) data = getData();

    // ── 1. Saldo inicial ──
    const initialBalance = data.accounts.reduce((s, a) => s + a.balance, 0);

    const todayDate = new Date();
    const todayStr  = todayDate.toISOString().split('T')[0];

    // ── 2. Janela de 12 meses ──
    const months = [];
    for (let i = 0; i < 12; i++) {
        const d = new Date(todayDate.getFullYear(), todayDate.getMonth() + i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // ── 3. Transações RECORRENTES marcadas explicitamente ──
    // Soma apenas a parcela mensal de cada recorrente (uma ocorrência = um mês)
    // Deduplica por groupId para não contar cada parcela como recorrente separada
    const recurIncomeMap  = {};
    const recurExpenseMap = {};
    data.transactions
        .filter(t => t.recurring && !t.groupId)
        .forEach(t => {
            if (t.type === 'income')  recurIncomeMap[t.id]  = t.amount;
            if (t.type === 'expense') recurExpenseMap[t.id] = t.amount;
        });

    const recurIncome  = Object.values(recurIncomeMap).reduce((s, v) => s + v, 0);
    const recurExpense = Object.values(recurExpenseMap).reduce((s, v) => s + v, 0);

    // ── 4. Transações futuras/parceladas já registradas (não recorrentes) ──
    // Parcelas: cada installment já é uma transação individual com data futura
    // Recorrentes: já tratados acima como base mensal fixa — não entram aqui
    const futureMonthMap = {};
    months.forEach(m => { futureMonthMap[m] = { income: 0, expense: 0 }; });

    data.transactions
        .filter(t => t.type !== 'transfer' && !t.recurring && t.date > todayStr)
        .forEach(tx => {
            const txMonth = tx.date.slice(0, 7);
            if (!futureMonthMap[txMonth]) return;
            if (tx.type === 'income')  futureMonthMap[txMonth].income  += tx.amount;
            if (tx.type === 'expense') futureMonthMap[txMonth].expense += tx.amount;
        });

    // ── 5. Média dos últimos 3 meses como fallback (só se NÃO houver recorrentes) ──
    let avgIncome = recurIncome, avgExpense = recurExpense, countedMonths = 0;
    const hasRecurring = recurIncome > 0 || recurExpense > 0;

    if (!hasRecurring) {
        const last3 = [];
        for (let i = 1; i <= 3; i++) {
            const d = new Date(todayDate.getFullYear(), todayDate.getMonth() - i, 1);
            last3.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        let sumIncome = 0, sumExpense = 0;
        last3.forEach(m => {
            const txs = data.transactions.filter(t => t.date.startsWith(m) && t.type !== 'transfer');
            if (!txs.length) return;
            countedMonths++;
            txs.forEach(t => {
                if (t.type === 'income')  sumIncome  += t.amount;
                if (t.type === 'expense') sumExpense += t.amount;
            });
        });
        if (countedMonths > 0) { avgIncome = sumIncome / countedMonths; avgExpense = sumExpense / countedMonths; }
    }

    // ── 6. Calcular saldo projetado mês a mês ──
    const balances = [], incomes = [], expenses = [], labels = [];
    const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    let runningBalance = initialBalance;

    months.forEach((m, idx) => {
        const [y, mo] = m.split('-').map(Number);
        labels.push(`${monthNames[mo - 1]}/${String(y).slice(2)}`);

        const knownIncome  = futureMonthMap[m].income;
        const knownExpense = futureMonthMap[m].expense;

        // Mês atual: só transações futuras; demais meses: recorrentes + pontuais já lançadas
        const baseIncome  = idx === 0 ? 0 : avgIncome;
        const baseExpense = idx === 0 ? 0 : avgExpense;

        const projIncome  = baseIncome  + knownIncome;
        const projExpense = baseExpense + knownExpense;

        incomes.push(parseFloat(projIncome.toFixed(2)));
        expenses.push(parseFloat(projExpense.toFixed(2)));
        runningBalance += projIncome - projExpense;
        balances.push(parseFloat(runningBalance.toFixed(2)));
    });

    // ── 7. Gráfico ECharts ──
    const chartDom = document.getElementById('projectionChart');
    if (!chartDom || typeof echarts === 'undefined') return;

    if (_projectionChart) {
        try { _projectionChart.resize(); } catch (_) { _projectionChart.dispose(); _projectionChart = null; }
    }
    if (!_projectionChart) {
        _projectionChart = echarts.init(chartDom, null, { renderer: 'canvas' });
        window.addEventListener('resize', () => _projectionChart?.resize());
    }

    _projectionChart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            backgroundColor: '#1e1e2a',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            textStyle: { color: '#f1f5f9', fontSize: 12 },
            formatter: (params) => {
                let html = `<div style="font-weight:600;margin-bottom:6px;">${params[0].name}</div>`;
                params.forEach(p => {
                    const color = p.color?.colorStops ? p.color.colorStops[0].color : p.color;
                    html += `<div style="display:flex;justify-content:space-between;gap:16px;">
                        <span style="color:${color};">&#9679; ${p.seriesName}</span>
                        <span style="font-weight:600;">${formatCurrency(p.value)}</span>
                    </div>`;
                });
                return html;
            }
        },
        legend: {
            data: ['Saldo Acumulado','Receitas','Despesas'],
            textStyle: { color: '#94a3b8', fontSize: 11 }, top: 0
        },
        grid: { left: '3%', right: '4%', bottom: '8%', top: '14%', containLabel: true },
        xAxis: {
            type: 'category', data: labels,
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
            axisLabel: { color: '#94a3b8', fontSize: 11 }
        },
        yAxis: {
            type: 'value',
            axisLabel: {
                color: '#94a3b8', fontSize: 10,
                formatter: v => Math.abs(v) >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v.toFixed(0)}`
            },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } }
        },
        series: [
            {
                name: 'Saldo Acumulado', type: 'line', data: balances,
                smooth: true, symbol: 'circle', symbolSize: 6,
                lineStyle: { width: 3 },
                areaStyle: {
                    color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(99,102,241,0.35)' },
                            { offset: 1, color: 'rgba(99,102,241,0.02)' }
                        ]
                    }
                },
                itemStyle: { color: '#6366f1' },
                markLine: {
                    silent: true,
                    lineStyle: { color: 'rgba(255,255,255,0.15)', type: 'dashed' },
                    data: [{ yAxis: 0 }]
                }
            },
            {
                name: 'Receitas', type: 'bar', data: incomes, barMaxWidth: 18,
                itemStyle: {
                    color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [{ offset: 0, color: '#10b981' }, { offset: 1, color: '#059669' }]
                    },
                    borderRadius: [4,4,0,0]
                }
            },
            {
                name: 'Despesas', type: 'bar', data: expenses, barMaxWidth: 18,
                itemStyle: {
                    color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [{ offset: 0, color: '#ef4444' }, { offset: 1, color: '#b91c1c' }]
                    },
                    borderRadius: [4,4,0,0]
                }
            }
        ]
    }, true);

    // ── 8. Painel lateral de resumo ──
    const summaryEl = document.getElementById('projection-summary-list');
    if (!summaryEl) return;

    const finalBalance = balances[balances.length - 1];
    const totalIncome  = incomes.reduce((s, v) => s + v, 0);
    const totalExpense = expenses.reduce((s, v) => s + v, 0);
    const balanceDelta = finalBalance - initialBalance;
    const bestMonthIdx = balances.indexOf(Math.max(...balances));
    const bestMonth    = labels[bestMonthIdx];
    const negMonths    = balances.filter(b => b < 0).length;
    const avgMonthSave = balanceDelta / 12;
    const deltaColor   = balanceDelta >= 0 ? 'var(--color-primary)' : 'var(--color-expense)';
    const deltaIcon    = balanceDelta >= 0 ? 'ph-trend-up' : 'ph-trend-down';
    const deltaLabel   = balanceDelta >= 0 ? 'Crescimento projetado' : 'Queda projetada';

    const sourceNote = hasRecurring
        ? `Projeção baseada em <b>${data.transactions.filter(t => t.recurring).length} lançamentos recorrentes</b> marcados.`
        : countedMonths > 0
            ? `Sem recorrentes marcados — usando média dos últimos ${countedMonths} meses.`
            : 'Marque lançamentos como <b>Recorrente</b> para projeções precisas.';

    summaryEl.innerHTML = `
    <div class="proj-summary-item">
        <div class="proj-summary-label"><i class="ph ph-wallet me-1 opacity-75"></i>Saldo Atual</div>
        <div class="proj-summary-value" style="color:var(--color-primary);">${formatCurrency(initialBalance)}</div>
    </div>
    <div class="proj-summary-item">
        <div class="proj-summary-label"><i class="ph ${deltaIcon} me-1 opacity-75"></i>${deltaLabel}</div>
        <div class="proj-summary-value" style="color:${deltaColor};">${balanceDelta >= 0 ? '+' : ''}${formatCurrency(balanceDelta)}</div>
    </div>
    <div class="proj-summary-item">
        <div class="proj-summary-label"><i class="ph ph-calendar-check me-1 opacity-75"></i>Saldo em ${labels[11]}</div>
        <div class="proj-summary-value" style="color:${finalBalance >= 0 ? 'var(--color-primary)' : 'var(--color-expense)'};">${formatCurrency(finalBalance)}</div>
    </div>
    <div class="proj-summary-divider"></div>
    <div class="proj-summary-item">
        <div class="proj-summary-label"><i class="ph ph-arrow-circle-up me-1 opacity-75"></i>Total receitas (12m)</div>
        <div class="proj-summary-value" style="color:#10b981;">${formatCurrency(totalIncome)}</div>
    </div>
    <div class="proj-summary-item">
        <div class="proj-summary-label"><i class="ph ph-arrow-circle-down me-1 opacity-75"></i>Total despesas (12m)</div>
        <div class="proj-summary-value" style="color:var(--color-expense);">${formatCurrency(totalExpense)}</div>
    </div>
    <div class="proj-summary-item">
        <div class="proj-summary-label"><i class="ph ph-piggy-bank me-1 opacity-75"></i>Economia/mês (média)</div>
        <div class="proj-summary-value" style="color:${avgMonthSave >= 0 ? 'var(--color-primary)' : 'var(--color-expense)'};">${avgMonthSave >= 0 ? '+' : ''}${formatCurrency(avgMonthSave)}</div>
    </div>
    <div class="proj-summary-divider"></div>
    <div class="proj-summary-item">
        <div class="proj-summary-label"><i class="ph ph-star me-1 opacity-75"></i>Melhor mês previsto</div>
        <div class="proj-summary-value">${bestMonth}</div>
    </div>
    <div class="proj-summary-item">
        <div class="proj-summary-label"><i class="ph ph-warning me-1 opacity-75"></i>Meses no negativo</div>
        <div class="proj-summary-value" style="color:${negMonths > 0 ? 'var(--color-expense)' : '#10b981'};">${negMonths === 0 ? 'Nenhum &#10003;' : negMonths + ' m' + (negMonths > 1 ? 'eses' : 'es')}</div>
    </div>
    <div class="proj-summary-divider"></div>
    <div class="tiny text-muted mt-2" style="line-height:1.6;">
        <i class="ph ph-info me-1"></i>${sourceNote}
    </div>`;

}

/* ============================================================
   DASHBOARD / NAVIGATION HELPERS
   ============================================================ */
function filterDashboardToTransactions(filter) {
    const filterEl = document.getElementById('tx-filter');
    if (filterEl) filterEl.value = filter;
    
    // Switch to list view and navigate
    _movViewMode = 'list';
    const navItem = document.querySelector('[data-target="movimentacao"]');
    if (navItem) navItem.click();
}

function renderDashboard(data) {
    const monthStr = new Date().toISOString().slice(0, 7);
    let totalIncome = 0, totalExpense = 0;

    data.transactions.forEach(tx => {
        if (!tx.date.startsWith(monthStr)) return;
        if (tx.type === 'income') totalIncome += tx.amount;
        if (tx.type === 'expense') totalExpense += tx.amount;
    });

    const totalBalance = data.accounts.reduce((s, a) => s + a.balance, 0);
    const balCard = document.querySelector('.balance-card');
    const balEl = document.getElementById('total-balance');
    
    balEl.textContent = formatCurrency(totalBalance);
    
    if (totalBalance < 0) {
        balCard.classList.add('negative-balance');
        balEl.style.color = '#ffffff'; 
    } else {
        balCard.classList.remove('negative-balance');
        balEl.style.color = ''; 
    }

    document.getElementById('total-income').textContent = formatCurrency(totalIncome);
    document.getElementById('total-expense').textContent = formatCurrency(totalExpense);

    // Quick accounts/cards list
    const qaList = document.getElementById('quick-accounts-list');
    qaList.innerHTML = '';
    data.accounts.forEach(acc => {
        qaList.innerHTML += `
        <li class="qa-item">
            <div class="d-flex align-items-center gap-2">
                <div class="qa-icon"><i class="ph ph-bank"></i></div>
                <span class="small fw-medium">${acc.name}</span>
            </div>
            <span class="small fw-semibold" style="color:var(--color-primary);">${formatCurrency(acc.balance)}</span>
        </li>`;
    });

    data.cards.forEach(card => {
        const today = new Date().toISOString().split('T')[0];
        const currentPeriod = getBillingPeriod(today, card.closingDay || 1);
        const billing = getCardBilling(data, card.id, currentPeriod);
        const avail = card.limit - (billing?.total || 0);
        const pct = Math.min(((billing?.total || 0) / card.limit) * 100, 100).toFixed(0);

        qaList.innerHTML += `
        <li class="qa-item">
            <div class="d-flex align-items-center gap-2">
                <div class="qa-icon card-type"><i class="ph ph-credit-card"></i></div>
                <div>
                    <span class="small fw-medium d-block">${card.name}</span>
                    <span class="tiny text-muted">Fatura ${formatPeriod(currentPeriod)}</span>
                </div>
            </div>
            <div class="text-end">
                <div class="small fw-semibold" style="color:var(--color-expense);">${formatCurrency(billing?.total || 0)}</div>
                <div class="tiny text-muted">Disp. ${formatCurrency(avail)}</div>
            </div>
        </li>`;
    });

    if (!data.accounts.length && !data.cards.length) {
        qaList.innerHTML = '<li class="py-2 small text-muted">Nenhuma conta cadastrada.</li>';
    }

    renderChart(data);

    // Recent transactions
    const today = new Date().toISOString().split('T')[0];
    const recentList = document.getElementById('recent-transactions');
    recentList.innerHTML = '';
    const pastTxs = [...data.transactions].filter(t => t.date <= today).sort((a, b) => new Date(b.date) - new Date(a.date));
    const seenG = new Set();
    const recent = [];
    for (const tx of pastTxs) {
        if (recent.length >= 5) break;
        if (tx.groupId && seenG.has(tx.groupId)) continue;
        if (tx.groupId) seenG.add(tx.groupId);
        recent.push(tx);
    }
    if (!recent.length) {
        recentList.innerHTML = '<li class="tx-item"><span class="text-muted small">Nenhuma transação ainda.</span></li>';
    }
    recent.forEach(tx => _renderTxItem(recentList, tx, data, true));

    // Upcoming
    const upcomingList = document.getElementById('upcoming-expenses');
    upcomingList.innerHTML = '';
    const futureExp = data.transactions.filter(t => t.type === 'expense' && t.date > today).sort((a, b) => new Date(a.date) - new Date(b.date));
    const seenU = new Set();
    const upcoming = [];
    for (const ex of futureExp) {
        if (upcoming.length >= 4) break;
        if (ex.groupId && seenU.has(ex.groupId)) continue;
        if (ex.groupId) seenU.add(ex.groupId);
        upcoming.push(ex);
    }
    if (!upcoming.length) {
        upcomingList.innerHTML = '<li class="tx-item"><span class="text-muted small">Nenhuma conta futura.</span></li>';
    }
    upcoming.forEach(ex => {
        const installBadge = ex.totalInstallments > 1 ? `<span class="tag installments">${ex.currentInstallment}/${ex.totalInstallments}</span>` : '';
        upcomingList.innerHTML += `
        <li class="tx-item upcoming-item">
            <div>
                <div class="small fw-semibold">${ex.description}</div>
                <div class="mt-1">${installBadge}<span class="text-muted tiny">Vence: ${formatDate(ex.date)}</span></div>
            </div>
            <span class="fw-bold small" style="color:var(--color-expense);">${formatCurrency(ex.amount)}</span>
        </li>`;
    });
}

function _renderTxItem(container, tx, data, compact) {
    const isIncome = tx.type === 'income';
    const isTransfer = tx.type === 'transfer';
    const icon = isIncome ? 'ph-arrow-up-right' : (isTransfer ? 'ph-arrows-left-right' : 'ph-arrow-down-left');
    const amtColor = isIncome ? 'var(--color-primary)' : (isTransfer ? '#f1f5f9' : 'var(--color-expense)');
    const amtSign = isIncome ? '+' : (isTransfer ? '' : '-');
    const installBadge = tx.totalInstallments > 1 ? `<span class="tag installments">${tx.totalInstallments} parcelas</span>` : '';
    const catBadge = tx.category ? `<span class="tag" data-cat="${tx.category}">${tx.category}</span>` : '';
    const recurBadge = tx.recurring ? `<span class="tag recurring">🔁 Recorrente</span>` : '';

    container.innerHTML += `
    <li class="tx-item">
        <div class="d-flex align-items-center gap-2">
            <div class="tx-icon ${tx.type}"><i class="ph ${icon}"></i></div>
            <div>
                <div class="small fw-semibold">${tx.description}</div>
                <div class="mt-1">${catBadge}${installBadge}${recurBadge}<span class="text-muted tiny">• ${formatDate(tx.date)}</span></div>
            </div>
        </div>
        <div class="d-flex align-items-center gap-2">
            <span class="fw-semibold small" style="color:${amtColor};">${amtSign} ${formatCurrency(tx.amount)}</span>
            <div class="d-flex gap-1">
                <button class="tx-delete" style="background:none;border:none;padding:5px;" onclick="edTx('${tx.id}')" title="Editar"><i class="ph ph-pencil-simple text-muted"></i></button>
                <button class="tx-delete" style="background:none;border:none;padding:5px;" onclick="delTx('${tx.id}')" title="Excluir"><i class="ph ph-trash text-muted"></i></button>
            </div>
        </div>
    </li>`;
}

/* ============================================================
   TRANSACTIONS TABLE + MOBILE CARDS
   ============================================================ */
function renderTransactions(data) {
    if (!data) data = getData();
    renderMonthTabs(data);

    const tbody   = document.getElementById('all-transactions-body');
    const mobileList = document.getElementById('all-transactions-mobile');
    tbody.innerHTML = '';
    mobileList.innerHTML = '';

    const filter = document.getElementById('tx-filter').value;
    let filtered = data.transactions;
    if (filter !== 'all') filtered = filtered.filter(t => t.type === filter);
    if (_currentMonth) filtered = filtered.filter(t => t.date.startsWith(_currentMonth));

    const sorted = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));

    const EMPTY_MSG = 'Nenhuma transação encontrada.';

    if (!sorted.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4 small">${EMPTY_MSG}</td></tr>`;
        mobileList.innerHTML = `<li class="tx-mobile-empty">${EMPTY_MSG}</li>`;
        return;
    }

    sorted.forEach(tx => {
        const isIncome   = tx.type === 'income';
        const isTransfer = tx.type === 'transfer';
        const icon     = isIncome ? 'ph-arrow-up-right' : (isTransfer ? 'ph-arrows-left-right' : 'ph-arrow-down-left');
        const amtColor = isIncome ? 'var(--color-primary)' : (isTransfer ? '#f1f5f9' : 'var(--color-expense)');
        const amtSign  = isIncome ? '+' : (isTransfer ? '' : '-');

        const accName   = data.accounts.find(a => a.id === tx.accountId)?.name || data.cards.find(c => c.id === tx.accountId)?.name || '—';
        const destName  = data.accounts.find(a => a.id === tx.destinationId)?.name || data.cards.find(c => c.id === tx.destinationId)?.name;
        const displayAcc = (isTransfer && destName) ? `${accName} → ${destName}` : accName;
        const catBadge   = tx.category ? `<span class="tag" data-cat="${tx.category}">${tx.category}</span>` : '';
        const installBadge = tx.totalInstallments > 1 ? `<span class="tag installments">${tx.currentInstallment}/${tx.totalInstallments}</span>` : '';

        // ── Desktop row ──────────────────────────────────────
        tbody.innerHTML += `
        <tr>
            <td>
                <div class="d-flex align-items-center gap-2">
                    <i class="ph ${icon}" style="font-size:1.1rem;color:${amtColor};"></i>
                    <div>
                        <div class="fw-semibold small">${tx.description}</div>
                        <div class="mt-1">${catBadge}${installBadge}</div>
                    </div>
                </div>
            </td>
            <td class="text-muted small">${displayAcc}</td>
            <td class="text-muted small">${formatDate(tx.date)}</td>
            <td class="fw-semibold small" style="color:${amtColor};">${amtSign} ${formatCurrency(tx.amount)}</td>
            <td class="text-end">
                <div class="d-flex justify-content-end gap-1">
                    <button class="btn-icon" onclick="edTx('${tx.id}')" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                    <button class="btn-icon danger" onclick="delTx('${tx.id}')" title="Excluir"><i class="ph ph-trash"></i></button>
                </div>
            </td>
        </tr>`;

        // ── Mobile card ──────────────────────────────────────
        mobileList.innerHTML += `
        <li class="tx-mobile-card">
            <div class="tx-mobile-left">
                <div class="tx-icon ${tx.type}"><i class="ph ${icon}"></i></div>
                <div class="tx-mobile-info">
                    <div class="tx-mobile-desc">${tx.description}</div>
                    <div class="tx-mobile-meta">
                        <span class="tx-mobile-acc"><i class="ph ph-bank"></i> ${displayAcc}</span>
                        <span class="tx-mobile-date">${formatDate(tx.date)}</span>
                    </div>
                    <div class="tx-mobile-tags">${catBadge}${installBadge}</div>
                </div>
            </div>
            <div class="tx-mobile-right">
                <span class="tx-mobile-amount" style="color:${amtColor};">${amtSign}${formatCurrency(tx.amount)}</span>
                <div class="tx-mobile-actions">
                    <button class="btn-icon" onclick="edTx('${tx.id}')"><i class="ph ph-pencil-simple"></i></button>
                    <button class="btn-icon danger" onclick="delTx('${tx.id}')"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        </li>`;
    });
}

/* ============================================================
   ACCOUNTS & CARDS
   ============================================================ */
function renderAccounts(data) {
    const grid = document.getElementById('accounts-grid');
    grid.innerHTML = '';
    if (!data.accounts.length) {
        grid.innerHTML = '<div class="col-12"><p class="text-muted small">Nenhuma conta cadastrada.</p></div>'; return;
    }
    data.accounts.forEach(acc => {
        grid.innerHTML += `
        <div class="col-12 col-sm-6 col-lg-4">
            <div class="card entity-card h-100">
                <div class="card-body">
                    <div class="d-flex justify-content-end gap-1 mb-3">
                        <button class="btn-icon" onclick="edAcc('${acc.id}')"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn-icon danger" onclick="delAcc('${acc.id}')"><i class="ph ph-trash"></i></button>
                    </div>
                    <div class="d-flex align-items-center gap-3 mb-3">
                        <div class="entity-icon"><i class="ph ph-bank"></i></div>
                        <div><h6 class="mb-0 fw-bold">${acc.name}</h6><div class="small text-muted">Conta Bancária</div></div>
                    </div>
                    <div class="small text-muted">Saldo Disponível</div>
                    <div class="d-flex justify-content-between align-items-end">
                        <div class="fs-4 fw-bold mt-1" style="color:var(--color-primary);">${formatCurrency(acc.balance)}</div>
                        <button class="btn btn-sm btn-outline-primary rounded-pill px-3 py-1 fw-semibold" style="font-size:0.75rem" onclick="viewAccountStatement('${acc.id}')">
                            Ver Extrato
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    });
}

function renderCards(data) {
    const grid = document.getElementById('cards-grid');
    grid.innerHTML = '';
    if (!data.cards.length) {
        grid.innerHTML = '<div class="col-12"><p class="text-muted small">Nenhum cartão cadastrado.</p></div>'; return;
    }

    const today = new Date().toISOString().split('T')[0];

    data.cards.forEach(card => {
        const allBillings = getAllCardBillings(data, card.id);
        const currentPeriod = getBillingPeriod(today, card.closingDay || 1);
        const currentBilling = allBillings.find(b => b.period === currentPeriod) || { total: 0, isPaid: false };
        const fatura = currentBilling.total;
        const avail = card.limit - fatura;
        const pct = Math.min((fatura / card.limit) * 100, 100).toFixed(0);
        const barColor = pct >= 90 ? 'var(--color-expense)' : pct >= 70 ? '#f59e0b' : 'var(--color-primary)';

        // Last 3 billing periods for mini history
        const billingHistory = allBillings.slice(0, 3);
        let historyHtml = '';
        billingHistory.forEach(b => {
            const statusIcon = b.isPaid
                ? `<i class="ph ph-check-circle" style="color:var(--color-primary);"></i>`
                : (b.total > 0 ? `<i class="ph ph-clock" style="color:#f59e0b;"></i>` : `<i class="ph ph-minus" style="color:var(--color-muted);"></i>`);
            historyHtml += `
            <div class="billing-row ${b.period === currentPeriod ? 'current' : ''}">
                <span class="tiny text-muted">${formatPeriod(b.period)}</span>
                <span class="tiny fw-semibold" style="color:${b.isPaid ? 'var(--color-primary)' : (b.total > 0 ? 'var(--color-expense)' : 'var(--color-muted)') };">${formatCurrency(b.total)}</span>
                ${statusIcon}
            </div>`;
        });

        // Account options for payment
        const accOpts = data.accounts.map(a => `<option value="${a.id}">${a.name} (${formatCurrency(a.balance)})</option>`).join('');

        grid.innerHTML += `
        <div class="col-12 col-sm-6 col-lg-4">
            <div class="card entity-card card-type h-100">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-3">
                        <div class="d-flex align-items-center gap-2">
                            <div class="entity-icon card-type"><i class="ph ph-credit-card"></i></div>
                            <div>
                                <h6 class="mb-0 fw-bold">${card.name}</h6>
                                <div class="tiny text-muted">Fecha dia ${card.closingDay || '—'} · Vence dia ${card.dueDay}</div>
                            </div>
                        </div>
                        <div class="d-flex gap-1">
                            <button class="btn-icon" onclick="edCard('${card.id}')"><i class="ph ph-pencil-simple"></i></button>
                            <button class="btn-icon danger" onclick="delCard('${card.id}')"><i class="ph ph-trash"></i></button>
                        </div>
                    </div>

                    <div class="d-flex justify-content-between mb-1">
                        <span class="small text-muted">Fatura ${formatPeriod(currentPeriod)}</span>
                        <span class="small fw-bold" style="color:var(--color-expense);">${formatCurrency(fatura)}</span>
                    </div>
                    <div class="progress mb-1" style="height:5px;border-radius:3px;background:rgba(255,255,255,0.08);">
                        <div style="width:${pct}%;background:${barColor};height:100%;border-radius:3px;transition:width 0.4s;"></div>
                    </div>
                    <div class="d-flex justify-content-between mb-3">
                        <span class="tiny text-muted">${pct}% do limite</span>
                        <span class="tiny text-muted">Disp. ${formatCurrency(avail)}</span>
                    </div>

                    <div class="billing-history mb-3">
                        <div class="tiny text-muted fw-semibold text-uppercase mb-1">Histórico de Faturas</div>
                        ${historyHtml || '<div class="tiny text-muted">Sem histórico ainda.</div>'}
                    </div>

                    ${!currentBilling.isPaid && fatura > 0 ? `
                    <div class="pay-fatura-section">
                        <div class="tiny text-muted fw-semibold text-uppercase mb-1">Pagar Fatura</div>
                        <div class="d-flex gap-2 align-items-center">
                            <select class="form-select form-select-sm pay-acc-select" id="pay-acc-${card.id}">
                                <option value="">Debitar de...</option>
                                ${accOpts}
                            </select>
                            <button class="btn btn-sm btn-pay" onclick="handlePayFatura('${card.id}', '${currentPeriod}', ${fatura})">
                                <i class="ph ph-check"></i> Pagar
                            </button>
                        </div>
                    </div>` : (currentBilling.isPaid && fatura > 0 ? `<div class="paid-badge"><i class="ph ph-check-circle"></i> Fatura paga em ${formatDate(currentBilling.paidAt)}</div>` : '')}

                    <div class="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
                        <span class="tiny text-muted fw-semibold text-uppercase">Visão Geral</span>
                        <button class="btn btn-sm btn-outline-primary rounded-pill px-3 py-1 fw-semibold" style="font-size:0.75rem" onclick="viewCardInvoice('${card.id}')">
                            Ver Fatura Detalhada
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    });
}

function handlePayFatura(cardId, period, amount) {
    const fromAccountId = document.getElementById(`pay-acc-${cardId}`)?.value;
    if (!fromAccountId) { showToast('Selecione a conta para debitar.', 'error'); return; }
    const acc = getData().accounts.find(a => a.id === fromAccountId);
    if (!acc) return;
    if (acc.balance < amount) {
        if (!confirm(`Saldo insuficiente (${formatCurrency(acc.balance)}). Confirmar mesmo assim?`)) return;
    }
    if (!confirm(`Pagar fatura de ${formatCurrency(amount)} com ${acc.name}?`)) return;
    payCardBilling(cardId, period, fromAccountId, amount);
    renderAll();
    showToast(`Fatura paga! ${formatCurrency(amount)} debitados de ${acc.name} ✓`);
}

/* ============================================================
   MONTH NAVIGATION
   ============================================================ */
function renderMonthTabs(data) {
    const monthsSet = new Set();
    data.transactions.forEach(t => monthsSet.add(t.date.slice(0, 7)));
    if (!monthsSet.size) monthsSet.add(new Date().toISOString().slice(0, 7));

    const sorted = Array.from(monthsSet).sort();
    window._availableMonths = sorted;

    if (!_currentMonth || !sorted.includes(_currentMonth)) {
        const todayM = new Date().toISOString().slice(0, 7);
        _currentMonth = sorted.includes(todayM) ? todayM : sorted[sorted.length - 1];
    }
    updateMonthNavigator(_currentMonth);
}

function setMovViewMode(mode) {
    _movViewMode = mode;
    // Update button classes
    const modes = ['list', 'sankey', 'sunburst'];
    modes.forEach(m => {
        const btn = document.getElementById(`btn-mov-${m}`);
        if (!btn) return;
        btn.classList.toggle('active', mode === m);
        btn.classList.toggle('btn-primary', mode === m);
        btn.classList.toggle('btn-outline-light', mode !== m);
    });
    
    // Internal flux logic sync
    if (mode === 'sankey' || mode === 'sunburst') {
        _fluxoMode = mode;
    }

    renderAll();
}

function renderMovimentacao(data) {
    const view = document.getElementById('movimentacao-view');
    if (!view || view.classList.contains('hidden')) return;

    const listCont = document.getElementById('mov-list-container');
    const chartCont = document.getElementById('mov-chart-container');
    const chartTitle = document.getElementById('mov-chart-title');

    if (_movViewMode === 'list') {
        listCont.classList.remove('hidden');
        chartCont.classList.add('hidden');
        renderTransactions(data);
    } else {
        listCont.classList.add('hidden');
        chartCont.classList.remove('hidden');
        chartTitle.textContent = _movViewMode === 'sankey' ? 'Fluxo de Caminhos (Sankey)' : 'Distribuição Solar (Hierarquia)';
        
        if (_movViewMode === 'sankey') renderSankey(data);
        else renderSunburst(data);
    }
    
    // Sync navigator text
    const mStr = _currentMonth || new Date().toISOString().slice(0, 7);
    updateMonthNavigator(mStr);
}

// Keep renderSankey and renderSunburst but they no longer handle visibility themselves
// (Previous code had renderFluxo as dispatcher)

/* ── ECharts: obtém/recria instância de forma segura ── */
function _getFluxoChart(chartDom) {
    // Se o container foi re-renderizado pelo DOM (troca de view), a instância
    // fica órfã. Descarta e recria.
    if (_fluxoChart) {
        try { _fluxoChart.resize(); } // lança se container não é mais filho do DOM
        catch (_) { _fluxoChart.dispose(); _fluxoChart = null; }
    }
    if (!_fluxoChart) {
        _fluxoChart = echarts.init(chartDom, null, { renderer: 'canvas' });
        // Garante apenas um listener de resize
        if (!window._echartsResizeAttached) {
            window.addEventListener('resize', () => _fluxoChart?.resize());
            window._echartsResizeAttached = true;
        }
    }
    return _fluxoChart;
}

/* ── Mensagem de vazio para ECharts (sem tocar no innerHTML do container) ── */
function _setFluxoEmpty(chart, msg) {
    chart.setOption({
        backgroundColor: 'transparent',
        graphic: [{
            type: 'text',
            left: 'center', top: 'middle',
            style: { text: msg, fill: '#64748b', fontSize: 14, fontFamily: 'Inter, sans-serif' }
        }],
        series: []
    }, true); // true = substitui opção anterior por completo
}

function renderSankey(data) {
    const chartDom = document.getElementById('sankeyChart');
    if (!chartDom || typeof echarts === 'undefined') return;

    const mStr = _currentMonth || new Date().toISOString().slice(0, 7);
    const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const [y, m] = mStr.split('-');
    document.querySelectorAll('.fluxo-month-text').forEach(el => {
        el.textContent = `${monthsFull[parseInt(m)-1]} ${y}`;
    });

    const chart = _getFluxoChart(chartDom);

    const txs = data.transactions.filter(t => t.date.startsWith(mStr));
    const incomeTxs  = txs.filter(t => t.type === 'income');
    const expenseTxs = txs.filter(t => t.type === 'expense');

    if (!incomeTxs.length && !expenseTxs.length) {
        _setFluxoEmpty(chart, 'Nenhum dado para este mês.');
        return;
    }

    const nodes = [{ name: 'Budget' }];
    const links = [];
    const nodeSet = new Set(['Budget']);

    const incomeByCat = {};
    incomeTxs.forEach(t => {
        const cat = t.category || 'Outros Rendimentos';
        incomeByCat[cat] = (incomeByCat[cat] || 0) + t.amount;
    });
    Object.entries(incomeByCat).forEach(([cat, val]) => {
        if (!nodeSet.has(cat)) { nodes.push({ name: cat }); nodeSet.add(cat); }
        links.push({ source: cat, target: 'Budget', value: val });
    });

    const expenseByCat = {};
    expenseTxs.forEach(t => {
        const cat = t.category || 'Outras Despesas';
        expenseByCat[cat] = (expenseByCat[cat] || 0) + t.amount;
    });
    Object.entries(expenseByCat).forEach(([cat, val]) => {
        if (!nodeSet.has(cat)) { nodes.push({ name: cat }); nodeSet.add(cat); }
        links.push({ source: 'Budget', target: cat, value: val });
    });

    chart.setOption({
        backgroundColor: 'transparent',
        graphic: [],   // limpa mensagem de vazio anterior
        tooltip: {
            trigger: 'item', triggerOn: 'mousemove',
            backgroundColor: '#1e1e2a',
            borderColor: 'rgba(255,255,255,0.1)',
            textStyle: { color: '#f1f5f9' },
            formatter: (params) => {
                const val = formatCurrency(params.value);
                if (params.dataType === 'node') return `<b>${params.name}</b>: ${val}`;
                return `${params.data.source} → ${params.data.target}<br/><b>${val}</b>`;
            }
        },
        series: [{
            type: 'sankey', layout: 'none',
            emphasis: { focus: 'adjacency' },
            data: nodes, links,
            lineStyle: { color: 'gradient', curveness: 0.5 },
            label: { color: '#f1f5f9', fontWeight: 'bold' },
            itemStyle: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }
        }]
    }, true); // true = replace option (evita acúmulo de séries)
}

function renderSunburst(data) {
    const chartDom = document.getElementById('sankeyChart');
    if (!chartDom || typeof echarts === 'undefined') return;

    const mStr = _currentMonth || new Date().toISOString().slice(0, 7);
    const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const [y, m] = mStr.split('-');
    document.querySelectorAll('.fluxo-month-text').forEach(el => el.textContent = `${monthsFull[parseInt(m)-1]} ${y}`);

    const chart = _getFluxoChart(chartDom);

    const txs = data.transactions.filter(t => t.date.startsWith(mStr));
    const expenseTxs = txs.filter(t => t.type === 'expense');
    const totalMthExp = expenseTxs.reduce((s, t) => s + t.amount, 0);

    if (!txs.filter(t => t.type === 'income').length && !expenseTxs.length) {
        _setFluxoEmpty(chart, 'Nenhum dado para este mês.');
        return;
    }

    const categoriesMap = {};
    expenseTxs.forEach(t => {
        const cat = t.category || 'Outros';
        if (!categoriesMap[cat]) categoriesMap[cat] = { total: 0, items: [] };
        categoriesMap[cat].total += t.amount;
        categoriesMap[cat].items.push({ name: t.description, value: t.amount });
    });

    const sunburstData = Object.entries(categoriesMap).map(([cat, info]) => ({
        name: cat, value: info.total,
        itemStyle: { color: COLOR_MAP[cat] || '#475569' },
        children: info.items.map(it => ({ name: it.name, value: it.value, itemStyle: { opacity: 0.7 } }))
    }));

    chart.setOption({
        backgroundColor: 'transparent',
        graphic: [],
        tooltip: {
            backgroundColor: '#1e1e2a',
            borderColor: 'rgba(255,255,255,0.1)',
            textStyle: { color: '#f1f5f9' },
            formatter: (params) => {
                const val = formatCurrency(params.value);
                const pct = totalMthExp > 0 ? ((params.value / totalMthExp) * 100).toFixed(1) : '0';
                return `<b>${params.name}</b><br/>${val} (${pct}%)`;
            }
        },
        series: [{
            type: 'sunburst', data: sunburstData,
            radius: [0, '95%'], sort: 'desc',
            emphasis: { focus: 'ancestor' }, nodeClick: 'link',
            levels: [
                {},
                { r0: '15%', r: '45%', label: { rotate: 'tangential', fontSize: 10, fontWeight: 'bold' }, itemStyle: { borderWidth: 2 } },
                { r0: '45%', r: '75%', label: { position: 'outside', padding: 3, silent: false, fontSize: 9 }, itemStyle: { borderWidth: 1, opacity: 0.8 } }
            ]
        }]
    }, true);
}

function updateMonthNavigator(mStr) {
    const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const [y, m] = mStr.split('-');
    const text = `${monthsFull[parseInt(m)-1]} ${y}`;
    document.querySelectorAll('.month-text').forEach(el => el.textContent = text);
}

function changeMonth(dir) {
    if (!window._availableMonths?.length) return;
    const idx = window._availableMonths.indexOf(_currentMonth);
    const newIdx = Math.max(0, Math.min(window._availableMonths.length - 1, idx + dir));
    if (idx !== newIdx) {
        _currentMonth = window._availableMonths[newIdx];
        const data = getData();
        renderMovimentacao(data);
        updateMonthNavigator(_currentMonth);
    }
}

/* ============================================================
   CHART
   ============================================================ */
const COLOR_MAP = {
    'Assinaturas': '#8b5cf6', 'Contabilidade': '#6366f1', 'Energia / Água': '#3b82f6',
    'Internet / Celular': '#0ea5e9', 'Taxas Bancárias': '#f59e0b',
    'Farmácia / Saúde': '#10b981', 'Manutenções': '#ef4444', 'Pagamento': '#ef4444',
    'Restaurantes / Delivery': '#f97316', 'Supermercado': '#f59e0b',
    'Transporte / Combustível': '#3b82f6', 'Outros': '#94a3b8'
};

function renderChart(data) {
    const wrapper = document.getElementById('summaryChart')?.parentElement;
    if (!wrapper || typeof Chart === 'undefined') return;

    const month = new Date().toISOString().slice(0, 7);
    const expenses = data.transactions.filter(t => t.type === 'expense' && t.date.startsWith(month));
    const catMap = {};
    let totalExpense = 0;
    expenses.forEach(t => {
        catMap[t.category || 'Outros'] = (catMap[t.category || 'Outros'] || 0) + t.amount;
        totalExpense += t.amount;
    });

    const sorted    = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const labels    = sorted.map(c => c[0]);
    const chartData = sorted.map(c => c[1]);

    // Garante que o canvas sempre existe no DOM — nunca substituir via innerHTML
    let canvas = document.getElementById('summaryChart');
    let emptyMsg = wrapper.querySelector('.chart-empty-msg');

    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'summaryChart';
        wrapper.appendChild(canvas);
    }
    if (!emptyMsg) {
        emptyMsg = document.createElement('div');
        emptyMsg.className = 'chart-empty-msg text-muted small position-absolute top-50 start-50 translate-middle text-center';
        emptyMsg.textContent = 'Nenhum gasto neste mês.';
        wrapper.appendChild(emptyMsg);
    }

    if (!chartData.length) {
        // Destrói instância antiga se existir, mas MANTÉM o canvas no DOM
        if (_summaryChart) { _summaryChart.destroy(); _summaryChart = null; }
        canvas.style.display = 'none';
        emptyMsg.style.display = '';
        return;
    }

    // Há dados — garante canvas visível, esconde mensagem
    canvas.style.display = '';
    emptyMsg.style.display = 'none';

    if (_summaryChart) {
        // Atualiza instância existente sem recriar
        _summaryChart.data.labels = labels;
        _summaryChart.data.datasets[0].data = chartData;
        _summaryChart.data.datasets[0].backgroundColor = labels.map(l => COLOR_MAP[l] || '#475569');
        _summaryChart._totalExpense = totalExpense; // passa pro plugin
        _summaryChart.update('active');
        return;
    }

    _summaryChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: chartData,
                backgroundColor: labels.map(l => COLOR_MAP[l] || '#475569'),
                borderWidth: 0, hoverOffset: 10, cutout: '75%'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'circle', padding: 15, font: { size: 11 } } },
                tooltip: {
                    backgroundColor: '#1e1e2a', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
                    titleColor: '#f1f5f9', bodyColor: '#94a3b8', padding: 10, cornerRadius: 10,
                    callbacks: { label: c => ` ${formatCurrency(c.raw)} (${((c.raw / totalExpense) * 100).toFixed(1)}%)` }
                }
            }
        },
        plugins: [{
            id: 'centerText',
            afterDraw: chart => {
                const { ctx: c, chartArea: { top, left, width, height } } = chart;
                const total = chart._totalExpense ?? chart.data.datasets[0].data.reduce((s, v) => s + v, 0);
                c.save();
                c.font = 'bold 14px sans-serif'; c.fillStyle = '#f1f5f9';
                c.textAlign = 'center'; c.textBaseline = 'middle';
                c.fillText(formatCurrency(total), left + width / 2, top + height / 2);
                c.restore();
            }
        }]
    });
    _summaryChart._totalExpense = totalExpense;
}

/* ============================================================
   EXCEL — Memory Card (Enhanced Export)
   ============================================================ */
function exportToExcel() {
    if (typeof XLSX === 'undefined') { alert('Aguarde a biblioteca carregar.'); return; }
    const data = getData();

    const wb = XLSX.utils.book_new();

    /* ── Shared style helpers ─────────────────────────────────── */
    const ST = {
        headerGreen:  { font: { bold: true, color: { rgb: '000000' }, sz: 11 }, fill: { fgColor: { rgb: '00C896' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: _border() },
        headerPurple: { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, fill: { fgColor: { rgb: '7C83FD' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: _border() },
        headerBlue:   { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, fill: { fgColor: { rgb: '3B82F6' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: _border() },
        headerGray:   { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, fill: { fgColor: { rgb: '334155' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: _border() },
        income:  { font: { color: { rgb: '00C896' }, bold: true }, fill: { fgColor: { rgb: '0D2B22' } }, alignment: { horizontal: 'right' }, border: _border('thin') },
        expense: { font: { color: { rgb: 'FF4D6D' }, bold: true }, fill: { fgColor: { rgb: '2B0D14' } }, alignment: { horizontal: 'right' }, border: _border('thin') },
        transfer:{ font: { color: { rgb: '7C83FD' }, bold: true }, fill: { fgColor: { rgb: '12122B' } }, alignment: { horizontal: 'right' }, border: _border('thin') },
        cell:    { font: { color: { rgb: 'E2E8F0' } }, fill: { fgColor: { rgb: '16161F' } }, border: _border('thin'), alignment: { vertical: 'center' } },
        cellAlt: { font: { color: { rgb: 'E2E8F0' } }, fill: { fgColor: { rgb: '1E1E2A' } }, border: _border('thin'), alignment: { vertical: 'center' } },
        titleBig:{ font: { bold: true, sz: 16, color: { rgb: '00C896' } }, fill: { fgColor: { rgb: '0D0D14' } }, alignment: { horizontal: 'center', vertical: 'center' } },
        subtitle:{ font: { bold: true, sz: 12, color: { rgb: '94A3B8' } }, fill: { fgColor: { rgb: '0D0D14' } }, alignment: { horizontal: 'center', vertical: 'center' } },
        kpiLabel:{ font: { sz: 10, color: { rgb: '94A3B8' } }, fill: { fgColor: { rgb: '16161F' } }, alignment: { horizontal: 'center', vertical: 'bottom' }, border: _border('thin') },
        kpiGreen:{ font: { bold: true, sz: 14, color: { rgb: '00C896' } }, fill: { fgColor: { rgb: '0D2B22' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: _border('thin') },
        kpiRed:  { font: { bold: true, sz: 14, color: { rgb: 'FF4D6D' } }, fill: { fgColor: { rgb: '2B0D14' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: _border('thin') },
        kpiBlue: { font: { bold: true, sz: 14, color: { rgb: '7C83FD' } }, fill: { fgColor: { rgb: '12122B' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: _border('thin') },
        numFmt:  'R$ #,##0.00',
        dateFmt: 'DD/MM/YYYY',
    };
    function _border(w = 'medium') { const s = { style: w, color: { rgb: '334155' } }; return { top: s, bottom: s, left: s, right: s }; }
    function _c(v, s, t = null) { const o = { v, s }; if (t) o.t = t; if ((t === 'n' || typeof v === 'number') && !t) o.t = 'n'; if (t === 'd') { o.t = 'n'; o.z = ST.dateFmt; } return o; }
    function _money(v, s) { return { v: v || 0, t: 'n', z: ST.numFmt, s }; }
    function _applySheet(ws, data2d) {
        data2d.forEach((row, r) => row.forEach((cell, c) => { if (cell !== null) ws[XLSX.utils.encode_cell({ r, c })] = cell; }));
        return ws;
    }

    /* ── 1. RESUMO sheet ──────────────────────────────────────── */
    const today = new Date().toISOString().split('T')[0];
    const curMonth = today.slice(0, 7);
    const allIncome = data.transactions.filter(t => t.type === 'income');
    const allExpense = data.transactions.filter(t => t.type === 'expense');
    const mthIncome = allIncome.filter(t => t.date.startsWith(curMonth)).reduce((s, t) => s + t.amount, 0);
    const mthExpense = allExpense.filter(t => t.date.startsWith(curMonth)).reduce((s, t) => s + t.amount, 0);
    const totalBalance = data.accounts.reduce((s, a) => s + a.balance, 0);
    const totalIncome = allIncome.reduce((s, t) => s + t.amount, 0);
    const totalExpense = allExpense.reduce((s, t) => s + t.amount, 0);

    // Category breakdown for current month
    const catMap = {};
    allExpense.filter(t => t.date.startsWith(curMonth)).forEach(t => {
        catMap[t.category || 'Outros'] = (catMap[t.category || 'Outros'] || 0) + t.amount;
    });
    const catRows = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

    const ws1 = { '!ref': 'A1:J50' };
    const rows1 = [];
    const exportDate = `Exportado em: ${formatDate(today)}`;

    rows1[0] = [_c('PLANNER FINANCEIRO PESSOAL', ST.titleBig), null, null, null, null, null, null, null, null, null];
    rows1[1] = [_c(exportDate, ST.subtitle), null, null, null, null, null, null, null, null, null];
    rows1[2] = Array(10).fill(_c('', { fill: { fgColor: { rgb: '0D0D14' } } }));

    rows1[3] = [
        _c('INDICADORES DO MÊS ATUAL', ST.headerGreen), null, null,
        _c('PATRIMÔNIO TOTAL', ST.headerGreen), null, null,
        _c('HISTÓRICO GERAL', ST.headerGreen), null, null, null
    ];
    rows1[4] = [
        _c('Entradas', ST.kpiLabel), _c('Saídas', ST.kpiLabel), _c('Saldo do Mês', ST.kpiLabel),
        _c('Contas Bancárias', ST.kpiLabel), _c('Cartões Pendentes', ST.kpiLabel), _c('Patrimônio Líquido', ST.kpiLabel),
        _c('Total Entradas', ST.kpiLabel), _c('Total Saídas', ST.kpiLabel), _c('Resultado', ST.kpiLabel), null
    ];
    const cardPendente = data.cards.reduce((s, card) => {
        const billing = getAllCardBillings(data, card.id).find(b => !b.isPaid && b.total > 0);
        return s + (billing?.total || 0);
    }, 0);
    const netWorth = totalBalance - cardPendente;
    rows1[5] = [
        _money(mthIncome, ST.kpiGreen), _money(mthExpense, ST.kpiRed), _money(mthIncome - mthExpense, mthIncome - mthExpense >= 0 ? ST.kpiGreen : ST.kpiRed),
        _money(totalBalance, ST.kpiGreen), _money(cardPendente, ST.kpiRed), _money(netWorth, netWorth >= 0 ? ST.kpiGreen : ST.kpiRed),
        _money(totalIncome, ST.kpiGreen), _money(totalExpense, ST.kpiRed), _money(totalIncome - totalExpense, (totalIncome-totalExpense) >= 0 ? ST.kpiGreen : ST.kpiRed), null
    ];

    rows1[6] = Array(10).fill(_c('', { fill: { fgColor: { rgb: '0D0D14' } } }));

    rows1[7] = [_c('GASTOS POR CATEGORIA — MÊS ATUAL', ST.headerPurple), null, null, null, null, null, null, null, null, null];
    rows1[8] = [_c('Categoria', ST.headerGray), _c('Valor (R$)', ST.headerGray), _c('% do Total', ST.headerGray), null, null, null, null, null, null, null];

    catRows.forEach(([cat, val], i) => {
        const pct = mthExpense > 0 ? (val / mthExpense * 100).toFixed(1) + '%' : '0%';
        rows1[9 + i] = [
            _c(cat, i % 2 === 0 ? ST.cell : ST.cellAlt),
            _money(val, { ...( i % 2 === 0 ? ST.cell : ST.cellAlt ), font: { color: { rgb: 'FF4D6D' }, bold: true }, alignment: { horizontal: 'right' } }),
            _c(pct, i % 2 === 0 ? ST.cell : ST.cellAlt),
            null, null, null, null, null, null, null
        ];
    });

    // Fill blank rows
    for (let r = 9 + catRows.length; r < 50; r++) {
        rows1[r] = Array(10).fill(null);
    }

    _applySheet(ws1, rows1);

    // Merge cells
    ws1['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 9 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } },
        { s: { r: 3, c: 3 }, e: { r: 3, c: 5 } },
        { s: { r: 3, c: 6 }, e: { r: 3, c: 9 } },
        { s: { r: 6, c: 0 }, e: { r: 6, c: 9 } },
        { s: { r: 7, c: 0 }, e: { r: 7, c: 9 } },
    ];
    ws1['!rows'] = [{ hpt: 36 }, { hpt: 20 }, { hpt: 10 }, { hpt: 28 }, { hpt: 22 }, { hpt: 40 }];
    ws1['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 8 }];

    XLSX.utils.book_append_sheet(wb, ws1, '📊 Resumo');

    /* ── 2. TRANSAÇÕES sheet ─────────────────────────────────── */
    const txHeaders = ['ID', 'Tipo', 'Descrição', 'Categoria', 'Valor', 'Data', 'Conta/Cartão', 'Destino', 'Parcela', 'Total Parcelas', 'GrupoID'];
    const txRows = data.transactions.map(t => {
        const accName = data.accounts.find(a => a.id === t.accountId)?.name || data.cards.find(c => c.id === t.accountId)?.name || t.accountId;
        const destName = data.accounts.find(a => a.id === t.destinationId)?.name || data.cards.find(c => c.id === t.destinationId)?.name || t.destinationId || '';
        return [t.id, t.type === 'income' ? 'Entrada' : (t.type === 'expense' ? 'Gasto' : 'Transferência'), t.description, t.category || '', t.amount, t.date, accName, destName, t.currentInstallment || 1, t.totalInstallments || 1, t.groupId || ''];
    });

    const ws2 = XLSX.utils.aoa_to_sheet([txHeaders, ...txRows]);

    // Style header row
    txHeaders.forEach((_, c) => {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        if (ws2[addr]) ws2[addr].s = ST.headerGreen;
    });

    // Style data rows
    txRows.forEach((row, r) => {
        const type = row[1];
        const amtStyle = type === 'Entrada' ? ST.income : (type === 'Gasto' ? ST.expense : ST.transfer);
        const base = r % 2 === 0 ? ST.cell : ST.cellAlt;
        row.forEach((_, c) => {
            const addr = XLSX.utils.encode_cell({ r: r + 1, c });
            if (!ws2[addr]) return;
            if (c === 4) { ws2[addr].s = amtStyle; ws2[addr].z = ST.numFmt; ws2[addr].t = 'n'; }
            else if (c === 5) { ws2[addr].s = { ...base, font: { color: { rgb: '94A3B8' } } }; }
            else ws2[addr].s = base;
        });
    });

    // Autofilter on header row
    ws2['!autofilter'] = { ref: `A1:K1` };
    ws2['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 35 }, { wch: 28 }, { wch: 16 }, { wch: 13 }, { wch: 22 }, { wch: 22 }, { wch: 9 }, { wch: 14 }, { wch: 14 }];
    ws2['!rows'] = [{ hpt: 24 }];

    XLSX.utils.book_append_sheet(wb, ws2, '💸 Transações');

    /* ── 3. CONTAS sheet ─────────────────────────────────────── */
    const accHeaders = ['ID', 'Nome da Conta', 'Saldo Atual'];
    const accRows = data.accounts.map(a => [a.id, a.name, a.balance]);
    const ws3 = XLSX.utils.aoa_to_sheet([accHeaders, ...accRows]);
    accHeaders.forEach((_, c) => { const addr = XLSX.utils.encode_cell({ r: 0, c }); if (ws3[addr]) ws3[addr].s = ST.headerBlue; });
    accRows.forEach((row, r) => {
        const base = r % 2 === 0 ? ST.cell : ST.cellAlt;
        row.forEach((_, c) => {
            const addr = XLSX.utils.encode_cell({ r: r + 1, c });
            if (!ws3[addr]) return;
            if (c === 2) { ws3[addr].s = { ...ST.kpiGreen, font: { color: { rgb: '00C896' }, bold: true } }; ws3[addr].z = ST.numFmt; ws3[addr].t = 'n'; }
            else ws3[addr].s = base;
        });
    });
    ws3['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 18 }];
    ws3['!rows'] = [{ hpt: 24 }];
    XLSX.utils.book_append_sheet(wb, ws3, '🏦 Contas');

    /* ── 4. CARTÕES sheet ────────────────────────────────────── */
    const cardHeaders = ['ID', 'Nome do Cartão', 'Limite', 'Dia Fechamento', 'Dia Vencimento', 'Fatura Atual', 'Disponível', 'Status'];
    const today2 = new Date().toISOString().split('T')[0];
    const cardRows = data.cards.map(c => {
        const period = getBillingPeriod(today2, c.closingDay || 1);
        const billing = getCardBilling(data, c.id, period);
        const fatura = billing?.total || 0;
        const avail = c.limit - fatura;
        return [c.id, c.name, c.limit, c.closingDay || 1, c.dueDay, fatura, avail, billing?.isPaid ? 'Paga' : (fatura > 0 ? 'Pendente' : 'Em aberto')];
    });
    const ws4 = XLSX.utils.aoa_to_sheet([cardHeaders, ...cardRows]);
    cardHeaders.forEach((_, c) => { const addr = XLSX.utils.encode_cell({ r: 0, c }); if (ws4[addr]) ws4[addr].s = ST.headerPurple; });
    cardRows.forEach((row, r) => {
        const base = r % 2 === 0 ? ST.cell : ST.cellAlt;
        row.forEach((_, c) => {
            const addr = XLSX.utils.encode_cell({ r: r + 1, c });
            if (!ws4[addr]) return;
            if (c === 2) { ws4[addr].s = { ...base, font: { color: { rgb: '94A3B8' } } }; ws4[addr].z = ST.numFmt; ws4[addr].t = 'n'; }
            else if (c === 5) { ws4[addr].s = ST.expense; ws4[addr].z = ST.numFmt; ws4[addr].t = 'n'; }
            else if (c === 6) { ws4[addr].s = ST.income; ws4[addr].z = ST.numFmt; ws4[addr].t = 'n'; }
            else if (c === 7) {
                const isPaid = row[7] === 'Paga';
                const isPending = row[7] === 'Pendente';
                ws4[addr].s = { ...base, font: { color: { rgb: isPaid ? '00C896' : (isPending ? 'FF4D6D' : '94A3B8') }, bold: isPaid || isPending } };
            }
            else ws4[addr].s = base;
        });
    });
    ws4['!cols'] = [{ wch: 14 }, { wch: 25 }, { wch: 14 }, { wch: 16 }, { wch: 17 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
    ws4['!rows'] = [{ hpt: 24 }];
    ws4['!autofilter'] = { ref: 'A1:H1' };
    XLSX.utils.book_append_sheet(wb, ws4, '💳 Cartões');

    /* ── 5. FATURAS sheet ────────────────────────────────────── */
    const billHeaders = ['Cartão', 'Período', 'Status', 'Valor', 'Data Pagamento', 'Conta Débito', 'Valor Pago'];
    const billRows = (data.cardBillings || []).map(b => {
        const cardName = data.cards.find(c => c.id === b.cardId)?.name || b.cardId;
        const accName = data.accounts.find(a => a.id === b.fromAccountId)?.name || b.fromAccountId || '';
        return [cardName, b.period, b.isPaid ? 'Paga' : 'Pendente', b.paidAmount || 0, b.paidAt || '', accName, b.paidAmount || 0];
    });
    const ws5 = XLSX.utils.aoa_to_sheet([billHeaders, ...billRows]);
    billHeaders.forEach((_, c) => { const addr = XLSX.utils.encode_cell({ r: 0, c }); if (ws5[addr]) ws5[addr].s = ST.headerGray; });
    ws5['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 14 }];
    ws5['!rows'] = [{ hpt: 24 }];
    XLSX.utils.book_append_sheet(wb, ws5, '🧾 Faturas');

    /* ── Also keep raw import-compatible sheets ──────────────── */
    const rawTxSheet = data.transactions.map(t => ({ 'ID': t.id, 'Tipo': t.type === 'income' ? 'Entrada' : (t.type === 'expense' ? 'Gasto' : 'Transferência'), 'Descrição': t.description, 'Categoria': t.category || '', 'Valor': t.amount, 'Data': t.date, 'Recorrente': t.recurring ? 'Sim' : 'Não', 'ContaID': t.accountId || '', 'DestinoID': t.destinationId || '', 'Parcela Atual': t.currentInstallment || 1, 'Total Parcelas': t.totalInstallments || 1, 'GrupoID': t.groupId || '' }));
    const rawAccSheet = data.accounts.map(a => ({ 'ID': a.id, 'Nome': a.name, 'Saldo': a.balance }));
    const rawCardSheet = data.cards.map(c => ({ 'ID': c.id, 'Nome': c.name, 'Limite': c.limit, 'Fechamento': c.closingDay || 1, 'Vencimento': c.dueDay }));
    const rawBillSheet = (data.cardBillings || []).map(b => ({ 'CartaoID': b.cardId, 'Periodo': b.period, 'Pago': b.isPaid ? 'Sim' : 'Não', 'ValorPago': b.paidAmount || '', 'DataPagamento': b.paidAt || '', 'ContaDebitoID': b.fromAccountId || '' }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawTxSheet.length ? rawTxSheet : [{}]), 'Transacoes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawAccSheet.length ? rawAccSheet : [{}]), 'Contas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawCardSheet.length ? rawCardSheet : [{}]), 'Cartoes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rawBillSheet.length ? rawBillSheet : [{}]), 'FaturasCartao');

    XLSX.writeFile(wb, `Planner_MemoryCard_${today}.xlsx`);
    _backupDone = true;
    showToast('Memory Card salvo! 💾');
}

function importFromExcel(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (typeof XLSX === 'undefined') { alert('Aguarde a biblioteca carregar.'); return; }

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const sheetTx   = wb.Sheets['Transacoes']  || wb.Sheets['Transações']  || null;
            const sheetAcc  = wb.Sheets['Contas']       || null;
            const sheetCard = wb.Sheets['Cartoes']      || wb.Sheets['Cartões']     || null;
            const sheetBill = wb.Sheets['FaturasCartao'] || null;

            if (!sheetTx && !sheetAcc && !sheetCard) {
                alert('Arquivo inválido! Use um backup gerado por este app.'); return;
            }

            const rawTx   = sheetTx   ? XLSX.utils.sheet_to_json(sheetTx)   : [];
            const rawAcc  = sheetAcc  ? XLSX.utils.sheet_to_json(sheetAcc)  : [];
            const rawCard = sheetCard ? XLSX.utils.sheet_to_json(sheetCard) : [];
            const rawBill = sheetBill ? XLSX.utils.sheet_to_json(sheetBill) : [];

            const transactions = rawTx.map(r => ({
                id: r['ID'] || generateId(),
                type: r['Tipo'] === 'Entrada' ? 'income' : (r['Tipo'] === 'Gasto' ? 'expense' : 'transfer'),
                description: r['Descrição'] || r['Descricao'] || '',
                category: r['Categoria'] || 'Outros',
                amount: parseFloat(r['Valor']) || 0,
                date: String(r['Data']) || '',
                recurring: r['Recorrente'] === 'Sim',
                accountId: r['ContaID'] || '',
                destinationId: r['DestinoID'] || null,
                currentInstallment: parseInt(r['Parcela Atual']) || 1,
                totalInstallments: parseInt(r['Total Parcelas']) || 1,
                groupId: r['GrupoID'] || null
            }));

            const accounts = rawAcc.map(r => ({ id: r['ID'] || generateId(), name: r['Nome'] || '', balance: parseFloat(r['Saldo']) || 0 }));

            const cards = rawCard.map(r => ({
                id: r['ID'] || generateId(), name: r['Nome'] || '',
                limit: parseFloat(r['Limite']) || 0,
                closingDay: parseInt(r['Fechamento']) || 1,
                dueDay: parseInt(r['Vencimento']) || 1
            }));

            const cardBillings = rawBill.map(r => ({
                cardId: r['CartaoID'] || '', period: r['Periodo'] || '',
                isPaid: r['Pago'] === 'Sim', paidAmount: parseFloat(r['ValorPago']) || 0,
                paidAt: r['DataPagamento'] || null, fromAccountId: r['ContaDebitoID'] || null
            }));

            if (!confirm(`Importar ${transactions.length} transações, ${accounts.length} contas e ${cards.length} cartões?\n\nDados atuais serão substituídos.`)) {
                event.target.value = ''; return;
            }

            saveData({ transactions, accounts, cards, cardBillings });
            _currentMonth = null;
            _backupDone = true; // Importar conta como backup realizado/atualizado
            
            // Fecha o welcome modal se estiver aberto
            const welcomeModal = bootstrap.Modal.getInstance(document.getElementById('welcomeModal'));
            if (welcomeModal) welcomeModal.hide();

            renderAll();
            showToast('Memory Card carregado! ✓');
        } catch (err) {
            console.error(err);
            alert('Erro ao carregar o arquivo. Verifique se é um backup válido.');
        }
        event.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}
