/* ==========================================================================
   UniHub V4 — módulo Financeiro
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = Hub.utils;
  const DB = Hub.db;
  const UI = Hub.ui;
  const M = {};
  const PER_PAGE = 15;

  const S = {
    tab: 'overview',
    search: '',
    type: '',
    status: '',
    month: '',
    page: 1
  };

  const CATEGORIES = ['Vendas', 'Compras', 'Despesas fixas', 'Marketing', 'Operação', 'Estornos', 'Impostos', 'Outros'];

  let activateTab = function () {};

  function norm(value) { return U.normalizeText(value).toLowerCase(); }

  function cashDate(entry) {
    return entry.paidAt || entry.dueDate || entry.createdAt;
  }

  function paidIn(entry, key) {
    return entry.status === 'pago' && U.monthKey(cashDate(entry)) === key;
  }

  function originLabel(entry, state) {
    if (entry.saleId) {
      const sale = state.sales.find(function (s) { return s.id === entry.saleId; });
      return sale ? sale.number : 'Pedido';
    }
    if (entry.purchaseOrderId) {
      const order = state.purchaseOrders.find(function (o) { return o.id === entry.purchaseOrderId; });
      return order ? order.number : 'Compra';
    }
    return 'Manual';
  }

  function renderKpis() {
    const state = DB.get();
    const box = document.getElementById('finance-kpis');
    if (!box) return;
    const month = U.currentMonthKey();
    const paid = state.finance.filter(function (f) { return f.status === 'pago'; });
    const inTotal = U.sum(paid.filter(function (f) { return f.type === 'receita'; }), function (f) { return f.amount; });
    const outTotal = U.sum(paid.filter(function (f) { return f.type === 'despesa'; }), function (f) { return f.amount; });
    const balance = inTotal - outTotal;
    const receivable = state.finance.filter(function (f) { return f.type === 'receita' && f.status === 'pendente'; });
    const payable = state.finance.filter(function (f) { return f.type === 'despesa' && f.status === 'pendente'; });
    const monthIn = U.sum(state.finance.filter(function (f) { return f.type === 'receita' && paidIn(f, month); }), function (f) { return f.amount; });
    const monthOut = U.sum(state.finance.filter(function (f) { return f.type === 'despesa' && paidIn(f, month); }), function (f) { return f.amount; });
    const result = monthIn - monthOut;

    function kpi(label, value, hint, tone, icon) {
      const el = U.el('article', { class: 'kpi' + (tone ? ' is-' + tone : '') });
      const top = U.el('div', { class: 'kpi-top' });
      top.appendChild(U.el('span', { text: label }));
      top.appendChild(U.icon(icon || 'wallet'));
      el.appendChild(top);
      el.appendChild(U.el('div', { class: 'kpi-value', text: value }));
      if (hint) el.appendChild(U.el('div', { class: 'kpi-hint', text: hint }));
      return el;
    }

    U.clear(box);
    box.appendChild(kpi('Saldo realizado', U.fmtMoney(balance), 'receitas pagas menos despesas pagas', balance >= 0 ? 'good' : 'alert'));
    box.appendChild(kpi('A receber', U.fmtMoney(U.sum(receivable, function (f) { return f.amount; })), receivable.length + ' lançamento(s) pendente(s)', receivable.length ? 'good' : '', 'down'));
    box.appendChild(kpi('A pagar', U.fmtMoney(U.sum(payable, function (f) { return f.amount; })), payable.length + ' conta(s) em aberto', payable.length ? 'alert' : '', 'up'));
    box.appendChild(kpi('Resultado do mês', U.fmtMoney(result), 'receitas ' + U.fmtMoney(monthIn) + ' · despesas ' + U.fmtMoney(monthOut), result >= 0 ? 'good' : 'alert', 'spark'));
  }

  function renderOverview() {
    const state = DB.get();
    const chart = document.getElementById('finance-chart');
    const upcoming = document.getElementById('finance-upcoming');
    if (!chart || !upcoming) return;
    U.clear(chart);

    const months = U.lastMonths(6);
    const series = months.map(function (key) {
      const income = U.sum(state.finance.filter(function (f) {
        return f.type === 'receita' && paidIn(f, key);
      }), function (f) { return f.amount; });
      const expense = U.sum(state.finance.filter(function (f) {
        return f.type === 'despesa' && paidIn(f, key);
      }), function (f) { return f.amount; });
      return { key: key, income: income, expense: expense };
    });
    const max = Math.max(1, Math.max.apply(null, series.map(function (s) { return Math.max(s.income, s.expense); })));

    series.forEach(function (s) {
      const col = U.el('div', { class: 'chart-col' });
      const bars = U.el('div', { class: 'chart-bars' });
      const income = U.el('div', {
        class: 'chart-bar in',
        style: { height: Math.max(2, (s.income / max) * 100) + '%' },
        title: U.fmtMoney(s.income) + ' em receitas'
      });
      const expense = U.el('div', {
        class: 'chart-bar out',
        style: { height: Math.max(2, (s.expense / max) * 100) + '%' },
        title: U.fmtMoney(s.expense) + ' em despesas'
      });
      bars.appendChild(income);
      bars.appendChild(expense);
      col.appendChild(bars);
      col.appendChild(U.el('div', { class: 'chart-label', text: U.monthLabel(s.key, true) }));
      chart.appendChild(col);
    });
    chart.setAttribute('aria-label', 'Receitas e despesas dos últimos seis meses: ' + series.map(function (s) {
      return U.monthLabel(s.key, true) + ', receitas ' + U.fmtMoney(s.income) + ', despesas ' + U.fmtMoney(s.expense);
    }).join('; '));

    U.clear(upcoming);
    const pending = state.finance.filter(function (f) {
      return f.status === 'pendente';
    }).sort(function (a, b) {
      return String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31'));
    }).slice(0, 6);

    if (!pending.length) {
      UI.empty(upcoming, {
        icon: 'check',
        title: 'Nenhuma conta em aberto',
        message: 'As receitas e despesas pendentes aparecerão aqui.'
      });
      return;
    }

    const today = U.todayISO();
    const list = U.el('ul', { class: 'upcoming-list' });
    pending.forEach(function (f) {
      const li = U.el('li', { class: 'upcoming-item' });
      const overdue = f.dueDate && f.dueDate < today;
      li.appendChild(U.el('span', { class: 'item-icon ' + (f.type === 'despesa' ? 'is-red' : 'is-green'), 'aria-hidden': 'true' }, U.icon(f.type === 'despesa' ? 'up' : 'down')));
      const main = U.el('div', { class: 'item-main' });
      main.appendChild(U.el('strong', { text: f.description }));
      main.appendChild(U.el('small', {
        text: (overdue ? 'Vencido em ' : 'Vence em ') + U.fmtDate(f.dueDate) + ' · ' + originLabel(f, state)
      }));
      li.appendChild(main);
      const side = U.el('div', { class: 'item-side' });
      side.appendChild(U.el('span', { class: 'amount ' + (f.type === 'despesa' ? 'is-red' : 'is-green'), text: U.fmtMoney(f.amount) }));
      side.appendChild(U.el('button', {
        class: 'mini-link', type: 'button', text: 'Marcar pago',
        onclick: function () { payEntry(f.id); }
      }));
      li.appendChild(side);
      list.appendChild(li);
    });
    upcoming.appendChild(list);
  }

  function renderEntries() {
    const state = DB.get();
    const tbody = document.querySelector('#finance-table tbody');
    if (!tbody) return;
    U.clear(tbody);
    const term = norm(S.search);
    const list = state.finance.filter(function (entry) {
      if (S.type && entry.type !== S.type) return false;
      if (S.status && entry.status !== S.status) return false;
      if (S.month && U.monthKey(entry.dueDate || entry.createdAt) !== S.month) return false;
      if (!term) return true;
      const haystack = [entry.description, entry.category, entry.notes, originLabel(entry, state)].join(' ').toLowerCase();
      return haystack.indexOf(term) > -1;
    }).sort(function (a, b) {
      return String(b.dueDate || b.createdAt).localeCompare(String(a.dueDate || a.createdAt));
    });

    S.page = Math.min(S.page, UI.pages(list.length, PER_PAGE));
    const rows = UI.slice(list, S.page, PER_PAGE);

    if (!rows.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 8, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: state.finance.length ? 'Nenhum lançamento encontrado' : 'Nenhum lançamento financeiro' }));
      td.appendChild(U.el('span', { text: state.finance.length ? 'Ajuste os filtros ou a busca.' : 'Crie uma receita ou despesa para começar.' }));
      if (!state.finance.length) {
        td.appendChild(U.el('button', {
          class: 'btn btn-primary btn-sm', type: 'button', onclick: function () { openEntryDialog(); }
        }, U.icon('plus'), 'Novo lançamento'));
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      rows.forEach(function (entry) {
        const tr = U.el('tr', { class: entry.status === 'cancelado' ? 'is-inactive' : '' });
        const due = U.el('td', { class: 'nowrap' });
        due.appendChild(U.el('span', { text: U.fmtDate(entry.dueDate) }));
        if (entry.paidAt) due.appendChild(U.el('span', { class: 'sub', text: 'pago em ' + U.fmtDate(entry.paidAt) }));
        tr.appendChild(due);
        const desc = U.el('td');
        desc.appendChild(U.el('span', { class: 'strong', text: entry.description }));
        if (entry.notes) desc.appendChild(U.el('span', { class: 'sub', text: entry.notes }));
        tr.appendChild(desc);
        const type = U.el('td');
        type.appendChild(UI.badge(entry.type === 'receita' ? 'Receita' : 'Despesa', entry.type === 'receita' ? 'green' : 'red'));
        tr.appendChild(type);
        tr.appendChild(U.el('td', { text: entry.category || '—' }));
        tr.appendChild(U.el('td', { class: 'num ' + (entry.type === 'receita' ? '' : ''), text: (entry.type === 'receita' ? '+' : '−') + ' ' + U.fmtMoney(entry.amount) }));
        const status = U.el('td');
        status.appendChild(UI.financeBadge(entry.status));
        tr.appendChild(status);
        tr.appendChild(U.el('td', { text: originLabel(entry, state) }));

        const actions = U.el('td', { class: 'actions-cell' });
        if (entry.status === 'pendente') {
          actions.appendChild(U.el('button', {
            class: 'btn btn-success btn-sm', type: 'button', title: 'Marcar como pago', 'aria-label': 'Marcar ' + entry.description + ' como pago',
            onclick: function () { payEntry(entry.id); }
          }, U.icon('check')));
        }
        if (entry.origin === 'manual') {
          actions.appendChild(U.el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', title: 'Editar lançamento', 'aria-label': 'Editar ' + entry.description,
            onclick: function () { openEntryDialog(entry.id); }
          }, U.icon('pen')));
          actions.appendChild(U.el('button', {
            class: 'btn btn-danger-ghost btn-sm', type: 'button', title: 'Excluir lançamento', 'aria-label': 'Excluir ' + entry.description,
            onclick: function () { deleteEntry(entry.id); }
          }, U.icon('trash')));
        } else {
          actions.appendChild(U.el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', title: 'Ver origem', 'aria-label': 'Ver origem de ' + entry.description,
            onclick: function () { openOrigin(entry); }
          }, U.icon('external')));
        }
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });
    }

    UI.pagination(document.getElementById('finance-pagination'), {
      page: S.page, pages: UI.pages(list.length, PER_PAGE), total: list.length, pageSize: PER_PAGE,
      onChange: function (page) { S.page = page; renderEntries(); }
    });
  }

  function openEntryDialog(id) {
    const state = DB.get();
    const entry = id ? state.finance.find(function (f) { return f.id === id; }) : null;
    if (entry && entry.origin !== 'manual') {
      UI.toast('Este lançamento é gerado por um pedido ou compra. Altere a origem para refletir no financeiro.', 'warn');
      return;
    }
    const dialog = document.getElementById('finance-dialog');
    if (!dialog) return;
    U.clear(dialog);

    const form = U.el('form', { class: 'dialog-form', novalidate: 'novalidate' });
    form.appendChild(UI.dialogHeader(entry ? 'Editar lançamento' : 'Novo lançamento', entry ? entry.description : 'Receita ou despesa', dialog));
    const body = U.el('div', { class: 'dialog-body' });
    body.appendChild(U.el('div', { class: 'form-error', role: 'alert' }));
    const grid = U.el('div', { class: 'form-grid' });

    const typeSelect = U.el('select', { name: 'type', id: 'fin-type' });
    typeSelect.appendChild(UI.option('receita', 'Receita', entry ? entry.type === 'receita' : true));
    typeSelect.appendChild(UI.option('despesa', 'Despesa', entry ? entry.type === 'despesa' : false));
    grid.appendChild(UI.field('Tipo *', typeSelect));
    grid.appendChild(UI.field('Valor (R$) *', U.el('input', { type: 'number', name: 'amount', id: 'fin-amount', min: '0.01', step: '0.01', required: true, value: entry ? entry.amount : '' })));
    grid.appendChild(UI.field('Descrição *', U.el('input', { type: 'text', name: 'description', id: 'fin-description', maxlength: 140, required: true, value: entry ? entry.description : '', placeholder: 'Ex.: Venda de kit, aluguel, embalagens' }), { className: 'span-2' }));
    const categoryInput = U.el('input', { type: 'text', name: 'category', id: 'fin-category', maxlength: 60, list: 'finance-categories', value: entry ? entry.category : '', placeholder: 'Selecione ou digite' });
    const datalist = U.el('datalist', { id: 'finance-categories' });
    CATEGORIES.forEach(function (cat) { datalist.appendChild(U.el('option', { value: cat })); });
    const categoryWrap = UI.field('Categoria', categoryInput);
    categoryWrap.appendChild(datalist);
    grid.appendChild(categoryWrap);
    grid.appendChild(UI.field('Vencimento', U.el('input', { type: 'date', name: 'dueDate', id: 'fin-due', value: entry ? entry.dueDate : U.todayISO() })));
    const statusSelect = U.el('select', { name: 'status', id: 'fin-status' });
    statusSelect.appendChild(UI.option('pendente', 'Pendente', entry ? entry.status === 'pendente' : true));
    statusSelect.appendChild(UI.option('pago', 'Pago', entry ? entry.status === 'pago' : false));
    grid.appendChild(UI.field('Status', statusSelect));
    const paidWrap = UI.field('Data do pagamento', U.el('input', { type: 'date', name: 'paidAt', id: 'fin-paid', value: entry ? entry.paidAt : U.todayISO() }));
    paidWrap.hidden = entry ? entry.status !== 'pago' : true;
    grid.appendChild(paidWrap);
    grid.appendChild(UI.field('Observações', U.el('textarea', { name: 'notes', id: 'fin-notes', rows: 2, maxlength: 400, value: entry ? entry.notes : '' }), { className: 'span-2' }));

    statusSelect.addEventListener('change', function () {
      paidWrap.hidden = statusSelect.value !== 'pago';
      if (statusSelect.value === 'pago' && !form.elements.paidAt.value) form.elements.paidAt.value = U.todayISO();
    });
    if (entry && entry.origin === 'sale') {
      body.appendChild(U.el('p', { class: 'banner', style: { display: 'block' }, text: 'Este lançamento foi gerado por um pedido. Edite o pedido para alterar o valor.' }));
    }

    body.appendChild(grid);
    form.appendChild(body);
    const cancel = U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { dialog.close(); } }, 'Cancelar');
    const save = U.el('button', { class: 'btn btn-primary', type: 'submit' }, U.icon('check'), entry ? 'Salvar lançamento' : 'Criar lançamento');
    form.appendChild(UI.dialogFooter([cancel, save]));

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      UI.clearFormError(form);
      const data = UI.formData(form);
      const description = U.normalizeText(data.description);
      const amount = U.toNumber(data.amount, 0);
      if (!description) { UI.invalid(form, 'description', 'Informe a descrição.'); return; }
      if (amount <= 0) { UI.invalid(form, 'amount', 'O valor deve ser maior que zero.'); return; }
      if (data.status === 'pago' && !data.paidAt) { UI.invalid(form, 'paidAt', 'Informe a data do pagamento.'); return; }
      try {
        DB.tx(function (s) {
          let target = entry ? s.finance.find(function (f) { return f.id === entry.id; }) : null;
          if (entry && (!target || target.origin !== 'manual')) throw new Error('Este lançamento não pode ser editado manualmente.');
          if (!target) {
            target = { id: U.uid('fin'), origin: 'manual', saleId: '', purchaseOrderId: '', createdAt: U.nowISO() };
            s.finance.push(target);
          }
          target.type = data.type;
          target.description = description;
          target.amount = U.round(amount, 2);
          target.category = U.normalizeText(data.category) || 'Outros';
          target.dueDate = data.dueDate || U.todayISO();
          target.status = data.status;
          target.paidAt = data.status === 'pago' ? data.paidAt : '';
          target.notes = U.normalizeText(data.notes);
          target.updatedAt = U.nowISO();
        });
        dialog.close();
        UI.toast(entry ? 'Lançamento atualizado.' : 'Lançamento criado.');
        renderAll();
      } catch (err) { UI.formError(form, err.message); }
    });

    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  async function payEntry(id) {
    const state = DB.get();
    const entry = state.finance.find(function (f) { return f.id === id; });
    if (!entry || entry.status !== 'pendente') return;
    const ok = await UI.confirm({
      title: 'Marcar como pago',
      message: 'Marcar "' + entry.description + '" no valor de ' + U.fmtMoney(entry.amount) + ' como pago hoje?',
      confirmLabel: 'Marcar pago',
      danger: false
    });
    if (!ok) return;
    try {
      DB.tx(function (s) {
        const target = s.finance.find(function (f) { return f.id === id; });
        if (!target || target.status !== 'pendente') throw new Error('Este lançamento não está pendente.');
        target.status = 'pago';
        target.paidAt = U.todayISO();
        target.updatedAt = U.nowISO();
      });
      UI.toast('Lançamento marcado como pago.');
      renderAll();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function deleteEntry(id) {
    const state = DB.get();
    const entry = state.finance.find(function (f) { return f.id === id; });
    if (!entry) return;
    if (entry.origin !== 'manual') {
      UI.toast('Este lançamento é gerado por um pedido ou compra e não pode ser excluído aqui.', 'warn');
      return;
    }
    const ok = await UI.confirm({
      title: 'Excluir lançamento',
      message: 'Excluir "' + entry.description + '"? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir'
    });
    if (!ok) return;
    try {
      DB.tx(function (s) { s.finance = s.finance.filter(function (f) { return f.id !== id; }); });
      UI.toast('Lançamento excluído.');
      renderAll();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  function openOrigin(entry) {
    if (entry.saleId) {
      Hub.app.navigate('pedidos');
      setTimeout(function () { Hub.modules.pedidos.openSaleDetail(entry.saleId); }, 30);
      return;
    }
    if (entry.purchaseOrderId) {
      Hub.app.navigate('estoque');
      setTimeout(function () { Hub.modules.estoque.showTab('compras'); }, 30);
      return;
    }
  }

  function exportFinance() {
    const state = DB.get();
    const rows = state.finance.map(function (f) {
      return [f.dueDate, f.description, f.type, f.category, f.amount, UI.financeStatus(f.status).label, f.paidAt, originLabel(f, state), f.notes];
    });
    U.download('financeiro.csv', U.toCSV(['Vencimento', 'Descrição', 'Tipo', 'Categoria', 'Valor', 'Status', 'Pago em', 'Origem', 'Observações'], rows), 'text/csv;charset=utf-8');
  }

  function renderTab(name) {
    S.tab = name || S.tab;
    renderKpis();
    if (S.tab === 'overview') renderOverview();
    else renderEntries();
  }

  function renderAll() {
    renderKpis();
    if (S.tab === 'overview') renderOverview();
    renderEntries();
  }

  M.render = function () { renderTab(S.tab); };
  M.openEntryDialog = openEntryDialog;
  M.showTab = function (name) {
    if (name) {
      S.tab = name;
      activateTab(name);
    } else {
      renderTab(S.tab);
    }
  };

  M.init = function () {
    const root = document.getElementById('view-financeiro');
    if (!root) return;
    activateTab = UI.initTabs(document.getElementById('finance-tabs'), function (name) {
      S.tab = name;
      renderTab(name);
    });

    const search = document.getElementById('finance-search');
    if (search) search.addEventListener('input', U.debounce(function () { S.search = search.value; S.page = 1; renderEntries(); }, 180));
    const type = document.getElementById('finance-type-filter');
    if (type) type.addEventListener('change', function () { S.type = type.value; S.page = 1; renderEntries(); });
    const status = document.getElementById('finance-status-filter');
    if (status) status.addEventListener('change', function () { S.status = status.value; S.page = 1; renderEntries(); });
    const month = document.getElementById('finance-month');
    if (month) month.addEventListener('change', function () { S.month = month.value; S.page = 1; renderEntries(); });

    const newEntry = document.getElementById('btn-new-finance');
    if (newEntry) newEntry.addEventListener('click', function () { openEntryDialog(); });
    const exportButton = document.getElementById('btn-export-finance');
    if (exportButton) exportButton.addEventListener('click', exportFinance);
  };

  Hub.modules = Hub.modules || {};
  Hub.modules.financeiro = M;
})(window.Hub = window.Hub || {});
