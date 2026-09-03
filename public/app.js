// --- Reemplazo de window.storage: habla con /api/kv y localStorage ---
const storage = {
  async get(key, shared) {
    if (!shared) {
      const v = localStorage.getItem(key);
      return v !== null ? { key, value: v, shared } : null;
    }
    const res = await fetch('/api/kv?key=' + encodeURIComponent(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('kv get failed');
    const data = await res.json();
    return { key, value: data.value, shared: true };
  },
  async set(key, value, shared) {
    if (!shared) {
      localStorage.setItem(key, value);
      return { key, value, shared };
    }
    const res = await fetch('/api/kv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value })
    });
    if (!res.ok) return null;
    return { key, value, shared: true };
  },
  async delete(key, shared) {
    if (!shared) {
      localStorage.removeItem(key);
      return { key, deleted: true, shared };
    }
    const res = await fetch('/api/kv?key=' + encodeURIComponent(key), { method: 'DELETE' });
    return res.ok ? { key, deleted: true, shared: true } : null;
  }
};

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function subscribeToPush(code) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch('/api/vapid-public-key');
    const { publicKey } = await keyRes.json();
    if (!publicKey) return false;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, subscription: sub })
    });
    return true;
  } catch (e) {
    console.error('push subscribe failed', e);
    return false;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}

// --- Boton de instalar la app (dispara el cuadro nativo de Chrome/Android) ---
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const banner = document.getElementById('installBanner');
  if (banner) banner.style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const banner = document.getElementById('installBanner');
  if (banner) banner.style.display = 'none';
});
document.addEventListener('DOMContentLoaded', () => {
  const installBtn = document.getElementById('installBtn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      const banner = document.getElementById('installBanner');
      if (banner) banner.style.display = 'none';
    });
  }
});

// --- App Wishy ---
const NAME_KEY = 'wishy-mi-nombre';
const CODE_KEY = 'wishy-codigo-actual';
const THEME_KEY = 'wishy-tema-preferido';

let myName = null;
let eventCode = null;
let myId = null;
let state = {
  eventName: '', currency: 'COP', minAmount: '', maxAmount: '',
  participants: [], assignments: null, drawnAt: null,
  sweet: { startDate: '', durationDays: '', intervalDays: '' }
};
let notifPref = { enabled: false, lastNotified: '' };
let loaded = false;
let activeTab = 'grupo';
let sweetIdeaIndex = 0;
let ideasVisible = false;
let resultVisible = false;
let editingSelf = false;

const SWEET_IDEAS = [
  'Deja un dulce en su puesto o casillero sin dejar rastro.',
  'Mándale un mensaje anónimo diciendo algo que admiras de él o ella.',
  'Pide que le lleven un café o algo calientico a su escritorio.',
  'Déjale una nota chistosa pegada donde la vea al llegar.',
  'Comparte (sin firmar) una canción que le recuerde a esta época.',
  'Pon un dulce o chocolate en su bolso o chaqueta cuando no mire.',
  'Envíale un meme random por un número o cuenta que no reconozca.',
  'Deja un post-it con un cumplido en su cuaderno o computador.',
  'Consíguele algo de su comida favorita y déjalo de sorpresa.',
  'Escóndele un pequeño detalle en un lugar que use todos los días.'
];

function uid() { return 'p' + Math.random().toString(36).slice(2, 9); }
function fmtAmount(n) { if (!n && n !== 0) return ''; return Number(n).toLocaleString('es-CO'); }
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
const escapeAttr = escapeHtml;
function todayStr() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 10); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00');
  const b = new Date(toStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
function genCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function normalizeCode(raw) {
  return (raw || '').trim().toLowerCase().replace(/\s+/g, '-');
}
function eventKey() { return 'evento-' + eventCode; }
function myIdKey() { return 'wishy-my-id-' + eventCode; }

function looksLikeUrl(text) {
  const t = text.trim();
  if (/\s/.test(t)) return false;
  return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t);
}
function normalizeGiftNote(raw) {
  const t = (raw || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (looksLikeUrl(t)) return 'https://' + t;
  return t;
}
function isRealLink(text) {
  return !!text && /^https?:\/\//i.test(text);
}

const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';

function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  s.classList.add('hide');
  setTimeout(() => s.remove(), 500);
}

