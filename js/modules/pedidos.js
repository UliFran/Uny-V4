/* ==========================================================================
   UniHub V4 — módulo Pedidos & Vendas
   --------------------------------------------------------------------------
   Fluxo: rascunho → confirmado → separado → enviado → entregue
          (cancelado antes da entrega · devolução depois da entrega)
   - Busca de produto ao digitar + atalhos "mais vendidos".
   - Encomenda: confirmar sem estoque deixa o saldo negativo (vira compra).
   - Recebimento: na hora, na entrega ou a prazo (parcelas mensais).
   - Lucro bruto por pedido (custo gravado no momento da venda).
   - Resumo por WhatsApp/cópia e impressão por iframe (funciona no Android).
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = Hub.utils;
  const DB = Hub.db;
  const UI = Hub.ui;
  const M = {};
  const PER_PAGE = 15;

  const S = { search: '', status: '', page: 1 };

  const PAYMENTS = [
    { value: 'pix', label: 'Pix' },
    { value: 'dinheiro', label: 'Dinheiro' },
    { value: 'cartao', label: 'Cartão' },
    { value: 'transferencia', label: 'Transferência' },
    { value: 'fiado', label: 'Fiado (a prazo)' }
  ];

  const RECEIPTS = [
    { value: 'agora', label: 'Recebido agora (já pago)' },
    { value: 'entrega', label: 'Receber na entrega' },
    { value: 'prazo', label: 'A prazo (parcelas)' }
  ];

  /** Próxima etapa do pedido e o texto do botão. */
  const NEXT = {
    confirmado: { to: 'separado', label: 'Marcar separado', icon: 'package' },
    separado: { to: 'enviado', label: 'Marcar enviado', icon: 'external' },
    enviado: { to: 'entregue', label: 'Marcar entregue', icon: 'check' }
  };
  const IN_PROGRESS = ['confirmado', 'separado', 'enviado'];

  function norm(value) { return U.normalizeText(value).toLowerCase(); }
  function firstName(name) { return U.normalizeText(name).split(' ')[0] || name; }
  function paymentLabel(value) { return UI.paymentLabel(value); }
  function now() { return U.nowISO(); }

  function addMonthsISO(isoDate, months) {
    const base = U.parseDate(isoDate) || new Date();
    const d = new Date(base.getFullYear(), base.getMonth() + months, 1, 12);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(base.getDate(), lastDay));
    return U.dateOnly(d);
  }

  function pendingEntries(sale, state) {
    return DB.financesOfSale(sale.id, state).filter(function (f) { return f.type === 'receita' && f.status === 'pendente'; });
  }

  function monthSales(state) {
    const month = U.currentMonthKey();
    return state.sales.filter(function (sale) {
      return sale.status !== 'rascunho' && sale.status !== 'cancelado' && sale.status !== 'devolvido' &&
        U.monthKey(sale.confirmedAt || sale.createdAt) === month;
    });
  }

  function shortages(items, state) {
    const aggregate = {};
    items.forEach(function (item) {
      aggregate[item.productId] = (aggregate[item.productId] || 0) + U.toNumber(item.qty, 0);
    });
    return Object.keys(aggregate).map(function (productId) {
      const product = DB.productById(productId, state);
      const available = DB.stockFor(productId, state);
      return { product: product, needed: aggregate[productId], available: available, missing: aggregate[productId] - available };
    }).filter(function (row) { return row.missing > 0; });
  }

  function shortageMessage(rows) {
    return rows.slice(0, 4).map(function (row) {
      return (row.product ? row.product.nome : 'Produto') + ': precisa de ' + row.needed + ', disponível ' + Math.max(0, row.available);
    }).join(' · ') + (rows.length > 4 ? ' · e mais ' + (rows.length - 4) : '');
  }

  /* ============================== regras (dentro de DB.tx) ============================== */

  /** Cria as contas a receber do pedido conforme a forma de recebimento. */
  function createReceivables(s, sale) {
    if (!(sale.total > 0)) return;
    const prazo = sale.receipt === 'prazo';
    const n = prazo ? Math.max(1, Math.min(12, Math.round(U.toNumber(sale.installments, 1)))) : 1;
    const cents = Math.round(sale.total * 100);
    const each = Math.floor(cents / n);
    const today = U.todayISO();
    const firstDue = prazo ? (sale.dueDate || today) : today;
    for (let i = 0; i < n; i += 1) {
      const value = (i === n - 1 ? cents - each * (n - 1) : each) / 100;
      const paid = sale.receipt === 'agora';
      s.finance.push({
        id: U.uid('fin'), type: 'receita',
        description: 'Pedido ' + sale.number + ' — ' + sale.clientName + (n > 1 ? ' (parcela ' + (i + 1) + '/' + n + ')' : ''),
        amount: value, category: 'Vendas',
        dueDate: prazo ? addMonthsISO(firstDue, i) : today,
        paidAt: paid ? today : '', status: paid ? 'pago' : 'pendente',
        origin: 'sale', saleId: sale.id, purchaseOrderId: '',
        installment: i + 1, installments: n,
        notes: sale.receipt === 'entrega' ? 'Receber na entrega' : '', createdAt: now(), updatedAt: now()
      });
    }
  }

  /** Baixa o estoque, grava o custo, cria as contas a receber e muda o status. */
  function applyConfirm(s, sale) {
    sale.items.forEach(function (item) {
      const product = s.products.find(function (p) { return p.id === item.productId; });
      if (!product) throw new Error('Produto não encontrado: ' + item.nome);
      item.unitCost = U.toNumber(product.cost, 0);
      s.movements.push({
        id: U.uid('mov'), productId: item.productId, type: 'saida', quantity: item.qty,
        unitCost: item.unitCost, unitPrice: item.unitPrice, cycle: '', expiry: '', supplier: '',
        note: 'Venda ' + sale.number, saleId: sale.id, createdAt: now(), updatedAt: now()
      });
    });
    s.finance = s.finance.filter(function (f) { return f.saleId !== sale.id; });
    createReceivables(s, sale);
    sale.status = 'confirmado';
    sale.confirmedAt = now();
    sale.statusHistory.push({ status: 'confirmado', at: now() });
  }

  /**
   * Ajusta o financeiro quando parte (ou todo) o valor do pedido é devolvido.
   * 1) reduz/cancela parcelas pendentes, da última para a primeira;
   * 2) o que já foi pago vira uma despesa de estorno (saída real de caixa).
   */
  function settleRefund(s, sale, amount, cancelAll, reasonLabel) {
    let remaining = U.round(amount, 2);
    const entries = s.finance.filter(function (f) {
      return f.saleId === sale.id && f.type === 'receita' && f.status === 'pendente';
    }).sort(function (a, b) { return String(b.dueDate).localeCompare(String(a.dueDate)); });
    entries.forEach(function (f) {
      if (cancelAll || f.amount <= remaining + 0.004) {
        remaining = U.round(remaining - f.amount, 2);
        f.status = 'cancelado';
        f.notes = (f.notes ? f.notes + ' · ' : '') + reasonLabel;
      } else if (remaining > 0) {
        f.amount = U.round(f.amount - remaining, 2);
        f.notes = (f.notes ? f.notes + ' · ' : '') + 'reduzido por devolução';
        remaining = 0;
      }
      f.updatedAt = now();
    });
    if (remaining > 0.004) {
      s.finance.push({
        id: U.uid('fin'), type: 'despesa',
        description: 'Estorno — pedido ' + sale.number + ' (' + reasonLabel + ')',
        amount: remaining, category: 'Estornos',
        dueDate: U.todayISO(), paidAt: U.todayISO(), status: 'pago',
        origin: 'manual', saleId: '', purchaseOrderId: '',
        notes: 'Valor já recebido devolvido ao cliente', createdAt: now(), updatedAt: now()
      });
    }
  }

  function returnToStock(s, sale, items, note) {
    items.forEach(function (item) {
      const product = s.products.find(function (p) { return p.id === item.productId; });
      s.movements.push({
        id: U.uid('mov'), productId: item.productId, type: 'devolucao', quantity: item.qty,
        unitCost: product ? product.cost : 0, unitPrice: item.unitPrice || 0, cycle: '', expiry: '', supplier: '',
        note: note + ' ' + sale.number, saleId: sale.id, createdAt: now(), updatedAt: now()
      });
    });
  }

  /* ============================== KPIs e lista ============================== */

  function kpiCard(label, value, hint, tone, icon) {
    const el = U.el('article', { class: 'kpi' + (tone ? ' is-' + tone : '') });
    const top = U.el('div', { class: 'kpi-top' });
    top.appendChild(U.el('span', { text: label }));
    top.appendChild(U.icon(icon || 'cart'));
    el.appendChild(top);
    el.appendChild(U.el('div', { class: 'kpi-value', text: value }));
    if (hint) el.appendChild(U.el('div', { class: 'kpi-hint', text: hint }));
    return el;
  }

  function renderKpis() {
    const state = DB.get();
    const box = document.getElementById('sale-kpis');
    if (!box) return;
    const sales = monthSales(state);
    const revenue = U.sum(sales, function (s) { return DB.saleNet(s); });
    const ticket = sales.length ? revenue / sales.length : 0;
    let profit = 0;
    let partial = 0;
    sales.forEach(function (s) {
      const p = DB.saleProfit(s);
      profit += p.profit;
      if (!p.complete) partial += 1;
    });
    const receivable = state.finance.filter(function (f) {
      return f.type === 'receita' && f.status === 'pendente' && f.saleId;
    });
    const progress = state.sales.filter(function (s) { return IN_PROGRESS.indexOf(s.status) > -1; });

    U.clear(box);
    box.appendChild(kpiCard('Pedidos no mês', String(sales.length), U.fmtMoney(revenue) + ' em vendas'));
    box.appendChild(kpiCard('Lucro bruto do mês', U.fmtMoney(profit),
      partial ? partial + ' pedido(s) sem custo informado' : 'vendas menos custo dos produtos', profit > 0 ? 'good' : '', 'spark'));
    box.appendChild(kpiCard('Ticket médio', U.fmtMoney(ticket), 'pedidos do mês', '', 'wallet'));
    box.appendChild(kpiCard('Em andamento', String(progress.length), 'a separar, enviar ou entregar', progress.length ? 'alert' : '', 'package'));
    box.appendChild(kpiCard('A receber', U.fmtMoney(U.sum(receivable, function (f) { return f.amount; })),
      receivable.length + ' parcela(s) pendente(s)', receivable.length ? 'alert' : '', 'down'));
  }

  function matchesFilter(sale, state) {
    if (S.status === 'andamento') return IN_PROGRESS.indexOf(sale.status) > -1;
    if (S.status === 'receber') return pendingEntries(sale, state).length > 0;
    return !S.status || sale.status === S.status;
  }

  function actionButton(icon, title, onclick, cls) {
    return U.el('button', {
      class: 'btn btn-ghost btn-sm ' + (cls || ''), type: 'button', title: title, 'aria-label': title, onclick: onclick
    }, U.icon(icon));
  }

  function renderSales() {
    const state = DB.get();
    const tbody = document.querySelector('#sales-table tbody');
    if (!tbody) return;
    U.clear(tbody);
    const term = norm(S.search);
    const list = state.sales.filter(function (sale) {
      if (!matchesFilter(sale, state)) return false;
      if (!term) return true;
      const haystack = [sale.number, sale.clientName, sale.paymentMethod, sale.notes].concat(sale.items.map(function (i) {
        return i.codigo + ' ' + i.nome;
      })).join(' ').toLowerCase();
      return haystack.indexOf(term) > -1;
    }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

    S.page = Math.min(S.page, UI.pages(list.length, PER_PAGE));
    const rows = UI.slice(list, S.page, PER_PAGE);

    if (!rows.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 8, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: state.sales.length ? 'Nenhum pedido encontrado' : 'Nenhum pedido criado' }));
      td.appendChild(U.el('span', { text: state.sales.length ? 'Ajuste a busca ou os filtros.' : 'Monte o primeiro pedido e acompanhe a separação, o envio e o recebimento.' }));
      if (!state.sales.length) {
        td.appendChild(U.el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: function () { openOrderDialog(); } }, U.icon('plus'), 'Novo pedido'));
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      rows.forEach(function (sale) {
        const tr = U.el('tr', { class: (sale.status === 'cancelado' || sale.status === 'devolvido') ? 'is-inactive' : '' });
        tr.appendChild(U.el('td', { class: 'nowrap' }, U.el('span', { class: 'strong', text: sale.number })));
        tr.appendChild(U.el('td', { class: 'nowrap', text: U.fmtDate(sale.createdAt) }));
        tr.appendChild(U.el('td', { text: sale.clientName || 'Consumidor final' }));
        tr.appendChild(U.el('td', { class: 'num', text: String(sale.items.length) }));
        const net = DB.saleNet(sale);
        const totalCell = U.el('td', { class: 'num' });
        totalCell.appendChild(document.createTextNode(U.fmtMoney(sale.status === 'rascunho' || sale.status === 'cancelado' || sale.status === 'devolvido' ? sale.total : net)));
        if (DB.saleReturned(sale) > 0) totalCell.appendChild(U.el('span', { class: 'sub', text: 'devolvido ' + U.fmtMoney(DB.saleReturned(sale)) }));
        tr.appendChild(totalCell);

        const payCell = U.el('td');
        payCell.appendChild(document.createTextNode(paymentLabel(sale.paymentMethod)));
        const pending = pendingEntries(sale, state);
        if (pending.length) {
          payCell.appendChild(U.el('span', { class: 'sub is-amber', text: 'a receber ' + U.fmtMoney(U.sum(pending, function (f) { return f.amount; })) }));
        } else if (sale.status !== 'rascunho' && sale.status !== 'cancelado' && sale.status !== 'devolvido') {
          payCell.appendChild(U.el('span', { class: 'sub is-green', text: 'recebido' }));
        }
        tr.appendChild(payCell);

        const status = U.el('td');
        status.appendChild(UI.saleBadge(sale.status));
        tr.appendChild(status);

        const actions = U.el('td', { class: 'actions-cell' });
        actions.appendChild(actionButton('eye', 'Ver pedido ' + sale.number, function () { openSaleDetail(sale.id); }));
        if (sale.status === 'rascunho') {
          actions.appendChild(actionButton('pen', 'Editar rascunho ' + sale.number, function () { openOrderDialog(sale.id); }));
          actions.appendChild(actionButton('check', 'Confirmar pedido ' + sale.number, function () { confirmSale(sale.id); }, 'btn-success'));
        } else if (NEXT[sale.status]) {
          const next = NEXT[sale.status];
          actions.appendChild(actionButton(next.icon, next.label + ' — ' + sale.number, function () { advanceSale(sale.id, next.to); }, 'btn-success'));
        }
        if (pending.length) {
          actions.appendChild(actionButton('wallet', 'Receber pagamento — ' + sale.number, function () { receiveSale(sale.id); }));
        }
        actions.appendChild(actionButton('phone', 'Enviar resumo por WhatsApp — ' + sale.number, function () { shareWhatsApp(sale.id); }));
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });
    }

    UI.pagination(document.getElementById('sales-pagination'), {
      page: S.page, pages: UI.pages(list.length, PER_PAGE), total: list.length, pageSize: PER_PAGE,
      onChange: function (page) { S.page = page; renderSales(); }
    });
  }

  /* ============================== novo pedido ============================== */

  function openOrderDialog(id) {
    const state = DB.get();
    const sale = id ? DB.saleById(id, state) : null;
    if (sale && sale.status !== 'rascunho') {
      UI.toast('Somente rascunhos podem ser editados. Use as ações do pedido para avançar, cancelar ou devolver.', 'warn');
      return;
    }
    if (!state.products.some(function (p) { return p.active !== false; })) {
      UI.toast('Cadastre um produto antes de criar um pedido.', 'warn');
      return;
    }

    const dialog = document.getElementById('sale-dialog');
    if (!dialog) return;
    U.clear(dialog);

    let items = sale ? sale.items.map(function (item) {
      return { productId: item.productId, codigo: item.codigo, nome: item.nome, qty: item.qty, unitPrice: item.unitPrice, discount: item.discount || 0 };
    }) : [];

    const form = U.el('form', { class: 'dialog-form', novalidate: 'novalidate' });
    form.appendChild(UI.dialogHeader(sale ? 'Editar rascunho' : 'Novo pedido', sale ? sale.number : 'Montar pedido', dialog));
    const body = U.el('div', { class: 'dialog-body' });
    body.appendChild(U.el('div', { class: 'form-error', role: 'alert' }));

    /* ---- cliente, pagamento e recebimento ---- */
    const topGrid = U.el('div', { class: 'form-grid' });
    const clients = state.clients.filter(function (c) {
      return c.active !== false || (sale && c.id === sale.clientId);
    }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    const clientSelect = U.el('select', { name: 'clientId', id: 'sale-client' });
    clientSelect.appendChild(UI.option('', 'Consumidor final', !sale || !sale.clientId));
    clients.forEach(function (c) {
      clientSelect.appendChild(UI.option(c.id, c.nome + (c.phone ? ' · ' + U.formatPhone(c.phone) : ''), sale && sale.clientId === c.id));
    });
    topGrid.appendChild(UI.field('Cliente', clientSelect, { className: 'span-2' }));

    const paymentSelect = U.el('select', { name: 'paymentMethod', id: 'sale-payment' });
    PAYMENTS.forEach(function (p) {
      paymentSelect.appendChild(UI.option(p.value, p.label, sale ? sale.paymentMethod === p.value : p.value === 'pix'));
    });
    topGrid.appendChild(UI.field('Forma de pagamento', paymentSelect));

    const receiptSelect = U.el('select', { name: 'receipt', id: 'sale-receipt' });
    RECEIPTS.forEach(function (r) {
      receiptSelect.appendChild(UI.option(r.value, r.label, sale ? sale.receipt === r.value : r.value === 'agora'));
    });
    topGrid.appendChild(UI.field('Recebimento', receiptSelect));

    const dueInput = U.el('input', { type: 'date', name: 'dueDate', id: 'sale-due', value: sale ? sale.dueDate : '' });
    const dueWrap = UI.field('Vencimento da 1ª parcela', dueInput);
    const instInput = U.el('input', { type: 'number', name: 'installments', id: 'sale-installments', min: '1', max: '12', step: '1', value: sale ? sale.installments : 1 });
    const instWrap = UI.field('Parcelas (mensais)', instInput);
    topGrid.appendChild(dueWrap);
    topGrid.appendChild(instWrap);
    body.appendChild(topGrid);

    function syncReceipt() {
      if (paymentSelect.value === 'fiado') receiptSelect.value = 'prazo';
      receiptSelect.disabled = paymentSelect.value === 'fiado';
      const prazo = receiptSelect.value === 'prazo';
      dueWrap.hidden = !prazo;
      instWrap.hidden = !prazo;
      if (prazo && !dueInput.value) dueInput.value = U.dateOnly(U.addDays(new Date(), 30));
    }
    paymentSelect.addEventListener('change', syncReceipt);
    receiptSelect.addEventListener('change', syncReceipt);

    /* ---- itens ---- */
    const itemSection = U.el('div', { class: 'dialog-section' });
    itemSection.appendChild(U.el('h3', { text: 'Itens do pedido' }));

    const picker = UI.productPicker({
      products: state.products.filter(function (p) { return p.active !== false; }),
      suggestions: DB.topSold(8, state),
      stockOf: function (p) { return DB.stockFor(p.id, state); },
      placeholder: 'Buscar produto por nome ou código…',
      label: 'Buscar produto para adicionar',
      onPick: function (p) {
        const existing = items.find(function (item) { return item.productId === p.id; });
        if (existing) existing.qty += 1;
        else items.push({ productId: p.id, codigo: p.codigo, nome: p.nome, qty: 1, unitPrice: p.price, discount: 0 });
        renderItems();
        picker.focus();
      }
    });
    itemSection.appendChild(picker.el);

    const tableWrap = U.el('div', { class: 'table-wrap', style: { boxShadow: 'none' } });
    const table = U.el('table', { class: 'data-table items-table' });
    table.appendChild(U.el('caption', { class: 'sr-only', text: 'Itens do pedido' }));
    const thead = U.el('thead');
    const headRow = U.el('tr');
    ['Produto', 'Qtd.', 'Preço unit.', 'Desconto', 'Total', ''].forEach(function (label, idx) {
      headRow.appendChild(U.el('th', { scope: 'col', class: idx > 0 && idx < 5 ? 'num' : '', text: label }));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = U.el('tbody');
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    itemSection.appendChild(tableWrap);
    body.appendChild(itemSection);

    const stockNote = U.el('p', { class: 'banner banner-warn', role: 'status', hidden: true });
    itemSection.appendChild(stockNote);

    function renderItems() {
      U.clear(tbody);
      if (!items.length) {
        const tr = U.el('tr');
        const td = U.el('td', { colspan: 6, class: 'table-empty' });
        td.appendChild(U.el('strong', { text: 'Nenhum item no pedido' }));
        td.appendChild(U.el('span', { text: 'Busque um produto acima ou toque em um dos mais vendidos.' }));
        tr.appendChild(td);
        tbody.appendChild(tr);
        updateTotals();
        return;
      }
      items.forEach(function (item, index) {
        const tr = U.el('tr');
        const name = U.el('td');
        name.appendChild(U.el('span', { class: 'strong', text: item.nome }));
        name.appendChild(U.el('span', { class: 'sub', text: item.codigo }));
        tr.appendChild(name);

        const qtyCell = U.el('td', { class: 'num' });
        const qty = U.el('input', { class: 'qty-input', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: item.qty, 'aria-label': 'Quantidade de ' + item.nome });
        qty.addEventListener('change', function () { item.qty = Math.max(1, Math.round(U.toNumber(qty.value, 1))); renderItems(); });
        qtyCell.appendChild(qty);
        tr.appendChild(qtyCell);

        const priceCell = U.el('td', { class: 'num' });
        const price = U.el('input', { class: 'qty-input', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: item.unitPrice, 'aria-label': 'Preço de ' + item.nome, style: { width: '94px' } });
        price.addEventListener('change', function () { item.unitPrice = Math.max(0, U.toNumber(price.value, 0)); renderItems(); });
        priceCell.appendChild(price);
        tr.appendChild(priceCell);

        const discCell = U.el('td', { class: 'num' });
        const disc = U.el('input', { class: 'qty-input', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: item.discount || 0, 'aria-label': 'Desconto de ' + item.nome, style: { width: '88px' } });
        disc.addEventListener('change', function () { item.discount = U.clamp(U.toNumber(disc.value, 0), 0, item.qty * item.unitPrice); renderItems(); });
        discCell.appendChild(disc);
        tr.appendChild(discCell);

        tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney((item.qty * item.unitPrice) - (item.discount || 0)) }));
        const action = U.el('td', { class: 'actions-cell' });
        action.appendChild(U.el('button', {
          class: 'btn btn-danger-ghost btn-sm', type: 'button', 'aria-label': 'Remover ' + item.nome,
          onclick: function () { items.splice(index, 1); renderItems(); }
        }, U.icon('trash')));
        tr.appendChild(action);
        tbody.appendChild(tr);
      });
      updateTotals();
    }

    /* ---- totais ---- */
    const totalSection = U.el('div', { class: 'dialog-section' });
    const totalGrid = U.el('div', { class: 'form-grid' });
    const discountInput = U.el('input', { type: 'number', name: 'orderDiscount', id: 'sale-discount', min: '0', step: '0.01', inputmode: 'decimal', value: sale ? U.round(sale.discount - U.sum(sale.items, function (i) { return i.discount; }), 2) : 0 });
    totalGrid.appendChild(UI.field('Desconto no pedido (R$)', discountInput));
    const notesInput = U.el('textarea', { name: 'notes', id: 'sale-notes', rows: 2, maxlength: 500, value: sale ? sale.notes : '' });
    totalGrid.appendChild(UI.field('Observações', notesInput, { className: 'span-2' }));
    totalSection.appendChild(totalGrid);

    const totalBox = U.el('div', { class: 'total-box' });
    const totalMain = U.el('div');
    totalMain.appendChild(U.el('div', { class: 'field-hint', text: 'Subtotal' }));
    const subtotalEl = U.el('strong', { text: U.fmtMoney(0) });
    totalMain.appendChild(subtotalEl);
    const discountEl = U.el('div', { class: 'field-hint', text: 'Descontos: R$ 0,00' });
    totalMain.appendChild(discountEl);
    totalBox.appendChild(totalMain);
    const totalRight = U.el('div', { style: { textAlign: 'right' } });
    totalRight.appendChild(U.el('div', { class: 'field-hint', text: 'Total do pedido' }));
    const totalEl = U.el('strong', { text: U.fmtMoney(0) });
    totalRight.appendChild(totalEl);
    totalBox.appendChild(totalRight);
    totalSection.appendChild(totalBox);
    body.appendChild(totalSection);

    function updateTotals() {
      const subtotal = U.sum(items, function (i) { return i.unitPrice * i.qty; });
      const itemDiscount = U.sum(items, function (i) { return i.discount || 0; });
      const orderDiscount = Math.max(0, U.toNumber(discountInput.value, 0));
      const discount = itemDiscount + orderDiscount;
      const total = Math.max(0, subtotal - discount);
      subtotalEl.textContent = U.fmtMoney(subtotal);
      discountEl.textContent = 'Descontos: ' + U.fmtMoney(discount);
      totalEl.textContent = U.fmtMoney(total);
      const missing = shortages(items, DB.get());
      stockNote.hidden = !missing.length;
      if (missing.length) stockNote.textContent = 'Sem estoque suficiente: ' + shortageMessage(missing) + '. Ao confirmar, vira encomenda e entra na lista de compras.';
      return { subtotal: U.round(subtotal, 2), discount: U.round(discount, 2), total: U.round(total, 2) };
    }
    discountInput.addEventListener('input', updateTotals);

    form.appendChild(body);
    const cancel = U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { dialog.close(); } }, 'Cancelar');
    const draftButton = U.el('button', { class: 'btn btn-secondary', type: 'submit', 'data-mode': 'draft' }, U.icon('pen'), 'Salvar rascunho');
    const confirmButton = U.el('button', { class: 'btn btn-success', type: 'submit', 'data-mode': 'confirm' }, U.icon('check'), 'Confirmar pedido');
    form.appendChild(UI.dialogFooter([cancel, draftButton, confirmButton]));

    syncReceipt();
    renderItems();

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      UI.clearFormError(form);
      const mode = event.submitter && event.submitter.dataset.mode === 'confirm' ? 'confirm' : 'draft';
      if (!items.length) { UI.formError(form, 'Adicione pelo menos um item ao pedido.'); return; }
      const receipt = paymentSelect.value === 'fiado' ? 'prazo' : receiptSelect.value;
      if (mode === 'confirm' && receipt === 'prazo' && !dueInput.value) {
        UI.invalid(form, 'dueDate', 'Informe o vencimento da primeira parcela.'); return;
      }
      if (mode === 'confirm') {
        const missing = shortages(items, DB.get());
        if (missing.length) {
          const ok = await UI.confirm({
            title: 'Confirmar como encomenda?',
            message: 'Faltam itens no estoque (' + shortageMessage(missing) + '). O pedido será confirmado e o saldo ficará negativo até a compra chegar.',
            confirmLabel: 'Confirmar encomenda', danger: false
          });
          if (!ok) return;
        }
      }

      try {
        const result = DB.tx(function (s) {
          let target = sale ? s.sales.find(function (item) { return item.id === sale.id; }) : null;
          if (sale && (!target || target.status !== 'rascunho')) throw new Error('Este rascunho não está mais disponível para edição.');
          if (!target) {
            target = { id: U.uid('sale'), number: DB.makeNumber(s, 'sale'), createdAt: now(), statusHistory: [], returns: [] };
            s.sales.push(target);
          }
          const snapshotItems = items.map(function (item) {
            const product = s.products.find(function (p) { return p.id === item.productId; });
            if (!product) throw new Error('Um dos produtos do pedido não existe mais.');
            const qty = Math.max(1, Math.round(U.toNumber(item.qty, 1)));
            const unitPrice = Math.max(0, U.toNumber(item.unitPrice, 0));
            const discount = U.clamp(U.toNumber(item.discount, 0), 0, unitPrice * qty);
            return {
              productId: product.id, codigo: product.codigo, nome: product.nome, qty: qty,
              unitPrice: unitPrice, discount: discount, total: U.round((unitPrice * qty) - discount, 2)
            };
          });
          const subtotal = U.round(U.sum(snapshotItems, function (i) { return i.unitPrice * i.qty; }), 2);
          const itemDiscount = U.round(U.sum(snapshotItems, function (i) { return i.discount; }), 2);
          const orderDiscount = Math.max(0, U.toNumber(discountInput.value, 0));
          if (U.round(itemDiscount + orderDiscount, 2) > subtotal) throw new Error('O desconto não pode ser maior que o subtotal.');
          const client = s.clients.find(function (c) { return c.id === clientSelect.value; });

          target.clientId = client ? client.id : null;
          target.clientName = client ? client.nome : 'Consumidor final';
          target.items = snapshotItems;
          target.subtotal = subtotal;
          target.discount = U.round(itemDiscount + orderDiscount, 2);
          target.total = U.round(subtotal - itemDiscount - orderDiscount, 2);
          target.paymentMethod = paymentSelect.value;
          target.receipt = receipt;
          target.installments = receipt === 'prazo' ? Math.max(1, Math.min(12, Math.round(U.toNumber(instInput.value, 1)))) : 1;
          target.dueDate = receipt === 'prazo' ? dueInput.value : '';
          target.notes = U.normalizeText(notesInput.value);
          target.updatedAt = now();

          if (mode === 'draft') {
            target.status = 'rascunho';
            target.statusHistory.push({ status: 'rascunho', at: now() });
          } else {
            applyConfirm(s, target);
          }
          return { sale: target, mode: mode };
        });
        dialog.close();
        UI.toast(result.mode === 'confirm' ? 'Pedido confirmado e estoque atualizado.' : 'Rascunho salvo.');
        M.render();
      } catch (err) {
        UI.formError(form, err.message);
      }
    });

    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  /* ============================== ações ============================== */

  async function confirmSale(id) {
    const state = DB.get();
    const sale = DB.saleById(id, state);
    if (!sale || sale.status !== 'rascunho') return;
    const missing = shortages(sale.items, state);
    const ok = await UI.confirm({
      title: missing.length ? 'Confirmar como encomenda?' : 'Confirmar pedido',
      message: missing.length
        ? 'Faltam itens (' + shortageMessage(missing) + '). O saldo ficará negativo até a compra chegar. Confirmar ' + sale.number + ' (' + U.fmtMoney(sale.total) + ')?'
        : 'Confirmar ' + sale.number + ' no valor de ' + U.fmtMoney(sale.total) + '? O estoque será baixado e o recebimento será lançado no financeiro.',
      confirmLabel: missing.length ? 'Confirmar encomenda' : 'Confirmar pedido',
      danger: false
    });
    if (!ok) return;
    try {
      DB.tx(function (s) {
        const target = s.sales.find(function (item) { return item.id === id; });
        if (!target || target.status !== 'rascunho') throw new Error('Este pedido não está mais em rascunho.');
        if (target.receipt === 'prazo' && !target.dueDate) target.dueDate = U.dateOnly(U.addDays(new Date(), 30));
        applyConfirm(s, target);
      });
      UI.toast('Pedido confirmado e estoque atualizado.');
      M.render();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function advanceSale(id, to) {
    const state = DB.get();
    const sale = DB.saleById(id, state);
    if (!sale || !NEXT[sale.status] || NEXT[sale.status].to !== to) return;
    const pending = pendingEntries(sale, state);
    if (to === 'entregue' && pending.length && sale.receipt === 'entrega') {
      const askPay = await UI.confirm({
        title: 'Entrega com pagamento pendente',
        message: 'O pedido ' + sale.number + ' está marcado para receber na entrega (' + U.fmtMoney(U.sum(pending, function (f) { return f.amount; })) + '). Registrar o recebimento agora?',
        confirmLabel: 'Entregar e receber', danger: false
      });
      try {
        DB.tx(function (s) {
          const target = s.sales.find(function (item) { return item.id === id; });
          if (!target || target.status !== 'enviado') throw new Error('O pedido mudou de situação. Atualize a tela.');
          target.status = 'entregue';
          target.deliveredAt = now();
          target.statusHistory.push({ status: 'entregue', at: now() });
          if (askPay) {
            s.finance.forEach(function (f) {
              if (f.saleId === id && f.type === 'receita' && f.status === 'pendente') {
                f.status = 'pago'; f.paidAt = U.todayISO(); f.updatedAt = now();
              }
            });
          }
        });
        UI.toast(askPay ? 'Pedido entregue e pagamento registrado.' : 'Pedido entregue. O recebimento continua pendente.');
        M.render();
      } catch (err) { UI.toast(err.message, 'error'); }
      return;
    }
    try {
      DB.tx(function (s) {
        const target = s.sales.find(function (item) { return item.id === id; });
        if (!target || NEXT[target.status] === undefined || NEXT[target.status].to !== to) throw new Error('O pedido mudou de situação. Atualize a tela.');
        target.status = to;
        if (to === 'separado') target.separatedAt = now();
        if (to === 'enviado') target.shippedAt = now();
        if (to === 'entregue') target.deliveredAt = now();
        target.statusHistory.push({ status: to, at: now() });
      });
      UI.toast('Pedido ' + sale.number + ': ' + UI.saleStatus(to).label.toLowerCase() + '.');
      M.render();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function receiveSale(id) {
    const state = DB.get();
    const sale = DB.saleById(id, state);
    if (!sale) return;
    const pending = pendingEntries(sale, state).sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    if (!pending.length) { UI.toast('Este pedido não tem valores a receber.', 'info'); return; }
    if (pending.length > 1) { openSaleDetail(id); return; }
    const entry = pending[0];
    const ok = await UI.confirm({
      title: 'Receber pagamento',
      message: 'Registrar o recebimento de ' + U.fmtMoney(entry.amount) + ' do pedido ' + sale.number + ' hoje?',
      confirmLabel: 'Registrar recebimento', danger: false
    });
    if (!ok) return;
    receiveEntry(entry.id);
  }

  function receiveEntry(entryId) {
    try {
      DB.tx(function (s) {
        const f = s.finance.find(function (item) { return item.id === entryId; });
        if (!f || f.status !== 'pendente') throw new Error('Este lançamento não está pendente.');
        f.status = 'pago'; f.paidAt = U.todayISO(); f.updatedAt = now();
      });
      UI.toast('Recebimento registrado.');
      M.render();
      const detail = document.getElementById('detail-dialog');
      if (detail && detail.open && detail.dataset.sale) openSaleDetail(detail.dataset.sale);
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function cancelSale(id) {
    const state = DB.get();
    const sale = DB.saleById(id, state);
    if (!sale || IN_PROGRESS.indexOf(sale.status) === -1) return;
    const ok = await UI.confirm({
      title: 'Cancelar pedido',
      message: 'Cancelar ' + sale.number + '? Os itens voltam ao estoque; parcelas pendentes são canceladas e o que já foi recebido vira um estorno no financeiro.',
      confirmLabel: 'Cancelar pedido'
    });
    if (!ok) return;
    try {
      DB.tx(function (s) {
        const target = s.sales.find(function (item) { return item.id === id; });
        if (!target || IN_PROGRESS.indexOf(target.status) === -1) throw new Error('Este pedido não pode mais ser cancelado.');
        returnToStock(s, target, target.items, 'Estorno');
        settleRefund(s, target, DB.saleNet(target), true, 'pedido cancelado');
        target.status = 'cancelado';
        target.canceledAt = now();
        target.statusHistory.push({ status: 'cancelado', at: now() });
      });
      UI.toast('Pedido cancelado, estoque devolvido e financeiro ajustado.');
      M.render();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function deleteDraft(id) {
    const sale = DB.saleById(id);
    if (!sale || sale.status !== 'rascunho') return;
    const ok = await UI.confirm({
      title: 'Excluir rascunho',
      message: 'Excluir o rascunho ' + sale.number + '? Nenhum estoque ou lançamento será afetado.',
      confirmLabel: 'Excluir rascunho'
    });
    if (!ok) return;
    try {
      DB.tx(function (s) { s.sales = s.sales.filter(function (item) { return item.id !== id; }); });
      UI.toast('Rascunho excluído.');
      M.render();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  /* ============================== devolução ============================== */

  function returnedQty(sale, productId) {
    let total = 0;
    (sale.returns || []).forEach(function (r) {
      (r.items || []).forEach(function (i) { if (i.productId === productId) total += U.toNumber(i.qty, 0); });
    });
    return total;
  }

  function openReturnDialog(id) {
    const sale = DB.saleById(id);
    if (!sale || sale.status !== 'entregue') {
      UI.toast('A devolução vale para pedidos já entregues. Antes disso, use Cancelar.', 'warn');
      return;
    }
    const dialog = document.getElementById('aux-dialog');
    if (!dialog) return;
    U.clear(dialog);

    const itemsTotal = U.sum(sale.items, function (i) { return i.total; });
    const factor = itemsTotal > 0 ? sale.total / itemsTotal : 1;
    const qtys = {};
    const form = U.el('form', { class: 'dialog-form', novalidate: 'novalidate' });
    form.appendChild(UI.dialogHeader('Pós-venda', 'Devolução — ' + sale.number, dialog));
    const body = U.el('div', { class: 'dialog-body' });
    body.appendChild(U.el('div', { class: 'form-error', role: 'alert' }));
    body.appendChild(U.el('p', { class: 'dialog-lead', text: 'Informe quanto de cada item o cliente devolveu. O valor a reembolsar é calculado com o desconto proporcional e pode ser ajustado.' }));

    const wrap = U.el('div', { class: 'table-wrap', style: { boxShadow: 'none' } });
    const table = U.el('table', { class: 'data-table' });
    const head = U.el('tr');
    ['Produto', 'Vendido', 'Devolver'].forEach(function (label, idx) { head.appendChild(U.el('th', { scope: 'col', class: idx ? 'num' : '', text: label })); });
    table.appendChild(U.el('thead', {}, head));
    const tb = U.el('tbody');
    sale.items.forEach(function (item) {
      const max = Math.max(0, item.qty - returnedQty(sale, item.productId));
      qtys[item.productId] = 0;
      const tr = U.el('tr');
      const name = U.el('td');
      name.appendChild(U.el('span', { class: 'strong', text: item.nome }));
      name.appendChild(U.el('span', { class: 'sub', text: item.codigo + (max < item.qty ? ' · já devolvidos ' + (item.qty - max) : '') }));
      tr.appendChild(name);
      tr.appendChild(U.el('td', { class: 'num', text: String(item.qty) }));
      const cell = U.el('td', { class: 'num' });
      const input = U.el('input', { class: 'qty-input', type: 'number', min: '0', max: String(max), step: '1', inputmode: 'numeric', value: 0, disabled: max === 0, 'aria-label': 'Quantidade devolvida de ' + item.nome });
      input.addEventListener('input', function () {
        qtys[item.productId] = U.clamp(Math.round(U.toNumber(input.value, 0)), 0, max);
        recalc();
      });
      cell.appendChild(input);
      tr.appendChild(cell);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    body.appendChild(wrap);

    const grid = U.el('div', { class: 'form-grid' });
    const refundInput = U.el('input', { type: 'number', name: 'refund', min: '0', step: '0.01', inputmode: 'decimal', value: 0 });
    grid.appendChild(UI.field('Valor a reembolsar / abater (R$)', refundInput, { hint: 'Calculado pelos itens; edite se combinou outro valor.' }));
    const reason = U.el('select', { name: 'reason' });
    ['Arrependimento', 'Produto com defeito', 'Troca', 'Erro no pedido', 'Outro'].forEach(function (r) { reason.appendChild(UI.option(r, r)); });
    grid.appendChild(UI.field('Motivo', reason));
    const restockLabel = U.el('label', { class: 'check-field span-2' });
    const restock = U.el('input', { type: 'checkbox', checked: true });
    restockLabel.appendChild(restock);
    restockLabel.appendChild(document.createTextNode(' Devolver os itens ao estoque (desmarque se estiverem inutilizáveis)'));
    grid.appendChild(restockLabel);
    body.appendChild(grid);
    form.appendChild(body);

    function recalc() {
      const value = U.sum(sale.items, function (i) { return (i.total / i.qty) * (qtys[i.productId] || 0); }) * factor;
      refundInput.value = U.round(value, 2);
    }

    const cancel = U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { dialog.close(); } }, 'Fechar');
    const save = U.el('button', { class: 'btn btn-danger', type: 'submit' }, U.icon('rotate'), 'Registrar devolução');
    form.appendChild(UI.dialogFooter([cancel, save]));

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      UI.clearFormError(form);
      const chosen = sale.items.filter(function (i) { return qtys[i.productId] > 0; })
        .map(function (i) { return { productId: i.productId, qty: qtys[i.productId], unitPrice: i.unitPrice }; });
      if (!chosen.length) { UI.formError(form, 'Informe a quantidade devolvida de pelo menos um item.'); return; }
      const refund = U.round(Math.max(0, U.toNumber(refundInput.value, 0)), 2);
      try {
        DB.tx(function (s) {
          const target = s.sales.find(function (item) { return item.id === id; });
          if (!target || target.status !== 'entregue') throw new Error('O pedido mudou de situação.');
          if (refund > DB.saleNet(target) + 0.004) throw new Error('O reembolso não pode ser maior que o valor do pedido (' + U.fmtMoney(DB.saleNet(target)) + ').');
          if (restock.checked) returnToStock(s, target, chosen, 'Devolução');
          settleRefund(s, target, refund, false, 'devolução: ' + reason.value);
          target.returns.push({ at: now(), items: chosen, refund: refund, reason: reason.value, restock: restock.checked });
          const allBack = target.items.every(function (i) { return returnedQty(target, i.productId) >= i.qty; });
          if (allBack) {
            target.status = 'devolvido';
            target.statusHistory.push({ status: 'devolvido', at: now() });
          }
        });
        dialog.close();
        UI.toast('Devolução registrada.');
        M.render();
      } catch (err) { UI.formError(form, err.message); }
    });

    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  /* ============================== resumo, WhatsApp e impressão ============================== */

  function summaryText(sale, state) {
    const store = state.settings.storeName || 'UniHub';
    const lines = [];
    lines.push('*' + store + '* — Pedido ' + sale.number);
    lines.push('Cliente: ' + (sale.clientName || 'Consumidor final'));
    lines.push('');
    sale.items.forEach(function (i) {
      lines.push('• ' + i.qty + 'x ' + i.nome + ' — ' + U.fmtMoney(i.total));
    });
    lines.push('');
    if (sale.discount > 0) lines.push('Desconto: ' + U.fmtMoney(sale.discount));
    lines.push('*Total: ' + U.fmtMoney(sale.total) + '*');
    const pending = pendingEntries(sale, state).sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    lines.push('Pagamento: ' + paymentLabel(sale.paymentMethod) + ' · ' + UI.receiptLabel(sale.receipt).toLowerCase());
    if (pending.length > 1) {
      pending.forEach(function (f) { lines.push('  - ' + U.fmtDate(f.dueDate) + ': ' + U.fmtMoney(f.amount)); });
    } else if (pending.length === 1 && sale.receipt === 'prazo') {
      lines.push('Vencimento: ' + U.fmtDate(pending[0].dueDate));
    }
    if (pending.length && sale.paymentMethod === 'pix' && state.settings.pixKey) {
      lines.push('Chave Pix: ' + state.settings.pixKey);
    }
    if (sale.notes) lines.push('Obs.: ' + sale.notes);
    lines.push('');
    lines.push('Obrigada pela preferência! 💛' + (state.settings.consultant ? ' — ' + state.settings.consultant : ''));
    return lines.join('\n');
  }

  function shareWhatsApp(id) {
    const state = DB.get();
    const sale = DB.saleById(id, state);
    if (!sale) return;
    const client = sale.clientId ? DB.clientById(sale.clientId, state) : null;
    const text = summaryText(sale, state);
    const url = client && client.phone ? U.waLink(client.phone, text) : 'https://wa.me/?text=' + encodeURIComponent(text);
    U.openExternal(url);
  }

  async function copySummary(id) {
    const state = DB.get();
    const sale = DB.saleById(id, state);
    if (!sale) return;
    try {
      await U.copyText(summaryText(sale, state));
      UI.toast('Resumo copiado. É só colar na conversa.');
    } catch (err) { UI.toast('Não foi possível copiar o resumo.', 'error'); }
  }

  /** Imprime em um iframe oculto: funciona no PC e no Android (sem pop-up). */
  function printHtml(title, html) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + U.escapeHtml(title) + '</title><style>' +
      'body{font-family:Arial,sans-serif;color:#111;margin:28px;font-size:13px}h1{font-size:22px;margin:0}h2{font-size:14px;margin:4px 0 20px;color:#666}header{display:flex;justify-content:space-between;border-bottom:2px solid #c8a24a;padding-bottom:12px;margin-bottom:18px}.box{display:flex;gap:30px;margin-bottom:15px}.box div{line-height:1.6}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #ddd;padding:7px 5px;text-align:left}th{background:#f5f5f5;font-size:11px;text-transform:uppercase}.n{text-align:right}.totals{margin-left:auto;width:280px;margin-top:16px}.totals div{display:flex;justify-content:space-between;padding:4px 0}.totals .grand{border-top:2px solid #111;font-size:17px;font-weight:bold;margin-top:4px;padding-top:8px}footer{margin-top:30px;font-size:11px;color:#777;text-align:center}@media print{body{margin:12mm}}' +
      '</style></head><body>' + html + '</body></html>');
    doc.close();
    setTimeout(function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) { UI.toast('Não foi possível abrir a impressão.', 'error'); }
      setTimeout(function () { if (frame.parentNode) frame.parentNode.removeChild(frame); }, 4000);
    }, 250);
  }

  function printSale(id) {
    const state = DB.get();
    const sale = DB.saleById(id, state);
    if (!sale) return;
    const e = U.escapeHtml;
    const rows = sale.items.map(function (item) {
      return '<tr><td>' + e(item.codigo) + '</td><td>' + e(item.nome) + '</td><td class="n">' + Number(item.qty) + '</td><td class="n">' + e(U.fmtMoney(item.unitPrice)) + '</td><td class="n">' + e(U.fmtMoney(item.discount)) + '</td><td class="n">' + e(U.fmtMoney(item.total)) + '</td></tr>';
    }).join('');
    const store = state.settings.storeName || 'UniHub';
    const consultant = state.settings.consultant ? '<div>Consultora: ' + e(state.settings.consultant) + '</div>' : '';
    printHtml(sale.number,
      '<header><div><h1>' + e(store).toUpperCase() + '</h1><h2>Pedido ' + e(sale.number) + '</h2>' + consultant + '</div><div style="text-align:right"><div>' + e(U.fmtDate(sale.createdAt)) + '</div><div>' + e(UI.saleStatus(sale.status).label) + '</div><div>' + e(paymentLabel(sale.paymentMethod)) + '</div></div></header>' +
      '<div class="box"><div><strong>Cliente</strong><br>' + e(sale.clientName) + '</div><div><strong>Vencimento</strong><br>' + (sale.dueDate ? e(U.fmtDate(sale.dueDate)) : '—') + '</div></div>' +
      '<table><thead><tr><th>Código</th><th>Produto</th><th class="n">Qtd.</th><th class="n">Preço</th><th class="n">Desc.</th><th class="n">Total</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="totals"><div><span>Subtotal</span><span>' + e(U.fmtMoney(sale.subtotal)) + '</span></div><div><span>Desconto</span><span>− ' + e(U.fmtMoney(sale.discount)) + '</span></div><div class="grand"><span>Total</span><span>' + e(U.fmtMoney(sale.total)) + '</span></div></div>' +
      (sale.notes ? '<p><strong>Observações:</strong> ' + e(sale.notes) + '</p>' : '') +
      '<footer>' + e(store) + ' · pedido gerado em ' + e(U.fmtDateTime(new Date())) + '</footer>');
  }

  /* ============================== detalhe ============================== */

  function openSaleDetail(id) {
    const state = DB.get();
    const sale = DB.saleById(id, state);
    if (!sale) return;
    const dialog = document.getElementById('detail-dialog');
    if (!dialog) return;
    U.clear(dialog);
    dialog.dataset.sale = id;

    const form = U.el('form', { class: 'dialog-form', method: 'dialog' });
    form.appendChild(UI.dialogHeader('Pedido', sale.number + ' · ' + sale.clientName, dialog));
    const body = U.el('div', { class: 'dialog-body' });

    const statusRow = U.el('div', { class: 'inline-summary', style: { marginBottom: '13px' } });
    statusRow.appendChild(UI.saleBadge(sale.status));
    statusRow.appendChild(U.el('span', { text: 'Criado em ' + U.fmtDateTime(sale.createdAt) }));
    if (sale.confirmedAt) statusRow.appendChild(U.el('span', { text: 'Confirmado em ' + U.fmtDateTime(sale.confirmedAt) }));
    if (sale.deliveredAt) statusRow.appendChild(U.el('span', { text: 'Entregue em ' + U.fmtDateTime(sale.deliveredAt) }));
    body.appendChild(statusRow);

    const grid = U.el('dl', { class: 'detail-grid' });
    function addDetail(label, value) {
      const wrap = U.el('div');
      wrap.appendChild(U.el('dt', { text: label }));
      wrap.appendChild(U.el('dd', { text: value || '—' }));
      grid.appendChild(wrap);
    }
    addDetail('Cliente', sale.clientName);
    addDetail('Pagamento', paymentLabel(sale.paymentMethod) + ' · ' + UI.receiptLabel(sale.receipt));
    addDetail('Subtotal', U.fmtMoney(sale.subtotal));
    addDetail('Desconto', U.fmtMoney(sale.discount));
    addDetail('Total', U.fmtMoney(sale.total));
    if (DB.saleReturned(sale) > 0) addDetail('Devolvido', U.fmtMoney(DB.saleReturned(sale)));
    if (sale.status !== 'rascunho' && sale.status !== 'cancelado') {
      const pr = DB.saleProfit(sale);
      addDetail('Lucro bruto', pr.complete ? U.fmtMoney(pr.profit) + ' (' + (pr.revenue ? Math.round(pr.profit / pr.revenue * 100) : 0) + '%)' : 'custo não informado em algum item');
    }
    if (sale.notes) addDetail('Observações', sale.notes);
    body.appendChild(grid);

    body.appendChild(U.el('h3', { text: 'Itens' }));
    const tableWrap = U.el('div', { class: 'table-wrap', style: { boxShadow: 'none' } });
    const table = U.el('table', { class: 'data-table' });
    table.appendChild(U.el('caption', { class: 'sr-only', text: 'Itens do pedido ' + sale.number }));
    const hr = U.el('tr');
    ['Produto', 'Qtd.', 'Preço', 'Desconto', 'Total'].forEach(function (label, idx) {
      hr.appendChild(U.el('th', { scope: 'col', class: idx ? 'num' : '', text: label }));
    });
    table.appendChild(U.el('thead', {}, hr));
    const tb = U.el('tbody');
    sale.items.forEach(function (item) {
      const tr = U.el('tr');
      const name = U.el('td');
      name.appendChild(U.el('span', { class: 'strong', text: item.nome }));
      name.appendChild(U.el('span', { class: 'sub', text: item.codigo }));
      tr.appendChild(name);
      tr.appendChild(U.el('td', { class: 'num', text: String(item.qty) }));
      tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(item.unitPrice) }));
      tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(item.discount) }));
      tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(item.total) }));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    tableWrap.appendChild(table);
    body.appendChild(tableWrap);

    const fins = DB.financesOfSale(sale.id, state).filter(function (f) { return f.type === 'receita'; })
      .sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    if (fins.length) {
      const section = U.el('div', { class: 'detail-section' });
      section.appendChild(U.el('h3', { text: 'Recebimento' }));
      const list = U.el('ul', { class: 'detail-list' });
      fins.forEach(function (f) {
        const li = U.el('li');
        li.appendChild(U.el('span', { text: (f.installments > 1 ? 'Parcela ' + f.installment + '/' + f.installments + ' · ' : '') + 'vence ' + U.fmtDate(f.dueDate) + ' · ' + U.fmtMoney(f.amount) }));
        const side = U.el('span', { class: 'row-actions' });
        side.appendChild(UI.financeBadge(f.status));
        if (f.status === 'pendente') {
          side.appendChild(U.el('button', {
            class: 'btn btn-success btn-sm', type: 'button',
            onclick: async function () {
              const ok = await UI.confirm({ title: 'Receber pagamento', message: 'Registrar o recebimento de ' + U.fmtMoney(f.amount) + ' hoje?', confirmLabel: 'Registrar', danger: false });
              if (ok) receiveEntry(f.id);
            }
          }, 'Receber'));
        }
        li.appendChild(side);
        list.appendChild(li);
      });
      section.appendChild(list);
      body.appendChild(section);
    }

    if (sale.returns && sale.returns.length) {
      const section = U.el('div', { class: 'detail-section' });
      section.appendChild(U.el('h3', { text: 'Devoluções' }));
      const list = U.el('ul', { class: 'detail-list' });
      sale.returns.forEach(function (r) {
        const li = U.el('li');
        li.appendChild(U.el('span', { text: r.items.reduce(function (t, i) { return t + i.qty; }, 0) + ' item(ns) · ' + r.reason + ' · ' + U.fmtMoney(r.refund) }));
        li.appendChild(U.el('span', { class: 'muted', text: U.fmtDateTime(r.at) }));
        list.appendChild(li);
      });
      section.appendChild(list);
      body.appendChild(section);
    }

    if (sale.statusHistory && sale.statusHistory.length) {
      const hist = U.el('div', { class: 'detail-section' });
      hist.appendChild(U.el('h3', { text: 'Linha do tempo' }));
      const list = U.el('ul', { class: 'detail-list' });
      sale.statusHistory.forEach(function (entry) {
        const li = U.el('li');
        li.appendChild(U.el('span', { text: UI.saleStatus(entry.status).label }));
        li.appendChild(U.el('span', { class: 'muted', text: U.fmtDateTime(entry.at) }));
        list.appendChild(li);
      });
      hist.appendChild(list);
      body.appendChild(hist);
    }

    form.appendChild(body);
    const buttons = [U.el('button', { class: 'btn btn-secondary', type: 'submit', value: 'close' }, 'Fechar')];
    buttons.push(U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { shareWhatsApp(sale.id); } }, U.icon('phone'), 'WhatsApp'));
    buttons.push(U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { copySummary(sale.id); } }, U.icon('copy'), 'Copiar'));
    buttons.push(U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { printSale(sale.id); } }, U.icon('printer'), 'Imprimir'));
    if (sale.status === 'rascunho') {
      buttons.push(U.el('button', { class: 'btn btn-primary', type: 'button', onclick: function () { dialog.close(); openOrderDialog(sale.id); } }, U.icon('pen'), 'Editar'));
      buttons.push(U.el('button', { class: 'btn btn-success', type: 'button', onclick: function () { dialog.close(); confirmSale(sale.id); } }, U.icon('check'), 'Confirmar'));
      buttons.push(U.el('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: function () { dialog.close(); deleteDraft(sale.id); } }, U.icon('trash'), 'Excluir'));
    } else if (NEXT[sale.status]) {
      const next = NEXT[sale.status];
      buttons.push(U.el('button', { class: 'btn btn-success', type: 'button', onclick: function () { dialog.close(); advanceSale(sale.id, next.to); } }, U.icon(next.icon), next.label));
      buttons.push(U.el('button', { class: 'btn btn-danger', type: 'button', onclick: function () { dialog.close(); cancelSale(sale.id); } }, U.icon('x'), 'Cancelar'));
    } else if (sale.status === 'entregue') {
      buttons.push(U.el('button', { class: 'btn btn-danger', type: 'button', onclick: function () { dialog.close(); openReturnDialog(sale.id); } }, U.icon('rotate'), 'Devolução'));
    }
    form.appendChild(UI.dialogFooter(buttons));
    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  /* ============================== lista de separação ============================== */

  function openPickList() {
    const state = DB.get();
    const dialog = document.getElementById('aux-dialog');
    if (!dialog) return;
    U.clear(dialog);
    const orders = state.sales.filter(function (s) { return s.status === 'confirmado' || s.status === 'separado'; })
      .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });

    const form = U.el('form', { class: 'dialog-form', method: 'dialog' });
    form.appendChild(UI.dialogHeader('Operação', 'Lista de separação', dialog));
    const body = U.el('div', { class: 'dialog-body' });

    if (!orders.length) {
      body.appendChild(U.el('p', { class: 'muted', text: 'Nenhum pedido aguardando separação. Pedidos confirmados aparecem aqui.' }));
    } else {
      const toPick = orders.filter(function (s) { return s.status === 'confirmado'; });
      const agg = {};
      toPick.forEach(function (s) {
        s.items.forEach(function (i) {
          if (!agg[i.productId]) agg[i.productId] = { nome: i.nome, codigo: i.codigo, qty: 0 };
          agg[i.productId].qty += i.qty;
        });
      });
      body.appendChild(U.el('h3', { text: 'Pegar no estoque (' + toPick.length + ' pedido(s) a separar)' }));
      const wrap = U.el('div', { class: 'table-wrap', style: { boxShadow: 'none' } });
      const table = U.el('table', { class: 'data-table' });
      const head = U.el('tr');
      ['Produto', 'Qtd.', 'Saldo'].forEach(function (label, idx) { head.appendChild(U.el('th', { scope: 'col', class: idx ? 'num' : '', text: label })); });
      table.appendChild(U.el('thead', {}, head));
      const tb = U.el('tbody');
      Object.keys(agg).sort(function (a, b) { return agg[a].nome.localeCompare(agg[b].nome, 'pt-BR'); }).forEach(function (pid) {
        const row = agg[pid];
        const saldo = DB.stockFor(pid, state);
        const tr = U.el('tr');
        const name = U.el('td');
        name.appendChild(U.el('span', { class: 'strong', text: row.nome }));
        name.appendChild(U.el('span', { class: 'sub', text: row.codigo }));
        tr.appendChild(name);
        tr.appendChild(U.el('td', { class: 'num', text: String(row.qty) }));
        tr.appendChild(U.el('td', { class: 'num' + (saldo < 0 ? ' is-red' : ''), text: String(saldo) }));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      wrap.appendChild(table);
      body.appendChild(wrap);

      body.appendChild(U.el('h3', { text: 'Pedidos' }));
      const list = U.el('ul', { class: 'detail-list' });
      orders.forEach(function (s) {
        const li = U.el('li');
        const main = U.el('span');
        main.appendChild(U.el('strong', { text: s.number + ' · ' + s.clientName }));
        main.appendChild(U.el('small', { class: 'block muted', text: s.items.map(function (i) { return i.qty + 'x ' + U.truncate(i.nome, 26); }).join(' · ') }));
        li.appendChild(main);
        const side = U.el('span', { class: 'row-actions' });
        side.appendChild(UI.saleBadge(s.status));
        if (s.status === 'confirmado') {
          side.appendChild(U.el('button', {
            class: 'btn btn-success btn-sm', type: 'button',
            onclick: function () { dialog.close(); advanceSale(s.id, 'separado'); setTimeout(openPickList, 250); }
          }, 'Separado'));
        }
        li.appendChild(side);
        list.appendChild(li);
      });
      body.appendChild(list);
    }
    form.appendChild(body);
    const close = U.el('button', { class: 'btn btn-secondary', type: 'submit', value: 'close' }, 'Fechar');
    form.appendChild(UI.dialogFooter([close]));
    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  function exportSales() {
    const state = DB.get();
    const rows = state.sales.map(function (sale) {
      const pr = DB.saleProfit(sale);
      return [
        sale.number, U.fmtDate(sale.createdAt), sale.clientName,
        sale.items.map(function (i) { return i.codigo + ' (' + i.qty + ')'; }).join(' | '),
        sale.subtotal, sale.discount, sale.total, DB.saleReturned(sale), paymentLabel(sale.paymentMethod),
        UI.receiptLabel(sale.receipt), UI.saleStatus(sale.status).label,
        sale.confirmedAt ? U.fmtDate(sale.confirmedAt) : '', pr.complete ? pr.profit : '', sale.notes
      ];
    });
    U.download('pedidos.csv', U.toCSV(['Pedido', 'Data', 'Cliente', 'Itens', 'Subtotal', 'Desconto', 'Total', 'Devolvido', 'Pagamento', 'Recebimento', 'Status', 'Confirmado em', 'Lucro bruto', 'Observações'], rows), 'text/csv;charset=utf-8');
  }

  M.openOrderDialog = openOrderDialog;
  M.openSaleDetail = openSaleDetail;
  M.openPickList = openPickList;
  M.setFilter = function (value) {
    S.status = value || '';
    S.page = 1;
    const select = document.getElementById('sale-status-filter');
    if (select) select.value = S.status;
  };
  M.render = function () { renderKpis(); renderSales(); };

  M.init = function () {
    const root = document.getElementById('view-pedidos');
    if (!root) return;
    const newSale = document.getElementById('btn-new-sale');
    if (newSale) newSale.addEventListener('click', function () { openOrderDialog(); });
    const pick = document.getElementById('btn-pick-list');
    if (pick) pick.addEventListener('click', openPickList);
    const search = document.getElementById('sale-search');
    if (search) search.addEventListener('input', U.debounce(function () { S.search = search.value; S.page = 1; renderSales(); }, 180));
    const status = document.getElementById('sale-status-filter');
    if (status) status.addEventListener('change', function () { S.status = status.value; S.page = 1; renderSales(); });
    const exportButton = document.getElementById('btn-export-sales');
    if (exportButton) exportButton.addEventListener('click', exportSales);
  };

  Hub.modules = Hub.modules || {};
  Hub.modules.pedidos = M;
  Hub.printHtml = printHtml;
})(window.Hub = window.Hub || {});
