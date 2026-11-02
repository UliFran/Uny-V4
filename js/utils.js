/* ==========================================================================
   UniHub V4 — utilitários compartilhados
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = {};

  /* ------------------------------ DOM ------------------------------ */

  U.$ = function (selector, root) {
    return (root || document).querySelector(selector);
  };

  U.$$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  /**
   * Cria elementos com segurança. Texto nunca é interpretado como HTML.
   * Use attrs.html apenas com markup estático e confiável.
   */
  U.el = function (tag, attrs) {
    const node = document.createElement(tag);
    const children = Array.prototype.slice.call(arguments, 2);
    const a = attrs || {};

    Object.keys(a).forEach(function (key) {
      const value = a[key];
      if (value === null || value === undefined || value === false) return;

      if (key === 'class' || key === 'className') {
        node.className = value;
      } else if (key === 'text') {
        node.textContent = value;
      } else if (key === 'html') {
        node.innerHTML = value;
      } else if (key === 'dataset') {
        Object.keys(value).forEach(function (dk) { node.dataset[dk] = value[dk]; });
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(node.style, value);
      } else if (key === 'value') {
        node.value = value;
      } else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'hidden') {
        node[key] = Boolean(value);
      } else if (key.indexOf('on') === 0 && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'for' || key === 'href' || key === 'src' || key === 'role') {
        node.setAttribute(key, value);
      } else if (key.indexOf('aria-') === 0 || key.indexOf('data-') === 0) {
        node.setAttribute(key, value);
      } else if (key in node && key !== 'list' && key !== 'form') {
        try { node[key] = value; } catch (err) { node.setAttribute(key, value); }
      } else {
        node.setAttribute(key, value);
      }
    });

    children.forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) {
        child.forEach(function (c) {
          if (c === null || c === undefined || c === false) return;
          node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
        });
      } else {
        node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    });

    return node;
  };

  U.clear = function (node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  };

  U.icon = function (name, extraClass) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon' + (extraClass ? ' ' + extraClass : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  };

  U.setHTML = function (node, html) {
    if (node) node.innerHTML = html;
    return node;
  };

  U.escapeHtml = function (value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* ------------------------------ Texto ------------------------------ */

  U.normalizeText = function (value) {
    return String(value === null || value === undefined ? '' : value)
      .normalize('NFC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  U.normalizeCode = function (value) {
    return U.normalizeText(value).replace(/\s+/g, ' ').toUpperCase();
  };

  U.normalizeHeader = function (value) {
    return U.normalizeText(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  };

  U.slug = function (value) {
    return U.normalizeText(value).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };

  U.initials = function (name) {
    const parts = U.normalizeText(name).split(' ').filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };

  U.truncate = function (value, max) {
    const text = U.normalizeText(value);
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  };

  /** Verdadeiro se TODAS as palavras da busca aparecem no texto (sem acento/maiúscula). */
  U.matchesTokens = function (haystack, term) {
    if (!term) return true;
    const hay = U.normalizeHeader(haystack).replace(/_/g, ' ');
    return String(term).split(/\s+/).every(function (token) {
      const t = U.normalizeHeader(token).replace(/_/g, ' ');
      return !t || hay.indexOf(t) > -1;
    });
  };

  U.plural = function (n, singular, plural) {
    return n === 1 ? singular : (plural || singular + 's');
  };

  /* ------------------------------ Números ------------------------------ */

  U.toNumber = function (value, fallback) {
    if (typeof value === 'number') return isFinite(value) ? value : (fallback || 0);
    if (value === null || value === undefined || value === '') return fallback || 0;
    // Aceita "1234.56", "1234,56" e "1.234,56".
    const n = U.parseMoney(value);
    return isFinite(n) ? n : (fallback || 0);
  };

  U.parseMoney = function (value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    let s = String(value === null || value === undefined ? '' : value)
      .replace(/[^\d.,-]/g, '').trim();
    if (!s) return 0;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      const decimals = s.length - lastComma - 1;
      s = decimals <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
    }
    const n = Number(s);
    return isFinite(n) ? n : 0;
  };

  U.round = function (n, decimals) {
    const d = decimals === undefined ? 2 : decimals;
    const f = Math.pow(10, d);
    return Math.round((Number(n) + Number.EPSILON) * f) / f;
  };

  U.clamp = function (n, min, max) {
    return Math.min(Math.max(n, min), max);
  };

  U.sum = function (list, getter) {
    return list.reduce(function (total, item) {
      const value = getter ? getter(item) : item;
      const n = Number(value);
      return total + (isFinite(n) ? n : 0);
    }, 0);
  };

  const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  U.fmtMoney = function (value) {
    return moneyFmt.format(Number(value) || 0);
  };
  U.fmtNumber = function (value, decimals) {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: decimals || 0,
      maximumFractionDigits: decimals === undefined ? 0 : decimals
    }).format(Number(value) || 0);
  };

  /* ------------------------------ Datas ------------------------------ */

  function pad(n) { return String(n).padStart(2, '0'); }

  U.todayISO = function () {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  U.nowISO = function () { return new Date().toISOString(); };

  U.dateOnly = function (value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  U.parseDate = function (value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parts = value.split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  };

  U.fmtDate = function (value, fallback) {
    const d = U.parseDate(value);
    if (!d) return fallback === undefined ? '—' : fallback;
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  };

  U.fmtDateShort = function (value) {
    const d = U.parseDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d);
  };

  U.fmtDateTime = function (value) {
    const d = U.parseDate(value);
    if (!d) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(d);
  };

  U.monthKey = function (value) {
    const d = value ? U.parseDate(value) : new Date();
    if (!d) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  };

  U.currentMonthKey = function () { return U.monthKey(new Date()); };

  U.monthLabel = function (key, short) {
    if (!key) return '';
    const parts = String(key).split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1, 12);
    return new Intl.DateTimeFormat('pt-BR', {
      month: short ? 'short' : 'long',
      year: short ? '2-digit' : 'numeric'
    }).format(d).replace('.', '');
  };

  U.monthLabelFromDate = function (value, short) {
    return U.monthLabel(U.monthKey(value), short);
  };

  U.addDays = function (value, days) {
    const base = value ? U.parseDate(value) : new Date();
    const d = base ? new Date(base.getTime()) : new Date();
    d.setDate(d.getDate() + days);
    return d;
  };

  U.daysBetween = function (a, b) {
    const p1 = U.parseDate(a);
    const p2 = U.parseDate(b || new Date());
    if (!p1 || !p2) return 0;
    const d1 = new Date(p1.getTime());
    const d2 = new Date(p2.getTime());
    d1.setHours(12, 0, 0, 0);
    d2.setHours(12, 0, 0, 0);
    return Math.round((d2 - d1) / (24 * 60 * 60 * 1000));
  };

  U.isBirthdayMonth = function (birthday, month) {
    const d = U.parseDate(birthday);
    if (!d) return false;
    return d.getMonth() === (month === undefined ? new Date().getMonth() : month);
  };

  U.monthRange = function (key) {
    const parts = String(key).split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0, 23, 59, 59) };
  };

  U.lastMonths = function (count) {
    const out = [];
    const base = new Date();
    base.setDate(1);
    for (let i = count - 1; i >= 0; i -= 1) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1, 12);
      out.push(U.monthKey(d));
    }
    return out;
  };

  /* ------------------------------ Diversos ------------------------------ */

  U.uid = function (prefix) {
    let id;
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      id = window.crypto.randomUUID();
    } else {
      id = 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    return prefix ? prefix + '-' + id : id;
  };

  U.debounce = function (fn, wait) {
    let timer;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait || 250);
    };
  };

  U.groupBy = function (list, keyFn) {
    return list.reduce(function (acc, item) {
      const key = typeof keyFn === 'function' ? keyFn(item) : item[keyFn];
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  };

  U.sortBy = function (list, keyFn, direction) {
    const dir = direction === 'desc' ? -1 : 1;
    return list.slice().sort(function (a, b) {
      const va = typeof keyFn === 'function' ? keyFn(a) : a[keyFn];
      const vb = typeof keyFn === 'function' ? keyFn(b) : b[keyFn];
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va || '').localeCompare(String(vb || ''), 'pt-BR') * dir;
      }
      return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
    });
  };

  U.unique = function (list) {
    return Array.from(new Set(list));
  };

  U.phoneDigits = function (value) {
    return String(value || '').replace(/\D/g, '');
  };

  U.formatPhone = function (value) {
    let d = U.phoneDigits(value);
    if (d.length > 13 && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return U.normalizeText(value);
  };

  U.waLink = function (phone, message) {
    let digits = U.phoneDigits(phone);
    if (!digits) return '';
    if (digits.length <= 11) digits = '55' + digits;
    return 'https://wa.me/' + digits + (message ? '?text=' + encodeURIComponent(message) : '');
  };

  U.copyText = function (text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch (err) { /* noop */ }
    document.body.removeChild(area);
    return Promise.resolve();
  };

  U.download = function (filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 800);
  };

  U.csvEscape = function (value) {
    let s = String(value === null || value === undefined ? '' : value);
    // Evita injeção de fórmulas (=, +, -, @) ao abrir no Excel/Planilhas.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
    if (/[";\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  U.toCSV = function (headers, rows) {
    const lines = [];
    lines.push(headers.map(U.csvEscape).join(';'));
    rows.forEach(function (row) {
      lines.push(row.map(U.csvEscape).join(';'));
    });
    return '\uFEFF' + lines.join('\r\n');
  };

  /** Parser CSV simples e robusto (aspas, quebras de linha e delimitador). */
  U.parseCSV = function (text, delimiter) {
    let input = String(text || '').replace(/^\uFEFF/, '');
    let delim = delimiter;
    if (!delim) {
      const firstLine = input.split(/\r?\n/)[0] || '';
      delim = (firstLine.split(';').length >= firstLine.split(',').length) ? ';' : ',';
    }

    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (quoted) {
        if (ch === '"') {
          if (input[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else if (ch === '\r') {
        /* ignora */
      } else {
        field += ch;
      }
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);

    if (!rows.length) return { headers: [], rows: [], delimiter: delim };
    const headers = rows[0].map(function (h) { return U.normalizeHeader(h); });
    const data = rows.slice(1).filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    }).map(function (r) {
      const obj = {};
      headers.forEach(function (h, idx) { obj[h] = r[idx] === undefined ? '' : String(r[idx]).trim(); });
      return obj;
    });
    return { headers: headers, rows: data, delimiter: delim, rawHeaders: rows[0] };
  };

  U.readFile = function (file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('Falha ao ler arquivo.')); };
      reader.readAsText(file, 'UTF-8');
    });
  };

  U.fileStem = function (filename) {
    return String(filename || 'arquivo').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-');
  };

  U.debounceInput = function (input, callback, wait) {
    if (!input) return;
    let timer;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(callback, wait || 220);
    });
  };

  U.focusFirst = function (root) {
    if (!root) return;
    const target = root.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
    if (target) setTimeout(function () { target.focus(); }, 40);
  };

  U.setBusy = function (button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalLabel) button.dataset.originalLabel = button.innerHTML;
      button.disabled = true;
      button.textContent = busyLabel || 'Processando…';
    } else {
      button.disabled = false;
      if (button.dataset.originalLabel) {
        button.innerHTML = button.dataset.originalLabel;
        delete button.dataset.originalLabel;
      }
    }
  };

  U.openExternal = function (url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  Hub.utils = U;
})(window.Hub = window.Hub || {});
