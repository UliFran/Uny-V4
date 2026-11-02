/* ==========================================================================
   UniHub V4 — aplicação, rotas, configurações e PWA
   Créditos: UliFran / Ulisystem® · desenvolvido com Claude (Anthropic).
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = Hub.utils;
  const DB = Hub.db;
  const UI = Hub.ui;
  const CFG = Hub.config || window.HUB_CONFIG || {};
  const VIEWS = ['dashboard', 'estoque', 'clientes', 'pedidos', 'financeiro'];
  const TITLES = {
    dashboard: 'Visão geral',
    estoque: 'Estoque',
    clientes: 'Clientes & Campanhas',
    pedidos: 'Pedidos & Vendas',
    financeiro: 'Financeiro'
  };
  let current = 'dashboard';
  let suppressHash = false;
  let pendingOptions = null;
  let installPrompt = null;

  function routeFromHash() {
    const raw = String(window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return VIEWS.indexOf(raw) > -1 ? raw : 'dashboard';
  }

  function setView(view, options) {
    const target = VIEWS.indexOf(view) > -1 ? view : 'dashboard';
    current = target;
    U.$$('.view').forEach(function (section) {
      const active = section.dataset.view === target;
      section.hidden = !active;
      section.classList.toggle('is-active', active);
    });
    U.$$('.main-nav a[data-nav]').forEach(function (link) {
      const active = link.dataset.nav === target;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const module = Hub.modules[target];
    if (module && typeof module.render === 'function') {
      try { module.render(); } catch (err) {
        console.error('Erro ao renderizar ' + target, err);
        UI.toast('Não foi possível atualizar esta tela. Veja o console.', 'error');
      }
    }
    document.title = TITLES[target] + ' · UniHub';
    renderBackupChip();
    if (!options || options.scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function navigate(view, options) {
    const target = VIEWS.indexOf(view) > -1 ? view : 'dashboard';
    const hash = '#/' + target;
    if (window.location.hash === hash) {
      setView(target, options);
      return;
    }
    if (options && options.scroll === false) pendingOptions = options;
    window.location.hash = hash;
  }

  /* ------------------------------ backup chip ------------------------------ */

  function renderBackupChip() {
    const chip = document.getElementById('backup-chip');
    if (!chip) return;
    const days = DB.daysSinceBackup();
    const late = DB.hasData() && days >= 7;
    chip.hidden = !late;
    if (late) {
      chip.textContent = days === Infinity ? 'Sem backup — baixar agora' : 'Backup há ' + days + ' dias — baixar agora';
    }
  }

  /* ------------------------------ configurações ------------------------------ */

  function fmtBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }

  async function renderSnapshots() {
    const box = document.getElementById('snapshot-list');
    if (!box) return;
    U.clear(box);
    const list = await DB.listSnapshots();
    if (!list.length) {
      box.appendChild(U.el('li', { class: 'muted small', text: 'As cópias automáticas aparecem aqui (uma por dia de uso e antes de operações de risco).' }));
      return;
    }
    list.forEach(function (snap) {
      const li = U.el('li');
      li.appendChild(U.el('span', { class: 'register-name', text: U.fmtDateTime(snap.at) + ' · ' + snap.reason }));
      li.appendChild(U.el('span', { class: 'register-count', text: fmtBytes(snap.bytes * 2) }));
      li.appendChild(U.el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', title: 'Baixar esta cópia', 'aria-label': 'Baixar cópia de ' + U.fmtDateTime(snap.at),
        onclick: async function () {
          const rec = await DB.getSnapshot(snap.id);
          if (rec) U.download('unihub-copia-' + U.dateOnly(snap.at) + '.json', rec.json, 'application/json;charset=utf-8');
        }
      }, U.icon('download')));
      li.appendChild(U.el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', title: 'Restaurar esta cópia', 'aria-label': 'Restaurar cópia de ' + U.fmtDateTime(snap.at),
        onclick: async function () {
          const ok = await UI.confirm({
            title: 'Restaurar cópia automática',
            message: 'Substituir os dados atuais pela cópia de ' + U.fmtDateTime(snap.at) + '? O estado atual será guardado antes como nova cópia.',
            confirmLabel: 'Restaurar cópia'
          });
          if (!ok) return;
          try {
            await DB.restoreSnapshot(snap.id);
            UI.toast('Cópia restaurada. Recarregando…');
            setTimeout(function () { window.location.reload(); }, 500);
          } catch (err) { UI.toast(err.message, 'error'); }
        }
      }, U.icon('rotate')));
      box.appendChild(li);
    });
  }

  async function openSettings() {
    const dialog = document.getElementById('settings-dialog');
    if (!dialog) return;
    const state = DB.get();
    const set = function (id, value) { const el = document.getElementById(id); if (el) el.value = value || ''; };
    set('settings-store', state.settings.storeName);
    set('settings-consultant', state.settings.consultant);
    set('settings-pix', state.settings.pixKey);
    const version = document.getElementById('schema-version');
    if (version) version.textContent = String(DB.VERSION);
    const install = document.getElementById('btn-install-app');
    if (install) install.hidden = !installPrompt;
    UI.openDialog(dialog);

    const storage = document.getElementById('storage-info');
    if (storage) {
      storage.textContent = 'Calculando uso do armazenamento…';
      const info = await DB.storageInfo();
      const counts = state.products.length + ' produtos · ' + state.clients.length + ' clientes · ' + state.sales.length + ' pedidos';
      if (info.memoryOnly) {
        storage.textContent = '⚠ Armazenamento do navegador indisponível: os dados NÃO estão sendo salvos. Baixe um backup. (' + info.error + ')';
      } else {
        storage.textContent = 'Uso: ' + fmtBytes(info.usage) + (info.quota ? ' de ' + fmtBytes(info.quota) : '') +
          ' · ' + counts + ' · armazenamento ' + (info.persisted ? 'persistente (protegido contra limpeza automática)' : 'padrão (o navegador pode limpar em caso de falta de espaço)') + '.';
      }
    }
    renderSnapshots();
    const last = document.getElementById('backup-last');
    if (last) {
      last.textContent = state.meta.lastBackupAt ? 'Último backup baixado: ' + U.fmtDateTime(state.meta.lastBackupAt) + '.' : 'Nenhum backup baixado ainda.';
    }
  }

  function bindSettings() {
    const dialog = document.getElementById('settings-dialog');
    if (!dialog) return;
    const click = function (id, handler) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handler);
    };

    click('btn-backup', function () { DB.downloadBackup(); renderBackupChip(); UI.toast('Backup JSON baixado.'); });
    click('backup-chip', function () { DB.downloadBackup(); renderBackupChip(); UI.toast('Backup JSON baixado.'); });
    click('btn-settings', openSettings);
    click('btn-export-backup', function () {
      DB.downloadBackup();
      renderBackupChip();
      UI.toast('Backup JSON baixado.');
      const last = document.getElementById('backup-last');
      if (last) last.textContent = 'Último backup baixado: ' + U.fmtDateTime(DB.get().meta.lastBackupAt) + '.';
    });

    click('btn-install-app', async function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      try { await installPrompt.userChoice; } catch (err) { /* noop */ }
      installPrompt = null;
      const el = document.getElementById('btn-install-app');
      if (el) el.hidden = true;
    });

    click('btn-save-settings', function () {
      const value = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
      try {
        DB.tx(function (s) {
          s.settings.storeName = U.normalizeText(value('settings-store')) || 'UniHub';
          s.settings.consultant = U.normalizeText(value('settings-consultant'));
          s.settings.pixKey = U.normalizeText(value('settings-pix'));
        });
        UI.toast('Identificação salva.');
      } catch (err) { UI.toast(err.message, 'error'); }
    });

    const restore = document.getElementById('btn-restore-backup');
    const file = document.getElementById('backup-file');
    if (restore && file) {
      restore.addEventListener('click', function () { file.click(); });
      file.addEventListener('change', async function () {
        const selected = file.files && file.files[0];
        if (!selected) return;
        try {
          const text = await U.readFile(selected);
          const ok = await UI.confirm({
            title: 'Restaurar backup',
            message: 'Substituir todos os dados atuais pelo backup "' + selected.name + '"? Uma cópia do estado atual é guardada automaticamente antes.',
            confirmLabel: 'Restaurar backup'
          });
          if (!ok) { file.value = ''; return; }
          await DB.importJSON(text);
          dialog.close();
          UI.toast('Backup restaurado. Recarregando…');
          setTimeout(function () { window.location.reload(); }, 600);
        } catch (err) {
          UI.toast('Backup inválido: ' + err.message, 'error');
          file.value = '';
        }
      });
    }

    click('btn-load-demo', async function () {
      if (DB.hasData()) {
        UI.toast('Já existem dados. Apague os dados antes de carregar a demonstração.', 'warn');
        return;
      }
      const ok = await UI.confirm({
        title: 'Carregar demonstração',
        message: 'Criar produtos, clientes, pedidos e lançamentos fictícios para explorar o UniHub? Você poderá apagar tudo depois.',
        confirmLabel: 'Carregar demonstração',
        danger: false
      });
      if (!ok) return;
      try {
        DB.loadDemo();
        await DB.flush();
        dialog.close();
        UI.toast('Demonstração carregada. Recarregando…');
        setTimeout(function () { window.location.reload(); }, 500);
      } catch (err) { UI.toast(err.message, 'error'); }
    });

    click('btn-reset-data', async function () {
      const ok = await UI.confirm({
        title: 'Apagar todos os dados',
        message: 'Isso remove produtos, clientes, pedidos, financeiro e campanhas deste aparelho. Uma cópia automática é guardada antes (em "Cópias automáticas"), mas baixe um backup também. Continuar?',
        confirmLabel: 'Apagar tudo'
      });
      if (!ok) return;
      try {
        await DB.reset();
        dialog.close();
        UI.toast('Dados apagados. Recarregando…');
        setTimeout(function () { window.location.reload(); }, 500);
      } catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  /* ------------------------------ PWA e eventos globais ------------------------------ */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(window.location.protocol)) return;
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.warn('Service worker não registrado:', err);
    });
  }

  function bindGlobal() {
    window.addEventListener('hashchange', function () {
      if (suppressHash) { suppressHash = false; return; }
      const view = routeFromHash();
      setView(view, pendingOptions);
      pendingOptions = null;
    });
    window.addEventListener('error', function (event) {
      console.error('Erro não tratado:', event.error || event.message);
    });
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      installPrompt = event;
    });
    window.addEventListener('online', function () { UI.toast('Conexão restabelecida.', 'info'); });
    window.addEventListener('offline', function () { UI.toast('Sem conexão — o UniHub continua funcionando neste aparelho.', 'info'); });

    DB.onError(function (err) {
      UI.toast('Falha ao salvar no armazenamento: ' + err.message + ' Baixe um backup agora.', 'error', 'Atenção');
    });
    // Outra aba/janela alterou os dados: recarrega a tela atual sem perder diálogos abertos.
    DB.onExternalChange(function () {
      setView(current, { scroll: false });
      UI.toast('Dados atualizados a partir de outra janela.', 'info');
    });
  }

  function init() {
    ['dashboard', 'estoque', 'clientes', 'pedidos', 'financeiro'].forEach(function (name) {
      const module = Hub.modules[name];
      if (module && typeof module.init === 'function') {
        try { module.init(); } catch (err) { console.error('Falha ao iniciar ' + name, err); }
      }
    });
    bindSettings();
    bindGlobal();
    const view = routeFromHash();
    if (!window.location.hash) {
      suppressHash = true;
      window.location.hash = '#/' + view;
    }
    document.body.classList.remove('is-booting');
    setView(view, { scroll: false });
    registerServiceWorker();
    if (DB.memoryOnly) {
      UI.toast('O navegador bloqueou o armazenamento: os dados não serão salvos. Saia do modo anônimo ou libere o armazenamento.', 'error', 'Atenção');
    }
  }

  Hub.app = {
    init: init,
    navigate: navigate,
    refresh: function () { setView(current); },
    refreshAll: function () { setView(current); },
    get current() { return current; }
  };

  function start() {
    DB.ready.then(init).catch(function (err) {
      console.error('Falha ao iniciar o UniHub:', err);
      init();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window.Hub = window.Hub || {});
