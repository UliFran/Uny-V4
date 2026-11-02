/* ==========================================================================
   UniHub V4 — camada de dados
   --------------------------------------------------------------------------
   Modelo "memória primeiro, IndexedDB por baixo":

   - O estado completo vive em memória (leituras síncronas, rápidas).
   - Cada DB.tx() compara os registros com a última versão gravada e persiste
     SOMENTE o que mudou, um registro por vez, no IndexedDB (sem o limite de
     5 MB do localStorage e sem regravar a base inteira a cada operação).
   - Registros alterados recebem `updatedAt`; registros removidos geram
     "tombstones". Isso deixa a base pronta para sincronizar com o Supabase.
   - Várias abas/janelas conversam por BroadcastChannel e se mantêm iguais.
   - Índices em cache (saldo por produto, tags, clientes) são reconstruídos uma
     única vez por versão do estado, eliminando as varreduras quadráticas.
   - Cópias de segurança automáticas (snapshots) ficam no próprio IndexedDB.

   Contrato (síncrono): load(), get(), tx(fn), stockFor(), stockStatus() ...
   Contrato (assíncrono): ready, flush(), importJSON(), reset(), snapshots.

   Créditos: UliFran / Ulisystem® · desenvolvido com Claude (Anthropic).
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = Hub.utils;
  const CFG = Hub.config || window.HUB_CONFIG || {};
  const DB_NAME = CFG.dbName || 'unihub-v4';
  const LEGACY_KEY = CFG.legacyStorageKey || 'hub-silene-v2';
  const VERSION = CFG.schemaVersion || 2;
  const TAB_ID = U.uid('tab');
  const KEEP_SNAPSHOTS = 7;

  /* Tabelas persistidas: nome -> função que gera a chave do registro. */
  const TABLES = {
    brands: function (r) { return r.id; },
    categories: function (r) { return r.id; },
    tags: function (r) { return r.id; },
    productTags: function (r) { return r.productId + '|' + r.tagId; },
    products: function (r) { return r.id; },
    movements: function (r) { return r.id; },
    purchaseOrders: function (r) { return r.id; },
    clients: function (r) { return r.id; },
    sales: function (r) { return r.id; },
    finance: function (r) { return r.id; },
    campaigns: function (r) { return r.id; },
    purchaseDraft: function (r) { return r.productId; }
  };
  const TABLE_NAMES = Object.keys(TABLES);
  const NO_TOUCH = { productTags: true, purchaseDraft: true };
  const KV = ['meta', 'settings', 'counters'];

  const TYPES = { tags: ['tipo_produto', 'familia_olfativa', 'linha'] };

  let state = null;
  let ver = 0;
  let idb = null;
  let memoryOnly = false;
  let lastError = null;
  let persisted = false;
  let cache = null;

  const committed = {};
  TABLE_NAMES.forEach(function (t) { committed[t] = new Map(); });
  const committedKV = {};

  let queue = [];
  let timer = null;
  let flushing = Promise.resolve();
  let channel = null;
  let reloadTimer = null;
  let errorHandler = null;
  let externalHandler = null;

  /* ------------------------------ estado base ------------------------------ */

  function iso(daysOffset) {
    const d = new Date();
    if (daysOffset) d.setDate(d.getDate() + daysOffset);
    return d.toISOString();
  }

  function baseState() {
    return {
      meta: { version: VERSION, createdAt: U.nowISO(), updatedAt: U.nowISO(), demo: false, lastBackupAt: '' },
      settings: { storeName: 'UniHub', consultant: '', pixKey: '' },
      brands: [], categories: [], tags: [], productTags: [], products: [],
      movements: [], purchaseOrders: [], clients: [], sales: [], finance: [],
      campaigns: [], purchaseDraft: [],
      counters: { sale: 0, purchase: 0 }
    };
  }

  function ensureArray(obj, key) {
    if (!Array.isArray(obj[key])) obj[key] = [];
    obj[key] = obj[key].filter(function (r) { return r && typeof r === 'object'; });
  }

  /** Normaliza qualquer estado (backup antigo, importado ou atual) para o schema atual. */
  function migrate(raw) {
    const defaults = baseState();
    const out = Object.assign({}, defaults, raw || {});
    out.meta = Object.assign({}, defaults.meta, raw && raw.meta ? raw.meta : {});
    out.settings = Object.assign({}, defaults.settings, raw && raw.settings ? raw.settings : {});
    out.counters = Object.assign({}, defaults.counters, raw && raw.counters ? raw.counters : {});
    out.meta.version = VERSION;
    TABLE_NAMES.forEach(function (key) { ensureArray(out, key); });

    out.products.forEach(function (p) {
      p.attributes = p.attributes && typeof p.attributes === 'object' ? p.attributes : {};
      p.active = p.active !== false;
      p.cost = U.toNumber(p.cost, 0);
      p.price = U.toNumber(p.price, 0);
      p.minStock = U.toNumber(p.minStock, 0);
    });
    out.movements.forEach(function (m) {
      m.type = m.type || 'entrada';
      // Estornos de venda antigos eram gravados como "entrada"; agora são "devolucao".
      if (m.type === 'entrada' && m.saleId && /^Estorno/i.test(String(m.note || ''))) m.type = 'devolucao';
      const qty = U.toNumber(m.quantity, 0);
      m.quantity = m.type === 'ajuste' ? qty : Math.abs(qty);
    });
    out.sales.forEach(function (s) {
      s.statusHistory = Array.isArray(s.statusHistory) ? s.statusHistory : [];
      s.items = Array.isArray(s.items) ? s.items : [];
      s.items.forEach(function (i) {
        i.qty = U.toNumber(i.qty, 0);
        i.unitPrice = U.toNumber(i.unitPrice, 0);
        i.discount = U.toNumber(i.discount, 0);
        i.total = U.toNumber(i.total, 0);
        if (i.unitCost !== undefined) i.unitCost = U.toNumber(i.unitCost, 0);
      });
      s.subtotal = U.toNumber(s.subtotal, 0);
      s.discount = U.toNumber(s.discount, 0);
      s.total = U.toNumber(s.total, 0);
      s.returns = Array.isArray(s.returns) ? s.returns : [];
      s.installments = Math.max(1, Math.round(U.toNumber(s.installments, 1)));
      if (!s.receipt) s.receipt = s.paymentMethod === 'fiado' ? 'prazo' : 'agora';
    });
    out.purchaseOrders.forEach(function (o) {
      o.items = Array.isArray(o.items) ? o.items : [];
      o.items.forEach(function (i) { i.qty = U.toNumber(i.qty, 0); i.unitCost = U.toNumber(i.unitCost, 0); });
      o.total = U.toNumber(o.total, 0);
    });
    out.finance.forEach(function (f) {
      f.amount = U.toNumber(f.amount, 0);
      f.status = f.status || 'pendente';
      f.type = f.type || 'despesa';
    });
    out.purchaseDraft.forEach(function (d) { d.qty = Math.max(1, Math.round(U.toNumber(d.qty, 1))); });
    return out;
  }

  /* --------------------------- referências iniciais --------------------------- */

  function eqName(a, b) {
    return U.normalizeText(a).toLowerCase() === U.normalizeText(b).toLowerCase();
  }

  function tagId(stateObj, tipo, nome) {
    const found = stateObj.tags.find(function (t) { return t.tipo === tipo && eqName(t.nome, nome); });
    return found ? found.id : null;
  }

  function addTag(stateObj, tipo, nome) {
    const existing = tagId(stateObj, tipo, nome);
    if (existing) return existing;
    const tag = { id: U.uid('tag'), tipo: tipo, nome: U.normalizeText(nome), createdAt: U.nowISO() };
    stateObj.tags.push(tag);
    return tag.id;
  }

  function addBrand(stateObj, nome) {
    const found = stateObj.brands.find(function (b) { return eqName(b.nome, nome); });
    if (found) return found.id;
    const brand = { id: U.uid('brand'), nome: U.normalizeText(nome), createdAt: U.nowISO() };
    stateObj.brands.push(brand);
    return brand.id;
  }

  function addCategory(stateObj, nome) {
    const found = stateObj.categories.find(function (c) { return eqName(c.nome, nome); });
    if (found) return found.id;
    const cat = { id: U.uid('cat'), nome: U.normalizeText(nome), createdAt: U.nowISO() };
    stateObj.categories.push(cat);
    return cat.id;
  }

  function seedReference(stateObj) {
    const s = stateObj || state;
    if (!s) return;
    addBrand(s, 'Natura');
    ['Perfumaria', 'Corpo e Banho', 'Cabelos', 'Maquiagem', 'Rosto',
      'Infantil', 'Casa', 'Presentes', 'Acessórios'
    ].forEach(function (name) { addCategory(s, name); });
    ['Body Splash', 'Deo Colônia', 'Deo Parfum', 'Desodorante Spray',
      'Hidratante Corporal', 'Hidratante para Mãos', 'Sabonete em Barra',
      'Sabonete Líquido', 'Óleo Corporal', 'Kits e Combos', 'Protetor Solar',
      'Shampoo', 'Condicionador', 'Máscara Capilar', 'Maquiagem', 'Acessório',
      'Presente'
    ].forEach(function (name) { addTag(s, 'tipo_produto', name); });
    ['Floral', 'Frutal', 'Amadeirado', 'Aromático', 'Cítrico',
      'Adocicado', 'Chypre', 'Musk', 'Gourmand'
    ].forEach(function (name) { addTag(s, 'familia_olfativa', name); });
    ['Tododia', 'Ekos', 'Essencial', 'Kaiak', 'Lumina', 'Una', 'Humor',
      'Natura Homem', 'Chronos', 'Faces', 'Ilía', 'Sève', 'Naturé',
      'Biografia', 'Aura', 'Crer Para Ver', 'Mamãe e Bebê'
    ].forEach(function (name) { addTag(s, 'linha', name); });
  }

  /** Valida um backup antes de aceitá-lo. Lança Error com mensagem amigável. */
  function validateState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Backup inválido: conteúdo não reconhecido.');
    const data = raw.data && typeof raw.data === 'object' ? raw.data : raw;
    if (!Array.isArray(data.products) && !Array.isArray(data.sales) && !Array.isArray(data.clients) && !data.meta) {
      throw new Error('Backup inválido: não parece um arquivo do UniHub/Hub.');
    }
    if (data.meta && Number(data.meta.version) > VERSION) {
      throw new Error('Este backup foi criado por uma versão mais nova (schema ' + data.meta.version + ').');
    }
    TABLE_NAMES.forEach(function (key) {
      if (data[key] === undefined) return;
      if (!Array.isArray(data[key])) throw new Error('Backup inválido: a tabela "' + key + '" está corrompida.');
      data[key].forEach(function (row, idx) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw new Error('Backup inválido: registro ' + (idx + 1) + ' de "' + key + '" está corrompido.');
        }
        if (key !== 'productTags' && key !== 'purchaseDraft' && !row.id) {
          throw new Error('Backup inválido: registro ' + (idx + 1) + ' de "' + key + '" não tem identificador.');
        }
      });
    });
    return data;
  }

  /* ------------------------------ IndexedDB ------------------------------ */

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB indisponível neste navegador.')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        TABLE_NAMES.forEach(function (t) { db.createObjectStore(t); });
        db.createObjectStore('kv');
        db.createObjectStore('tombstones');
        db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Falha ao abrir o IndexedDB.')); };
      req.onblocked = function () { reject(new Error('Banco de dados bloqueado por outra janela.')); };
    });
  }

  function reqPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function readStore(store) {
    const tx = idb.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    return Promise.all([reqPromise(os.getAllKeys()), reqPromise(os.getAll())]).then(function (res) {
      return { keys: res[0], values: res[1] };
    });
  }

  function byCreated(a, b) {
    const x = String(a.createdAt || '');
    const y = String(b.createdAt || '');
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /** Lê todo o IndexedDB e devolve { fresh, empty }. */
  async function readEverything() {
    const fresh = baseState();
    const kv = await readStore('kv');
    let found = false;
    kv.keys.forEach(function (key, i) {
      if (KV.indexOf(key) > -1) { fresh[key] = kv.values[i]; found = true; }
    });
    for (let i = 0; i < TABLE_NAMES.length; i += 1) {
      const t = TABLE_NAMES[i];
      const res = await readStore(t);
      fresh[t] = res.values.slice().sort(byCreated);
      if (res.values.length) found = true;
    }
    return { fresh: migrate(fresh), empty: !found };
  }

  function replaceState(next) {
    if (!state) { state = next; return; }
    Object.keys(state).forEach(function (k) { delete state[k]; });
    Object.assign(state, next);
  }

  function rebuildCommitted() {
    TABLE_NAMES.forEach(function (t) {
      const map = new Map();
      const keyFn = TABLES[t];
      state[t].forEach(function (rec) { map.set(keyFn(rec), JSON.stringify(rec)); });
      committed[t] = map;
    });
    KV.forEach(function (k) { committedKV[k] = JSON.stringify(state[k]); });
  }

  /* ------------------------------ gravação ------------------------------ */

  function writeBatch(ops) {
    return new Promise(function (resolve, reject) {
      const stores = {};
      ops.forEach(function (op) { stores[op.s] = true; });
      const tx = idb.transaction(Object.keys(stores), 'readwrite');
      ops.forEach(function (op) {
        const os = tx.objectStore(op.s);
        if (op.del) os.delete(op.k);
        else if (op.k === undefined) os.put(op.v);
        else os.put(op.v, op.k);
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('Falha ao gravar no IndexedDB.')); };
      tx.onabort = function () { reject(tx.error || new Error('Gravação cancelada pelo navegador (armazenamento cheio?).')); };
    });
  }

  function doFlush() {
    timer = null;
    const batch = queue;
    queue = [];
    if (!batch.length || memoryOnly || !idb) return flushing;
    flushing = flushing.then(function () { return writeBatch(batch); }).then(function () {
      if (channel) channel.postMessage({ type: 'commit', tab: TAB_ID });
    }).catch(function (err) {
      lastError = err;
      console.error('Falha ao persistir:', err);
      if (errorHandler) errorHandler(err);
    });
    return flushing;
  }

  function enqueue(ops) {
    if (!ops.length) return;
    // push.apply estoura a pilha com dezenas de milhares de operações (restauração grande).
    for (let i = 0; i < ops.length; i += 1) queue.push(ops[i]);
    if (!timer) timer = setTimeout(doFlush, 0);
  }

  function flush() {
    if (timer) { clearTimeout(timer); return doFlush(); }
    return flushing;
  }

  /** Compara o estado em memória com o último gravado e enfileira o que mudou. */
  function commit() {
    if (!state) throw new Error('Base não carregada.');
    const now = U.nowISO();
    const ops = [];
    TABLE_NAMES.forEach(function (t) {
      const keyFn = TABLES[t];
      const prev = committed[t];
      const seen = new Set();
      state[t].forEach(function (rec) {
        const key = keyFn(rec);
        seen.add(key);
        let json = JSON.stringify(rec);
        if (prev.get(key) !== json) {
          if (!NO_TOUCH[t]) {
            rec.updatedAt = now;
            json = JSON.stringify(rec);
          }
          prev.set(key, json);
          ops.push({ s: t, k: key, v: rec });
        }
      });
      if (prev.size !== seen.size) {
        Array.from(prev.keys()).forEach(function (key) {
          if (seen.has(key)) return;
          prev.delete(key);
          ops.push({ s: t, k: key, del: true });
          ops.push({ s: 'tombstones', k: t + '|' + key, v: { table: t, key: key, at: now } });
        });
      }
    });
    if (ops.length) state.meta.updatedAt = now;
    KV.forEach(function (k) {
      const json = JSON.stringify(state[k]);
      if (committedKV[k] !== json) {
        committedKV[k] = json;
        ops.push({ s: 'kv', k: k, v: state[k] });
      }
    });
    enqueue(ops);
    return ops.length;
  }

  /** Volta a memória ao último estado confirmado (rollback). */
  function restoreCommitted() {
    TABLE_NAMES.forEach(function (t) {
      state[t] = Array.from(committed[t].values()).map(function (json) { return JSON.parse(json); });
    });
    KV.forEach(function (k) { state[k] = JSON.parse(committedKV[k]); });
  }

  /**
   * Executa uma alteração atômica. Em caso de erro a memória volta ao último
   * estado confirmado e o erro é propagado para a interface.
   */
  function tx(fn) {
    ver += 1;
    let result;
    try {
      result = fn(state);
      commit();
    } catch (err) {
      restoreCommitted();
      ver += 1;
      throw err;
    }
    ver += 1;
    return result;
  }

  function save() { ver += 1; commit(); return state; }

  /* ------------------------------ índices em cache ------------------------------ */

  function movementDelta(m) {
    const qty = U.toNumber(m.quantity, 0);
    if (m.type === 'entrada' || m.type === 'devolucao') return qty;
    if (m.type === 'saida') return -qty;
    if (m.type === 'ajuste') return qty; // ajuste usa quantidade assinada
    return 0;
  }

  function saleReturned(sale) {
    return U.sum(sale.returns || [], function (r) { return r.refund; });
  }

  function saleNet(sale) {
    if (!sale || sale.status === 'cancelado' || sale.status === 'rascunho' || sale.status === 'devolvido') return 0;
    return Math.max(0, U.round(U.toNumber(sale.total, 0) - saleReturned(sale), 2));
  }

  function build(s) {
    const c = {
      ver: ver, s: s,
      product: new Map(), client: new Map(), sale: new Map(), order: new Map(),
      brand: new Map(), category: new Map(), tag: new Map(),
      stock: new Map(), tagsOf: new Map(), clientStat: new Map(), finOfSale: new Map(), sold: new Map()
    };
    s.products.forEach(function (p) { c.product.set(p.id, p); });
    s.clients.forEach(function (x) { c.client.set(x.id, x); });
    s.sales.forEach(function (x) { c.sale.set(x.id, x); });
    s.purchaseOrders.forEach(function (x) { c.order.set(x.id, x); });
    s.brands.forEach(function (x) { c.brand.set(x.id, x); });
    s.categories.forEach(function (x) { c.category.set(x.id, x); });
    s.tags.forEach(function (x) { c.tag.set(x.id, x); });
    s.productTags.forEach(function (pt) {
      const t = c.tag.get(pt.tagId);
      if (!t) return;
      let list = c.tagsOf.get(pt.productId);
      if (!list) { list = []; c.tagsOf.set(pt.productId, list); }
      list.push(t);
    });
    s.movements.forEach(function (m) {
      let e = c.stock.get(m.productId);
      if (!e) { e = { saldo: 0, received: 0, count: 0, last: null }; c.stock.set(m.productId, e); }
      e.saldo += movementDelta(m);
      e.count += 1;
      if (m.type === 'entrada') {
        e.received += U.toNumber(m.quantity, 0);
        if (!e.last || String(m.createdAt) > String(e.last.createdAt)) e.last = m;
      }
    });
    s.sales.forEach(function (sale) {
      if (sale.status === 'cancelado' || sale.status === 'rascunho' || sale.status === 'devolvido') return;
      const net = saleNet(sale);
      let st = c.clientStat.get(sale.clientId);
      if (!st) { st = { count: 0, total: 0, last: null }; c.clientStat.set(sale.clientId, st); }
      st.count += 1;
      st.total += net;
      const when = sale.confirmedAt || sale.createdAt;
      if (!st.last || String(when) > String(st.last.confirmedAt || st.last.createdAt)) st.last = sale;
      sale.items.forEach(function (i) {
        c.sold.set(i.productId, (c.sold.get(i.productId) || 0) + U.toNumber(i.qty, 0));
      });
    });
    s.finance.forEach(function (f) {
      if (!f.saleId) return;
      let list = c.finOfSale.get(f.saleId);
      if (!list) { list = []; c.finOfSale.set(f.saleId, list); }
      list.push(f);
    });
    return c;
  }

  function idx(stateObj) {
    const s = stateObj || state;
    if (cache && cache.ver === ver && cache.s === s) return cache;
    cache = build(s);
    return cache;
  }

  /* ------------------------------- consultas ------------------------------- */

  function stockEntry(productId, stateObj) {
    return idx(stateObj).stock.get(productId) || { saldo: 0, received: 0, count: 0, last: null };
  }

  function stockFor(productId, stateObj) { return stockEntry(productId, stateObj).saldo; }
  function receivedFor(productId, stateObj) { return stockEntry(productId, stateObj).received; }
  function lastEntryFor(productId, stateObj) { return stockEntry(productId, stateObj).last; }
  function hasMovements(productId, stateObj) { return stockEntry(productId, stateObj).count > 0; }

  function stockStatus(product, stateObj) {
    const e = stockEntry(product.id, stateObj);
    if (!e.count) return { key: 'sem', label: 'Sem movimentação', tone: 'neutral' };
    const min = U.toNumber(product.minStock, 0);
    if (e.saldo < 0) return { key: 'falta', label: 'Em falta (encomenda)', tone: 'red' };
    if (e.saldo === 0) return { key: 'zerado', label: 'Zerado', tone: 'red' };
    if (min > 0 && e.saldo < min) return { key: 'baixo', label: 'Abaixo do mínimo', tone: 'red' };
    return { key: 'ok', label: 'OK', tone: 'green' };
  }

  function isCritical(status) {
    return status.key === 'baixo' || status.key === 'zerado' || status.key === 'falta';
  }

  function financesOfSale(saleId, stateObj) { return idx(stateObj).finOfSale.get(saleId) || []; }
  function financeOfSale(saleId, stateObj) { return financesOfSale(saleId, stateObj)[0] || null; }

  function financeOfPurchase(orderId, stateObj) {
    const s = stateObj || state;
    return s.finance.find(function (f) { return f.purchaseOrderId === orderId; }) || null;
  }

  function clientStats(clientId, stateObj) {
    const st = idx(stateObj).clientStat.get(clientId);
    if (!st) return { count: 0, total: 0, last: null, lastAt: null };
    return {
      count: st.count, total: U.round(st.total, 2), last: st.last,
      lastAt: st.last ? (st.last.confirmedAt || st.last.createdAt) : null
    };
  }

  function productById(id, stateObj) { return idx(stateObj).product.get(id) || null; }
  function clientById(id, stateObj) { return idx(stateObj).client.get(id) || null; }
  function saleById(id, stateObj) { return idx(stateObj).sale.get(id) || null; }
  function orderById(id, stateObj) { return idx(stateObj).order.get(id) || null; }
  function brandById(id, stateObj) { return idx(stateObj).brand.get(id) || null; }
  function categoryById(id, stateObj) { return idx(stateObj).category.get(id) || null; }
  function productTags(productId, stateObj) { return idx(stateObj).tagsOf.get(productId) || []; }
  function lineOf(productId, stateObj) {
    const tag = productTags(productId, stateObj).find(function (t) { return t.tipo === 'linha'; });
    return tag ? tag.nome : '';
  }
  function soldQty(productId, stateObj) { return idx(stateObj).sold.get(productId) || 0; }

  /** Produtos mais vendidos (atalhos na montagem de pedidos). */
  function topSold(limit, stateObj) {
    const c = idx(stateObj);
    const rows = [];
    c.sold.forEach(function (qty, id) {
      const p = c.product.get(id);
      if (p && p.active !== false) rows.push({ product: p, qty: qty });
    });
    rows.sort(function (a, b) { return b.qty - a.qty; });
    return rows.slice(0, limit || 8).map(function (r) { return r.product; });
  }

  /** Lucro bruto de um pedido. `complete` só é verdadeiro se todos os itens têm custo. */
  function saleProfit(sale) {
    const net = saleNet(sale);
    if (!net) return { revenue: 0, cost: 0, profit: 0, complete: true };
    const returnedQty = {};
    (sale.returns || []).forEach(function (r) {
      (r.items || []).forEach(function (i) { returnedQty[i.productId] = (returnedQty[i.productId] || 0) + U.toNumber(i.qty, 0); });
    });
    let cost = 0;
    let complete = true;
    sale.items.forEach(function (i) {
      const qty = Math.max(0, U.toNumber(i.qty, 0) - (returnedQty[i.productId] || 0));
      const unit = U.toNumber(i.unitCost, 0);
      if (!(unit > 0)) complete = false;
      cost += unit * qty;
    });
    return { revenue: net, cost: U.round(cost, 2), profit: U.round(net - cost, 2), complete: complete };
  }

  function makeNumber(stateObj, kind) {
    const prefixes = { sale: 'PED', purchase: 'CMP' };
    const prefix = prefixes[kind] || 'REG';
    const year = new Date().getFullYear();
    stateObj.counters[kind] = U.toNumber(stateObj.counters[kind], 0) + 1;
    return prefix + '-' + year + '-' + String(stateObj.counters[kind]).padStart(4, '0');
  }

  /* ----------------------------- backup / snapshots ----------------------------- */

  function exportJSON() {
    return JSON.stringify({
      app: 'UniHub',
      appVersion: CFG.appVersion || '4.0.0',
      exportedAt: U.nowISO(),
      schemaVersion: VERSION,
      data: state
    }, null, 2);
  }

  function hasData() {
    return Boolean(state.products.length || state.clients.length || state.sales.length || state.finance.length);
  }

  async function snapshot(reason) {
    if (memoryOnly || !idb) return null;
    await flush();
    const json = exportJSON();
    const record = { at: U.nowISO(), reason: reason || 'manual', bytes: json.length, json: json };
    await writeBatch([{ s: 'backups', v: record }]);
    const all = await readStore('backups');
    const extra = all.values.length - KEEP_SNAPSHOTS;
    if (extra > 0) {
      const old = all.values.slice().sort(function (a, b) { return a.id - b.id; }).slice(0, extra);
      await writeBatch(old.map(function (r) { return { s: 'backups', k: r.id, del: true }; }));
    }
    return record;
  }

  async function listSnapshots() {
    if (memoryOnly || !idb) return [];
    const all = await readStore('backups');
    return all.values.map(function (r) { return { id: r.id, at: r.at, reason: r.reason, bytes: r.bytes }; })
      .sort(function (a, b) { return b.id - a.id; });
  }

  function getSnapshot(id) {
    const tx = idb.transaction('backups', 'readonly');
    return reqPromise(tx.objectStore('backups').get(id));
  }

  async function autoSnapshot() {
    if (memoryOnly || !idb || !hasData()) return;
    const list = await listSnapshots();
    const last = list[0];
    if (last && (Date.now() - new Date(last.at).getTime()) < 20 * 3600 * 1000) return;
    await snapshot('automático');
  }

  async function replaceAll(next) {
    replaceState(next);
    ver += 1;
    commit();
    await flush();
    if (channel) channel.postMessage({ type: 'commit', tab: TAB_ID });
  }

  async function importJSON(text) {
    const parsed = JSON.parse(text);
    const data = validateState(parsed);
    await snapshot('antes de restaurar');
    const next = migrate(data);
    seedReference(next);
    await replaceAll(next);
    return state;
  }

  async function restoreSnapshot(id) {
    const rec = await getSnapshot(id);
    if (!rec) throw new Error('Cópia de segurança não encontrada.');
    const next = migrate(validateState(JSON.parse(rec.json)));
    await snapshot('antes de restaurar cópia');
    seedReference(next);
    await replaceAll(next);
    return state;
  }

  async function reset() {
    await snapshot('antes de apagar tudo');
    const next = baseState();
    seedReference(next);
    await replaceAll(next);
    return state;
  }

  function downloadBackup() {
    state.meta.lastBackupAt = U.nowISO();
    save();
    U.download('unihub-backup-' + U.todayISO() + '.json', exportJSON(), 'application/json;charset=utf-8');
  }

  function daysSinceBackup() {
    const last = state.meta.lastBackupAt;
    if (!last) return hasData() ? Infinity : 0;
    return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  }

  async function storageInfo() {
    const info = { persisted: persisted, usage: 0, quota: 0, memoryOnly: memoryOnly, error: lastError ? lastError.message : '' };
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        info.usage = est.usage || 0;
        info.quota = est.quota || 0;
      }
      if (navigator.storage && navigator.storage.persisted) info.persisted = await navigator.storage.persisted();
    } catch (err) { /* noop */ }
    return info;
  }

  /* --------------------------- multi-aba (BroadcastChannel) --------------------------- */

  async function reloadFromDisk() {
    await flush();
    const res = await readEverything();
    replaceState(res.fresh);
    rebuildCommitted();
    ver += 1;
    if (externalHandler) externalHandler();
  }

  function listenOtherTabs() {
    if (typeof BroadcastChannel !== 'function') return;
    channel = new BroadcastChannel(DB_NAME + '-sync');
    channel.onmessage = function (event) {
      if (!event.data || event.data.tab === TAB_ID || event.data.type !== 'commit') return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(function () {
        reloadFromDisk().catch(function (err) { console.error('Falha ao sincronizar abas:', err); });
      }, 120);
    };
  }

  /* ------------------------------- inicialização ------------------------------- */

  function legacyState() {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      return raw ? migrate(JSON.parse(raw)) : null;
    } catch (err) { return null; }
  }

  async function init() {
    try {
      idb = await openDB();
      const res = await readEverything();
      if (res.empty) {
        const next = legacyState() || baseState();
        seedReference(next);
        replaceState(next);
        TABLE_NAMES.forEach(function (t) { committed[t] = new Map(); });
        KV.forEach(function (k) { committedKV[k] = ''; });
        ver += 1;
        commit();
        await flush();
      } else {
        replaceState(res.fresh);
        rebuildCommitted();
      }
    } catch (err) {
      memoryOnly = true;
      lastError = err;
      console.error('Persistência indisponível; usando somente memória.', err);
      rebuildCommitted();
    }
    ver += 1;
    listenOtherTabs();
    try {
      if (navigator.storage && navigator.storage.persist) persisted = await navigator.storage.persist();
    } catch (err) { /* noop */ }
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
    autoSnapshot().catch(function (err) { console.warn('Snapshot automático falhou:', err); });
    return state;
  }

  /* ------------------------------- demonstração ------------------------------- */

  function loadDemo() {
    if (state.products.length || state.clients.length || state.sales.length) {
      throw new Error('Já existem dados cadastrados. Apague os dados antes de carregar a demonstração.');
    }

    return tx(function (s) {
      seedReference(s);
      s.settings.consultant = s.settings.consultant || 'Consultora Demo';
      s.meta.demo = true;

      const nat = s.brands.find(function (b) { return b.nome === 'Natura'; });
      const cat = function (name) { const c = s.categories.find(function (x) { return x.nome === name; }); return c ? c.id : null; };

      function product(code, name, technical, cost, price, min, categoryName, line, type, family, description) {
        const p = {
          id: U.uid('prod'), codigo: code, nome: name, nomeTecnico: technical || '',
          brandId: nat ? nat.id : null, categoryId: cat(categoryName), cost: cost, price: price, minStock: min,
          active: true, description: description || '', imageUrl: '', productUrl: '', attributes: {},
          createdAt: iso(-30), updatedAt: iso(-30)
        };
        s.products.push(p);
        [['linha', line], ['tipo_produto', type], ['familia_olfativa', family]].forEach(function (pair) {
          if (!pair[1]) return;
          const id = addTag(s, pair[0], pair[1]);
          if (id && !s.productTags.some(function (pt) { return pt.productId === p.id && pt.tagId === id; })) {
            s.productTags.push({ productId: p.id, tagId: id });
          }
        });
        return p;
      }

      const p1 = product('NAT-001', 'Sabonete em Barra Tododia Algodão 90g', 'Sabonete em Barra', 8.90, 31.40, 6, 'Corpo e Banho', 'Tododia', 'Sabonete em Barra', 'Floral', 'Sabonete cremoso com fragrância de algodão.');
      const p2 = product('NAT-002', 'Hidratante Corporal Tododia Cereja e Avelã 400ml', 'Hidratante Corporal', 26.50, 62.90, 4, 'Corpo e Banho', 'Tododia', 'Hidratante Corporal', 'Frutal', 'Hidratação prolongada com toque aveludado.');
      const p3 = product('NAT-003', 'Deo Parfum Essencial Feminino 100ml', 'Deo Parfum', 128.00, 239.90, 2, 'Perfumaria', 'Essencial', 'Deo Parfum', 'Floral', 'Fragrância marcante com notas florais e amadeiradas.');
      const p4 = product('NAT-004', 'Body Splash Kaiak Oceano 200ml', 'Body Splash', 39.90, 89.90, 3, 'Perfumaria', 'Kaiak', 'Body Splash', 'Cítrico', 'Frescor aquático para o dia a dia.');
      const p5 = product('NAT-005', 'Shampoo Lumina Nutrição 300ml', 'Shampoo', 22.40, 49.90, 5, 'Cabelos', 'Lumina', 'Shampoo', '', 'Limpeza suave com nutrição intensa.');
      const p6 = product('NAT-006', 'Batom Matte Faces Cor 12 3,5g', 'Batom', 18.50, 42.90, 3, 'Maquiagem', 'Faces', 'Maquiagem', '', 'Acabamento matte de longa duração.');
      const p7 = product('NAT-007', 'Óleo Corporal Ekos Castanha 200ml', 'Óleo Corporal', 47.00, 104.90, 2, 'Corpo e Banho', 'Ekos', 'Óleo Corporal', 'Amadeirado', 'Óleo nutritivo de castanha.');
      const p8 = product('NAT-008', 'Kit Presente Tododia Sabonetes', 'Kit', 36.00, 84.90, 1, 'Presentes', 'Tododia', 'Kits e Combos', 'Floral', 'Kit com três sabonetes para presente.');
      void p7;

      [[p1, 14, -21], [p2, 9, -21], [p3, 5, -18], [p4, 8, -18], [p5, 12, -14], [p6, 7, -12], [p7, 4, -10], [p8, 3, -8]]
        .forEach(function (item) {
          s.movements.push({
            id: U.uid('mov'), productId: item[0].id, type: 'entrada', quantity: item[1],
            unitCost: item[0].cost, unitPrice: item[0].price, cycle: 'Ciclo 20/2026', expiry: '', supplier: 'Natura',
            note: 'Carga inicial de demonstração', createdAt: iso(item[2]), updatedAt: iso(item[2])
          });
        });

      function client(name, phone, email, birthday, city, tags, notes) {
        const c = {
          id: U.uid('cli'), nome: name, phone: phone, email: email || '', birthday: birthday || '',
          city: city || '', notes: notes || '', tags: tags || [], active: true, createdAt: iso(-25), updatedAt: iso(-25)
        };
        s.clients.push(c);
        return c;
      }
      const mm = String(new Date().getMonth() + 1).padStart(2, '0');
      const c1 = client('Ana Souza', '(11) 98888-1010', 'ana.souza@email.com', '1990-' + mm + '-08', 'São Paulo', ['VIP', 'Perfumaria'], 'Prefere fragrâncias florais.');
      const c2 = client('Bruno Lima', '(11) 97777-2020', 'bruno.lima@email.com', '1987-03-14', 'Santo André', ['Corpo e Banho'], '');
      const c3 = client('Carla Mendes', '(11) 96666-3030', 'carla.mendes@email.com', '1994-' + mm + '-21', 'São Paulo', ['VIP', 'Presentes'], 'Compra presentes todo mês.');
      const c4 = client('Diego Alves', '(11) 95555-4040', '', '1992-07-02', 'Osasco', [], '');
      client('Elisa Rocha', '(11) 94444-5050', 'elisa.rocha@email.com', '1989-12-11', 'São Bernardo', ['Maquiagem'], 'Gosta de batons matte.');

      /** status: rascunho | confirmado | separado | enviado | entregue */
      function makeSale(clientObj, items, status, payment, receipt, daysAgo, paid, dueDays) {
        const saleItems = items.map(function (item) {
          const unit = item[0].price;
          const disc = item[2] || 0;
          return {
            productId: item[0].id, codigo: item[0].codigo, nome: item[0].nome, qty: item[1],
            unitPrice: unit, unitCost: item[0].cost, discount: disc, total: U.round((unit * item[1]) - disc, 2)
          };
        });
        const subtotal = U.round(U.sum(saleItems, function (i) { return i.unitPrice * i.qty; }), 2);
        const discount = U.round(U.sum(saleItems, function (i) { return i.discount; }), 2);
        const total = U.round(subtotal - discount, 2);
        const createdAt = iso(-daysAgo);
        const sale = {
          id: U.uid('sale'), number: makeNumber(s, 'sale'),
          clientId: clientObj ? clientObj.id : null, clientName: clientObj ? clientObj.nome : 'Consumidor final',
          items: saleItems, subtotal: subtotal, discount: discount, total: total,
          paymentMethod: payment, receipt: receipt, installments: 1, returns: [],
          dueDate: dueDays ? U.dateOnly(iso(dueDays)) : '', status: status, notes: '',
          createdAt: createdAt, confirmedAt: status === 'rascunho' ? '' : createdAt,
          deliveredAt: status === 'entregue' ? createdAt : '', canceledAt: '',
          statusHistory: [{ status: status, at: createdAt }]
        };
        s.sales.push(sale);
        if (status !== 'rascunho') {
          saleItems.forEach(function (item) {
            s.movements.push({
              id: U.uid('mov'), productId: item.productId, type: 'saida', quantity: item.qty,
              unitCost: item.unitCost, unitPrice: item.unitPrice, cycle: '', expiry: '', supplier: '',
              note: 'Venda ' + sale.number, saleId: sale.id, createdAt: createdAt, updatedAt: createdAt
            });
          });
          s.finance.push({
            id: U.uid('fin'), type: 'receita', description: 'Pedido ' + sale.number + ' — ' + sale.clientName,
            amount: total, category: 'Vendas',
            dueDate: U.dateOnly(dueDays ? iso(dueDays) : createdAt), paidAt: paid ? U.dateOnly(createdAt) : '',
            status: paid ? 'pago' : 'pendente', origin: 'sale', saleId: sale.id, purchaseOrderId: '',
            installment: 1, installments: 1, notes: '', createdAt: createdAt, updatedAt: createdAt
          });
        }
        return sale;
      }

      makeSale(c1, [[p3, 1, 0], [p1, 2, 5]], 'entregue', 'pix', 'agora', 5, true, 0);
      makeSale(c2, [[p4, 1, 0]], 'confirmado', 'fiado', 'prazo', 2, false, 7);
      makeSale(c3, [[p8, 1, 0], [p2, 1, 0]], 'enviado', 'cartao', 'agora', 1, true, 0);
      makeSale(c1, [[p5, 2, 0]], 'separado', 'pix', 'entrega', 1, false, 0);
      makeSale(c4, [[p6, 2, 0]], 'rascunho', 'pix', 'agora', 0, false, 0);

      s.purchaseOrders.push({
        id: U.uid('purchase'), number: makeNumber(s, 'purchase'), status: 'aberta',
        items: [
          { productId: p1.id, codigo: p1.codigo, nome: p1.nome, qty: 12, unitCost: p1.cost },
          { productId: p2.id, codigo: p2.codigo, nome: p2.nome, qty: 8, unitCost: p2.cost }
        ],
        total: U.round((p1.cost * 12) + (p2.cost * 8), 2), notes: 'Reposição de itens de maior giro',
        createdAt: iso(-1), closedAt: '', receivedAt: ''
      });

      s.finance.push(
        { id: U.uid('fin'), type: 'despesa', description: 'Aluguel do espaço', amount: 850, category: 'Despesas fixas', dueDate: U.dateOnly(iso(-4)), paidAt: U.dateOnly(iso(-4)), status: 'pago', origin: 'manual', saleId: '', purchaseOrderId: '', notes: '', createdAt: iso(-4), updatedAt: iso(-4) },
        { id: U.uid('fin'), type: 'despesa', description: 'Impulsionamento de post', amount: 120, category: 'Marketing', dueDate: U.dateOnly(iso(3)), paidAt: '', status: 'pendente', origin: 'manual', saleId: '', purchaseOrderId: '', notes: '', createdAt: iso(-2), updatedAt: iso(-2) },
        { id: U.uid('fin'), type: 'despesa', description: 'Embalagens e sacolas', amount: 86.50, category: 'Operação', dueDate: U.dateOnly(iso(-2)), paidAt: U.dateOnly(iso(-2)), status: 'pago', origin: 'manual', saleId: '', purchaseOrderId: '', notes: '', createdAt: iso(-2), updatedAt: iso(-2) }
      );

      s.campaigns.push({
        id: U.uid('camp'), name: 'Aniversariantes do mês',
        message: 'Oi, {primeiro_nome}! Seu mês é especial e preparei um mimo para você. Venha conhecer as novidades da Natura. 💛',
        audience: 'birthday', tag: '', createdAt: iso(-1)
      });
      s.purchaseDraft = [];
      return s;
    });
  }

  /* --------------------------------- API --------------------------------- */

  state = baseState();
  seedReference(state);
  rebuildCommitted();

  Hub.config = CFG;
  Hub.db = {
    NAME: DB_NAME,
    VERSION: VERSION,
    TYPES: TYPES,
    ready: init(),
    load: function () { return state; },
    get: function () { return state; },
    save: save,
    tx: tx,
    flush: flush,
    reset: reset,
    exportJSON: exportJSON,
    importJSON: importJSON,
    downloadBackup: downloadBackup,
    daysSinceBackup: daysSinceBackup,
    snapshot: snapshot,
    listSnapshots: listSnapshots,
    getSnapshot: getSnapshot,
    restoreSnapshot: restoreSnapshot,
    storageInfo: storageInfo,
    hasData: hasData,
    seedReference: seedReference,
    loadDemo: loadDemo,
    idx: idx,
    stockFor: stockFor,
    receivedFor: receivedFor,
    lastEntryFor: lastEntryFor,
    hasMovements: hasMovements,
    stockStatus: stockStatus,
    isCritical: isCritical,
    financeOfSale: financeOfSale,
    financesOfSale: financesOfSale,
    financeOfPurchase: financeOfPurchase,
    clientStats: clientStats,
    productById: productById,
    clientById: clientById,
    saleById: saleById,
    orderById: orderById,
    brandById: brandById,
    categoryById: categoryById,
    productTags: productTags,
    lineOf: lineOf,
    soldQty: soldQty,
    topSold: topSold,
    saleNet: saleNet,
    saleReturned: saleReturned,
    saleProfit: saleProfit,
    makeNumber: makeNumber,
    movementDelta: movementDelta,
    addTag: addTag,
    addBrand: addBrand,
    addCategory: addCategory,
    findTagId: tagId,
    onError: function (fn) { errorHandler = fn; },
    onExternalChange: function (fn) { externalHandler = fn; },
    get memoryOnly() { return memoryOnly; },
    get lastError() { return lastError; }
  };
})(window.Hub = window.Hub || {});
