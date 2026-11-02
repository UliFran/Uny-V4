/* ==========================================================================
   UniHub V4 — módulo Estoque
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = Hub.utils;
  const DB = Hub.db;
  const UI = Hub.ui;

  const M = {};
  const PER_PAGE = 15;
  const S = {
    tab: 'produtos',
    prodSearch: '',
    prodBrand: '',
    prodCategory: '',
    prodStatus: 'ativos',
    prodPage: 1,
    entrySearch: '',
    entryPage: 1,
    stockSearch: '',
    stockStatus: '',
    stockOnlyMoved: false,
    stockPage: 1,
    purchaseSearch: '',
    purchaseStatus: '',
    purchasePage: 1,
    historySearch: '',
    historyType: '',
    historyFrom: '',
    historyTo: '',
    historyPage: 1,
    editingProduct: null,
    editingEntry: null,
    editingPurchase: null
  };

  let activateTab = function () {};

  function norm(value) { return U.normalizeText(value).toLowerCase(); }

  let lastTerm = null;
  let lastTokens = [];

  function termTokens(term) {
    if (term !== lastTerm) {
      lastTerm = term;
      lastTokens = U.normalizeHeader(term).split('_').filter(Boolean);
    }
    return lastTokens;
  }

  /** Texto pesquisável do produto, calculado uma vez por versão do estado. */
  function searchText(product, state) {
    const index = DB.idx(state);
    if (!index.searchText) index.searchText = new Map();
    let text = index.searchText.get(product.id);
    if (text === undefined) {
      const brand = DB.brandById(product.brandId, state);
      const category = DB.categoryById(product.categoryId, state);
      const tags = DB.productTags(product.id, state).map(function (t) { return t.nome; });
      text = U.normalizeHeader([
        product.codigo, product.nome, product.nomeTecnico,
        brand ? brand.nome : '', category ? category.nome : '',
        tags.join(' '), product.description
      ].join(' ')).replace(/_/g, ' ');
      index.searchText.set(product.id, text);
    }
    return text;
  }

  function productMatches(product, term, state) {
    if (!term) return true;
    const text = searchText(product, state);
    return termTokens(term).every(function (token) { return text.indexOf(token) > -1; });
  }

  function lineOf(product, state) { return DB.lineOf(product.id, state); }

  function productLabel(product, state) {
    const brand = DB.brandById(product.brandId, state);
    const line = lineOf(product, state);
    return (brand ? brand.nome : 'Sem marca') + (line ? ' · ' + line : '');
  }

  function fillSelect(select, items, current, placeholder) {
    if (!select) return;
    U.clear(select);
    if (placeholder !== undefined) select.appendChild(UI.option('', placeholder, !current));
    items.forEach(function (item) {
      const value = typeof item === 'object' ? item.value : item;
      const label = typeof item === 'object' ? item.label : item;
      select.appendChild(UI.option(value, label, String(current) === String(value)));
    });
    if (current !== undefined && current !== null) select.value = current;
  }

  function populateFilters() {
    const state = DB.get();
    fillSelect(document.getElementById('prod-brand-filter'),
      state.brands.map(function (b) { return { value: b.id, label: b.nome }; }),
      S.prodBrand, 'Todas as marcas');
    fillSelect(document.getElementById('prod-category-filter'),
      state.categories.map(function (c) { return { value: c.id, label: c.nome }; }),
      S.prodCategory, 'Todas as categorias');
  }

  /* ============================== produtos ============================== */

  function renderProducts() {
    const state = DB.get();
    const tbody = document.querySelector('#products-table tbody');
    if (!tbody) return;
    U.clear(tbody);
    const term = norm(S.prodSearch);
    const list = state.products.filter(function (p) {
      if (S.prodStatus === 'ativos' && p.active === false) return false;
      if (S.prodStatus === 'inativos' && p.active !== false) return false;
      if (S.prodBrand && p.brandId !== S.prodBrand) return false;
      if (S.prodCategory && p.categoryId !== S.prodCategory) return false;
      return productMatches(p, term, state);
    }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });

    S.prodPage = Math.min(S.prodPage, UI.pages(list.length, PER_PAGE));
    const rows = UI.slice(list, S.prodPage, PER_PAGE);

    if (!rows.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 8, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: state.products.length ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado' }));
      td.appendChild(U.el('span', { text: state.products.length ? 'Ajuste a busca ou os filtros.' : 'Cadastre o primeiro item do catálogo.' }));
      if (!state.products.length) {
        td.appendChild(U.el('button', {
          class: 'btn btn-primary btn-sm', type: 'button', onclick: function () { openProductDialog(); }
        }, U.icon('plus'), 'Novo produto'));
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      rows.forEach(function (p) {
        const saldo = DB.stockFor(p.id, state);
        const status = DB.stockStatus(p, state);
        const tr = U.el('tr', { class: p.active === false ? 'is-inactive' : '' });
        tr.appendChild(U.el('td', { class: 'nowrap' }, U.el('span', { class: 'strong', text: p.codigo })));
        const nameCell = U.el('td');
        nameCell.appendChild(U.el('span', { class: 'strong', text: p.nome }));
        const subParts = [];
        if (p.nomeTecnico) subParts.push(p.nomeTecnico);
        if (p.active === false) subParts.push('Inativo');
        if (subParts.length) nameCell.appendChild(U.el('span', { class: 'sub', text: subParts.join(' · ') }));
        tr.appendChild(nameCell);
        tr.appendChild(U.el('td', { text: productLabel(p, state) }));
        tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(p.cost) }));
        tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(p.price) }));
        tr.appendChild(U.el('td', { class: 'num', text: String(saldo) }));
        const statusCell = U.el('td');
        statusCell.appendChild(UI.badge(status.label, status.tone));
        tr.appendChild(statusCell);
        const actions = U.el('td', { class: 'actions-cell' });
        actions.appendChild(U.el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', title: 'Editar produto', 'aria-label': 'Editar ' + p.nome,
          onclick: function () { openProductDialog(p.id); }
        }, U.icon('pen')));
        actions.appendChild(U.el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          title: p.active === false ? 'Reativar produto' : 'Inativar produto',
          'aria-label': p.active === false ? 'Reativar ' + p.nome : 'Inativar ' + p.nome,
          onclick: function () { toggleProduct(p.id); }
        }, U.icon(p.active === false ? 'rotate' : 'eye')));
        actions.appendChild(U.el('button', {
          class: 'btn btn-danger-ghost btn-sm', type: 'button', title: 'Excluir produto', 'aria-label': 'Excluir ' + p.nome,
          onclick: function () { deleteProduct(p.id); }
        }, U.icon('trash')));
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });
    }

    const summary = document.getElementById('prod-summary');
    if (summary) {
      U.clear(summary);
      summary.appendChild(U.el('span', {}, U.el('strong', { text: String(list.length) }), ' produto(s) nesta visão'));
      summary.appendChild(U.el('span', {}, U.el('strong', { text: String(state.products.filter(function (p) { return p.active !== false; }).length) }), ' ativo(s) no catálogo'));
      summary.appendChild(U.el('span', {}, 'Valor a custo: ', U.el('strong', { text: U.fmtMoney(state.products.reduce(function (total, p) {
        return total + Math.max(0, DB.stockFor(p.id, state)) * U.toNumber(p.cost, 0);
      }, 0)) })));
    }

    UI.pagination(document.getElementById('products-pagination'), {
      page: S.prodPage, pages: UI.pages(list.length, PER_PAGE), total: list.length, pageSize: PER_PAGE,
      onChange: function (page) { S.prodPage = page; renderProducts(); }
    });
  }

  function toggleProduct(id) {
    try {
      DB.tx(function (s) {
        const p = s.products.find(function (item) { return item.id === id; });
        if (!p) throw new Error('Produto não encontrado.');
        p.active = p.active === false;
        p.updatedAt = U.nowISO();
      });
      UI.toast('Situação do produto atualizada.');
      renderProducts();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  async function deleteProduct(id) {
    const state = DB.get();
    const product = state.products.find(function (p) { return p.id === id; });
    if (!product) return;
    const hasMovements = state.movements.some(function (m) { return m.productId === id; });
    const hasSales = state.sales.some(function (s) {
      return s.items.some(function (i) { return i.productId === id; });
    });
    const hasPurchases = state.purchaseOrders.some(function (o) {
      return o.items.some(function (i) { return i.productId === id; });
    });

    if (hasMovements || hasSales || hasPurchases) {
      const ok = await UI.confirm({
        title: 'Produto com histórico',
        message: 'Este produto já aparece em movimentações, pedidos ou compras e não pode ser excluído sem perder o histórico. Deseja inativá-lo?',
        confirmLabel: 'Inativar produto',
        danger: false
      });
      if (!ok) return;
      try {
        DB.tx(function (s) {
          const p = s.products.find(function (item) { return item.id === id; });
          if (p) { p.active = false; p.updatedAt = U.nowISO(); }
        });
        UI.toast('Produto inativado. O histórico foi preservado.');
        renderProducts();
      } catch (err) { UI.toast(err.message, 'error'); }
      return;
    }

    const ok = await UI.confirm({
      title: 'Excluir produto',
      message: 'Excluir "' + product.nome + '"? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir'
    });
    if (!ok) return;
    try {
      DB.tx(function (s) {
        s.products = s.products.filter(function (p) { return p.id !== id; });
        s.productTags = s.productTags.filter(function (pt) { return pt.productId !== id; });
        s.purchaseDraft = s.purchaseDraft.filter(function (item) { return item.productId !== id; });
      });
      UI.toast('Produto excluído.');
      renderProducts();
      populateFilters();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  function openProductDialog(id) {
    const state = DB.get();
    const product = id ? state.products.find(function (p) { return p.id === id; }) : null;
    const dialog = document.getElementById('product-dialog');
    if (!dialog) return;
    U.clear(dialog);
    S.editingProduct = product ? product.id : null;

    const form = U.el('form', { class: 'dialog-form', id: 'product-form', novalidate: 'novalidate' });
    form.appendChild(UI.dialogHeader(product ? 'Editar produto' : 'Novo produto', product ? product.nome : 'Cadastrar produto', dialog));

    const body = U.el('div', { class: 'dialog-body' });
    const error = U.el('div', { class: 'form-error', role: 'alert' });
    body.appendChild(error);

    function input(name, type, value, attrs) {
      return U.el('input', Object.assign({
        type: type, name: name, id: 'pf-' + name, value: value === null || value === undefined ? '' : value
      }, attrs || {}));
    }

    const grid = U.el('div', { class: 'form-grid' });
    grid.appendChild(U.el('p', { class: 'form-section-title', text: 'Identificação' }));
    grid.appendChild(UI.field('Código *', input('codigo', 'text', product ? product.codigo : '', { maxlength: 40, required: true, autocomplete: 'off' }), { hint: 'O código é normalizado em maiúsculas e deve ser único.' }));
    grid.appendChild(UI.field('Produto *', input('nome', 'text', product ? product.nome : '', { maxlength: 140, required: true })));
    grid.appendChild(UI.field('Nome técnico / descrição curta', input('nomeTecnico', 'text', product ? product.nomeTecnico : '', { maxlength: 120 })));
    grid.appendChild(UI.field('Marca', (function () {
      const select = U.el('select', { name: 'brandId', id: 'pf-brandId' });
      select.appendChild(UI.option('', 'Sem marca'));
      state.brands.forEach(function (b) { select.appendChild(UI.option(b.id, b.nome, product && product.brandId === b.id)); });
      return select;
    })()));
    grid.appendChild(UI.field('Categoria', (function () {
      const select = U.el('select', { name: 'categoryId', id: 'pf-categoryId' });
      select.appendChild(UI.option('', 'Sem categoria'));
      state.categories.forEach(function (c) { select.appendChild(UI.option(c.id, c.nome, product && product.categoryId === c.id)); });
      return select;
    })()));

    grid.appendChild(U.el('p', { class: 'form-section-title', text: 'Preços e estoque' }));
    grid.appendChild(UI.field('Custo unitário (R$)', input('cost', 'number', product ? product.cost : '', { min: '0', step: '0.01', inputmode: 'decimal' })));
    grid.appendChild(UI.field('Preço de revista / venda (R$)', input('price', 'number', product ? product.price : '', { min: '0', step: '0.01', inputmode: 'decimal' })));
    grid.appendChild(UI.field('Estoque mínimo', input('minStock', 'number', product ? product.minStock : 0, { min: '0', step: '1', inputmode: 'numeric' }), { hint: 'Usado para gerar alertas de reposição.' }));
    const activeWrap = U.el('label', { class: 'check-field' });
    const activeInput = U.el('input', { type: 'checkbox', name: 'active', checked: !product || product.active !== false });
    activeWrap.appendChild(activeInput);
    activeWrap.appendChild(document.createTextNode('Produto ativo no catálogo'));
    grid.appendChild(activeWrap);

    grid.appendChild(U.el('p', { class: 'form-section-title', text: 'Classificação' }));
    const tagWrap = U.el('div', { class: 'span-2' });
    ['tipo_produto', 'familia_olfativa', 'linha'].forEach(function (type) {
      const tags = state.tags.filter(function (t) { return t.tipo === type; });
      if (!tags.length) return;
      tagWrap.appendChild(U.el('p', { class: 'field-hint', text: type === 'tipo_produto' ? 'Tipo de produto' : type === 'familia_olfativa' ? 'Família olfativa' : 'Linha' }));
      const chips = U.el('div', { class: 'chip-grid', style: { marginBottom: '9px' } });
      tags.forEach(function (tag) {
        const selected = product && state.productTags.some(function (pt) { return pt.productId === product.id && pt.tagId === tag.id; });
        const label = U.el('label', { class: 'chip-check' });
        label.appendChild(U.el('input', { type: 'checkbox', name: 'tags', value: tag.id, checked: Boolean(selected) }));
        label.appendChild(document.createTextNode(tag.nome));
        chips.appendChild(label);
      });
      tagWrap.appendChild(chips);
    });
    if (tagWrap.children.length) grid.appendChild(tagWrap);

    grid.appendChild(U.el('p', { class: 'form-section-title', text: 'Extras' }));
    grid.appendChild(UI.field('Descrição', U.el('textarea', { name: 'description', id: 'pf-description', rows: 3, maxlength: 1000, value: product ? product.description : '' }), { className: 'span-2' }));
    grid.appendChild(UI.field('URL da imagem', input('imageUrl', 'url', product ? product.imageUrl : '', { placeholder: 'https://…' })));
    grid.appendChild(UI.field('Link do produto', input('productUrl', 'url', product ? product.productUrl : '', { placeholder: 'https://…' })));

    body.appendChild(grid);
    form.appendChild(body);

    const cancel = U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { dialog.close(); } }, 'Cancelar');
    const save = U.el('button', { class: 'btn btn-primary', type: 'submit' }, U.icon('check'), product ? 'Salvar alterações' : 'Cadastrar produto');
    form.appendChild(UI.dialogFooter([cancel, save]));

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      UI.clearFormError(form);
      const data = UI.formData(form);
      const code = U.normalizeCode(data.codigo);
      const name = U.normalizeText(data.nome);
      if (!code) { UI.invalid(form, 'codigo', 'Informe o código do produto.'); return; }
      if (!name) { UI.invalid(form, 'nome', 'Informe o nome do produto.'); return; }
      const cost = Math.max(0, U.toNumber(data.cost, 0));
      const price = Math.max(0, U.toNumber(data.price, 0));
      const minStock = Math.max(0, Math.round(U.toNumber(data.minStock, 0)));
      const selectedTags = U.$$('input[name="tags"]:checked', form).map(function (input) { return input.value; });

      try {
        DB.tx(function (s) {
          const duplicate = s.products.find(function (p) { return p.codigo === code && p.id !== (product ? product.id : null); });
          if (duplicate) throw new Error('Já existe um produto com o código ' + code + '.');
          let target = product ? s.products.find(function (p) { return p.id === product.id; }) : null;
          if (product && !target) throw new Error('Produto não encontrado. Recarregue a página.');
          if (!target) {
            target = { id: U.uid('prod'), createdAt: U.nowISO(), attributes: {} };
            s.products.push(target);
          }
          target.codigo = code;
          target.nome = name;
          target.nomeTecnico = U.normalizeText(data.nomeTecnico);
          target.brandId = data.brandId || null;
          target.categoryId = data.categoryId || null;
          target.cost = cost;
          target.price = price;
          target.minStock = minStock;
          target.active = data.active === true;
          target.description = U.normalizeText(data.description);
          target.imageUrl = U.normalizeText(data.imageUrl);
          target.productUrl = U.normalizeText(data.productUrl);
          target.updatedAt = U.nowISO();
          s.productTags = s.productTags.filter(function (pt) { return pt.productId !== target.id; });
          selectedTags.forEach(function (tagId) {
            if (s.tags.some(function (t) { return t.id === tagId; })) {
              s.productTags.push({ productId: target.id, tagId: tagId });
            }
          });
        });
        dialog.close();
        UI.toast(product ? 'Produto atualizado.' : 'Produto cadastrado.');
        populateFilters();
        renderProducts();
      } catch (err) {
        UI.formError(form, err.message);
      }
    });

    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  /* ============================== entradas ============================== */

  function renderEntries() {
    const state = DB.get();
    const tbody = document.querySelector('#entries-table tbody');
    if (!tbody) return;
    U.clear(tbody);
    const term = norm(S.entrySearch);
    const list = state.movements.filter(function (m) {
      if (m.type !== 'entrada') return false;
      const p = DB.productById(m.productId, state);
      const order = DB.orderById(m.orderId, state);
      const haystack = [p ? p.codigo : '', p ? p.nome : '', m.supplier, m.cycle, m.note, order ? order.number : ''].join(' ').toLowerCase();
      return !term || haystack.indexOf(term) > -1;
    }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

    S.entryPage = Math.min(S.entryPage, UI.pages(list.length, PER_PAGE));
    const rows = UI.slice(list, S.entryPage, PER_PAGE);

    if (!rows.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 8, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: state.movements.some(function (m) { return m.type === 'entrada'; }) ? 'Nenhuma entrada encontrada' : 'Nenhuma entrada registrada' }));
      td.appendChild(U.el('span', { text: 'Registre a chegada de produtos para atualizar o saldo.' }));
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      rows.forEach(function (m) {
        const p = DB.productById(m.productId, state);
        const order = DB.orderById(m.orderId, state);
        const tr = U.el('tr');
        tr.appendChild(U.el('td', { class: 'nowrap', text: U.fmtDateTime(m.createdAt) }));
        const nameCell = U.el('td');
        nameCell.appendChild(U.el('span', { class: 'strong', text: p ? p.nome : 'Produto removido' }));
        nameCell.appendChild(U.el('span', { class: 'sub', text: p ? p.codigo : m.productId }));
        tr.appendChild(nameCell);
        tr.appendChild(U.el('td', { class: 'num', text: String(m.quantity) }));
        tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(m.unitCost) }));
        tr.appendChild(U.el('td', { text: m.cycle || '—' }));
        tr.appendChild(U.el('td', { text: m.supplier || '—' }));
        tr.appendChild(U.el('td', { text: order ? order.number : 'Manual' }));
        const actions = U.el('td', { class: 'actions-cell' });
        const locked = Boolean(m.orderId || m.saleId);
        actions.appendChild(U.el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', title: locked ? 'Entrada vinculada a uma ordem; reabra a ordem para editar' : 'Editar entrada',
          'aria-label': 'Editar entrada', disabled: locked,
          onclick: function () { openEntryDialog(m.id); }
        }, U.icon('pen')));
        actions.appendChild(U.el('button', {
          class: 'btn btn-danger-ghost btn-sm', type: 'button', title: locked ? 'Entrada vinculada; reabra a ordem para alterar' : 'Excluir entrada',
          'aria-label': 'Excluir entrada', disabled: locked,
          onclick: function () { deleteEntry(m.id); }
        }, U.icon('trash')));
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });
    }

    UI.pagination(document.getElementById('entries-pagination'), {
      page: S.entryPage, pages: UI.pages(list.length, PER_PAGE), total: list.length, pageSize: PER_PAGE,
      onChange: function (page) { S.entryPage = page; renderEntries(); }
    });
  }

  function openEntryDialog(id) {
    const state = DB.get();
    const movement = id ? state.movements.find(function (m) { return m.id === id; }) : null;
    if (id && movement && (movement.orderId || movement.saleId)) {
      UI.toast('Esta entrada está vinculada a uma ordem ou venda. Altere pela origem.', 'warn');
      return;
    }
    const products = state.products.filter(function (p) { return p.active !== false || (movement && movement.productId === p.id); })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    if (!products.length) {
      UI.toast('Cadastre um produto antes de registrar entradas.', 'warn');
      return;
    }

    const dialog = document.getElementById('entry-dialog');
    if (!dialog) return;
    U.clear(dialog);
    S.editingEntry = movement ? movement.id : null;
    const product = movement ? state.products.find(function (p) { return p.id === movement.productId; }) : null;

    const form = U.el('form', { class: 'dialog-form', id: 'entry-form', novalidate: 'novalidate' });
    form.appendChild(UI.dialogHeader(movement ? 'Editar entrada' : 'Nova entrada', movement ? 'Atualizar movimentação' : 'Registrar entrada', dialog));
    const body = U.el('div', { class: 'dialog-body' });
    const error = U.el('div', { class: 'form-error', role: 'alert' });
    body.appendChild(error);
    const grid = U.el('div', { class: 'form-grid' });

    const productField = U.el('div', { class: 'field span-2' });
    productField.appendChild(U.el('span', { text: 'Produto *' }));
    const chosen = U.el('input', { type: 'hidden', name: 'productId', id: 'ef-product', value: movement ? movement.productId : '' });
    const chosenLabel = U.el('div', { class: 'picked-product' });
    function showChosen() {
      const p = DB.productById(chosen.value, state);
      U.clear(chosenLabel);
      if (!p) { chosenLabel.appendChild(U.el('span', { class: 'muted', text: 'Nenhum produto selecionado.' })); return; }
      chosenLabel.appendChild(U.icon('check'));
      chosenLabel.appendChild(U.el('strong', { text: p.nome }));
      chosenLabel.appendChild(U.el('small', { text: p.codigo + ' · saldo ' + DB.stockFor(p.id, state) }));
    }
    const picker = UI.productPicker({
      products: products,
      stockOf: function (p) { return DB.stockFor(p.id, state); },
      placeholder: 'Buscar produto por nome ou código…',
      label: 'Buscar produto da entrada',
      onPick: function (p) {
        chosen.value = p.id;
        showChosen();
        if (form.elements.unitCost && !form.elements.unitCost.value) form.elements.unitCost.value = p.cost || '';
        if (form.elements.unitPrice && !form.elements.unitPrice.value) form.elements.unitPrice.value = p.price || '';
        if (form.elements.quantity) form.elements.quantity.focus();
      }
    });
    productField.appendChild(picker.el);
    productField.appendChild(chosenLabel);
    productField.appendChild(chosen);
    productField.appendChild(U.el('span', { class: 'field-error', 'aria-live': 'polite' }));
    grid.appendChild(productField);
    showChosen();

    function num(name, value, attrs) {
      return U.el('input', Object.assign({ type: 'number', name: name, id: 'ef-' + name, value: value }, attrs || {}));
    }

    grid.appendChild(UI.field('Quantidade *', num('quantity', movement ? movement.quantity : 1, { min: '1', step: '1', required: true })));
    grid.appendChild(UI.field('Custo unitário (R$)', num('unitCost', movement ? movement.unitCost : (product ? product.cost : ''), { min: '0', step: '0.01' })));
    grid.appendChild(UI.field('Preço de venda (R$)', num('unitPrice', movement ? movement.unitPrice : (product ? product.price : ''), { min: '0', step: '0.01' })));
    grid.appendChild(UI.field('Ciclo', U.el('input', { type: 'text', name: 'cycle', id: 'ef-cycle', maxlength: 40, value: movement ? movement.cycle : '' })));
    grid.appendChild(UI.field('Validade', U.el('input', { type: 'date', name: 'expiry', id: 'ef-expiry', value: movement ? movement.expiry : '' })));
    grid.appendChild(UI.field('Fornecedor', U.el('input', { type: 'text', name: 'supplier', id: 'ef-supplier', maxlength: 80, value: movement ? movement.supplier : 'Natura' })));
    grid.appendChild(UI.field('Observação', U.el('textarea', { name: 'note', id: 'ef-note', rows: 2, maxlength: 300, value: movement ? movement.note : '' }), { className: 'span-2' }));
    body.appendChild(grid);

    form.appendChild(body);
    const cancel = U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { dialog.close(); } }, 'Cancelar');
    const save = U.el('button', { class: 'btn btn-success', type: 'submit' }, U.icon('check'), movement ? 'Salvar entrada' : 'Registrar entrada');
    form.appendChild(UI.dialogFooter([cancel, save]));

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      UI.clearFormError(form);
      const data = UI.formData(form);
      const qty = Math.round(U.toNumber(data.quantity, 0));
      if (!data.productId) { UI.invalid(form, 'productId', 'Selecione o produto.'); return; }
      if (qty <= 0) { UI.invalid(form, 'quantity', 'A quantidade deve ser maior que zero.'); return; }

      try {
        DB.tx(function (s) {
          const p = s.products.find(function (item) { return item.id === data.productId; });
          if (!p) throw new Error('Produto não encontrado.');
          let target = movement ? s.movements.find(function (m) { return m.id === movement.id; }) : null;
          if (movement && (!target || target.orderId || target.saleId)) {
            throw new Error('Esta entrada está vinculada a outra operação e não pode ser editada aqui.');
          }
          if (!target) {
            target = { id: U.uid('mov'), type: 'entrada', createdAt: U.nowISO() };
            s.movements.push(target);
          }
          target.productId = p.id;
          target.type = 'entrada';
          target.quantity = qty;
          target.unitCost = Math.max(0, U.toNumber(data.unitCost, 0));
          target.unitPrice = Math.max(0, U.toNumber(data.unitPrice, 0));
          target.cycle = U.normalizeText(data.cycle);
          target.expiry = data.expiry || '';
          target.supplier = U.normalizeText(data.supplier);
          target.note = U.normalizeText(data.note);
          target.updatedAt = U.nowISO();
          // Editar uma entrada antiga não pode reescrever o custo/preço atuais.
          const newer = s.movements.some(function (m) {
            return m.productId === p.id && m.type === 'entrada' && m.id !== target.id && String(m.createdAt) > String(target.createdAt);
          });
          if (!newer) {
            if (target.unitCost > 0) p.cost = target.unitCost;
            if (target.unitPrice > 0) p.price = target.unitPrice;
          }
          p.updatedAt = U.nowISO();
        });
        dialog.close();
        UI.toast(movement ? 'Entrada atualizada.' : 'Entrada registrada.');
        renderEntries();
        renderProducts();
      } catch (err) {
        UI.formError(form, err.message);
      }
    });

    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  async function deleteEntry(id) {
    const state = DB.get();
    const movement = state.movements.find(function (m) { return m.id === id; });
    if (!movement) return;
    if (movement.orderId || movement.saleId) {
      UI.toast('Esta entrada está vinculada a outra operação. Altere pela origem.', 'warn');
      return;
    }
    const product = state.products.find(function (p) { return p.id === movement.productId; });
    if (DB.stockFor(movement.productId, state) - movement.quantity < 0) {
      UI.toast('Não é possível excluir: parte dessa entrada já foi vendida e o saldo ficaria negativo. Use um ajuste de estoque.', 'error');
      return;
    }
    const ok = await UI.confirm({
      title: 'Excluir entrada',
      message: 'Excluir a entrada de ' + movement.quantity + ' un. de "' + (product ? product.nome : 'produto') + '"? O saldo será recalculado.',
      confirmLabel: 'Excluir'
    });
    if (!ok) return;
    try {
      DB.tx(function (s) {
        s.movements = s.movements.filter(function (m) { return m.id !== id; });
      });
      UI.toast('Entrada excluída.');
      renderEntries();
      renderProducts();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  /* ============================== estoque atual ============================== */

  function stockRows(state) {
    return state.products.map(function (product) {
      const saldo = DB.stockFor(product.id, state);
      const status = DB.stockStatus(product, state);
      const last = DB.lastEntryFor(product.id, state);
      const moved = DB.hasMovements(product.id, state);
      return { product: product, saldo: saldo, status: status, last: last, moved: moved };
    });
  }

  function draftProduct(state, productId) {
    return state.products.find(function (p) { return p.id === productId; });
  }

  function renderStock() {
    const state = DB.get();
    const tbody = document.querySelector('#stock-table tbody');
    if (!tbody) return;
    U.clear(tbody);
    const term = norm(S.stockSearch);
    const allRows = stockRows(state);
    let rows = allRows.filter(function (row) {
      if (S.stockStatus && row.status.key !== S.stockStatus) return false;
      if (S.stockOnlyMoved && !row.moved) return false;
      return productMatches(row.product, term, state);
    });

    const severity = { falta: 0, zerado: 1, baixo: 2, sem: 3, ok: 4 };
    rows.sort(function (a, b) {
      const d = severity[a.status.key] - severity[b.status.key];
      return d !== 0 ? d : a.product.nome.localeCompare(b.product.nome, 'pt-BR');
    });

    const activeProducts = state.products.filter(function (p) { return p.active !== false; });
    const stockValue = state.products.reduce(function (total, p) {
      return total + Math.max(0, DB.stockFor(p.id, state)) * U.toNumber(p.cost, 0);
    }, 0);
    const lowCount = allRows.filter(function (r) { return r.product.active !== false && DB.isCritical(r.status); }).length;
    const zeroCount = allRows.filter(function (r) { return r.product.active !== false && r.status.key === 'zerado'; }).length;
    const orderCount = allRows.filter(function (r) { return r.product.active !== false && r.status.key === 'falta'; }).length;
    const noMove = allRows.filter(function (r) { return r.product.active !== false && r.status.key === 'sem'; }).length;

    const kpis = document.getElementById('stock-kpis');
    if (kpis) {
      U.clear(kpis);
      function stockKpi(label, value, hint, tone) {
        const box = U.el('article', { class: 'kpi' + (tone ? ' is-' + tone : '') });
        const top = U.el('div', { class: 'kpi-top' });
        top.appendChild(U.el('span', { text: label }));
        top.appendChild(U.icon('box'));
        box.appendChild(top);
        box.appendChild(U.el('div', { class: 'kpi-value', text: value }));
        if (hint) box.appendChild(U.el('div', { class: 'kpi-hint', text: hint }));
        return box;
      }
      kpis.appendChild(stockKpi('Valor a custo', U.fmtMoney(stockValue), activeProducts.length + ' produtos ativos'));
      kpis.appendChild(stockKpi('Estoque crítico', String(lowCount), 'abaixo do mínimo ou zerado', lowCount ? 'alert' : 'good'));
      kpis.appendChild(stockKpi('Zerados', String(zeroCount), 'precisam de reposição', zeroCount ? 'alert' : ''));
      kpis.appendChild(stockKpi('Encomendas a comprar', String(orderCount), 'vendidos sem estoque (saldo negativo)', orderCount ? 'alert' : ''));
      kpis.appendChild(stockKpi('Sem movimentação', String(noMove), 'cadastrados e nunca movimentados'));
    }

    S.stockPage = Math.min(S.stockPage, UI.pages(rows.length, PER_PAGE));
    const pageRows = UI.slice(rows, S.stockPage, PER_PAGE);
    const draftIds = state.purchaseDraft.map(function (item) { return item.productId; });

    if (!pageRows.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 7, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: state.products.length ? 'Nenhum item encontrado' : 'Nenhum produto no catálogo' }));
      td.appendChild(U.el('span', { text: state.products.length ? 'Ajuste a busca ou os filtros.' : 'Cadastre produtos para acompanhar o saldo.' }));
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      pageRows.forEach(function (row) {
        const tr = U.el('tr');
        tr.appendChild(U.el('td', { class: 'nowrap' }, U.el('span', { class: 'strong', text: row.product.codigo })));
        const name = U.el('td');
        name.appendChild(U.el('span', { class: 'strong', text: row.product.nome }));
        name.appendChild(U.el('span', { class: 'sub', text: productLabel(row.product, state) }));
        tr.appendChild(name);
        tr.appendChild(U.el('td', { class: 'nowrap', text: row.last ? U.fmtDate(row.last.createdAt) : '—' }));
        tr.appendChild(U.el('td', { class: 'num', text: String(row.saldo) }));
        tr.appendChild(U.el('td', { class: 'num', text: String(row.product.minStock || 0) }));
        const statusCell = U.el('td');
        statusCell.appendChild(UI.badge(row.status.label, row.status.tone));
        tr.appendChild(statusCell);
        const actionCell = U.el('td', { class: 'actions-cell' });
        const inDraft = draftIds.indexOf(row.product.id) > -1;
        actionCell.appendChild(U.el('button', {
          class: 'btn ' + (inDraft ? 'btn-danger-ghost' : 'btn-secondary') + ' btn-sm',
          type: 'button',
          title: inDraft ? 'Remover da lista de compra' : 'Adicionar à lista de compra',
          'aria-label': inDraft ? 'Remover ' + row.product.nome + ' da compra' : 'Adicionar ' + row.product.nome + ' à compra',
          onclick: function () { inDraft ? removeDraft(row.product.id) : addDraft(row.product.id); }
        }, U.icon(inDraft ? 'x' : 'plus'), inDraft ? 'Na lista' : 'Adicionar'));
        actionCell.appendChild(U.el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', title: 'Ajustar estoque (inventário, perda, brinde)',
          'aria-label': 'Ajustar estoque de ' + row.product.nome,
          onclick: function () { openAdjustDialog(row.product.id); }
        }, U.icon('pen')));
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
      });
    }

    renderDraft();
    UI.pagination(document.getElementById('stock-pagination'), {
      page: S.stockPage, pages: UI.pages(rows.length, PER_PAGE), total: rows.length, pageSize: PER_PAGE,
      onChange: function (page) { S.stockPage = page; renderStock(); }
    });
  }

  /* ============================== ajuste de estoque ============================== */

  const ADJUST_KINDS = [
    { value: 'contagem', label: 'Inventário: informar a contagem real' },
    { value: 'perda', label: 'Perda / avaria / vencido (−)' },
    { value: 'brinde', label: 'Brinde / amostra / uso próprio (−)' },
    { value: 'acerto', label: 'Acerto a favor do estoque (+)' }
  ];

  function openAdjustDialog(productId) {
    const state = DB.get();
    const products = state.products.filter(function (p) { return p.active !== false; });
    if (!products.length) { UI.toast('Cadastre um produto antes de ajustar o estoque.', 'warn'); return; }
    const dialog = document.getElementById('entry-dialog');
    if (!dialog) return;
    U.clear(dialog);

    const form = U.el('form', { class: 'dialog-form', novalidate: 'novalidate' });
    form.appendChild(UI.dialogHeader('Estoque', 'Ajustar estoque', dialog));
    const body = U.el('div', { class: 'dialog-body' });
    body.appendChild(U.el('div', { class: 'form-error', role: 'alert' }));
    const grid = U.el('div', { class: 'form-grid' });

    const productField = U.el('div', { class: 'field span-2' });
    productField.appendChild(U.el('span', { text: 'Produto *' }));
    const chosen = U.el('input', { type: 'hidden', name: 'productId', value: productId || '' });
    const chosenLabel = U.el('div', { class: 'picked-product' });
    function showChosen() {
      const p = DB.productById(chosen.value, state);
      U.clear(chosenLabel);
      if (!p) { chosenLabel.appendChild(U.el('span', { class: 'muted', text: 'Busque e selecione o produto.' })); return; }
      chosenLabel.appendChild(U.icon('check'));
      chosenLabel.appendChild(U.el('strong', { text: p.nome }));
      chosenLabel.appendChild(U.el('small', { text: p.codigo + ' · saldo atual ' + DB.stockFor(p.id, state) }));
    }
    const picker = UI.productPicker({
      products: products,
      stockOf: function (p) { return DB.stockFor(p.id, state); },
      placeholder: 'Buscar produto por nome ou código…',
      label: 'Buscar produto para ajustar',
      onPick: function (p) { chosen.value = p.id; showChosen(); form.elements.quantity.focus(); }
    });
    productField.appendChild(picker.el);
    productField.appendChild(chosenLabel);
    productField.appendChild(chosen);
    productField.appendChild(U.el('span', { class: 'field-error', 'aria-live': 'polite' }));
    grid.appendChild(productField);
    showChosen();

    const kind = U.el('select', { name: 'kind' });
    ADJUST_KINDS.forEach(function (k) { kind.appendChild(UI.option(k.value, k.label)); });
    grid.appendChild(UI.field('Tipo de ajuste', kind, { className: 'span-2' }));
    const qtyLabel = U.el('input', { type: 'number', name: 'quantity', min: '0', step: '1', inputmode: 'numeric', value: '' });
    const qtyField = UI.field('Quantidade', qtyLabel, { hint: 'Em inventário, informe quanto existe de fato na prateleira.' });
    grid.appendChild(qtyField);
    grid.appendChild(UI.field('Observação', U.el('input', { type: 'text', name: 'note', maxlength: 200, placeholder: 'Ex.: caixa danificada' })));
    body.appendChild(grid);
    form.appendChild(body);

    const cancel = U.el('button', { class: 'btn btn-secondary', type: 'button', onclick: function () { dialog.close(); } }, 'Cancelar');
    const save = U.el('button', { class: 'btn btn-success', type: 'submit' }, U.icon('check'), 'Registrar ajuste');
    form.appendChild(UI.dialogFooter([cancel, save]));

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      UI.clearFormError(form);
      const pid = chosen.value;
      const qty = Math.round(U.toNumber(form.elements.quantity.value, NaN));
      if (!pid) { UI.invalid(form, 'productId', 'Selecione o produto.'); return; }
      if (!isFinite(qty) || qty < 0 || form.elements.quantity.value === '') { UI.invalid(form, 'quantity', 'Informe a quantidade.'); return; }
      try {
        DB.tx(function (s) {
          const p = s.products.find(function (item) { return item.id === pid; });
          if (!p) throw new Error('Produto não encontrado.');
          const saldo = DB.stockFor(pid, s);
          let delta = qty;
          if (kind.value === 'contagem') delta = qty - saldo;
          else if (kind.value === 'perda' || kind.value === 'brinde') delta = -qty;
          if (delta === 0) throw new Error('Nada a ajustar: a quantidade informada já é o saldo atual.');
          const label = { contagem: 'Inventário', perda: 'Perda/avaria', brinde: 'Brinde/amostra', acerto: 'Acerto de estoque' }[kind.value];
          s.movements.push({
            id: U.uid('mov'), productId: pid, type: 'ajuste', quantity: delta,
            unitCost: p.cost || 0, unitPrice: 0, cycle: '', expiry: '', supplier: '',
            note: label + (form.elements.note.value ? ' — ' + U.normalizeText(form.elements.note.value) : ''),
            createdAt: U.nowISO(), updatedAt: U.nowISO()
          });
        });
        dialog.close();
        UI.toast('Ajuste registrado.');
        M.render();
      } catch (err) { UI.formError(form, err.message); }
    });

    dialog.appendChild(form);
    UI.openDialog(dialog);
  }

  /** Monta a lista de compra com tudo que está em falta, abaixo do mínimo ou zerado. */
  function suggestReplenishment() {
    const state = DB.get();
    const openQty = {};
    state.purchaseOrders.forEach(function (o) {
      if (o.status !== 'aberta') return;
      o.items.forEach(function (i) { openQty[i.productId] = (openQty[i.productId] || 0) + U.toNumber(i.qty, 0); });
    });
    const proposals = [];
    state.products.forEach(function (p) {
      if (p.active === false) return;
      const status = DB.stockStatus(p, state);
      if (!DB.isCritical(status)) return;
      const saldo = DB.stockFor(p.id, state);
      const need = Math.max(U.toNumber(p.minStock, 0), 1) - saldo - (openQty[p.id] || 0);
      if (need > 0) proposals.push({ productId: p.id, qty: Math.round(need) });
    });
    if (!proposals.length) { UI.toast('Nada a sugerir: nenhum item crítico sem ordem de compra aberta.', 'info'); return; }
    try {
      DB.tx(function (s) {
        proposals.forEach(function (prop) {
          const existing = s.purchaseDraft.find(function (i) { return i.productId === prop.productId; });
          if (existing) existing.qty = Math.max(existing.qty, prop.qty);
          else s.purchaseDraft.push(prop);
        });
      });
      UI.toast(proposals.length + ' produto(s) adicionados à lista de compra.');
      renderStock();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  function renderDraft() {
    const state = DB.get();
    const tbody = document.querySelector('#purchase-draft-table tbody');
    const banner = document.getElementById('purchase-edit-banner');
    const createButton = document.getElementById('btn-create-purchase');
    if (!tbody) return;
    U.clear(tbody);
    const draft = state.purchaseDraft.map(function (item) {
      const product = draftProduct(state, item.productId);
      return product ? { product: product, qty: item.qty } : null;
    }).filter(Boolean);

    if (banner) {
      U.clear(banner);
      if (S.editingPurchase) {
        const order = state.purchaseOrders.find(function (o) { return o.id === S.editingPurchase; });
        if (order) {
          const text = U.el('span', {}, U.icon('pen'), ' Editando a ordem ', U.el('strong', { text: order.number }), '. Ao gerar, os itens serão atualizados.');
          banner.appendChild(text);
          banner.appendChild(U.el('button', {
            class: 'btn btn-secondary btn-sm', type: 'button',
            onclick: function () { cancelEditPurchase(); }
          }, 'Cancelar edição'));
          banner.hidden = false;
        } else {
          S.editingPurchase = null;
          banner.hidden = true;
        }
      } else {
        banner.hidden = true;
      }
    }

    if (!draft.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 6, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: 'Lista de compra vazia' }));
      td.appendChild(U.el('span', { text: 'Use o botão "Adicionar" na tabela de saldo para montar a reposição.' }));
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      draft.forEach(function (item) {
        const tr = U.el('tr');
        tr.appendChild(U.el('td', { text: item.product.codigo }));
        tr.appendChild(U.el('td', { text: item.product.nome }));
        tr.appendChild(U.el('td', { class: 'num', text: String(DB.stockFor(item.product.id, state)) }));
        tr.appendChild(U.el('td', { class: 'num', text: String(item.product.minStock || 0) }));
        const qtyCell = U.el('td', { class: 'num' });
        const qty = U.el('input', {
          class: 'qty-input', type: 'number', min: '1', step: '1', value: item.qty,
          'aria-label': 'Quantidade a comprar de ' + item.product.nome
        });
        qty.addEventListener('change', function () { updateDraftQty(item.product.id, qty.value); });
        qtyCell.appendChild(qty);
        tr.appendChild(qtyCell);
        const actions = U.el('td', { class: 'actions-cell' });
        actions.appendChild(U.el('button', {
          class: 'btn btn-danger-ghost btn-sm', type: 'button', 'aria-label': 'Remover ' + item.product.nome + ' da lista',
          onclick: function () { removeDraft(item.product.id); }
        }, U.icon('trash')));
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });
    }

    if (createButton) {
      createButton.disabled = draft.length === 0;
      createButton.innerHTML = '';
      createButton.appendChild(U.icon('check'));
      createButton.appendChild(document.createTextNode(S.editingPurchase ? 'Salvar ordem' : 'Gerar ordem'));
    }
  }

  function addDraft(productId) {
    const state = DB.get();
    const product = draftProduct(state, productId);
    if (!product) return;
    const saldo = DB.stockFor(productId, state);
    const qty = Math.max(1, U.toNumber(product.minStock, 0) - saldo);
    try {
      DB.tx(function (s) {
        if (!s.purchaseDraft.some(function (item) { return item.productId === productId; })) {
          s.purchaseDraft.push({ productId: productId, qty: qty });
        }
      });
      renderStock();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  function removeDraft(productId) {
    try {
      DB.tx(function (s) {
        s.purchaseDraft = s.purchaseDraft.filter(function (item) { return item.productId !== productId; });
      });
      renderStock();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  function updateDraftQty(productId, value) {
    const qty = Math.max(1, Math.round(U.toNumber(value, 1)));
    try {
      DB.tx(function (s) {
        const item = s.purchaseDraft.find(function (i) { return i.productId === productId; });
        if (item) item.qty = qty;
      });
      renderStock();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  function cancelEditPurchase() {
    S.editingPurchase = null;
    try {
      DB.tx(function (s) { s.purchaseDraft = []; });
      renderStock();
      UI.toast('Edição da ordem cancelada.', 'info');
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function createPurchase() {
    const state = DB.get();
    const items = state.purchaseDraft.map(function (item) {
      const p = draftProduct(state, item.productId);
      return p ? {
        productId: p.id, codigo: p.codigo, nome: p.nome,
        qty: Math.max(1, Math.round(U.toNumber(item.qty, 1))), unitCost: U.toNumber(p.cost, 0)
      } : null;
    }).filter(Boolean);
    if (!items.length) { UI.toast('Adicione produtos à lista de compra.', 'warn'); return; }
    const total = U.round(U.sum(items, function (i) { return i.qty * i.unitCost; }), 2);
    const order = S.editingPurchase ? state.purchaseOrders.find(function (o) { return o.id === S.editingPurchase; }) : null;
    if (S.editingPurchase && !order) { UI.toast('Ordem em edição não encontrada.', 'error'); return; }

    const ok = await UI.confirm({
      title: S.editingPurchase ? 'Salvar ordem de compra' : 'Gerar ordem de compra',
      message: (S.editingPurchase ? 'Atualizar ' : 'Criar ') + 'uma ordem com ' + items.length + ' item(ns), total estimado de ' + U.fmtMoney(total) + '?',
      confirmLabel: S.editingPurchase ? 'Salvar ordem' : 'Gerar ordem',
      danger: false
    });
    if (!ok) return;

    try {
      const editing = Boolean(S.editingPurchase);
      DB.tx(function (s) {
        let target = S.editingPurchase ? s.purchaseOrders.find(function (o) { return o.id === S.editingPurchase; }) : null;
        if (target && target.status !== 'aberta') throw new Error('Somente ordens abertas podem ser editadas.');
        if (!target) {
          target = {
            id: U.uid('purchase'),
            number: DB.makeNumber(s, 'purchase'),
            status: 'aberta',
            items: [],
            total: 0,
            notes: '',
            createdAt: U.nowISO(),
            closedAt: '',
            receivedAt: ''
          };
          s.purchaseOrders.push(target);
        }
        target.items = items;
        target.total = total;
        target.updatedAt = U.nowISO();
        s.purchaseDraft = [];
      });
      S.editingPurchase = null;
      UI.toast(editing ? 'Ordem atualizada.' : 'Ordem de compra criada.');
      M.showTab('compras');
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  /* ============================== compras ============================== */

  function renderPurchases() {
    const state = DB.get();
    const tbody = document.querySelector('#purchases-table tbody');
    if (!tbody) return;
    U.clear(tbody);
    const term = norm(S.purchaseSearch);
    const list = state.purchaseOrders.filter(function (order) {
      if (S.purchaseStatus && order.status !== S.purchaseStatus) return false;
      if (!term) return true;
      const haystack = [order.number, order.notes].concat(order.items.map(function (i) { return i.codigo + ' ' + i.nome; })).join(' ').toLowerCase();
      return haystack.indexOf(term) > -1;
    }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

    S.purchasePage = Math.min(S.purchasePage, UI.pages(list.length, PER_PAGE));
    const rows = UI.slice(list, S.purchasePage, PER_PAGE);

    if (!rows.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 6, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: state.purchaseOrders.length ? 'Nenhuma ordem encontrada' : 'Nenhuma ordem de compra' }));
      td.appendChild(U.el('span', { text: 'Monte uma lista no Estoque atual para gerar a primeira ordem.' }));
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      rows.forEach(function (order) {
        const tr = U.el('tr');
        tr.appendChild(U.el('td', { class: 'nowrap' }, U.el('span', { class: 'strong', text: order.number })));
        tr.appendChild(U.el('td', { class: 'nowrap', text: U.fmtDate(order.createdAt) }));
        const itemCell = U.el('td');
        itemCell.appendChild(U.el('span', { class: 'strong', text: order.items.length + ' item(ns)' }));
        itemCell.appendChild(U.el('span', { class: 'sub', text: order.items.slice(0, 2).map(function (i) { return i.codigo + ' · ' + i.qty + ' un.'; }).join(' | ') + (order.items.length > 2 ? ' …' : '') }));
        tr.appendChild(itemCell);
        tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(order.total) }));
        const status = U.el('td');
        status.appendChild(UI.purchaseBadge(order.status));
        tr.appendChild(status);
        const actions = U.el('td', { class: 'actions-cell' });
        if (order.status === 'aberta') {
          actions.appendChild(U.el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', title: 'Editar ordem', 'aria-label': 'Editar ordem ' + order.number,
            onclick: function () { editPurchase(order.id); }
          }, U.icon('pen')));
          actions.appendChild(U.el('button', {
            class: 'btn btn-success btn-sm', type: 'button', title: 'Encerrar e dar entrada', 'aria-label': 'Encerrar ordem ' + order.number,
            onclick: function () { closePurchase(order.id); }
          }, U.icon('check')));
        } else {
          actions.appendChild(U.el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', title: 'Reabrir ordem', 'aria-label': 'Reabrir ordem ' + order.number,
            onclick: function () { reopenPurchase(order.id); }
          }, U.icon('rotate')));
        }
        actions.appendChild(U.el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', title: 'Imprimir ordem', 'aria-label': 'Imprimir ordem ' + order.number,
          onclick: function () { printPurchase(order.id); }
        }, U.icon('printer')));
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });
    }

    UI.pagination(document.getElementById('purchases-pagination'), {
      page: S.purchasePage, pages: UI.pages(list.length, PER_PAGE), total: list.length, pageSize: PER_PAGE,
      onChange: function (page) { S.purchasePage = page; renderPurchases(); }
    });
  }

  function editPurchase(orderId) {
    const state = DB.get();
    const order = state.purchaseOrders.find(function (o) { return o.id === orderId; });
    if (!order || order.status !== 'aberta') return;
    try {
      DB.tx(function (s) {
        s.purchaseDraft = order.items.map(function (item) {
          return { productId: item.productId, qty: item.qty };
        });
      });
      S.editingPurchase = orderId;
      M.showTab('saldo');
      UI.toast('Edite as quantidades e salve a ordem.', 'info');
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function closePurchase(orderId) {
    const state = DB.get();
    const order = state.purchaseOrders.find(function (o) { return o.id === orderId; });
    if (!order || order.status !== 'aberta') return;
    const ok = await UI.confirm({
      title: 'Encerrar ordem de compra',
      message: 'Encerrar ' + order.number + ' e dar entrada de ' + order.items.length + ' item(ns) no estoque? Também será criada uma conta a pagar de ' + U.fmtMoney(order.total) + '.',
      confirmLabel: 'Encerrar e dar entrada',
      danger: false
    });
    if (!ok) return;
    try {
      DB.tx(function (s) {
        const current = s.purchaseOrders.find(function (o) { return o.id === orderId; });
        if (!current || current.status !== 'aberta') throw new Error('Esta ordem já foi encerrada.');
        current.items.forEach(function (item) {
          const product = s.products.find(function (p) { return p.id === item.productId; });
          if (!product) throw new Error('Produto não encontrado: ' + item.nome + '.');
          s.movements.push({
            id: U.uid('mov'), productId: product.id, type: 'entrada', quantity: item.qty,
            unitCost: item.unitCost, unitPrice: product.price, cycle: '', expiry: '', supplier: 'Compra',
            note: 'Compra ' + current.number, orderId: current.id, createdAt: U.nowISO(), updatedAt: U.nowISO()
          });
          if (U.toNumber(item.unitCost, 0) > 0) product.cost = item.unitCost;
          product.updatedAt = U.nowISO();
        });
        current.status = 'encerrada';
        current.closedAt = U.nowISO();
        current.receivedAt = U.nowISO();
        current.updatedAt = U.nowISO();
        if (current.total > 0 && !s.finance.some(function (f) { return f.purchaseOrderId === current.id; })) {
          s.finance.push({
            id: U.uid('fin'), type: 'despesa', description: 'Compra ' + current.number,
            amount: current.total, category: 'Compras', dueDate: U.todayISO(), paidAt: '',
            status: 'pendente', origin: 'purchase', saleId: '', purchaseOrderId: current.id,
            notes: '', createdAt: U.nowISO(), updatedAt: U.nowISO()
          });
        }
      });
      UI.toast('Ordem encerrada e estoque atualizado.');
      renderPurchases();
      renderStock();
      renderProducts();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  async function reopenPurchase(orderId) {
    const state = DB.get();
    const order = state.purchaseOrders.find(function (o) { return o.id === orderId; });
    if (!order || order.status !== 'encerrada') return;
    const finance = DB.financeOfPurchase(orderId, state);
    if (finance && finance.status === 'pago') {
      UI.toast('A conta a pagar desta compra já foi paga. Cancele ou reabra o lançamento no Financeiro antes de reabrir a ordem.', 'error');
      return;
    }
    const short = order.items.filter(function (item) {
      return DB.stockFor(item.productId, state) - item.qty < 0;
    });
    if (short.length) {
      UI.toast('Não dá para reabrir: parte da mercadoria desta compra já foi vendida (' + short.slice(0, 3).map(function (i) { return i.nome; }).join(', ') + '). Registre um ajuste de estoque.', 'error');
      return;
    }
    const ok = await UI.confirm({
      title: 'Reabrir ordem de compra',
      message: 'Reabrir ' + order.number + '? As entradas geradas por esta ordem serão removidas do estoque e a conta a pagar pendente será excluída.',
      confirmLabel: 'Reabrir ordem'
    });
    if (!ok) return;
    try {
      DB.tx(function (s) {
        const current = s.purchaseOrders.find(function (o) { return o.id === orderId; });
        if (!current || current.status !== 'encerrada') throw new Error('Esta ordem não está encerrada.');
        s.movements = s.movements.filter(function (m) { return m.orderId !== orderId; });
        s.finance = s.finance.filter(function (f) {
          return !(f.purchaseOrderId === orderId && f.status === 'pendente');
        });
        current.status = 'aberta';
        current.closedAt = '';
        current.receivedAt = '';
        current.updatedAt = U.nowISO();
      });
      UI.toast('Ordem reaberta. As entradas foram removidas.');
      renderPurchases();
      renderStock();
      renderProducts();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  function printPurchase(orderId) {
    const state = DB.get();
    const order = DB.orderById(orderId, state);
    if (!order) return;
    const e = U.escapeHtml;
    const store = state.settings.storeName || 'UniHub';
    const rows = order.items.map(function (i) {
      return '<tr><td>' + e(i.codigo) + '</td><td>' + e(i.nome) + '</td><td class="n">' + Number(i.qty) + '</td><td class="n">' + e(U.fmtMoney(i.unitCost)) + '</td><td class="n">' + e(U.fmtMoney(i.qty * i.unitCost)) + '</td></tr>';
    }).join('');
    Hub.printHtml(order.number,
      '<header><div><h1>' + e(store).toUpperCase() + '</h1><h2>Ordem de compra ' + e(order.number) + '</h2></div><div style="text-align:right"><div>' + e(U.fmtDate(order.createdAt)) + '</div><div>' + e(order.status === 'encerrada' ? 'Encerrada' : 'Aberta') + '</div></div></header>' +
      '<table><thead><tr><th>Código</th><th>Produto</th><th class="n">Qtd.</th><th class="n">Custo</th><th class="n">Total</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="totals"><div class="grand"><span>Total</span><span>' + e(U.fmtMoney(order.total)) + '</span></div></div><footer>' + e(store) + ' · UniHub V4</footer>');
  }

  /* ============================== histórico ============================== */

  function renderHistory() {
    const state = DB.get();
    const tbody = document.querySelector('#history-table tbody');
    if (!tbody) return;
    U.clear(tbody);
    const term = norm(S.historySearch);
    const list = state.movements.filter(function (m) {
      if (S.historyType && m.type !== S.historyType) return false;
      const p = DB.productById(m.productId, state);
      const sale = DB.saleById(m.saleId, state);
      const order = DB.orderById(m.orderId, state);
      const date = U.dateOnly(m.createdAt);
      if (S.historyFrom && date < S.historyFrom) return false;
      if (S.historyTo && date > S.historyTo) return false;
      const haystack = [p ? p.codigo : '', p ? p.nome : '', m.note, m.supplier, m.cycle, sale ? sale.number : '', order ? order.number : ''].join(' ').toLowerCase();
      return !term || haystack.indexOf(term) > -1;
    }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

    S.historyPage = Math.min(S.historyPage, UI.pages(list.length, PER_PAGE));
    const rows = UI.slice(list, S.historyPage, PER_PAGE);

    if (!rows.length) {
      const tr = U.el('tr');
      const td = U.el('td', { colspan: 7, class: 'table-empty' });
      td.appendChild(U.el('strong', { text: 'Nenhuma movimentação encontrada' }));
      td.appendChild(U.el('span', { text: state.movements.length ? 'Ajuste os filtros de busca.' : 'Entradas e saídas aparecerão aqui.' }));
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      rows.forEach(function (m) {
        const p = DB.productById(m.productId, state);
        const sale = DB.saleById(m.saleId, state);
        const order = DB.orderById(m.orderId, state);
        const signed = m.type === 'entrada' ? '+' + m.quantity : m.type === 'saida' ? '−' + m.quantity : (m.quantity > 0 ? '+' : '') + m.quantity;
        const tr = U.el('tr');
        tr.appendChild(U.el('td', { class: 'nowrap', text: U.fmtDateTime(m.createdAt) }));
        const name = U.el('td');
        name.appendChild(U.el('span', { class: 'strong', text: p ? p.nome : 'Produto removido' }));
        name.appendChild(U.el('span', { class: 'sub', text: p ? p.codigo : '' }));
        tr.appendChild(name);
        const type = U.el('td');
        type.appendChild(UI.movementBadge(m.type));
        tr.appendChild(type);
        tr.appendChild(U.el('td', { class: 'num', text: signed }));
        tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(m.unitCost) }));
        tr.appendChild(U.el('td', { text: sale ? sale.number : order ? order.number : 'Manual' }));
        tr.appendChild(U.el('td', { text: m.note || '—' }));
        tbody.appendChild(tr);
      });
    }

    UI.pagination(document.getElementById('history-pagination'), {
      page: S.historyPage, pages: UI.pages(list.length, PER_PAGE), total: list.length, pageSize: PER_PAGE,
      onChange: function (page) { S.historyPage = page; renderHistory(); }
    });
  }

  /* ============================== cadastros ============================== */

  function registerCount(state, type, id) {
    if (type === 'brand') return state.products.filter(function (p) { return p.brandId === id; }).length;
    if (type === 'category') return state.products.filter(function (p) { return p.categoryId === id; }).length;
    return state.productTags.filter(function (pt) { return pt.tagId === id; }).length;
  }

  function renderRegisters() {
    const state = DB.get();

    function renderList(containerId, type, items, groupByType) {
      const list = document.getElementById(containerId);
      if (!list) return;
      U.clear(list);
      if (!items.length) {
        list.appendChild(U.el('li', { class: 'muted small', text: 'Nenhum registro ainda.' }));
        return;
      }
      let lastType = null;
      items.forEach(function (item) {
        if (groupByType && item.tipo !== lastType) {
          lastType = item.tipo;
          const labels = { tipo_produto: 'Tipo de produto', familia_olfativa: 'Família olfativa', linha: 'Linha' };
          list.appendChild(U.el('li', { class: 'register-group-label', text: labels[item.tipo] || item.tipo }));
        }
        const li = U.el('li');
        li.appendChild(U.el('span', { class: 'register-name', text: item.nome }));
        li.appendChild(U.el('span', { class: 'register-count', text: registerCount(state, type, item.id) + ' uso(s)' }));
        li.appendChild(U.el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', title: 'Renomear', 'aria-label': 'Renomear ' + item.nome,
          onclick: function () { renameRegister(type, item.id); }
        }, U.icon('pen')));
        li.appendChild(U.el('button', {
          class: 'btn btn-danger-ghost btn-sm', type: 'button', title: 'Excluir', 'aria-label': 'Excluir ' + item.nome,
          onclick: function () { deleteRegister(type, item.id); }
        }, U.icon('trash')));
        list.appendChild(li);
      });
    }

    renderList('brand-list', 'brand', state.brands.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); }));
    renderList('category-list', 'category', state.categories.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); }));
    const tagOrder = { tipo_produto: 0, familia_olfativa: 1, linha: 2 };
    renderList('tag-list', 'tag', state.tags.slice().sort(function (a, b) {
      return (tagOrder[a.tipo] - tagOrder[b.tipo]) || a.nome.localeCompare(b.nome, 'pt-BR');
    }), true);
  }

  async function renameRegister(type, id) {
    const state = DB.get();
    const collection = type === 'brand' ? state.brands : type === 'category' ? state.categories : state.tags;
    const item = collection.find(function (i) { return i.id === id; });
    if (!item) return;
    const label = type === 'brand' ? 'marca' : type === 'category' ? 'categoria' : 'subcategoria';
    const value = await UI.prompt({ title: 'Renomear ' + label, label: 'Novo nome', value: item.nome });
    if (value === null) return;
    if (!value) { UI.toast('O nome não pode ficar vazio.', 'warn'); return; }
    try {
      DB.tx(function (s) {
        const target = (type === 'brand' ? s.brands : type === 'category' ? s.categories : s.tags)
          .find(function (i) { return i.id === id; });
        if (!target) throw new Error('Registro não encontrado.');
        if (type === 'tag') {
          const duplicate = s.tags.some(function (t) {
            return t.id !== id && t.tipo === target.tipo && norm(t.nome) === norm(value);
          });
          if (duplicate) throw new Error('Já existe uma subcategoria com esse nome neste grupo.');
        } else {
          const list = type === 'brand' ? s.brands : s.categories;
          if (list.some(function (i) { return i.id !== id && norm(i.nome) === norm(value); })) {
            throw new Error('Já existe um registro com esse nome.');
          }
        }
        target.nome = value;
      });
      UI.toast('Nome atualizado.');
      populateFilters();
      renderRegisters();
      renderProducts();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  async function deleteRegister(type, id) {
    const state = DB.get();
    const collection = type === 'brand' ? state.brands : type === 'category' ? state.categories : state.tags;
    const item = collection.find(function (i) { return i.id === id; });
    if (!item) return;
    const count = registerCount(state, type, id);
    const label = type === 'brand' ? 'marca' : type === 'category' ? 'categoria' : 'subcategoria';
    const message = count
      ? 'Excluir a ' + label + ' "' + item.nome + '"? Ela está em ' + count + ' registro(s); os vínculos serão removidos.'
      : 'Excluir a ' + label + ' "' + item.nome + '"?';
    const ok = await UI.confirm({ title: 'Excluir ' + label, message: message, confirmLabel: 'Excluir' });
    if (!ok) return;
    try {
      DB.tx(function (s) {
        if (type === 'brand') {
          s.products.forEach(function (p) { if (p.brandId === id) p.brandId = null; });
          s.brands = s.brands.filter(function (b) { return b.id !== id; });
        } else if (type === 'category') {
          s.products.forEach(function (p) { if (p.categoryId === id) p.categoryId = null; });
          s.categories = s.categories.filter(function (c) { return c.id !== id; });
        } else {
          s.tags = s.tags.filter(function (t) { return t.id !== id; });
          s.productTags = s.productTags.filter(function (pt) { return pt.tagId !== id; });
        }
      });
      UI.toast(label.charAt(0).toUpperCase() + label.slice(1) + ' excluída.');
      populateFilters();
      renderRegisters();
      renderProducts();
    } catch (err) { UI.toast(err.message, 'error'); }
  }

  function addRegister(type, name, tagType) {
    const value = U.normalizeText(name);
    if (!value) { UI.toast('Informe um nome.', 'warn'); return false; }
    const state = DB.get();
    try {
      DB.tx(function (s) {
        if (type === 'brand') {
          if (s.brands.some(function (b) { return norm(b.nome) === norm(value); })) throw new Error('Marca já cadastrada.');
          s.brands.push({ id: U.uid('brand'), nome: value, createdAt: U.nowISO() });
        } else if (type === 'category') {
          if (s.categories.some(function (c) { return norm(c.nome) === norm(value); })) throw new Error('Categoria já cadastrada.');
          s.categories.push({ id: U.uid('cat'), nome: value, createdAt: U.nowISO() });
        } else {
          if (s.tags.some(function (t) { return t.tipo === tagType && norm(t.nome) === norm(value); })) {
            throw new Error('Subcategoria já cadastrada neste grupo.');
          }
          s.tags.push({ id: U.uid('tag'), tipo: tagType, nome: value, createdAt: U.nowISO() });
        }
      });
      UI.toast('Cadastro adicionado.');
      populateFilters();
      renderRegisters();
      return true;
    } catch (err) {
      UI.toast(err.message, 'error');
      return false;
    }
  }

  /* ============================== exports ============================== */

  function exportProducts() {
    const state = DB.get();
    const rows = state.products.map(function (p) {
      const brand = DB.brandById(p.brandId, state);
      const category = DB.categoryById(p.categoryId, state);
      return [p.codigo, p.nome, p.nomeTecnico, brand ? brand.nome : '', category ? category.nome : '', lineOf(p, state), p.cost, p.price, p.minStock, DB.stockFor(p.id, state), p.active !== false ? 'Ativo' : 'Inativo'];
    });
    U.download('produtos.csv', U.toCSV(['Código', 'Produto', 'Nome técnico', 'Marca', 'Categoria', 'Linha', 'Custo', 'Revista', 'Mínimo', 'Saldo', 'Situação'], rows), 'text/csv;charset=utf-8');
  }

  function exportEntries() {
    const state = DB.get();
    const rows = state.movements.filter(function (m) { return m.type === 'entrada'; }).map(function (m) {
      const p = DB.productById(m.productId, state);
      const order = DB.orderById(m.orderId, state);
      return [U.fmtDate(m.createdAt), p ? p.codigo : '', p ? p.nome : '', m.quantity, m.unitCost, m.cycle, m.supplier, order ? order.number : 'Manual', m.note];
    });
    U.download('entradas.csv', U.toCSV(['Data', 'Código', 'Produto', 'Quantidade', 'Custo', 'Ciclo', 'Fornecedor', 'Origem', 'Observação'], rows), 'text/csv;charset=utf-8');
  }

  function exportStock() {
    const state = DB.get();
    const rows = stockRows(state).map(function (row) {
      return [row.product.codigo, row.product.nome, productLabel(row.product, state), row.last ? U.fmtDate(row.last.createdAt) : '', row.saldo, row.product.minStock || 0, row.status.label, row.product.cost, row.product.price, (Math.max(0, row.saldo) * U.toNumber(row.product.cost, 0)).toFixed(2)];
    });
    U.download('estoque-atual.csv', U.toCSV(['Código', 'Produto', 'Marca / linha', 'Última entrada', 'Saldo', 'Mínimo', 'Situação', 'Custo', 'Revista', 'Valor a custo'], rows), 'text/csv;charset=utf-8');
  }

  function exportHistory() {
    const state = DB.get();
    const rows = state.movements.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).map(function (m) {
      const p = DB.productById(m.productId, state);
      const sale = DB.saleById(m.saleId, state);
      const order = DB.orderById(m.orderId, state);
      return [U.fmtDateTime(m.createdAt), p ? p.codigo : '', p ? p.nome : '', m.type, m.quantity, m.unitCost, sale ? sale.number : order ? order.number : 'Manual', m.note];
    });
    U.download('historico-estoque.csv', U.toCSV(['Data', 'Código', 'Produto', 'Tipo', 'Quantidade', 'Custo', 'Origem', 'Observação'], rows), 'text/csv;charset=utf-8');
  }

  /* ============================== init ============================== */

  function renderTab(name) {
    S.tab = name || S.tab;
    if (S.tab === 'produtos') { populateFilters(); renderProducts(); }
    else if (S.tab === 'entradas') renderEntries();
    else if (S.tab === 'saldo') renderStock();
    else if (S.tab === 'compras') renderPurchases();
    else if (S.tab === 'historico') renderHistory();
    else if (S.tab === 'cadastros') renderRegisters();
  }

  M.showTab = function (name) {
    if (name) {
      S.tab = name;
      activateTab(name);
    } else {
      renderTab(S.tab);
    }
  };

  M.openProductDialog = openProductDialog;
  M.openEntryDialog = openEntryDialog;
  M.openAdjustDialog = openAdjustDialog;
  M.render = function () { populateFilters(); renderTab(S.tab); };

  M.init = function () {
    const root = document.getElementById('view-estoque');
    if (!root) return;
    activateTab = UI.initTabs(document.getElementById('estoque-tabs'), function (name) {
      S.tab = name;
      renderTab(name);
    });

    const prodSearch = document.getElementById('prod-search');
    if (prodSearch) prodSearch.addEventListener('input', U.debounce(function () { S.prodSearch = prodSearch.value; S.prodPage = 1; renderProducts(); }, 180));
    ['prod-brand-filter', 'prod-category-filter', 'prod-status-filter'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        if (id === 'prod-brand-filter') S.prodBrand = el.value;
        if (id === 'prod-category-filter') S.prodCategory = el.value;
        if (id === 'prod-status-filter') S.prodStatus = el.value;
        S.prodPage = 1;
        renderProducts();
      });
    });

    const entrySearch = document.getElementById('entry-search');
    if (entrySearch) entrySearch.addEventListener('input', U.debounce(function () { S.entrySearch = entrySearch.value; S.entryPage = 1; renderEntries(); }, 180));

    const stockSearch = document.getElementById('stock-search');
    if (stockSearch) stockSearch.addEventListener('input', U.debounce(function () { S.stockSearch = stockSearch.value; S.stockPage = 1; renderStock(); }, 180));
    const stockStatus = document.getElementById('stock-status-filter');
    if (stockStatus) stockStatus.addEventListener('change', function () { S.stockStatus = stockStatus.value; S.stockPage = 1; renderStock(); });
    const stockMoved = document.getElementById('stock-only-moved');
    if (stockMoved) stockMoved.addEventListener('change', function () { S.stockOnlyMoved = stockMoved.checked; S.stockPage = 1; renderStock(); });

    const purchaseSearch = document.getElementById('purchase-search');
    if (purchaseSearch) purchaseSearch.addEventListener('input', U.debounce(function () { S.purchaseSearch = purchaseSearch.value; S.purchasePage = 1; renderPurchases(); }, 180));
    const purchaseStatus = document.getElementById('purchase-status-filter');
    if (purchaseStatus) purchaseStatus.addEventListener('change', function () { S.purchaseStatus = purchaseStatus.value; S.purchasePage = 1; renderPurchases(); });

    const historySearch = document.getElementById('history-search');
    if (historySearch) historySearch.addEventListener('input', U.debounce(function () { S.historySearch = historySearch.value; S.historyPage = 1; renderHistory(); }, 180));
    const historyType = document.getElementById('history-type-filter');
    if (historyType) historyType.addEventListener('change', function () { S.historyType = historyType.value; S.historyPage = 1; renderHistory(); });
    ['history-from', 'history-to'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        if (id === 'history-from') S.historyFrom = el.value;
        if (id === 'history-to') S.historyTo = el.value;
        S.historyPage = 1;
        renderHistory();
      });
    });

    const clickMap = {
      'btn-new-product': function () { openProductDialog(); },
      'btn-new-entry': function () { openEntryDialog(); },
      'btn-create-purchase': function () { createPurchase(); },
      'btn-suggest-purchase': suggestReplenishment,
      'btn-adjust-stock': function () { openAdjustDialog(); },
      'btn-export-products': exportProducts,
      'btn-export-entries': exportEntries,
      'btn-export-stock': exportStock,
      'btn-export-history': exportHistory
    };
    Object.keys(clickMap).forEach(function (id) {
      const button = document.getElementById(id);
      if (button) button.addEventListener('click', clickMap[id]);
    });

    const brandForm = document.getElementById('brand-form');
    if (brandForm) brandForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const input = document.getElementById('brand-name');
      if (addRegister('brand', input.value)) input.value = '';
    });
    const categoryForm = document.getElementById('category-form');
    if (categoryForm) categoryForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const input = document.getElementById('category-name');
      if (addRegister('category', input.value)) input.value = '';
    });
    const tagForm = document.getElementById('tag-form');
    if (tagForm) tagForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const input = document.getElementById('tag-name');
      const type = document.getElementById('tag-type');
      if (addRegister('tag', input.value, type.value)) input.value = '';
    });

    const importButton = document.getElementById('btn-import-catalog');
    if (importButton) importButton.addEventListener('click', function () {
      if (Hub.importer && typeof Hub.importer.open === 'function') Hub.importer.open();
      else UI.toast('Módulo de importação não carregado.', 'error');
    });

    populateFilters();
    renderTab('produtos');
  };

  Hub.modules = Hub.modules || {};
  Hub.modules.estoque = M;
})(window.Hub = window.Hub || {});
