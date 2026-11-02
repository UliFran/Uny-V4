/* ==========================================================================
   UniHub V4 — módulo Clientes & Campanhas
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = Hub.utils;
  const DB = Hub.db;
  const UI = Hub.ui;
  const M = {};
  const PER_PAGE = 15;

  const S = {
    tab: 'clients',
    search: '',
    tag: '',
    status: 'ativos',
    page: 1,
    campaignSearch: '',
    editingClient: null
  };

  let activateTab = function () {};

  function norm(value) { return U.normalizeText(value).toLowerCase(); }
  function firstName(name) { return U.normalizeText(name).split(' ')[0] || name; }

  function allTags(state) {
    return U.unique(state.clients.reduce(function (acc, client) {
      return acc.concat(Array.isArray(client.tags) ? client.tags : []);
    }, [])).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  function populateTagFilter() {
    const state = DB.get();
    const select = document.getElementById('client-tag-filter');
    if (!select) return;
    const current = S.tag;
    U.clear(select);
    select.appendChild(UI.option('', 'Todas as etiquetas', !current));
    allTags(state).forEach(function (tag) {
      select.appendChild(UI.option(tag, tag, current === tag));
    });
    select.value = current;
  }

  function renderKpis() {
    const state = DB.get();
    const box = document.getElementById('client-kpis');
    if (!box) return;
    const active = state.clients.filter(function (c) { return c.active !== false; });
    const birthdays = active.filter(function (c) { return U.isBirthdayMonth(c.birthday); });
    const new30 = state.clients.filter(function (c) {
      return U.daysBetween(c.createdAt, new Date()) <= 30;
    });
    const withOrders = active.filter(function (c) { return DB.clientStats(c.id, state).count > 0; });

    function kpi(label, value, hint, tone) {
      const el = U.el('article', { class: 'kpi' + (tone ? ' is-' + tone : '') });
      const top = U.el('div', { class: 'kpi-top' });
      top.appendChild(U.el('span', { text: label }));
      top.appendChild(U.icon('users'));
      el.appendChild(top);
      el.appendChild(U.el('div', { class: 'kpi-value', text: value }));
      if (hint) el.appendChild(U.el('div', { class: 'kpi-hint', text: hint }));
      return el;
    }

    U.clear(box);
    box.appendChild(kpi('Clientes ativos', String(active.length), state.clients.length + ' no total'));
    box.appendChild(kpi('Aniversariantes', String(birthdays.length), 'no mês atual', birthdays.length ? 'good' : ''));
    box.appendChild(kpi('Compradores', String(withOrders.length), 'com ao menos um pedido'));
    box.appendChild(kpi('Novos em 30 dias', String(new30.length), 'cadastros recentes'));
  }

  function renderClients() {
    const state = DB.get();
    const tbody = document.querySelector('#clients-table tbody');
    if (!tbody) return;
    U.clear(tbody);
    const term = norm(S.search);
    const list = state.clients.filter(function (client) {
      if (S.status === 'ativos' && client.active === false) return false;
      if (S.status === 'inativos' && client.active !== false) return false;
      if (S.tag && (!Array.isArray(client.tags) || client.tags.indexOf(S.tag) === -1)) return false;
      if (!term) return true;
      const haystack = [client.nome, client.phone, client.email, client.city, client.notes, (client.tags || []).join(' ')].join(' ').toLowerCase();
      return haystack.indexOf(term) > -1;
    }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });

    S.page = Math.min(S.page, UI.pages(list.length, PER_PAGE));
    const rows = UI.slice(list, S.page, PER_PAGE);

    if (!rows.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 7, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: state.clients.length ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado' }));
      td.appendChild(U.el('span', { text: state.clients.length ? 'Ajuste a busca ou os filtros.' : 'Cadastre o primeiro cliente para começar.' }));
      if (!state.clients.length) {
        td.appendChild(U.el('button', {
          class: 'btn btn-primary btn-sm', type: 'button', onclick: function () { openClientDialog(); }
        }, U.icon('plus'), 'Novo cliente'));
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      rows.forEach(function (client) {
        const stats = DB.clientStats(client.id, state);
        const tr = U.el('tr', { class: client.active === false ? 'is-inactive' : '' });
        const nameCell = U.el('td');
        const nameWrap = U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
        nameWrap.appendChild(UI.avatar(client.nome, 'is-gold'));
        const names = U.el('div');
        names.appendChild(U.el('span', { class: 'strong', text: client.nome }));
        if (client.tags && client.tags.length) {
          const tags = U.el('div', { class: 'tag-list', style: { marginTop: '2px' } });
          client.tags.slice(0, 3).forEach(function (tag) { tags.appendChild(U.el('span', { class: 'tag', text: tag })); });
          if (client.tags.length > 3) tags.appendChild(U.el('span', { class: 'tag', text: '+' + (client.tags.length - 3) }));
          names.appendChild(tags);
        } else if (client.active === false) {
          names.appendChild(U.el('span', { class: 'sub', text: 'Inativo' }));
        }
        nameWrap.appendChild(names);
        nameCell.appendChild(nameWrap);
        tr.appendChild(nameCell);

        const contact = U.el('td');
        contact.appendChild(U.el('span', { text: client.phone ? U.formatPhone(client.phone) : '—' }));
        if (client.email) contact.appendChild(U.el('span', { class: 'sub', text: client.email }));
        tr.appendChild(contact);
        tr.appendChild(U.el('td', { text: client.city || '—' }));
        tr.appendChild(U.el('td', { class: 'nowrap', text: client.birthday ? U.fmtDateShort(client.birthday) : '—' }));
        tr.appendChild(U.el('td', { class: 'num', text: String(stats.count) }));
        tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(stats.total) }));

        const actions = U.el('td', { class: 'actions-cell' });
        actions.appendChild(U.el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', title: 'Ver histórico', 'aria-label': 'Ver histórico de ' + client.nome,
          onclick: function () { openClientDetail(client.id); }
        }, U.icon('eye')));
        actions.appendChild(U.el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', title: 'Editar cliente', 'aria-label': 'Editar ' + client.nome,
          onclick: function () { openClientDialog(client.id); }
        }, U.icon('pen')));
        if (client.phone) {
          const message = 'Oi, ' + firstName(client.nome) + '! Tudo bem? Aqui é ' + (state.settings.consultant || state.settings.storeName || 'do UniHub') + '. 💛';
          actions.appendChild(U.el('a', {
            class: 'btn btn-ghost btn-sm', href: U.waLink(client.phone, message), target: '_blank', rel: 'noopener noreferrer',
            title: 'Abrir WhatsApp', 'aria-label': 'Abrir WhatsApp de ' + client.nome
          }, U.icon('phone')));
        }
        actions.appendChild(U.el('button', {
          class: 'btn btn-danger-ghost btn-sm', type: 'button', title: 'Excluir cliente', 'aria-label': 'Excluir ' + client.nome,
          onclick: function () { deleteClient(client.id); }
        }, U.icon('trash')));
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });
    }

    UI.pagination(document.getElementById('clients-pagination'), {
      page: S.page, pages: UI.pages(list.length, PER_PAGE), total: list.length, pageSize: PER_PAGE,
      onChange: function (page) { S.page = page; renderClients(); }
    });
  }

  function openClientDialog(id) {
    const state = DB.get();
    const client = id ? state.clients.find(function (c) { return c.id === id; }) : null;
    const dialog = document.getElementById('client-dialog');
    if (!dialog) return;
    U.clear(dialog);
    S.editingClient = client ? client.id : null;

    const form = U.el('form', { class: 'dialog-form', id: 'client-form', novalidate: 'novalidate' });
    form.appendChild(UI.dialogHeader(client ? 'Editar cliente' : 'Novo cliente', client ? client.nome : 'Cadastrar cliente', dialog));
    const body = U.el('div', { class: 'dialog-body' });
    body.appendChild(U.el('div', { class: 'form-error', role: 'alert' }));
    const grid = U.el('div', { class: 'form-grid' });

    function input(name, type, value, attrs) {
      return U.el('input', Object.assign({
        type: type, name: name, id: 'cf-' + name, value: value === null || value === undefined ? '' : value
      }, attrs || {}));
    }

    grid.appendChild(UI.field('Nome completo *', input('nome', 'text', client ? client.nome : '', { maxlength: 100, required: true, autocomplete: 'name' }), { className: 'span-2' }));
    grid.appendChild(UI.field('Telefone / WhatsApp', input('phone', 'tel', client ? client.phone : '', { maxlength: 20, placeholder: '(11) 99999-9999', autocomplete: 'tel' })));
    grid.appendChild(UI.field('E-mail', input('email', 'email', client ? client.email : '', { maxlength: 120, placeholder: 'cliente@email.com', autocomplete: 'email' })));
    grid.appendChild(UI.field('Aniversário', input('birthday', 'date', client ? client.birthday : '')));
    grid.appendChild(UI.field('Cidade', input('city', 'text', client ? client.city : '', { maxlength: 80, autocomplete: 'address-level2' })));
    grid.appendChild(UI.field('Etiquetas', input('tags', 'text', client ? (client.tags || []).join(', ') : '', { maxlength: 160, placeholder: 'VIP, Perfumaria, Presentes' }), { className: 'span-2', hint: 'Separe por vírgula. As etiquetas ajudam a filtrar e criar campanhas.' }));
    grid.appendChild(UI.field('Observações', U.el('textarea', { name: 'notes', id: 'cf-notes', rows: 3, maxlength: 500, value: client ? client.notes : '' }), { className: 'span-2' }));
    const activeWrap = U.el('label', { class: 'check-field' });
    activeWrap.appendChild(U.el('input', { type: 'checkbox', name: 'active', checked: !client || client.active !== false }));
    activeWrap.appendChild(document.createTextNode('Cliente ativo'));
    grid.appendChild(activeWrap);

    body.appendChild(grid);
    form.appendChild(body);
    const cancel = U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { dialog.close(); } }, 'Cancelar');
    const save = U.el('button', { class: 'btn btn-primary', type: 'submit' }, U.icon('check'), client ? 'Salvar alterações' : 'Cadastrar cliente');
    form.appendChild(UI.dialogFooter([cancel, save]));

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      UI.clearFormError(form);
      const data = UI.formData(form);
      const name = U.normalizeText(data.nome);
      if (!name) { UI.invalid(form, 'nome', 'Informe o nome do cliente.'); return; }
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        UI.invalid(form, 'email', 'Informe um e-mail válido.'); return;
      }
      const tags = U.unique(String(data.tags || '').split(',').map(U.normalizeText).filter(Boolean));
      const digits = U.phoneDigits(data.phone);
      if (digits.length >= 8) {
        const twin = DB.get().clients.find(function (c) {
          return (!client || c.id !== client.id) && U.phoneDigits(c.phone).slice(-8) === digits.slice(-8);
        });
        if (twin && !form.dataset.dupAck) {
          UI.formError(form, 'O telefone já está cadastrado para "' + twin.nome + '". Se for outra pessoa, salve novamente para confirmar.');
          form.dataset.dupAck = '1';
          return;
        }
      }
      try {
        DB.tx(function (s) {
          let target = client ? s.clients.find(function (c) { return c.id === client.id; }) : null;
          if (client && !target) throw new Error('Cliente não encontrado. Recarregue a página.');
          if (!target) {
            target = { id: U.uid('cli'), createdAt: U.nowISO() };
            s.clients.push(target);
          }
          target.nome = name;
          target.phone = U.normalizeText(data.phone);
          target.email = U.normalizeText(data.email);
          target.birthday = data.birthday || '';
          target.city = U.normalizeText(data.city);
          target.tags = tags;
          target.notes = U.normalizeText(data.notes);
          target.active = data.active === true;
          target.updatedAt = U.nowISO();
        });
        dialog.close();
        UI.toast(client ? 'Cliente atualizado.' : 'Cliente cadastrado.');
        populateTagFilter();
        renderClients();
        renderKpis();
      } catch (err) {
        UI.formError(form, err.message);
      }
    });

    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  function openClientDetail(id) {
    const state = DB.get();
    const client = state.clients.find(function (c) { return c.id === id; });
    if (!client) return;
    const stats = DB.clientStats(client.id, state);
    const dialog = document.getElementById('detail-dialog');
    if (!dialog) return;
    U.clear(dialog);

    const form = U.el('form', { class: 'dialog-form', method: 'dialog' });
    form.appendChild(UI.dialogHeader('Cliente', client.nome, dialog));
    const body = U.el('div', { class: 'dialog-body' });

    const grid = U.el('dl', { class: 'detail-grid' });
    function addDetail(label, value, span) {
      const wrap = U.el('div', { class: span ? 'span-2' : '' });
      wrap.appendChild(U.el('dt', { text: label }));
      wrap.appendChild(U.el('dd', { text: value || '—' }));
      grid.appendChild(wrap);
    }
    addDetail('Telefone', client.phone ? U.formatPhone(client.phone) : '—');
    addDetail('E-mail', client.email);
    addDetail('Aniversário', client.birthday ? U.fmtDate(client.birthday) : '—');
    addDetail('Cidade', client.city);
    addDetail('Situação', client.active === false ? 'Inativo' : 'Ativo');
    addDetail('Etiquetas', (client.tags || []).join(', ') || '—');
    addDetail('Observações', client.notes, true);
    body.appendChild(grid);

    const statsBox = U.el('div', { class: 'import-summary' });
    [['Compras', String(stats.count)], ['Total gasto', U.fmtMoney(stats.total)], ['Última compra', stats.lastAt ? U.fmtDate(stats.lastAt) : '—']].forEach(function (item) {
      const box = U.el('div', { class: 'import-stat' });
      box.appendChild(U.el('strong', { text: item[1] }));
      box.appendChild(U.el('span', { text: item[0] }));
      statsBox.appendChild(box);
    });
    body.appendChild(statsBox);

    const orders = state.sales.filter(function (s) {
      return s.clientId === client.id && s.status !== 'rascunho' && s.status !== 'cancelado';
    }).sort(function (a, b) { return String(b.confirmedAt || b.createdAt).localeCompare(String(a.confirmedAt || a.createdAt)); });

    const section = U.el('div', { class: 'detail-section' });
    section.appendChild(U.el('h3', { text: 'Histórico de compras' }));
    if (!orders.length) {
      section.appendChild(U.el('p', { class: 'muted small', text: 'Nenhuma compra confirmada para este cliente.' }));
    } else {
      const list = U.el('ul', { class: 'detail-list' });
      orders.forEach(function (sale) {
        const li = U.el('li');
        li.appendChild(U.el('span', {}, U.el('strong', { text: sale.number }), ' · ' + U.fmtDate(sale.confirmedAt || sale.createdAt)));
        li.appendChild(U.el('span', {}, U.fmtMoney(sale.total), ' ', UI.saleBadge(sale.status)));
        list.appendChild(li);
      });
      section.appendChild(list);
    }
    body.appendChild(section);
    form.appendChild(body);

    const close = U.el('button', { class: 'btn btn-secondary', type: 'submit', value: 'close' }, 'Fechar');
    const edit = U.el('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: function () { dialog.close(); openClientDialog(client.id); }
    }, U.icon('pen'), 'Editar cliente');
    const left = U.el('div');
    if (client.phone) {
      left.appendChild(U.el('a', {
        class: 'btn btn-secondary', href: U.waLink(client.phone, 'Oi, ' + firstName(client.nome) + '! Tudo bem? Aqui é ' + (state.settings.consultant || state.settings.storeName || 'do UniHub') + '. 💛'),
        target: '_blank', rel: 'noopener noreferrer'
      }, U.icon('phone'), 'WhatsApp'));
    }
    form.appendChild(UI.dialogFooter([close, edit], left));
    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  async function deleteClient(id) {
    const state = DB.get();
    const client = state.clients.find(function (c) { return c.id === id; });
    if (!client) return;
    const hasSales = state.sales.some(function (s) { return s.clientId === id; });
    if (hasSales) {
      const ok = await UI.confirm({
        title: 'Cliente com histórico',
        message: 'Este cliente possui pedidos e não pode ser excluído sem perder o histórico. Deseja inativá-lo?',
        confirmLabel: 'Inativar cliente',
        danger: false
      });
      if (!ok) return;
      try {
        DB.tx(function (s) {
          const target = s.clients.find(function (c) { return c.id === id; });
          if (target) { target.active = false; target.updatedAt = U.nowISO(); }
        });
        UI.toast('Cliente inativado. O histórico foi preservado.');
        renderClients();
        renderKpis();
      } catch (err) { UI.toast(err.message, 'error'); }
      return;
    }
    const ok = await UI.confirm({
      title: 'Excluir cliente',
      message: 'Excluir "' + client.nome + '"? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir'
    });
    if (!ok) return;
    try {
      DB.tx(function (s) { s.clients = s.clients.filter(function (c) { return c.id !== id; }); });
      UI.toast('Cliente excluído.');
      populateTagFilter();
      renderClients();
      renderKpis();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  /* ============================== campanhas ============================== */

  const AUDIENCE = {
    all: 'Todos os clientes ativos',
    birthday: 'Aniversariantes do mês',
    inactive: 'Sem comprar há 90 dias',
    tag: 'Clientes com etiqueta'
  };

  function campaignRecipients(campaign, state) {
    const active = state.clients.filter(function (c) { return c.active !== false; });
    if (campaign.audience === 'birthday') {
      return active.filter(function (c) { return U.isBirthdayMonth(c.birthday); });
    }
    if (campaign.audience === 'inactive') {
      return active.filter(function (c) {
        // Só entram clientes que já compraram e estão há 90 dias ou mais sem comprar.
        const stats = DB.clientStats(c.id, state);
        return Boolean(stats.lastAt) && U.daysBetween(stats.lastAt, new Date()) >= 90;
      });
    }
    if (campaign.audience === 'tag') {
      return active.filter(function (c) { return (c.tags || []).indexOf(campaign.tag) > -1; });
    }
    return active;
  }

  function personalize(message, client) {
    return String(message || '')
      .replace(/\{nome\}/gi, client.nome)
      .replace(/\{primeiro_nome\}/gi, firstName(client.nome))
      .replace(/\{cidade\}/gi, client.city || '');
  }

  function campaignLabel(campaign) {
    return AUDIENCE[campaign.audience] + (campaign.audience === 'tag' && campaign.tag ? ': ' + campaign.tag : '');
  }

  function renderCampaigns() {
    const state = DB.get();
    const tbody = document.querySelector('#campaigns-table tbody');
    if (!tbody) return;
    U.clear(tbody);
    const term = norm(S.campaignSearch);
    const list = state.campaigns.filter(function (campaign) {
      return !term || norm(campaign.name + ' ' + campaign.message + ' ' + campaignLabel(campaign)).indexOf(term) > -1;
    }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

    if (!list.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 5, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: state.campaigns.length ? 'Nenhuma campanha encontrada' : 'Nenhuma campanha criada' }));
      td.appendChild(U.el('span', { text: 'Crie mensagens para aniversariantes, clientes inativos ou etiquetas.' }));
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    list.forEach(function (campaign) {
      const recipients = campaignRecipients(campaign, state);
      const tr = U.el('tr');
      tr.appendChild(U.el('td', {}, U.el('span', { class: 'strong', text: campaign.name })));
      tr.appendChild(U.el('td', { text: campaignLabel(campaign) }));
      tr.appendChild(U.el('td', { class: 'num', text: String(recipients.length) }));
      tr.appendChild(U.el('td', { class: 'nowrap', text: U.fmtDate(campaign.createdAt) }));
      const actions = U.el('td', { class: 'actions-cell' });
      actions.appendChild(U.el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', title: 'Abrir campanha', 'aria-label': 'Abrir campanha ' + campaign.name,
        onclick: function () { openCampaignDetail(campaign.id); }
      }, U.icon('eye')));
      actions.appendChild(U.el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', title: 'Editar campanha', 'aria-label': 'Editar campanha ' + campaign.name,
        onclick: function () { openCampaignDialog(campaign.id); }
      }, U.icon('pen')));
      actions.appendChild(U.el('button', {
        class: 'btn btn-danger-ghost btn-sm', type: 'button', title: 'Excluir campanha', 'aria-label': 'Excluir campanha ' + campaign.name,
        onclick: function () { deleteCampaign(campaign.id); }
      }, U.icon('trash')));
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
  }

  function openCampaignDialog(id) {
    const state = DB.get();
    const campaign = id ? state.campaigns.find(function (c) { return c.id === id; }) : null;
    const dialog = document.getElementById('campaign-dialog');
    if (!dialog) return;
    U.clear(dialog);

    const form = U.el('form', { class: 'dialog-form', novalidate: 'novalidate' });
    form.appendChild(UI.dialogHeader(campaign ? 'Editar campanha' : 'Nova campanha', campaign ? campaign.name : 'Criar campanha', dialog));
    const body = U.el('div', { class: 'dialog-body' });
    body.appendChild(U.el('div', { class: 'form-error', role: 'alert' }));
    body.appendChild(U.el('p', { class: 'dialog-lead', text: 'A campanha não envia mensagens automaticamente. Ela organiza o público e gera links individuais de WhatsApp.' }));
    const grid = U.el('div', { class: 'form-grid' });

    const nameInput = U.el('input', { type: 'text', name: 'name', id: 'camp-name', maxlength: 100, required: true, value: campaign ? campaign.name : '', placeholder: 'Ex.: Aniversariantes de outubro' });
    grid.appendChild(UI.field('Nome da campanha *', nameInput, { className: 'span-2' }));
    const audienceSelect = U.el('select', { name: 'audience', id: 'camp-audience' });
    Object.keys(AUDIENCE).forEach(function (key) {
      audienceSelect.appendChild(UI.option(key, AUDIENCE[key], campaign && campaign.audience === key));
    });
    grid.appendChild(UI.field('Público', audienceSelect));
    const tagWrap = UI.field('Etiqueta', (function () {
      const select = U.el('select', { name: 'tag', id: 'camp-tag' });
      select.appendChild(UI.option('', 'Selecione uma etiqueta'));
      allTags(state).forEach(function (tag) { select.appendChild(UI.option(tag, tag, campaign && campaign.tag === tag)); });
      return select;
    })());
    tagWrap.hidden = !campaign || campaign.audience !== 'tag';
    grid.appendChild(tagWrap);
    const messageArea = U.el('textarea', { name: 'message', id: 'camp-message', rows: 5, maxlength: 1000, required: true, placeholder: 'Oi, {primeiro_nome}! …' }, campaign ? campaign.message : 'Oi, {primeiro_nome}! Seu mês é especial e preparei um mimo para você. 💛');
    grid.appendChild(UI.field('Mensagem *', messageArea, { className: 'span-2', hint: 'Variáveis: {nome}, {primeiro_nome}, {cidade}.' }));

    const preview = U.el('div', { class: 'banner', style: { display: 'block' } });
    grid.appendChild(preview);
    body.appendChild(grid);

    function updatePreview() {
      const draft = {
        audience: audienceSelect.value,
        tag: form.elements.tag ? form.elements.tag.value : ''
      };
      const recipients = campaignRecipients(draft, DB.get());
      const first = recipients[0];
      preview.textContent = recipients.length + ' ' + U.plural(recipients.length, 'pessoa', 'pessoas') + ' no público.' +
        (first ? ' Prévia para ' + first.nome + ': “' + U.truncate(personalize(messageArea.value, first), 180) + '”' : ' Cadastre clientes ou ajuste o público.');
    }
    audienceSelect.addEventListener('change', function () {
      tagWrap.hidden = audienceSelect.value !== 'tag';
      updatePreview();
    });
    messageArea.addEventListener('input', U.debounce(updatePreview, 150));
    updatePreview();

    form.appendChild(body);
    const cancel = U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { dialog.close(); } }, 'Cancelar');
    const save = U.el('button', { class: 'btn btn-primary', type: 'submit' }, U.icon('check'), campaign ? 'Salvar campanha' : 'Criar campanha');
    form.appendChild(UI.dialogFooter([cancel, save]));

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      UI.clearFormError(form);
      const data = UI.formData(form);
      if (!U.normalizeText(data.name)) { UI.invalid(form, 'name', 'Informe o nome da campanha.'); return; }
      if (!U.normalizeText(data.message)) { UI.invalid(form, 'message', 'Escreva a mensagem da campanha.'); return; }
      if (data.audience === 'tag' && !data.tag) { UI.invalid(form, 'tag', 'Selecione a etiqueta do público.'); return; }
      try {
        DB.tx(function (s) {
          let target = campaign ? s.campaigns.find(function (c) { return c.id === campaign.id; }) : null;
          if (campaign && !target) throw new Error('Campanha não encontrada.');
          if (!target) {
            target = { id: U.uid('camp'), createdAt: U.nowISO() };
            s.campaigns.push(target);
          }
          target.name = U.normalizeText(data.name);
          target.message = U.normalizeText(data.message);
          target.audience = data.audience;
          target.tag = data.audience === 'tag' ? U.normalizeText(data.tag) : '';
          target.updatedAt = U.nowISO();
        });
        dialog.close();
        UI.toast(campaign ? 'Campanha atualizada.' : 'Campanha criada.');
        renderCampaigns();
      } catch (err) { UI.formError(form, err.message); }
    });

    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  function openCampaignDetail(id) {
    const state = DB.get();
    const campaign = state.campaigns.find(function (c) { return c.id === id; });
    if (!campaign) return;
    const recipients = campaignRecipients(campaign, state).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    const dialog = document.getElementById('detail-dialog');
    if (!dialog) return;
    U.clear(dialog);
    const form = U.el('form', { class: 'dialog-form', method: 'dialog' });
    form.appendChild(UI.dialogHeader('Campanha', campaign.name, dialog));
    const body = U.el('div', { class: 'dialog-body' });

    const summary = U.el('div', { class: 'import-summary' });
    [['Público', campaignLabel(campaign)], ['Pessoas', String(recipients.length)], ['Criada em', U.fmtDate(campaign.createdAt)]].forEach(function (item) {
      const box = U.el('div', { class: 'import-stat' });
      box.appendChild(U.el('strong', { text: item[1], style: { fontSize: '1rem' } }));
      box.appendChild(U.el('span', { text: item[0] }));
      summary.appendChild(box);
    });
    body.appendChild(summary);

    body.appendChild(U.el('h3', { text: 'Mensagem base' }));
    body.appendChild(U.el('p', { class: 'banner', style: { display: 'block' }, text: campaign.message }));

    body.appendChild(U.el('h3', { text: 'Destinatários' }));
    if (!recipients.length) {
      UI.empty(body, { icon: 'users', title: 'Nenhum destinatário', message: 'Ajuste o público ou cadastre clientes com os dados necessários.' });
    } else {
      const list = U.el('ul', { class: 'detail-list' });
      recipients.forEach(function (client) {
        const message = personalize(campaign.message, client);
        const li = U.el('li', { style: { alignItems: 'center' } });
        const main = U.el('div', { style: { minWidth: 0 } });
        main.appendChild(U.el('strong', { text: client.nome }));
        main.appendChild(U.el('div', { class: 'field-hint', text: client.phone ? U.formatPhone(client.phone) : 'sem telefone' }));
        li.appendChild(main);
        const actions = U.el('div', { class: 'btn-row' });
        actions.appendChild(U.el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', title: 'Copiar mensagem', 'aria-label': 'Copiar mensagem para ' + client.nome,
          onclick: function () {
            U.copyText(message).then(function () { UI.toast('Mensagem copiada para ' + firstName(client.nome) + '.'); });
          }
        }, U.icon('copy')));
        if (client.phone) {
          actions.appendChild(U.el('a', {
            class: 'btn btn-success btn-sm', href: U.waLink(client.phone, message), target: '_blank', rel: 'noopener noreferrer',
            title: 'Abrir WhatsApp', 'aria-label': 'Enviar para ' + client.nome
          }, U.icon('phone'), 'WhatsApp'));
        }
        li.appendChild(actions);
        list.appendChild(li);
      });
      body.appendChild(list);
    }
    form.appendChild(body);
    const close = U.el('button', { class: 'btn btn-secondary', type: 'submit', value: 'close' }, 'Fechar');
    const edit = U.el('button', {
      class: 'btn btn-primary', type: 'button', onclick: function () { dialog.close(); openCampaignDialog(campaign.id); }
    }, U.icon('pen'), 'Editar campanha');
    form.appendChild(UI.dialogFooter([close, edit]));
    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  async function deleteCampaign(id) {
    const state = DB.get();
    const campaign = state.campaigns.find(function (c) { return c.id === id; });
    if (!campaign) return;
    const ok = await UI.confirm({ title: 'Excluir campanha', message: 'Excluir "' + campaign.name + '"?', confirmLabel: 'Excluir' });
    if (!ok) return;
    try {
      DB.tx(function (s) { s.campaigns = s.campaigns.filter(function (c) { return c.id !== id; }); });
      UI.toast('Campanha excluída.');
      renderCampaigns();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  function exportClients() {
    const state = DB.get();
    const rows = state.clients.map(function (c) {
      const stats = DB.clientStats(c.id, state);
      return [c.nome, c.phone, c.email, c.birthday, c.city, (c.tags || []).join(', '), stats.count, stats.total, stats.lastAt ? U.fmtDate(stats.lastAt) : '', c.active === false ? 'Inativo' : 'Ativo', c.notes];
    });
    U.download('clientes.csv', U.toCSV(['Nome', 'Telefone', 'E-mail', 'Aniversário', 'Cidade', 'Etiquetas', 'Compras', 'Total gasto', 'Última compra', 'Situação', 'Observações'], rows), 'text/csv;charset=utf-8');
  }

  function renderTab(name) {
    S.tab = name || S.tab;
    const pageActions = document.querySelector('#view-clientes .page-actions');
    if (pageActions) pageActions.hidden = S.tab === 'campaigns';
    if (S.tab === 'clients') { populateTagFilter(); renderKpis(); renderClients(); }
    else renderCampaigns();
  }

  M.showTab = function (name) {
    if (name) {
      S.tab = name;
      activateTab(name);
    } else {
      renderTab(S.tab);
    }
  };
  M.openClientDialog = openClientDialog;
  M.openCampaignDialog = openCampaignDialog;
  M.render = function () { populateTagFilter(); renderTab(S.tab); };

  M.init = function () {
    const root = document.getElementById('view-clientes');
    if (!root) return;
    activateTab = UI.initTabs(document.getElementById('client-tabs'), function (name) {
      S.tab = name;
      renderTab(name);
    });

    const search = document.getElementById('client-search');
    if (search) search.addEventListener('input', U.debounce(function () { S.search = search.value; S.page = 1; renderClients(); }, 180));
    const tag = document.getElementById('client-tag-filter');
    if (tag) tag.addEventListener('change', function () { S.tag = tag.value; S.page = 1; renderClients(); });
    const status = document.getElementById('client-status-filter');
    if (status) status.addEventListener('change', function () { S.status = status.value; S.page = 1; renderClients(); });
    const campaignSearch = document.getElementById('campaign-search');
    if (campaignSearch) campaignSearch.addEventListener('input', U.debounce(function () { S.campaignSearch = campaignSearch.value; renderCampaigns(); }, 180));

    const newClient = document.getElementById('btn-new-client');
    if (newClient) newClient.addEventListener('click', function () { openClientDialog(); });
    const newCampaign = document.getElementById('btn-new-campaign');
    if (newCampaign) newCampaign.addEventListener('click', function () { openCampaignDialog(); });
    const exportButton = document.getElementById('btn-export-clients');
    if (exportButton) exportButton.addEventListener('click', exportClients);

    populateTagFilter();
  };

  Hub.modules = Hub.modules || {};
  Hub.modules.clientes = M;
})(window.Hub = window.Hub || {});
