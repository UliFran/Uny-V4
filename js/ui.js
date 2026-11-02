/* ==========================================================================
   UniHub V4 — componentes de interface
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = Hub.utils;
  const UI = {};

  const CONFIRM = document.getElementById('confirm-dialog');
  const PROMPT = document.getElementById('prompt-dialog');

  /* ------------------------------- toasts ------------------------------- */

  const TOAST_ICONS = { success: 'check', error: 'alert', warn: 'alert', info: 'spark' };

  UI.toast = function (message, type, title) {
    const region = document.getElementById('toast-region');
    if (!region) return;
    const kind = type || 'success';
    const toast = U.el('div', { class: 'toast is-' + kind, role: kind === 'error' ? 'alert' : 'status' });
    toast.appendChild(U.icon(TOAST_ICONS[kind] || 'check'));
    const content = U.el('div', { class: 'toast-content' });
    if (title) content.appendChild(U.el('strong', { text: title }));
    content.appendChild(document.createTextNode(message));
    toast.appendChild(content);
    const close = U.el('button', {
      class: 'toast-close', type: 'button', 'aria-label': 'Fechar aviso',
      onclick: function () { remove(); }
    }, U.icon('x'));
    toast.appendChild(close);
    region.appendChild(toast);

    let timer = setTimeout(remove, kind === 'error' ? 8000 : 4800);
    function remove() {
      clearTimeout(timer);
      if (!toast.parentNode) return;
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 160);
    }
    return toast;
  };

  /* ------------------------------- diálogos ------------------------------- */

  UI.openDialog = function (dialog) {
    if (!dialog) return;
    if (dialog.open) {
      U.focusFirst(dialog);
      return;
    }
    dialog.showModal();
    U.focusFirst(dialog);
  };

  UI.closeDialog = function (dialog) {
    if (dialog && dialog.open) dialog.close();
  };

  UI.confirm = function (options) {
    const opts = options || {};
    return new Promise(function (resolve) {
      const title = document.getElementById('confirm-title');
      const message = document.getElementById('confirm-message');
      const ok = document.getElementById('confirm-ok');
      if (!CONFIRM || !title || !message || !ok) {
        resolve(window.confirm(opts.message || 'Confirmar ação?'));
        return;
      }
      if (CONFIRM.open) { resolve(false); return; }

      title.textContent = opts.title || 'Confirmar ação';
      message.textContent = opts.message || '';
      ok.textContent = opts.confirmLabel || 'Confirmar';
      ok.className = 'btn ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');
      CONFIRM.returnValue = 'cancel';

      function onClose() {
        CONFIRM.removeEventListener('close', onClose);
        resolve(CONFIRM.returnValue === 'confirm');
      }
      if (CONFIRM.open) CONFIRM.close();
      CONFIRM.addEventListener('close', onClose);
      CONFIRM.showModal();
      setTimeout(function () { ok.focus(); }, 40);
    });
  };

  UI.prompt = function (options) {
    const opts = options || {};
    return new Promise(function (resolve) {
      if (!PROMPT) {
        resolve(window.prompt(opts.label || 'Valor', opts.value || ''));
        return;
      }
      const title = document.getElementById('prompt-title');
      const label = document.getElementById('prompt-label');
      const input = document.getElementById('prompt-input');
      const form = document.getElementById('prompt-form');
      title.textContent = opts.title || 'Editar';
      label.textContent = opts.label || 'Valor';
      input.placeholder = opts.placeholder || '';
      input.maxLength = opts.maxLength || 80;
      PROMPT.returnValue = 'cancel';
      form.reset();
      input.value = opts.value || '';

      function onClose() {
        PROMPT.removeEventListener('close', onClose);
        const value = PROMPT.returnValue === 'save' ? U.normalizeText(input.value) : null;
        resolve(value);
      }
      if (PROMPT.open) { resolve(null); return; }
      PROMPT.addEventListener('close', onClose);
      PROMPT.showModal();
      setTimeout(function () { input.focus(); input.select(); }, 40);
    });
  };

  UI.formError = function (form, message) {
    if (!form) return;
    const box = form.querySelector('.form-error');
    if (!box) return;
    box.textContent = message;
    box.classList.add('is-visible');
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  UI.clearFormError = function (form) {
    if (!form) return;
    const box = form.querySelector('.form-error');
    if (box) {
      box.textContent = '';
      box.classList.remove('is-visible');
    }
    U.$$('.field.has-error', form).forEach(function (field) {
      field.classList.remove('has-error');
      const error = field.querySelector('.field-error');
      if (error) error.textContent = '';
    });
  };

  UI.invalid = function (form, name, message) {
    const field = form ? form.elements[name] : null;
    if (!field) return;
    const wrap = field.closest('.field');
    if (wrap) {
      wrap.classList.add('has-error');
      const error = wrap.querySelector('.field-error');
      if (error) error.textContent = message;
    }
    field.focus();
  };

  UI.formData = function (form) {
    const data = {};
    if (!form) return data;
    const fd = new FormData(form);
    fd.forEach(function (value, key) { data[key] = typeof value === 'string' ? value.trim() : value; });
    U.$$('input[type="checkbox"]', form).forEach(function (input) {
      if (input.name) data[input.name] = input.checked;
    });
    return data;
  };

  UI.setBusy = U.setBusy;

  /* ------------------------------- badges ------------------------------- */

  UI.badge = function (text, tone) {
    return U.el('span', { class: 'badge badge-' + (tone || 'neutral'), text: text });
  };

  const SALE = {
    rascunho: { label: 'Rascunho', tone: 'neutral' },
    confirmado: { label: 'Confirmado', tone: 'blue' },
    separado: { label: 'Separado', tone: 'amber' },
    enviado: { label: 'Enviado', tone: 'blue' },
    entregue: { label: 'Entregue', tone: 'green' },
    devolvido: { label: 'Devolvido', tone: 'neutral' },
    cancelado: { label: 'Cancelado', tone: 'red' }
  };
  const FINANCE = {
    pendente: { label: 'Pendente', tone: 'amber' },
    pago: { label: 'Pago', tone: 'green' },
    cancelado: { label: 'Cancelado', tone: 'neutral' }
  };
  const PURCHASE = {
    aberta: { label: 'Aberta', tone: 'amber' },
    encerrada: { label: 'Encerrada', tone: 'green' }
  };
  const MOVEMENT = {
    entrada: { label: 'Entrada', tone: 'green' },
    saida: { label: 'Saída', tone: 'red' },
    ajuste: { label: 'Ajuste', tone: 'amber' },
    devolucao: { label: 'Devolução', tone: 'blue' }
  };
  const PAYMENT = {
    pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão', fiado: 'Fiado', transferencia: 'Transferência'
  };
  const RECEIPT = {
    agora: 'Recebido na hora', entrega: 'Receber na entrega', prazo: 'A prazo'
  };
  UI.receiptLabel = function (value) { return RECEIPT[value] || value || '—'; };

  UI.saleStatus = function (value) { return SALE[value] || { label: value || '—', tone: 'neutral' }; };
  UI.financeStatus = function (value) { return FINANCE[value] || { label: value || '—', tone: 'neutral' }; };
  UI.purchaseStatus = function (value) { return PURCHASE[value] || { label: value || '—', tone: 'neutral' }; };
  UI.movementStatus = function (value) { return MOVEMENT[value] || { label: value || '—', tone: 'neutral' }; };
  UI.paymentLabel = function (value) { return PAYMENT[value] || value || '—'; };

  UI.saleBadge = function (value) { const s = UI.saleStatus(value); return UI.badge(s.label, s.tone); };
  UI.financeBadge = function (value) { const s = UI.financeStatus(value); return UI.badge(s.label, s.tone); };
  UI.purchaseBadge = function (value) { const s = UI.purchaseStatus(value); return UI.badge(s.label, s.tone); };
  UI.movementBadge = function (value) { const s = UI.movementStatus(value); return UI.badge(s.label, s.tone); };

  /* ------------------------------- tabs ------------------------------- */

  UI.initTabs = function (root, onChange) {
    if (!root) return function () {};
    const tabs = U.$$('.tab[data-tab]', root);
    if (!tabs.length) return function () {};

    function activate(name, focusTab) {
      const tab = tabs.find(function (t) { return t.dataset.tab === name; });
      if (!tab) return;
      tabs.forEach(function (t) {
        const selected = t === tab;
        t.classList.toggle('is-active', selected);
        t.setAttribute('aria-selected', selected ? 'true' : 'false');
        t.tabIndex = selected ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) {
          panel.hidden = !selected;
          panel.classList.toggle('is-active', selected);
        }
      });
      if (focusTab) tab.focus();
      if (typeof onChange === 'function') onChange(name);
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { activate(tab.dataset.tab); });
      tab.addEventListener('keydown', function (event) {
        let next = null;
        if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
        if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
        if (event.key === 'Home') next = tabs[0];
        if (event.key === 'End') next = tabs[tabs.length - 1];
        if (next) {
          event.preventDefault();
          activate(next.dataset.tab, true);
        }
      });
    });

    const active = tabs.find(function (t) { return t.classList.contains('is-active'); }) || tabs[0];
    activate(active.dataset.tab);
    return activate;
  };

  /* ------------------------------- empty / pagination ------------------------------- */

  UI.empty = function (container, options) {
    if (!container) return;
    U.clear(container);
    const opts = options || {};
    const box = U.el('div', { class: 'empty-state' });
    const icon = U.el('div', { class: 'empty-icon' }, U.icon(opts.icon || 'box'));
    box.appendChild(icon);
    box.appendChild(U.el('strong', { text: opts.title || 'Nada por aqui ainda' }));
    box.appendChild(U.el('p', { text: opts.message || 'Cadastre o primeiro registro para começar.' }));
    if (opts.actionLabel) {
      box.appendChild(U.el('button', {
        class: 'btn btn-primary btn-sm', type: 'button', onclick: opts.onAction
      }, U.icon('plus'), opts.actionLabel));
    }
    container.appendChild(box);
  };

  UI.pagination = function (container, options) {
    if (!container) return;
    U.clear(container);
    const opts = options || {};
    const page = Math.max(1, Number(opts.page) || 1);
    const pages = Math.max(0, Number(opts.pages) || 0);
    const total = Number(opts.total) || 0;
    const pageSize = Number(opts.pageSize) || 20;
    if (!total || pages <= 1) return;

    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    container.appendChild(U.el('span', {
      class: 'page-info',
      text: start + '–' + end + ' de ' + total
    }));

    function addPage(label, target, disabled, current) {
      const attrs = {
        type: 'button',
        text: String(label),
        disabled: disabled,
        'aria-label': current ? 'Página ' + target + ', atual' : 'Ir para a página ' + target
      };
      if (current) attrs['aria-current'] = 'page';
      const button = U.el('button', attrs);
      button.addEventListener('click', function () { if (!disabled) opts.onChange(target); });
      container.appendChild(button);
    }

    addPage('‹', page - 1, page <= 1, false);
    let from = Math.max(1, page - 2);
    let to = Math.min(pages, from + 4);
    from = Math.max(1, to - 4);
    if (from > 1) {
      addPage(1, 1, false, page === 1);
      if (from > 2) container.appendChild(U.el('span', { class: 'page-ellipsis', text: '…' }));
    }
    for (let i = from; i <= to; i += 1) addPage(i, i, false, i === page);
    if (to < pages) {
      if (to < pages - 1) container.appendChild(U.el('span', { class: 'page-ellipsis', text: '…' }));
      addPage(pages, pages, false, page === pages);
    }
    addPage('›', page + 1, page >= pages, false);
  };

  UI.slice = function (list, page, pageSize) {
    const p = Math.max(1, Number(page) || 1);
    return list.slice((p - 1) * pageSize, p * pageSize);
  };

  UI.pages = function (total, pageSize) {
    return Math.max(1, Math.ceil(total / pageSize));
  };

  /* ------------------------------- seletor de produto ------------------------------- */

  /**
   * Campo de busca com resultados ao digitar (substitui o <select> gigante).
   * options: { products: [...], onPick(product), stockOf(product), suggestions: [...],
   *            placeholder, limit }
   */
  UI.productPicker = function (options) {
    const opts = options || {};
    const limit = opts.limit || 30;
    const index = (opts.products || []).map(function (p) {
      return {
        product: p,
        text: U.normalizeHeader([p.codigo, p.nome, p.nomeTecnico].join(' ')).replace(/_/g, ' ')
      };
    });

    const wrap = U.el('div', { class: 'picker' });
    const box = U.el('label', { class: 'search-field picker-box' });
    box.appendChild(U.icon('search'));
    const input = U.el('input', {
      type: 'search', class: 'picker-input', autocomplete: 'off', autocapitalize: 'none',
      placeholder: opts.placeholder || 'Digite o nome ou código do produto',
      'aria-label': opts.label || 'Buscar produto', role: 'combobox', 'aria-expanded': 'false'
    });
    box.appendChild(input);
    wrap.appendChild(box);

    const chips = U.el('div', { class: 'picker-chips' });
    if (opts.suggestions && opts.suggestions.length) {
      chips.appendChild(U.el('span', { class: 'picker-chips-label', text: 'Mais vendidos' }));
      opts.suggestions.forEach(function (p) {
        chips.appendChild(U.el('button', {
          class: 'chip', type: 'button', title: p.codigo + ' — ' + p.nome,
          onclick: function () { pick(p); }
        }, U.truncate(p.nome, 28)));
      });
      wrap.appendChild(chips);
    }

    const list = U.el('ul', { class: 'picker-list', role: 'listbox', hidden: true });
    wrap.appendChild(list);

    function describe(p) {
      const stock = typeof opts.stockOf === 'function' ? opts.stockOf(p) : null;
      const side = U.el('span', { class: 'picker-side' });
      side.appendChild(U.el('strong', { text: U.fmtMoney(p.price) }));
      if (stock !== null) {
        side.appendChild(U.el('small', { class: stock <= 0 ? 'is-red' : '', text: stock <= 0 ? 'sem estoque' : stock + ' un.' }));
      }
      return side;
    }

    function pick(p) {
      input.value = '';
      hide();
      if (typeof opts.onPick === 'function') opts.onPick(p);
    }

    function hide() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }

    function render() {
      const raw = input.value.trim();
      if (!raw) { hide(); return; }
      const tokens = U.normalizeHeader(raw).split('_').filter(Boolean);
      const found = [];
      for (let i = 0; i < index.length && found.length < limit; i += 1) {
        const row = index[i];
        if (tokens.every(function (t) { return row.text.indexOf(t) > -1; })) found.push(row.product);
      }
      U.clear(list);
      if (!found.length) {
        list.appendChild(U.el('li', { class: 'picker-empty', text: 'Nenhum produto encontrado.' }));
      }
      found.forEach(function (p) {
        const item = U.el('li', { role: 'option' });
        const btn = U.el('button', { type: 'button', class: 'picker-item', onclick: function () { pick(p); } });
        const main = U.el('span', { class: 'picker-main' });
        main.appendChild(U.el('strong', { text: p.nome }));
        main.appendChild(U.el('small', { text: p.codigo }));
        btn.appendChild(main);
        btn.appendChild(describe(p));
        item.appendChild(btn);
        list.appendChild(item);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('input', U.debounce(render, 90));
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        const first = list.querySelector('.picker-item');
        if (first) first.click();
      } else if (event.key === 'ArrowDown') {
        const first = list.querySelector('.picker-item');
        if (first) { event.preventDefault(); first.focus(); }
      } else if (event.key === 'Escape') {
        if (!list.hidden) { event.stopPropagation(); hide(); }
      }
    });
    list.addEventListener('keydown', function (event) {
      const items = U.$$('.picker-item', list);
      const at = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' && at < items.length - 1) { event.preventDefault(); items[at + 1].focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); if (at > 0) items[at - 1].focus(); else input.focus(); }
      if (event.key === 'Escape') { event.stopPropagation(); hide(); input.focus(); }
    });
    document.addEventListener('click', function (event) {
      if (!wrap.isConnected) return;
      if (!wrap.contains(event.target)) hide();
    });

    return { el: wrap, input: input, focus: function () { input.focus(); }, clear: function () { input.value = ''; hide(); } };
  };

  /* ------------------------------- misc ------------------------------- */

  UI.option = function (value, label, selected) {
    return U.el('option', { value: value, text: label, selected: Boolean(selected) });
  };

  UI.options = function (select, items, options) {
    const opts = options || {};
    if (!select) return;
    const current = opts.keepValue === false ? null : select.value;
    U.clear(select);
    if (opts.placeholder !== undefined) {
      select.appendChild(UI.option('', opts.placeholder, current === '' || current === null || current === undefined));
    }
    items.forEach(function (item) {
      const value = typeof item === 'object' ? item.value : item;
      const label = typeof item === 'object' ? item.label : item;
      select.appendChild(UI.option(value, label, String(value) === String(current)));
    });
    if (opts.value !== undefined) select.value = opts.value;
  };

  UI.field = function (label, input, options) {
    const opts = options || {};
    const fieldId = input && input.id ? input.id : 'field-' + U.uid();
    if (input && !input.id) input.id = fieldId;
    const wrap = U.el('label', { class: 'field' + (opts.className ? ' ' + opts.className : ''), for: fieldId });
    wrap.appendChild(U.el('span', { text: label }));
    wrap.appendChild(input);
    if (opts.hint) wrap.appendChild(U.el('small', { text: opts.hint }));
    if (opts.error !== false) wrap.appendChild(U.el('span', { class: 'field-error', 'aria-live': 'polite' }));
    return wrap;
  };

  UI.dialogHeader = function (eyebrow, title, dialog) {
    const head = U.el('header', { class: 'dialog-head' });
    const text = U.el('div');
    text.appendChild(U.el('p', { class: 'eyebrow', text: eyebrow || 'Edição' }));
    text.appendChild(U.el('h2', { id: dialog ? dialog.getAttribute('aria-labelledby') : '', text: title }));
    head.appendChild(text);
    head.appendChild(U.el('button', {
      class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': 'Fechar',
      onclick: function () { if (dialog) dialog.close(); }
    }, U.icon('x')));
    return head;
  };

  UI.dialogFooter = function (buttons, leftNode) {
    const foot = U.el('footer', { class: 'dialog-foot' });
    if (leftNode) {
      leftNode.classList.add('foot-left');
      foot.appendChild(leftNode);
    }
    (buttons || []).forEach(function (button) { foot.appendChild(button); });
    return foot;
  };

  UI.avatar = function (name, tone) {
    return U.el('span', {
      class: 'item-icon ' + (tone || 'is-gold'),
      'aria-hidden': 'true',
      text: U.initials(name)
    });
  };

  Hub.ui = UI;
})(window.Hub = window.Hub || {});