async function init() {
  let theme = 'light';
  const savedTheme = localStorage.getItem(THEME_KEY);
  theme = savedTheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme, false);

  loaded = true;
  myName = localStorage.getItem(NAME_KEY);

  if (!myName) {
    document.getElementById('bottomNav').style.display = 'none';
    renderNameScreen();
  } else {
    eventCode = localStorage.getItem(CODE_KEY);
    if (!eventCode) {
      document.getElementById('bottomNav').style.display = 'none';
      renderCodeScreen();
    } else {
      await continueIntoEvent();
    }
  }

  setTimeout(hideSplash, 700);
}

function applyTheme(theme, persist) {
  document.body.setAttribute('data-theme', theme);
  document.getElementById('themeToggle').innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
  if (persist) localStorage.setItem(THEME_KEY, theme);
}
document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.body.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark', true);
});

// --- Paso 1: nombre propio ---
function renderNameScreen() {
  const app = document.getElementById('app');
  document.getElementById('codeBar').innerHTML = '';
  app.innerHTML = `
    <h1 class="headline">¿Cómo te llamas?</h1>
    <p class="lede">Wishy funciona como tu cuenta propia en este celular: primero tu nombre, luego el grupo al que quieras entrar.</p>
    <div class="field">
      <label for="myNameInput">Tu nombre</label>
      <input type="text" id="myNameInput" placeholder="Nombre o apodo">
    </div>
    <button class="btn-primary" id="saveNameBtn">Continuar</button>
  `;
  const input = document.getElementById('myNameInput');
  const go = () => {
    const v = input.value.trim();
    if (!v) return;
    myName = v;
    localStorage.setItem(NAME_KEY, v);
    eventCode = localStorage.getItem(CODE_KEY);
    if (!eventCode) renderCodeScreen();
    else continueIntoEvent();
  };
  document.getElementById('saveNameBtn').addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

// --- Paso 2: código del grupo (libre, no autogenerado) ---
function renderCodeScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h1 class="headline">Hola, ${escapeHtml(myName)}</h1>
    <p class="lede">Escribe el nombre del grupo al que quieres entrar. Si no existe, se crea en ese momento; si ya existe, entras a verlo.</p>
    <div class="field">
      <label for="codeInput">Nombre o código del grupo</label>
      <input type="text" id="codeInput" placeholder="ej. familia-perez-2026">
    </div>
    <button class="btn-primary" id="codeGoBtn">Continuar</button>
    <div style="text-align:center; margin-top:14px;">
      <button class="btn-ghost" id="randomCodeBtn">Generar uno al azar</button>
    </div>
    <div style="text-align:center; margin-top:6px;">
      <button class="btn-ghost" id="changeNameBtn2">Cambiar mi nombre</button>
    </div>
  `;
  const input = document.getElementById('codeInput');
  const go = async () => {
    const code = normalizeCode(input.value);
    if (!code) return;
    eventCode = code;
    localStorage.setItem(CODE_KEY, code);
    await continueIntoEvent();
  };
  document.getElementById('codeGoBtn').addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  document.getElementById('randomCodeBtn').addEventListener('click', () => { input.value = genCode(); });
  document.getElementById('changeNameBtn2').addEventListener('click', () => {
    localStorage.removeItem(NAME_KEY);
    myName = null;
    renderNameScreen();
  });
}

async function loadEventData() {
  state = {
    eventName: '', currency: 'COP', minAmount: '', maxAmount: '',
    participants: [], assignments: null, drawnAt: null,
    sweet: { startDate: '', durationDays: '', intervalDays: '' }
  };
  try {
    const res = await storage.get(eventKey(), true);
    if (res && res.value) state = Object.assign(state, JSON.parse(res.value));
    if (!state.sweet) state.sweet = { startDate: '', durationDays: '', intervalDays: '' };
  } catch (e) {}
  const npRaw = localStorage.getItem('wishy-notif-' + eventCode);
  notifPref = npRaw ? JSON.parse(npRaw) : { enabled: false, lastNotified: '' };
}
function saveNotifPref() {
  localStorage.setItem('wishy-notif-' + eventCode, JSON.stringify(notifPref));
}
async function saveState() {
  try {
    const result = await storage.set(eventKey(), JSON.stringify(state), true);
    if (!result) console.error('No se pudo guardar el evento');
  } catch (e) { console.error('Error guardando', e); }
}

// --- Paso 3: entrar al grupo (auto-registro si hace falta) ---
async function continueIntoEvent() {
  await loadEventData();
  renderCodeBar();
  myId = localStorage.getItem(myIdKey());
  const alreadyIn = myId && state.participants.some(p => p.id === myId);
  if (!alreadyIn) {
    myId = null;
    document.getElementById('bottomNav').style.display = 'none';
    renderJoinSelfScreen();
  } else {
    document.getElementById('bottomNav').style.display = 'flex';
    activeTab = state.assignments ? 'resultado' : 'grupo';
    render();
  }
}

function renderJoinSelfScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h1 class="headline">Únete al grupo</h1>
    <p class="lede">${state.eventName ? escapeHtml(state.eventName) + ' — ' : ''}Agrégate con tu nombre y, si quieres, una idea de regalo. Nadie más va a ver tu deseo hasta que le toque regalarte a ti.</p>
    <div class="field">
      <label for="joinNameInput">Tu nombre</label>
      <input type="text" id="joinNameInput" value="${escapeAttr(myName)}">
    </div>
    <div class="field">
      <label for="joinWishInput">Tu deseo (opcional)</label>
      <input type="text" id="joinWishInput" placeholder="Link, talla, idea puntual...">
    </div>
    <button class="btn-primary" id="joinBtn">Unirme al grupo</button>
  `;
  document.getElementById('joinBtn').addEventListener('click', async () => {
    const name = document.getElementById('joinNameInput').value.trim();
    const wish = document.getElementById('joinWishInput').value;
    if (!name) return;
    await loadEventData(); // refresca antes de guardar, para no pisar a otros que se unieron a la vez
    const id = uid();
    state.participants.push({ id, name, link: normalizeGiftNote(wish) });
    const hadDraw = !!state.assignments;
    state.assignments = null; state.drawnAt = null;
    await saveState();
    localStorage.setItem(myIdKey(), id);
    myId = id;
    myName = name;
    localStorage.setItem(NAME_KEY, name);
    document.getElementById('bottomNav').style.display = 'flex';
    activeTab = 'grupo';
    render();
    if (hadDraw) {
      setTimeout(() => alert('El sorteo ya se había hecho, pero como te uniste ahora hay que rehacerlo para incluirte.'), 200);
    }
  });
}

