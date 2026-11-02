/* ==========================================================================
   UniHub V4 — visão geral
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = Hub.utils;
  const DB = Hub.db;
  const UI = Hub.ui;
  const M = {};

  function inMonth(value, key) {
    return value && U.monthKey(value) === key;
  }

  function kpi(icon, label, value, hint, tone) {
    const box = U.el('article', { class: 'kpi' + (tone ? ' is-' + tone : '') });
    const top = U.el('div', { class: 'kpi-top' });
    top.appendChild(U.el('span', { text: label }));
    top.appendChild(U.icon(icon));
    box.appendChild(top);
    box.appendChild(U.el('div', { class: 'kpi-value', text: value }));
    if (hint) box.appendChild(U.el('div', { class: 'kpi-hint', text: hint }));
    return box;
  }

  function listItem(icon, tone, title, subtitle, side, action) {
    const li = U.el('li', { class: 'alert-item' });
    li.appendChild(U.el('span', { class: 'item-icon ' + (tone || ''), 'aria-hidden': 'true' }, U.icon(icon)));
    const main = U.el('div', { class: 'item-main' });
    main.appendChild(U.el('strong', { text: title }));
    if (subtitle) main.appendChild(U.el('small', { text: subtitle }));
    li.appendChild(main);
    if (side) li.appendChild(side);
    if (action) li.appendChild(action);
    return li;
  }

  function renderKpis() {
    const state = DB.get();
    const month = U.currentMonthKey();
    const prev = (function () {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      return U.monthKey(d);
    })();

    const paidIn = state.finance.filter(function (f) {
      return f.type === 'receita' && f.status === 'pago' && inMonth(f.paidAt || f.dueDate, month);
    });
    const paidPrev = state.finance.filter(function (f) {
      return f.type === 'receita' && f.status === 'pago' && inMonth(f.paidAt || f.dueDate, prev);
    });
    const revenue = U.sum(paidIn, function (f) { return f.amount; });
    const revenuePrev = U.sum(paidPrev, function (f) { return f.amount; });
    const receivable = state.finance.filter(function (f) {
      return f.type === 'receita' && f.status === 'pendente';
    });
    const activeClients = state.clients.filter(function (c) { return c.active !== false; });
    const low = state.products.filter(function (p) {
      return p.active !== false && DB.isCritical(DB.stockStatus(p, state));
    });
    const zero = state.products.filter(function (p) {
      if (p.active === false) return false;
      const key = DB.stockStatus(p, state).key;
      return key === 'zerado' || key === 'falta';
    });
    const monthSales = state.sales.filter(function (s) {
      return DB.saleNet(s) > 0 && inMonth(s.confirmedAt || s.createdAt, month);
    });
    const monthProfit = U.sum(monthSales, function (s) { return DB.saleProfit(s).profit; });
    const balance = state.finance.reduce(function (total, f) {
      if (f.status !== 'pago') return total;
      if (f.type === 'receita') return total + Number(f.amount || 0);
      if (f.type === 'despesa') return total - Number(f.amount || 0);
      return total;
    }, 0);

    const diff = revenue - revenuePrev;
    let revenueHint = 'sem base no mês anterior';
    if (revenuePrev > 0) {
      const pct = Math.round((diff / revenuePrev) * 100);
      revenueHint = (pct >= 0 ? '+' : '') + pct + '% vs. mês anterior';
    } else if (revenue > 0) {
      revenueHint = 'primeiro mês com receita paga';
    }

    const grid = document.getElementById('dash-kpis');
    if (!grid) return;
    U.clear(grid);
    grid.appendChild(kpi('wallet', 'Receita do mês', U.fmtMoney(revenue), revenueHint, revenue > 0 ? 'good' : ''));
    grid.appendChild(kpi('down', 'A receber', U.fmtMoney(U.sum(receivable, function (f) { return f.amount; })), receivable.length + ' ' + U.plural(receivable.length, 'conta em aberto', 'contas em aberto'), receivable.length ? 'alert' : ''));
    grid.appendChild(kpi('cart', 'Pedidos do mês', String(monthSales.length), U.fmtMoney(U.sum(monthSales, function (s) { return DB.saleNet(s); })) + ' em vendas · lucro bruto ' + U.fmtMoney(monthProfit)));
    grid.appendChild(kpi('box', 'Estoque baixo', String(low.length), zero.length ? zero.length + ' ' + U.plural(zero.length, 'item zerado', 'itens zerados') : 'nenhum item zerado', low.length ? 'alert' : 'good'));
    grid.appendChild(kpi('users', 'Clientes ativos', String(activeClients.length), state.clients.length + ' cadastrados no total'));
    grid.appendChild(kpi('wallet', 'Saldo realizado', U.fmtMoney(balance), 'receitas pagas menos despesas pagas', balance >= 0 ? 'good' : 'alert'));
  }

  function renderAlerts() {
    const state = DB.get();
    const box = document.getElementById('dash-alerts');
    if (!box) return;
    U.clear(box);
    const list = U.el('ul', { class: 'alert-list' });

    const stock = state.products.map(function (p) {
      return { product: p, status: DB.stockStatus(p, state), saldo: DB.stockFor(p.id, state) };
    }).filter(function (row) {
      return row.product.active !== false && DB.isCritical(row.status);
    }).sort(function (a, b) {
      return a.saldo - b.saldo;
    }).slice(0, 4);

    stock.forEach(function (row) {
      const side = U.el('div', { class: 'item-side' });
      side.appendChild(U.el('span', { class: 'amount ' + (row.saldo <= 0 ? 'is-red' : ''), text: row.saldo + ' un.' }));
      side.appendChild(U.el('small', { text: 'mín. ' + (row.product.minStock || 0) }));
      list.appendChild(listItem('alert', row.saldo <= 0 ? 'is-red' : 'is-amber', row.product.nome,
        row.product.codigo + ' · ' + row.status.label, side));
    });

    const today = U.todayISO();
    const overdue = state.finance.filter(function (f) {
      return f.status === 'pendente' && f.dueDate && f.dueDate < today;
    }).sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); }).slice(0, 3);

    overdue.forEach(function (f) {
      const side = U.el('div', { class: 'item-side' });
      side.appendChild(U.el('span', { class: 'amount ' + (f.type === 'despesa' ? 'is-red' : 'is-green'), text: U.fmtMoney(f.amount) }));
      side.appendChild(U.el('small', { text: U.fmtDate(f.dueDate) }));
      list.appendChild(listItem('calendar', f.type === 'despesa' ? 'is-red' : 'is-amber',
        (f.type === 'despesa' ? 'Pagar: ' : 'Receber: ') + f.description,
        'Venceu em ' + U.fmtDate(f.dueDate), side));
    });

    if (!list.children.length) {
      UI.empty(box, {
        icon: 'check',
        title: 'Tudo em ordem',
        message: 'Nenhum estoque crítico ou conta vencida neste momento.'
      });
      return;
    }
    box.appendChild(list);
  }

  function renderBirthdays() {
    const state = DB.get();
    const box = document.getElementById('dash-birthdays');
    if (!box) return;
    U.clear(box);
    const current = new Date().getMonth();
    const clients = state.clients.filter(function (c) {
      return c.active !== false && U.isBirthdayMonth(c.birthday, current);
    }).sort(function (a, b) {
      return U.parseDate(a.birthday).getDate() - U.parseDate(b.birthday).getDate();
    });

    if (!clients.length) {
      UI.empty(box, {
        icon: 'calendar',
        title: 'Nenhum aniversariante',
        message: 'Cadastre a data de nascimento dos clientes para criar campanhas automáticas.'
      });
      return;
    }

    const list = U.el('ul', { class: 'birthday-list' });
    clients.forEach(function (client) {
      const day = U.parseDate(client.birthday).getDate();
      const side = U.el('div', { class: 'item-side' });
      side.appendChild(U.el('span', { class: 'amount', text: String(day).padStart(2, '0') + '/' + String(current + 1).padStart(2, '0') }));
      if (client.phone) {
        side.appendChild(U.el('a', {
          class: 'mini-link', href: U.waLink(client.phone, 'Oi, ' + client.nome.split(' ')[0] + '! Seu mês é especial. Preparei um mimo para você em ' + (state.settings.storeName || 'UniHub') + '. 💛'),
          target: '_blank', rel: 'noopener noreferrer', text: 'WhatsApp'
        }));
      }
      list.appendChild(listItem('users', 'is-gold', client.nome,
        client.phone ? U.formatPhone(client.phone) : 'sem telefone', side));
    });
    box.appendChild(list);
  }

  function renderActivity() {
    const state = DB.get();
    const box = document.getElementById('dash-activity');
    if (!box) return;
    U.clear(box);
    const sales = state.sales.slice(-30).map(function (sale) {
      return {
        at: sale.confirmedAt || sale.createdAt,
        icon: 'cart',
        tone: (sale.status === 'cancelado' || sale.status === 'devolvido') ? 'is-red' : 'is-green',
        title: sale.number + ' · ' + sale.clientName,
        subtitle: UI.saleStatus(sale.status).label + ' · ' + U.fmtDateTime(sale.confirmedAt || sale.createdAt),
        side: U.fmtMoney(sale.total)
      };
    });
    const MOVE_LABEL = { entrada: 'Entrada: ', saida: 'Saída: ', ajuste: 'Ajuste: ', devolucao: 'Devolução: ' };
    const movements = state.movements.slice(-30).map(function (m) {
      const p = DB.productById(m.productId, state);
      return {
        at: m.createdAt,
        icon: m.type === 'saida' ? 'down' : 'up',
        tone: m.type === 'saida' ? 'is-amber' : 'is-green',
        title: (MOVE_LABEL[m.type] || 'Movimento: ') + (p ? p.nome : 'Produto removido'),
        subtitle: m.quantity + ' un. · ' + U.fmtDateTime(m.createdAt),
        side: p ? p.codigo : ''
      };
    });
    const recent = sales.concat(movements).sort(function (a, b) {
      return String(b.at).localeCompare(String(a.at));
    }).slice(0, 7);

    if (!recent.length) {
      UI.empty(box, {
        icon: 'clock',
        title: 'Sem movimentação recente',
        message: 'Crie um pedido ou registre uma entrada para começar.'
      });
      return;
    }

    const list = U.el('ul', { class: 'activity-list' });
    recent.forEach(function (item) {
      const side = U.el('div', { class: 'item-side' });
      side.appendChild(U.el('span', { class: 'amount', text: item.side || '' }));
      list.appendChild(listItem(item.icon, item.tone, item.title, item.subtitle, side));
    });
    box.appendChild(list);
  }

  function renderPipeline() {
    const state = DB.get();
    const box = document.getElementById('dash-pipeline');
    if (!box) return;
    U.clear(box);
    const count = function (status) { return state.sales.filter(function (s) { return s.status === status; }).length; };
    const receivable = state.finance.filter(function (f) { return f.type === 'receita' && f.status === 'pendente' && f.saleId; });
    const orders = state.products.filter(function (p) { return p.active !== false && DB.stockStatus(p, state).key === 'falta'; }).length;
    const steps = [
      { label: 'Rascunhos', value: count('rascunho'), filter: 'rascunho', icon: 'pen', hint: 'aguardando confirmação' },
      { label: 'A separar', value: count('confirmado'), filter: 'confirmado', icon: 'package', hint: 'pedidos confirmados' },
      { label: 'A enviar', value: count('separado'), filter: 'separado', icon: 'box', hint: 'já separados' },
      { label: 'A caminho', value: count('enviado'), filter: 'enviado', icon: 'external', hint: 'aguardando entrega' },
      { label: 'A receber', value: receivable.length, filter: 'receber', icon: 'wallet', hint: U.fmtMoney(U.sum(receivable, function (f) { return f.amount; })) },
      { label: 'A comprar', value: orders, filter: '', icon: 'cart', hint: 'itens vendidos sem estoque', go: 'estoque' }
    ];
    const row = U.el('div', { class: 'pipeline' });
    steps.forEach(function (step) {
      const tile = U.el('button', {
        class: 'pipe-step' + (step.value ? ' has-items' : ''), type: 'button',
        dataset: { filter: step.filter, go: step.go || 'pedidos' },
        title: 'Abrir: ' + step.label
      });
      tile.appendChild(U.icon(step.icon));
      tile.appendChild(U.el('strong', { text: String(step.value) }));
      tile.appendChild(U.el('span', { text: step.label }));
      tile.appendChild(U.el('small', { text: step.hint }));
      row.appendChild(tile);
    });
    box.appendChild(row);
  }

  M.render = function () {
    renderPipeline();
    renderKpis();
    renderAlerts();
    renderBirthdays();
    renderActivity();
  };

  M.init = function () {
    const hero = document.getElementById('view-dashboard');
    if (!hero) return;
    hero.addEventListener('click', function (event) {
      const pipe = event.target.closest('.pipe-step');
      if (pipe) {
        if (pipe.dataset.go === 'estoque') {
          Hub.app.navigate('estoque');
          setTimeout(function () { Hub.modules.estoque.showTab('saldo'); }, 30);
        } else {
          Hub.modules.pedidos.setFilter(pipe.dataset.filter);
          Hub.app.navigate('pedidos');
        }
        return;
      }
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'new-sale') {
        Hub.app.navigate('pedidos');
        setTimeout(function () { Hub.modules.pedidos.openOrderDialog(); }, 30);
      } else if (action === 'new-entry') {
        Hub.app.navigate('estoque');
        setTimeout(function () { Hub.modules.estoque.showTab('entradas'); Hub.modules.estoque.openEntryDialog(); }, 30);
      } else if (action === 'new-client') {
        Hub.app.navigate('clientes');
        setTimeout(function () { Hub.modules.clientes.openClientDialog(); }, 30);
      } else if (action === 'go-estoque') {
        Hub.app.navigate('estoque');
        setTimeout(function () { Hub.modules.estoque.showTab('saldo'); }, 30);
      } else if (action === 'go-clientes') {
        Hub.app.navigate('clientes');
      } else if (action === 'go-pedidos') {
        Hub.app.navigate('pedidos');
      }
    });
  };

  Hub.modules = Hub.modules || {};
  Hub.modules.dashboard = M;
})(window.Hub = window.Hub || {});
