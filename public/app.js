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

// --- App Wishy (misma logica que la version de Claude, ahora contra el servidor) ---
const CODE_KEY = 'codigo-actual';
const THEME_KEY = 'tema-preferido';

let eventCode = null;
let state = {
  eventName: '', currency: 'COP', minAmount: '', maxAmount: '',
  participants: [], assignments: null, drawnAt: null,
  sweet: { startDate: '', durationDays: '', intervalDays: '' }
};
let notifPref = { enabled: false, lastNotified: '' };
let revealedFor = null;
let loaded = false;
let activeTab = 'amigos';
let sweetIdeaIndex = 0;

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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function eventKey() { return 'evento-' + eventCode; }

const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';

async function init() {
  let theme = 'light';
  const savedTheme = localStorage.getItem(THEME_KEY);
  theme = savedTheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme, false);

  eventCode = localStorage.getItem(CODE_KEY) || null;

  loaded = true;
  if (eventCode) {
    await loadEventData();
    renderCodeBar();
    document.getElementById('bottomNav').style.display = 'flex';
    if (state.assignments) activeTab = 'angelito';
    render();
  } else {
    document.getElementById('bottomNav').style.display = 'none';
    renderJoinScreen();
  }
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
  const npRaw = localStorage.getItem('notif-' + eventCode);
  notifPref = npRaw ? JSON.parse(npRaw) : { enabled: false, lastNotified: '' };
}
function saveNotifPref() {
  localStorage.setItem('notif-' + eventCode, JSON.stringify(notifPref));
}

async function joinEvent(code) {
  code = (code || '').trim().toUpperCase();
  if (!code) return;
  eventCode = code;
  localStorage.setItem(CODE_KEY, code);
  await loadEventData();
  renderCodeBar();
  document.getElementById('bottomNav').style.display = 'flex';
  activeTab = state.assignments ? 'angelito' : 'amigos';
  render();
}

function leaveEvent() {
  eventCode = null;
  localStorage.removeItem(CODE_KEY);
  document.getElementById('bottomNav').style.display = 'none';
  document.getElementById('codeBar').innerHTML = '';
  renderJoinScreen();
}

function renderJoinScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h1 class="headline">Bienvenido a Wishy</h1>
    <p class="lede">Crea un grupo nuevo o entra con el código que te compartieron para ver el mismo sorteo, la misma lista y los mismos recordatorios.</p>
    <div class="join-wrap">
      <button class="btn-primary" id="createBtn">Crear un grupo nuevo</button>
      <div class="or-sep">o</div>
      <div class="field" style="margin-bottom:8px;">
        <label for="joinCodeInput">Código del grupo</label>
        <input type="text" id="joinCodeInput" class="join-code-input" maxlength="8" placeholder="AB3F9">
      </div>
      <button class="btn-secondary" id="joinBtn">Entrar con este código</button>
    </div>
  `;
  document.getElementById('createBtn').addEventListener('click', () => joinEvent(genCode()));
  const input = document.getElementById('joinCodeInput');
  document.getElementById('joinBtn').addEventListener('click', () => joinEvent(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); joinEvent(input.value); } });
}

function renderCodeBar() {
  document.getElementById('codeBar').innerHTML = `
    <div class="code-bar">
      <span>Código del grupo: <b>${escapeHtml(eventCode)}</b></span>
      <button id="leaveBtn">Cambiar</button>
    </div>
  `;
  document.getElementById('leaveBtn').addEventListener('click', () => {
    if (confirm('Vas a salir de este grupo en este dispositivo (el evento no se borra). ¿Continuar?')) leaveEvent();
  });
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

async function saveState() {
  try {
    const result = await storage.set(eventKey(), JSON.stringify(state), true);
    if (!result) console.error('No se pudo guardar el evento');
  } catch (e) { console.error('Error guardando', e); }
}

function addParticipant(name, link) {
  name = (name || '').trim();
  if (!name) return;
  link = (link || '').trim();
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  state.participants.push({ id: uid(), name, link });
  state.assignments = null; state.drawnAt = null;
  saveState(); render();
}
function removeParticipant(id) {
  state.participants = state.participants.filter(p => p.id !== id);
  state.assignments = null; state.drawnAt = null;
  saveState(); render();
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
function doDraw() {
  const ids = state.participants.map(p => p.id);
  const map = shuffledDerangement(ids);
  if (!map) { alert('Agrega al menos 2 personas para sortear.'); return; }
  state.assignments = map; state.drawnAt = Date.now(); revealedFor = null;
  saveState(); render();
}
function resetDraw() {
  state.assignments = null; state.drawnAt = null; revealedFor = null;
  saveState(); render();
}
function editList() {
  state.assignments = null; state.drawnAt = null; revealedFor = null;
  saveState(); render();
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
  if (!loaded || !eventCode) return;
  nav.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });
  if (activeTab === 'amigos') renderAmigos(app);
  else if (activeTab === 'angelito') renderAngelito(app);
  else renderEndulzar(app);
}

document.getElementById('bottomNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-btn');
  if (!btn) return;
  activeTab = btn.dataset.tab;
  render();
});

function renderAmigos(app) {
  app.innerHTML = `
    <h1 class="headline">Arma el grupo</h1>
    <p class="lede">Agrega a los participantes, define el monto y cuando estén todos, ve a "Sorteo".</p>
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
    <h1 class="headline" style="font-size:1.15rem;">Participantes</h1>
    <p class="lede" style="margin-bottom:14px;">El link de regalo es opcional: wishlist, tienda o producto puntual.</p>
    <div class="add-row">
      <div class="field">
        <label for="newName">Nombre</label>
        <input type="text" id="newName" placeholder="Nombre">
      </div>
      <button class="btn-add" id="addBtn">+</button>
    </div>
    <div class="field" style="margin-top:-10px;">
      <input type="text" id="newLink" placeholder="Link de regalo (opcional)">
    </div>
    ${state.participants.length === 0
      ? '<p class="empty">Aún no hay participantes.</p>'
      : `<ul class="participant-list">
          ${state.participants.map(p => `
            <li>
              <div>
                <div class="p-name">${escapeHtml(p.name)}</div>
                ${p.link ? `<a class="p-link" href="${escapeAttr(p.link)}" target="_blank" rel="noopener">${escapeHtml(p.link)}</a>` : ''}
              </div>
              <button class="p-remove" data-id="${p.id}" aria-label="Quitar">✕</button>
            </li>`).join('')}
        </ul>`
    }
    <div class="warn">Comparte el código <b>${escapeHtml(eventCode)}</b> y el enlace de esta app con el grupo — quien entre con ese código ve esta misma lista, el sorteo y los recordatorios.</div>
  `;
  document.getElementById('eventName').addEventListener('input', e => { state.eventName = e.target.value; saveState(); });
  document.getElementById('minAmount').addEventListener('input', e => { state.minAmount = e.target.value; saveState(); });
  document.getElementById('maxAmount').addEventListener('input', e => { state.maxAmount = e.target.value; saveState(); });
  document.getElementById('currency').addEventListener('change', e => { state.currency = e.target.value; saveState(); });
  const nameInput = document.getElementById('newName');
  const linkInput = document.getElementById('newLink');
  document.getElementById('addBtn').addEventListener('click', () => addParticipant(nameInput.value, linkInput.value));
  [nameInput, linkInput].forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addParticipant(nameInput.value, linkInput.value); }
    });
  });
  document.querySelectorAll('.p-remove').forEach(btn => {
    btn.addEventListener('click', () => removeParticipant(btn.dataset.id));
  });
}

function renderAngelito(app) {
  if (!state.assignments) {
    app.innerHTML = `
      <h1 class="headline">Listos para sortear</h1>
      <p class="lede">${state.participants.length < 2
        ? 'Agrega al menos 2 personas en la pestaña "Amigos" para poder sortear.'
        : `Hay ${state.participants.length} participantes. Cuando todos estén en la lista, dale al botón.`}</p>
      <button class="btn-primary" id="drawBtn" ${state.participants.length < 2 ? 'disabled' : ''}>Realizar el sorteo</button>
    `;
    const drawBtn = document.getElementById('drawBtn');
    if (drawBtn) drawBtn.addEventListener('click', doDraw);
    return;
  }
  const byId = {};
  state.participants.forEach(p => byId[p.id] = p);
  const amountRange = (state.minAmount || state.maxAmount)
    ? `Monto sugerido: ${state.minAmount ? fmtAmount(state.minAmount) : '—'} a ${state.maxAmount ? fmtAmount(state.maxAmount) : '—'} ${state.currency}`
    : '';
  app.innerHTML = `
    <h1 class="headline">${state.eventName ? escapeHtml(state.eventName) : 'Tu sorteo'}</h1>
    ${amountRange ? `<p class="lede" style="margin-bottom:16px;">${amountRange}</p>` : '<div style="height:6px;"></div>'}
    <label for="revealSelect">¿Quién eres?</label>
    <select id="revealSelect">
      <option value="">Selecciona tu nombre</option>
      ${state.participants.map(p => `<option value="${p.id}" ${revealedFor === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
    </select>
    <div id="revealArea"></div>
    <div style="margin-top:22px;">
      <button class="btn-ghost" id="editListBtn">Editar lista de participantes</button><br>
      <button class="btn-ghost" id="resetDrawBtn">Repetir el sorteo</button>
    </div>
  `;
  document.getElementById('editListBtn').addEventListener('click', editList);
  document.getElementById('resetDrawBtn').addEventListener('click', () => {
    if (confirm('Esto borra el sorteo actual para todos. ¿Continuar?')) resetDraw();
  });
  const select = document.getElementById('revealSelect');
  select.addEventListener('change', () => { revealedFor = select.value || null; renderRevealArea(); });
  renderRevealArea();
  function renderRevealArea() {
    const area = document.getElementById('revealArea');
    if (!revealedFor) { area.innerHTML = ''; return; }
    const target = byId[state.assignments[revealedFor]];
    if (!target) { area.innerHTML = '<p class="empty">No se encontró tu asignación.</p>'; return; }
    area.innerHTML = `
      <div class="reveal-card">
        <div class="to">Te tocó regalarle a</div>
        <div class="name">${escapeHtml(target.name)}</div>
        ${amountRange ? `<div class="budget">${amountRange}</div>` : ''}
        ${target.link ? `<a class="giftlink" href="${escapeAttr(target.link)}" target="_blank" rel="noopener">Ver su link de regalo →</a>` : '<p class="note">No dejó un link de regalo.</p>'}
        <div><button class="btn-ghost" id="hideBtn" style="margin-top:14px;">Ocultar</button></div>
      </div>
    `;
    document.getElementById('hideBtn').addEventListener('click', () => {
      revealedFor = null; select.value = ''; renderRevealArea();
    });
  }
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
    else if (isSweetenDay) bannerHtml = `<div class="sweet-banner">🍬 ¡Hoy toca endulzar a tu angelito!</div>`;

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
    <h1 class="headline">Endulza a tu angelito</h1>
    <p class="lede">Antes de la revelación, deja detalles anónimos para tu angelito sin que se dé cuenta de quién eres.</p>
    ${bannerHtml}
    ${countdownHtml}
    <div class="sweet-card">
      <div class="idea">"${idea}"</div>
      <button class="btn-secondary" id="anotherIdea">Otra idea</button>
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

  document.getElementById('anotherIdea').addEventListener('click', () => {
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