function renderCodeBar() {
  document.getElementById('codeBar').innerHTML = `
    <div class="code-bar">
      <span>${escapeHtml(myName)} · Grupo: <b>${escapeHtml(eventCode)}</b></span>
      <button id="leaveBtn">Cambiar</button>
    </div>
  `;
  document.getElementById('leaveBtn').addEventListener('click', () => {
    if (confirm('Vas a salir de este grupo en este dispositivo (tu lugar en el grupo no se borra). ¿Continuar?')) {
      eventCode = null;
      localStorage.removeItem(CODE_KEY);
      document.getElementById('bottomNav').style.display = 'none';
      document.getElementById('codeBar').innerHTML = '';
      renderCodeScreen();
    }
  });
}

function shuffledDerangement(ids) {
  if (ids.length < 2) return null;
  let attempt = 0;
  while (attempt < 200) {
    attempt++;
    const shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let ok = true;
    for (let i = 0; i < ids.length; i++) { if (shuffled[i] === ids[i]) { ok = false; break; } }
    if (ok) { const map = {}; ids.forEach((giver, i) => { map[giver] = shuffled[i]; }); return map; }
  }
  return null;
}
async function doDraw() {
  await loadEventData();
  const ids = state.participants.map(p => p.id);
  const map = shuffledDerangement(ids);
  if (!map) { alert('Se necesitan al menos 2 personas para sortear.'); return; }
  state.assignments = map; state.drawnAt = Date.now();
  await saveState();
  resultVisible = false;
  activeTab = 'resultado';
  render();
}
async function resetDraw() {
  await loadEventData();
  state.assignments = null; state.drawnAt = null;
  await saveState();
  resultVisible = false;
  render();
}
async function editSelf(name, link) {
  name = (name || '').trim();
  if (!name) return;
  await loadEventData();
  const p = state.participants.find(p => p.id === myId);
  if (!p) { render(); return; }
  p.name = name;
  p.link = normalizeGiftNote(link);
  myName = name;
  localStorage.setItem(NAME_KEY, name);
  editingSelf = false;
  await saveState();
  render();
}
async function leaveGroupEntry() {
  await loadEventData();
  state.participants = state.participants.filter(p => p.id !== myId);
  state.assignments = null; state.drawnAt = null;
  await saveState();
  localStorage.removeItem(myIdKey());
  myId = null;
  document.getElementById('bottomNav').style.display = 'none';
  renderJoinSelfScreen();
}

function getSchedule() {
  const { startDate, durationDays, intervalDays } = state.sweet;
  const duration = parseInt(durationDays, 10);
  const interval = parseInt(intervalDays, 10);
  if (!startDate || !duration || duration <= 0) return null;
  const revealDate = addDays(startDate, duration);
  const step = (interval && interval > 0) ? interval : duration;
  const sweetenDates = [];
  for (let d = step; d < duration; d += step) sweetenDates.push(addDays(startDate, d));
  return { startDate, revealDate, sweetenDates, duration, interval: step };
}

function render() {
  const app = document.getElementById('app');
  const nav = document.getElementById('bottomNav');
  if (!loaded || !eventCode || !myId) return;
  nav.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });
  if (activeTab === 'grupo') renderGrupo(app);
  else if (activeTab === 'resultado') renderResultado(app);
  else renderEndulzar(app);
}

document.getElementById('bottomNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-btn');
  if (!btn) return;
  activeTab = btn.dataset.tab;
  editingSelf = false;
  render();
});

function renderGrupo(app) {
  const me = state.participants.find(p => p.id === myId);
  app.innerHTML = `
    <h1 class="headline">Grupo</h1>
    <p class="lede">Cada quien se agrega con su propio nombre y deseo. Nadie ve el deseo de otro hasta que le toque regalarle.</p>
    <div class="card">
      <div class="field">
        <label for="eventName">Nombre del evento</label>
        <input type="text" id="eventName" placeholder="Novena de la oficina" value="${escapeAttr(state.eventName)}">
      </div>
      <div class="row">
        <div class="field">
          <label for="minAmount">Monto mín.</label>
          <input type="number" id="minAmount" min="0" placeholder="30000" value="${escapeAttr(state.minAmount)}">
        </div>
        <div class="field">
          <label for="maxAmount">Monto máx.</label>
          <input type="number" id="maxAmount" min="0" placeholder="60000" value="${escapeAttr(state.maxAmount)}">
        </div>
        <div class="field" style="max-width:90px;">
          <label for="currency">Moneda</label>
          <select id="currency">
            ${['COP', 'USD', 'MXN', 'EUR', 'PEN', 'ARS', 'CLP'].map(c => `<option value="${c}" ${c === state.currency ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <h1 class="headline" style="font-size:1.15rem;">Participantes (${state.participants.length})</h1>
    <p class="lede" style="margin-bottom:14px;">Solo se ven los nombres — los deseos son privados.</p>
    <ul class="participant-list">
      ${state.participants.map(p => p.id === myId ? (editingSelf ? `
        <li style="flex-direction:column; align-items:stretch; gap:8px;">
          <input type="text" id="selfEditName" value="${escapeAttr(p.name)}" placeholder="Tu nombre">
          <input type="text" id="selfEditWish" value="${escapeAttr(p.link)}" placeholder="Tu deseo (opcional)">
          <div class="row">
            <button class="btn-add" id="saveSelfEdit">Guardar</button>
            <button class="btn-secondary" id="cancelSelfEdit">Cancelar</button>
          </div>
        </li>
      ` : `
        <li>
          <div class="p-name">${escapeHtml(p.name)} <span class="note" style="display:inline;">(tú)</span></div>
          <div style="display:flex; gap:4px;">
            <button class="p-remove" id="editSelfBtn" title="Editar">✎</button>
            <button class="p-remove" id="leaveSelfBtn" title="Salir">✕</button>
          </div>
        </li>
      `) : `
        <li><div class="p-name">${escapeHtml(p.name)}</div></li>
      `).join('')}
    </ul>

    ${!state.assignments
      ? `<button class="btn-primary" id="drawBtn" ${state.participants.length < 2 ? 'disabled' : ''}>Realizar el sorteo</button>
         ${state.participants.length < 2 ? '<p class="note" style="text-align:center;">Se necesitan al menos 2 personas.</p>' : ''}`
      : `<div class="warn">El sorteo ya se hizo. Ve a la pestaña "Mi resultado".</div>
         <button class="btn-ghost" id="resetDrawBtn">Rehacer el sorteo (borra el actual para todos)</button>`
    }

    <div class="warn" style="margin-top:16px;">Comparte el código <b>${escapeHtml(eventCode)}</b> — cada quien entra a esta app, escribe ese mismo código, y se agrega con su propio nombre.</div>
  `;

  document.getElementById('eventName').addEventListener('input', e => { state.eventName = e.target.value; saveState(); });
  document.getElementById('minAmount').addEventListener('input', e => { state.minAmount = e.target.value; saveState(); });
  document.getElementById('maxAmount').addEventListener('input', e => { state.maxAmount = e.target.value; saveState(); });
  document.getElementById('currency').addEventListener('change', e => { state.currency = e.target.value; saveState(); });

  const editBtn = document.getElementById('editSelfBtn');
  if (editBtn) editBtn.addEventListener('click', () => { editingSelf = true; render(); });
  const cancelBtn = document.getElementById('cancelSelfEdit');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { editingSelf = false; render(); });
  const saveBtn = document.getElementById('saveSelfEdit');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    editSelf(document.getElementById('selfEditName').value, document.getElementById('selfEditWish').value);
  });
  const leaveBtn = document.getElementById('leaveSelfBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', () => {
    if (confirm('¿Salir del grupo? Se borra tu nombre y tu deseo de esta lista.')) leaveGroupEntry();
  });
  const drawBtn = document.getElementById('drawBtn');
  if (drawBtn) drawBtn.addEventListener('click', doDraw);
  const resetBtn = document.getElementById('resetDrawBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (confirm('Esto borra el sorteo actual para todos. ¿Continuar?')) resetDraw();
  });
}

function renderResultado(app) {
  if (!state.assignments) {
    app.innerHTML = `
      <h1 class="headline">Mi resultado</h1>
      <p class="lede">Todavía no se ha hecho el sorteo.</p>
      ${state.participants.length >= 2
        ? `<button class="btn-primary" id="drawBtn2">Realizar el sorteo</button>`
        : `<p class="note">Se necesitan al menos 2 personas en el grupo.</p>`}
    `;
    const drawBtn = document.getElementById('drawBtn2');
    if (drawBtn) drawBtn.addEventListener('click', doDraw);
    return;
  }

  const byId = {};
  state.participants.forEach(p => byId[p.id] = p);
  const target = byId[state.assignments[myId]];
  const amountRange = (state.minAmount || state.maxAmount)
    ? `Monto sugerido: ${state.minAmount ? fmtAmount(state.minAmount) : '—'} a ${state.maxAmount ? fmtAmount(state.maxAmount) : '—'} ${state.currency}`
    : '';

  app.innerHTML = `
    <h1 class="headline">Mi resultado</h1>
    <p class="lede">Solo tú puedes ver esto en tu celular.</p>
    ${!target ? '<p class="empty">No se encontró tu asignación.</p>' : (!resultVisible ? `
      <button class="btn-primary" id="showResultBtn">Ver mi resultado</button>
    ` : `
      <div class="reveal-card">
        <div class="to">Te tocó regalarle a</div>
        <div class="name">${escapeHtml(target.name)}</div>
        ${amountRange ? `<div class="budget">${amountRange}</div>` : ''}
        ${target.link ? (isRealLink(target.link)
            ? `<a class="giftlink" href="${escapeAttr(target.link)}" target="_blank" rel="noopener">Ver su link de regalo →</a>`
            : `<p class="note">Idea de regalo: ${escapeHtml(target.link)}</p>`)
          : '<p class="note">No dejó ninguna idea de regalo.</p>'}
        <div><button class="btn-ghost" id="hideResultBtn" style="margin-top:14px;">Ocultar</button></div>
      </div>
    `)}
  `;
  const showBtn = document.getElementById('showResultBtn');
  if (showBtn) showBtn.addEventListener('click', () => { resultVisible = true; render(); });
  const hideBtn = document.getElementById('hideResultBtn');
  if (hideBtn) hideBtn.addEventListener('click', () => { resultVisible = false; render(); });
}

function renderEndulzar(app) {
  const sched = getSchedule();
  const today = todayStr();
  let bannerHtml = '';
  let countdownHtml = '';

  if (sched) {
    const isSweetenDay = sched.sweetenDates.includes(today);
    const isRevealDay = today === sched.revealDate;
    if (isRevealDay) bannerHtml = `<div class="sweet-banner">🎁 ¡Hoy es la revelación final!</div>`;
    else if (isSweetenDay) bannerHtml = `<div class="sweet-banner">🍬 ¡Hoy toca endulzar!</div>`;

    const daysToReveal = daysBetween(today, sched.revealDate);
    const nextSweeten = sched.sweetenDates.find(d => d >= today);
    const daysToNext = nextSweeten ? daysBetween(today, nextSweeten) : null;
    countdownHtml = `
      <div class="countdown-row">
        <div class="countdown">
          <span class="num">${daysToReveal >= 0 ? daysToReveal : 0}</span>
          <span class="lbl">días para la revelación</span>
        </div>
        <div class="countdown">
          <span class="num">${daysToNext !== null ? (daysToNext > 0 ? daysToNext : 0) : '—'}</span>
          <span class="lbl">${daysToNext === null ? 'sin más endulces' : daysToNext === 0 ? 'endulza hoy' : 'días para endulzar'}</span>
        </div>
      </div>
    `;
  }

  const idea = SWEET_IDEAS[sweetIdeaIndex % SWEET_IDEAS.length];
  const notifSupported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const notifGranted = notifSupported && Notification.permission === 'granted' && notifPref.enabled;

  app.innerHTML = `
    <h1 class="headline">Gana aura endulzando</h1>
    <p class="lede">Antes de la revelación, deja detalles para tu Wishy sin que se dé cuenta de quién eres.</p>
    ${bannerHtml}
    ${countdownHtml}

    <div class="sweet-card">
      <button class="btn-secondary" id="toggleIdeas">${ideasVisible ? 'Ocultar ideas' : 'Mostrar ideas'}</button>
      ${ideasVisible ? `
        <div class="idea">"${idea}"</div>
        <button class="btn-secondary" id="anotherIdea">Otra idea</button>
      ` : ''}
    </div>

    <div class="card">
      <label>¿Cuánto dura el amigo secreto?</label>
      <div class="row">
        <div class="field">
          <label for="startDate" style="font-size:0.72rem;">Fecha de inicio</label>
          <input type="date" id="startDate" value="${escapeAttr(state.sweet.startDate)}">
        </div>
        <div class="field">
          <label for="durationDays" style="font-size:0.72rem;">Duración (días)</label>
          <input type="number" id="durationDays" min="1" placeholder="15" value="${escapeAttr(state.sweet.durationDays)}">
        </div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label for="intervalDays">Cada cuántos días endulzar</label>
        <input type="number" id="intervalDays" min="1" placeholder="3" value="${escapeAttr(state.sweet.intervalDays)}">
      </div>
      <p class="note">${sched ? `Del ${sched.startDate} al ${sched.revealDate}, cada ${sched.interval} días. Esto queda visible para todo el grupo.` : 'Completa la fecha de inicio y la duración para calcular el calendario.'}</p>
    </div>

    <div class="card">
      <div class="notif-row">
        <div>
          <div style="font-weight:600; font-size:0.9rem;">Recordarme por notificación</div>
          <div class="notif-status">${!notifSupported ? 'Tu navegador no soporta notificaciones push.' : notifGranted ? 'Activado — te llegará aunque tengas la app cerrada.' : 'Actívalo para recibir el aviso incluso con la app cerrada.'}</div>
        </div>
        <button class="btn-add" id="notifBtn" ${!notifSupported ? 'disabled' : ''}>${notifGranted ? 'Activado' : 'Activar'}</button>
      </div>
    </div>
  `;

  document.getElementById('toggleIdeas').addEventListener('click', () => { ideasVisible = !ideasVisible; renderEndulzar(app); });
  const anotherBtn = document.getElementById('anotherIdea');
  if (anotherBtn) anotherBtn.addEventListener('click', () => {
    sweetIdeaIndex = Math.floor(Math.random() * SWEET_IDEAS.length);
    renderEndulzar(app);
  });
  document.getElementById('startDate').addEventListener('change', e => { state.sweet.startDate = e.target.value; saveState(); renderEndulzar(app); });
  document.getElementById('durationDays').addEventListener('input', e => { state.sweet.durationDays = e.target.value; saveState(); renderEndulzar(app); });
  document.getElementById('intervalDays').addEventListener('input', e => { state.sweet.intervalDays = e.target.value; saveState(); renderEndulzar(app); });
  document.getElementById('notifBtn').addEventListener('click', async () => {
    if (!notifSupported) return;
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        const ok = await subscribeToPush(eventCode);
        notifPref.enabled = ok;
      } else {
        notifPref.enabled = false;
      }
      saveNotifPref();
      renderEndulzar(app);
    } catch (e) { console.error(e); }
  });
}

init();
