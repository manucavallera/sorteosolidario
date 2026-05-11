/* ============================================
   SORTEO SOLIDARIO - Multi-Raffle App
   v4 - Firebase Firestore + Real-time sync
   ============================================ */

// ---- Defaults ----
const DEFAULT_RAFFLE = {
  id: '',
  name: 'Nuevo Sorteo',
  active: true,
  totalNumbers: 100,
  pricePerNumber: 1000,
  currency: '$',
  whatsappNumber: '5491100000000',
  soldNumbers: [],
  reservations: [],
  raffleDate: '',
  heroTitle: 'pequeño guerrero 💙',
  heroDescription: 'Gracias por unirte a este grupo de sorteos, realizados para solventar gastos médicos de mi hijo Gadiel Cavallera. Nació con Hidrocefalia severa, tiene epilepsia refractaria, autismo y retraso madurativo.',
  storyTitle: 'Un guerrero de verdad',
  storyText1: 'Gadiel nació con Hidrocefalia severa, tiene epilepsia refractaria, autismo y retraso madurativo. Es un luchador incansable que inspira a toda la familia con su valentía.',
  storyText2: 'Los tratamientos y cuidados que necesita son costosos. Por eso organizamos este sorteo solidario para solventar sus gastos médicos.',
  storyQuote: 'Cada número que comprás no es solo una chance de ganar un premio, es un acto de amor. ¡Gracias por sumarte! 💙',
  prize1Title: 'Premio Principal',
  prize1Desc: 'Completá con los detalles del premio',
  prize2Title: 'Segundo Premio',
  prize2Desc: 'Completá con los detalles del premio',
  prize3Title: 'Tercer Premio',
  prize3Desc: 'Completá con los detalles del premio',
  createdAt: 0,
};

const DEFAULT_APP_DATA = {
  adminPassword: 'admin123',
  globalTitle: 'Sorteos Solidarios',
  globalSubtitle: 'Ayudemos juntos a quienes más lo necesitan 💙',
  raffles: [],
};

function generateId() {
  return 'r_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// ============================================
// FIREBASE / FIRESTORE LAYER
// ============================================
let db = null;
let _firestoreConfigured = false;
let _raffleListeners = {};  // raffleId → unsubscribe fn

function initFirebase() {
  try {
    if (
      typeof firebase !== 'undefined' &&
      typeof FIREBASE_CONFIG !== 'undefined' &&
      FIREBASE_CONFIG.apiKey !== 'REEMPLAZAR'
    ) {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      _firestoreConfigured = true;
      console.log('✅ Firebase conectado');
    } else {
      console.warn('⚠️ Firebase no configurado — usando localStorage');
    }
  } catch (e) {
    console.warn('Firebase init error:', e);
  }
}

// ---- Guardar en Firestore ----
async function saveToFirestore(data) {
  if (!db) return;
  try {
    // Guardar config global
    await db.collection('config').doc('main').set({
      adminPassword: data.adminPassword,
      globalTitle:   data.globalTitle,
      globalSubtitle: data.globalSubtitle,
    });
    // Guardar cada sorteo
    for (const raffle of data.raffles) {
      await db.collection('raffles').doc(raffle.id).set(raffle);
    }
  } catch (e) {
    console.warn('Error guardando en Firestore:', e);
    if (e.code === 'permission-denied') {
      alert('⚠️ ATENCIÓN: Firebase está bloqueando el guardado. Los datos solo se guardaron en tu celular. Tenés que ir a Firebase -> Firestore Database -> Reglas y poner "allow read, write: if true;"');
    }
  }
}

// ---- Cargar desde Firestore ----
async function loadFromFirestore() {
  if (!db) return null;
  try {
    const [configSnap, rafflesSnap] = await Promise.all([
      db.collection('config').doc('main').get(),
      db.collection('raffles').orderBy('createdAt').get(),
    ]);
    const config = configSnap.exists ? configSnap.data() : {};
    const raffles = rafflesSnap.docs.map(doc => ({
      ...DEFAULT_RAFFLE,
      ...doc.data(),
      reservations: doc.data().reservations || [],
      soldNumbers:  doc.data().soldNumbers  || [],
    }));
    return { ...DEFAULT_APP_DATA, ...config, raffles };
  } catch (e) {
    console.warn('Error cargando desde Firestore:', e);
    if (e.code === 'permission-denied') {
      alert('⚠️ ATENCIÓN: Firebase está bloqueando la lectura de sorteos. Nadie puede verlos. Tenés que ir a Firebase -> Firestore Database -> Reglas y poner "allow read, write: if true;"');
    }
    return null;
  }
}

// ---- Listener en tiempo real para números vendidos ----
function subscribeToRaffle(raffleId) {
  if (!db || _raffleListeners[raffleId]) return;
  _raffleListeners[raffleId] = db.collection('raffles').doc(raffleId)
    .onSnapshot(doc => {
      if (!doc.exists) return;
      const data = doc.data();
      const raffle = APP.raffles.find(r => r.id === raffleId);
      if (!raffle) return;
      const newSold = data.soldNumbers || [];
      // Solo re-renderizar si cambiaron los vendidos
      if (JSON.stringify(newSold) !== JSON.stringify(raffle.soldNumbers)) {
        raffle.soldNumbers = newSold;
        saveLocalCache(APP);
        // Si el usuario está viendo ese sorteo, refrescar la grilla
        if (state.currentView === 'raffle' && state.currentRaffleId === raffleId) {
          initRaffleGrid(raffle);
          showToast('🔄 Números actualizados en tiempo real');
        }
      }
    }, err => console.warn('onSnapshot error:', err));
}

// ---- Listener en tiempo real para la LISTA de sorteos ----
// Esto hace que cuando el admin crea/edita/elimina un sorteo,
// todos los visitantes lo ven automáticamente sin recargar.
let _raffleListListener = null;
function subscribeToRaffleList() {
  if (!db || _raffleListListener) return;
  _raffleListListener = db.collection('raffles').orderBy('createdAt')
    .onSnapshot(snapshot => {
      const newRaffles = snapshot.docs.map(doc => ({
        ...DEFAULT_RAFFLE,
        ...doc.data(),
        reservations: doc.data().reservations || [],
        soldNumbers:  doc.data().soldNumbers  || [],
      }));
      // Solo actualizar si cambió algo
      if (JSON.stringify(newRaffles) !== JSON.stringify(APP.raffles)) {
        APP.raffles = newRaffles;
        saveLocalCache(APP);
        // Si el usuario está en el home, re-renderizar para mostrar nuevos sorteos
        if (state.currentView === 'home') {
          render();
        }
      }
    }, err => {
      console.warn('subscribeToRaffleList error:', err);
      if (err.code === 'permission-denied') {
        console.error('Firebase Reglas bloquean lectura en tiempo real.');
      }
    });
}

function unsubscribeAll() {
  Object.values(_raffleListeners).forEach(unsub => unsub());
  _raffleListeners = {};
  if (_raffleListListener) { _raffleListListener(); _raffleListListener = null; }
}

// ============================================
// LOCAL STORAGE (cache / fallback)
// ============================================
function saveLocalCache(data) {
  try { localStorage.setItem('sorteo_app_data', JSON.stringify(data)); }
  catch (e) { /* ignore */ }
}

function loadLocalCache() {
  try {
    const saved = localStorage.getItem('sorteo_app_data');
    if (!saved) return { ...DEFAULT_APP_DATA };
    const parsed = JSON.parse(saved);
    // Migración de versión antigua (formato sin raffles[])
    if (parsed.totalNumbers && !parsed.raffles) {
      const migrated = { ...DEFAULT_APP_DATA };
      migrated.adminPassword = parsed.adminPassword || 'admin123';
      const raffle = { ...DEFAULT_RAFFLE, ...parsed, id: generateId(), createdAt: Date.now(), reservations: [] };
      delete raffle.adminPassword;
      migrated.raffles = [raffle];
      return migrated;
    }
    if (parsed.raffles) {
      parsed.raffles = parsed.raffles.map(r => ({ ...DEFAULT_RAFFLE, ...r, reservations: r.reservations || [] }));
    }
    return { ...DEFAULT_APP_DATA, ...parsed };
  } catch (e) {
    return { ...DEFAULT_APP_DATA };
  }
}

// ---- saveAppData: guarda en Firestore + cache local ----
function saveAppData(data) {
  saveLocalCache(data);
  if (_firestoreConfigured) {
    saveToFirestore(data).catch(e => console.warn('saveToFirestore error:', e));
  }
}

// ---- APP se inicializa desde cache local; Firestore la sobreescribe al cargar ----
let APP = loadLocalCache();

// ============================================
// STATE
// ============================================
const state = {
  currentView: 'home',
  currentRaffleId: null,
  selectedNumbers: [],
  adminUnlocked: false,
};

let _countdownInterval = null;

// ---- Router ----
function navigate(view, raffleId) {
  clearCountdown();
  // Desuscribir listeners anteriores si cambiamos de sorteo
  if (state.currentRaffleId && state.currentRaffleId !== raffleId) {
    if (_raffleListeners[state.currentRaffleId]) {
      _raffleListeners[state.currentRaffleId]();
      delete _raffleListeners[state.currentRaffleId];
    }
  }
  state.currentView = view;
  state.currentRaffleId = raffleId || null;
  state.selectedNumbers = [];
  window.location.hash = view === 'raffle' && raffleId ? `sorteo/${raffleId}` : '';
  render();
  window.scrollTo(0, 0);
  // Suscribir en tiempo real al sorteo que se está viendo
  if (view === 'raffle' && raffleId) subscribeToRaffle(raffleId);
}

function handleHashChange() {
  const hash = window.location.hash.replace('#', '');

  if (hash.startsWith('sorteo/')) {
    const id = hash.replace('sorteo/', '');
    const raffle = APP.raffles.find(r => r.id === id);
    if (raffle) {
      state.currentView = 'raffle';
      state.currentRaffleId = id;
      state.selectedNumbers = [];
      render();
      subscribeToRaffle(id);
      return;
    }
  }

  // Si el hash corresponde a una sección en el DOM (ej: #historia, #premios)
  // y estamos en una página de sorteo, scroll suave en vez de navegar a home
  if (hash && state.currentView === 'raffle') {
    const target = document.getElementById(hash);
    if (target) {
      const navbar = document.getElementById('navbar');
      const offset = navbar ? navbar.offsetHeight + 8 : 8;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
      return;
    }
  }

  state.currentView = 'home';
  state.currentRaffleId = null;
  render();
}

// ---- Spinner de carga inicial ----
function showLoadingSpinner() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;">
      <div style="font-size:3rem;animation:spin 1s linear infinite;">🎟️</div>
      <p style="color:var(--text-secondary);font-size:1rem;">Cargando sorteos...</p>
    </div>`;
  // Inyectar la animación si no existe
  if (!document.getElementById('spin-style')) {
    const s = document.createElement('style');
    s.id = 'spin-style';
    s.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Inicializar Firebase
  initFirebase();

  // 2. Si Firebase está configurado, mostrar spinner y cargar datos reales
  if (_firestoreConfigured) {
    showLoadingSpinner();
    const firestoreData = await loadFromFirestore();
    if (firestoreData) {
      APP = firestoreData;
      saveLocalCache(APP);
    }
  }

  // 3. Arrancar la app
  window.addEventListener('hashchange', handleHashChange);
  handleHashChange();
  initAdminFab();

  // 4. Suscribir en tiempo real a la lista de sorteos
  //    (así cuando el admin crea uno, aparece para todos sin recargar)
  if (_firestoreConfigured) {
    subscribeToRaffleList();
  }
});

function clearCountdown() {
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
}

// ---- Main Render ----
function render() {
  const app = document.getElementById('app');
  if (!app) return;
  if (state.currentView === 'raffle' && state.currentRaffleId) {
    const raffle = APP.raffles.find(r => r.id === state.currentRaffleId);
    if (raffle) { app.innerHTML = renderRafflePage(raffle); initRafflePage(raffle); return; }
  }
  app.innerHTML = renderHomePage();
  initHomePage();
}

// ============================================
// HOME PAGE
// ============================================
function renderHomePage() {
  const activeRaffles = APP.raffles.filter(r => r.active);
  const raffleCards = activeRaffles.length > 0
    ? activeRaffles.map(r => renderRaffleCard(r)).join('')
    : `<div class="empty-state"><div class="empty-state__icon">🎟️</div><h3>No hay sorteos activos</h3><p>Tocá el ⚙️ abajo a la izquierda para crear el primer sorteo.</p></div>`;

  return `
    <section class="hero hero--home" id="inicio">
      <div class="hero__bg"><img src="hero_background.png" alt="" class="hero__bg-image" /><div class="hero__bg-overlay"></div></div>
      <div class="hero__particles" id="hero-particles"></div>
      <div class="hero__content">
        <div class="hero__badge"><span>✨</span> <span>${APP.globalTitle}</span></div>
        <h1 class="hero__title">Ayudemos juntos a este gran<br /><span class="hero__title-gradient">pequeño guerrero 💙</span></h1>
        <p class="hero__description">${APP.globalSubtitle} <strong>Elegí un sorteo y participá.</strong></p>
      </div>
      ${activeRaffles.length > 0 ? `<div class="hero__scroll-hint"><span>Deslizá</span><div class="scroll-arrow"></div></div>` : ''}
    </section>
    <section class="raffles-section" id="sorteos">
      <div class="container">
        <h2 class="section-title fade-up">Sorteos Activos 🎉</h2>
        <p class="section-subtitle fade-up">Elegí un sorteo para ver los números y participar</p>
        <div class="raffles-grid">${raffleCards}</div>
      </div>
    </section>
    <section class="contact" id="contacto">
      <div class="container container--narrow">
        <div class="contact__card glass fade-up">
          <div class="contact__icon">💬</div>
          <h2 class="contact__title">¿Tenés dudas? ¡Escribinos!</h2>
          <p class="contact__desc">Si tenés alguna pregunta sobre los sorteos, no dudes en contactarnos.</p>
          <a href="#" class="contact__whatsapp" onclick="openWhatsAppGeneral(); return false;"><span class="contact__whatsapp-icon">📱</span>Escribinos por WhatsApp</a>
        </div>
      </div>
    </section>
    <footer class="footer"><div class="container"><p class="footer__text">Hecho con <span class="footer__heart">❤️</span> y mucha solidaridad<br />${APP.globalTitle} 2026</p></div></footer>`;
}

function renderRaffleCard(r) {
  const sold = r.soldNumbers.length;
  const available = r.totalNumbers - sold;
  const dateStr = r.raffleDate ? formatCountdownShort(r.raffleDate) : '';
  return `
    <div class="raffle-card glass fade-up" onclick="navigate('raffle','${r.id}')">
      <div class="raffle-card__header">
        <span class="raffle-card__badge">🟢 Activo</span>
        ${dateStr ? `<span class="raffle-card__date">📅 ${dateStr}</span>` : ''}
      </div>
      <h3 class="raffle-card__title">${r.name}</h3>
      <p class="raffle-card__desc">${r.heroDescription.substring(0, 90)}...</p>
      <div class="raffle-card__stats">
        <div class="raffle-card__stat"><span class="raffle-card__stat-value">${available}</span><span class="raffle-card__stat-label">Disponibles</span></div>
        <div class="raffle-card__stat"><span class="raffle-card__stat-value">${r.currency}${r.pricePerNumber.toLocaleString('es-AR')}</span><span class="raffle-card__stat-label">Por número</span></div>
        <div class="raffle-card__stat"><span class="raffle-card__stat-value">🏆 3</span><span class="raffle-card__stat-label">Premios</span></div>
      </div>
      <div class="raffle-card__cta"><span>Ver sorteo →</span></div>
    </div>`;
}

function formatCountdownShort(dateStr) {
  if (!dateStr) return '';
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const diff = target - now;
  if (diff <= 0) return 'Finalizado';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return '¡Hoy!';
  if (days === 1) return 'Mañana';
  return `${days} días`;
}

function initHomePage() { initParticles(); initScrollAnimations(); }

// ============================================
// RAFFLE DETAIL PAGE
// ============================================
function renderRafflePage(r) {
  const hasDate = !!r.raffleDate;
  return `
    <nav class="navbar" id="navbar">
      <div class="container">
        <a href="javascript:void(0)" class="navbar__logo" onclick="navigate('home')"><span class="navbar__logo-icon">💙</span><div class="navbar__logo-text"><span>${r.name}</span></div></a>
        <div class="navbar__links">
          <a href="javascript:void(0)" class="navbar__link" onclick="scrollToSection('historia')">Historia</a>
          <a href="javascript:void(0)" class="navbar__link" onclick="scrollToSection('sorteo-section')">Números</a>
          <a href="javascript:void(0)" class="navbar__link" onclick="scrollToSection('premios')">Premios</a>
          <a href="javascript:void(0)" class="navbar__link" onclick="scrollToSection('como-funciona')">¿Cómo funciona?</a>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn btn--outline" style="padding:8px 16px;font-size:0.8rem;" onclick="shareRaffle('${r.id}')">🔗 Compartir</button>
          <button class="btn btn--outline" style="padding:8px 16px;font-size:0.8rem;" onclick="navigate('home')">← Volver</button>
        </div>
        <button class="navbar__mobile-btn" id="mobile-menu-btn" aria-label="Abrir menú"><span></span><span></span><span></span></button>
      </div>
    </nav>
    <div class="mobile-menu" id="mobile-menu">
      <a href="javascript:void(0)" class="mobile-menu__link" onclick="navigate('home')">← Volver al inicio</a>
      <a href="javascript:void(0)" class="mobile-menu__link" onclick="scrollToSection('historia')">Historia</a>
      <a href="javascript:void(0)" class="mobile-menu__link" onclick="scrollToSection('sorteo-section')">Números</a>
      <a href="javascript:void(0)" class="mobile-menu__link" onclick="scrollToSection('premios')">Premios</a>
      <button class="mobile-menu__link" style="background:none;border:none;color:inherit;font:inherit;cursor:pointer;" onclick="shareRaffle('${r.id}')">🔗 Compartir sorteo</button>
      <a href="javascript:void(0)" class="mobile-menu__cta" onclick="scrollToSection('sorteo-section')">🎟️ Participar ahora</a>
    </div>

    <section class="hero" id="inicio">
      <div class="hero__bg"><img src="hero_background.png" alt="" class="hero__bg-image" /><div class="hero__bg-overlay"></div></div>
      <div class="hero__particles" id="hero-particles"></div>
      <div class="hero__content">
        <div class="hero__badge"><span>✨</span> ${r.name}</div>
        <h1 class="hero__title">Ayudemos juntos a este gran<br /><span class="hero__title-gradient">${r.heroTitle}</span></h1>
        <p class="hero__description">${r.heroDescription} <strong>Cada número que comprás hace la diferencia.</strong></p>
        <div class="hero__buttons">
          <a href="#sorteo-section" class="btn btn--primary btn--large">🎟️ Elegí tu número</a>
          <a href="#historia" class="btn btn--outline btn--large">Conocé su historia</a>
        </div>
      </div>
      <div class="hero__scroll-hint"><span>Deslizá</span><div class="scroll-arrow"></div></div>
    </section>

    ${hasDate ? `
    <section class="countdown-section">
      <div class="container container--narrow">
        <div class="countdown-card glass fade-up">
          <p class="countdown-label">⏳ El sorteo se realiza el <strong>${formatDateDisplay(r.raffleDate)}</strong></p>
          <div class="countdown-timer" id="countdown-timer">
            <div class="countdown-unit"><span class="countdown-num" id="cd-days">00</span><span class="countdown-txt">días</span></div>
            <div class="countdown-sep">:</div>
            <div class="countdown-unit"><span class="countdown-num" id="cd-hours">00</span><span class="countdown-txt">horas</span></div>
            <div class="countdown-sep">:</div>
            <div class="countdown-unit"><span class="countdown-num" id="cd-mins">00</span><span class="countdown-txt">min</span></div>
            <div class="countdown-sep">:</div>
            <div class="countdown-unit"><span class="countdown-num" id="cd-secs">00</span><span class="countdown-txt">seg</span></div>
          </div>
        </div>
      </div>
    </section>` : ''}

    <section class="stats" id="stats">
      <div class="container">
        <div class="stats__grid">
          <div class="stat-card glass fade-up"><div class="stat-card__icon">🎟️</div><div class="stat-card__value" data-count="${r.totalNumbers}">0</div><div class="stat-card__label">Números totales</div></div>
          <div class="stat-card glass fade-up"><div class="stat-card__icon">✅</div><div class="stat-card__value">${r.soldNumbers.length}</div><div class="stat-card__label">Vendidos</div></div>
          <div class="stat-card glass fade-up"><div class="stat-card__icon">🎯</div><div class="stat-card__value">${r.totalNumbers - r.soldNumbers.length}</div><div class="stat-card__label">Disponibles</div></div>
          <div class="stat-card glass fade-up"><div class="stat-card__icon">🏆</div><div class="stat-card__value" data-count="3">0</div><div class="stat-card__label">Premios</div></div>
        </div>
      </div>
    </section>



    <section class="about" id="historia">
      <div class="container container--narrow">
        <h2 class="section-title fade-up">Su Historia 💙</h2>
        <p class="section-subtitle fade-up">Conocé por qué organizamos este sorteo y cómo podés ayudar</p>
        <div class="about__content fade-up">
          <div class="about__image-wrapper"><div class="about__image-placeholder"><span>💙</span><span>Foto del niño</span></div></div>
          <div class="about__text">
            <h3>${r.storyTitle}</h3>
            <p>${r.storyText1}</p><p>${r.storyText2}</p>
            <div class="about__highlight"><p>"${r.storyQuote}"</p></div>
          </div>
        </div>
      </div>
    </section>

    <section class="raffle" id="sorteo-section">
      <div class="container">
        <h2 class="section-title fade-up">Elegí tu Número 🎟️</h2>
        <p class="section-subtitle fade-up">Seleccioná uno o más números disponibles. Los tachados ya están vendidos.</p>
        <div class="raffle__controls fade-up">
          <div class="raffle__search-wrapper"><span class="raffle__search-icon">🔍</span><input type="text" class="raffle__search" id="raffle-search" placeholder="Buscar número..." inputmode="numeric" /></div>
          <div class="raffle__legend">
            <div class="raffle__legend-item"><div class="raffle__legend-dot raffle__legend-dot--available"></div>Disponible</div>
            <div class="raffle__legend-item"><div class="raffle__legend-dot raffle__legend-dot--selected"></div>Seleccionado</div>
            <div class="raffle__legend-item"><div class="raffle__legend-dot raffle__legend-dot--sold"></div>Vendido</div>
          </div>
        </div>
        <div class="raffle__grid fade-up" id="raffle-grid"></div>
        <div class="raffle__selection glass" id="raffle-selection">
          <div class="raffle__selection-header">
            <span class="raffle__selection-title">🎟️ <span id="selection-count">0</span></span>
            <span class="raffle__selection-total" id="selection-total">${r.currency}0</span>
          </div>
          <div class="raffle__selection-numbers" id="selection-chips"></div>
          <button class="btn btn--secondary btn--large raffle__checkout-btn" onclick="openCheckoutModal()">📲 Reservar por WhatsApp</button>
        </div>
      </div>
    </section>

    <section class="prizes" id="premios">
      <div class="container">
        <h2 class="section-title fade-up">Premios 🏆</h2>
        <p class="section-subtitle fade-up">¡Participá y podés ganar estos increíbles premios!</p>
        <div class="prizes__grid">
          <div class="prize-card glass prize-card--featured fade-up"><span class="prize-card__badge">1er Premio</span><div class="prize-card__icon">🥇</div><h3 class="prize-card__title">${r.prize1Title}</h3><p class="prize-card__desc">${r.prize1Desc}</p></div>
          <div class="prize-card glass fade-up"><span class="prize-card__badge" style="background:var(--gradient-button-secondary);">2do Premio</span><div class="prize-card__icon">🥈</div><h3 class="prize-card__title">${r.prize2Title}</h3><p class="prize-card__desc">${r.prize2Desc}</p></div>
          <div class="prize-card glass fade-up"><span class="prize-card__badge" style="background:var(--gradient-accent);">3er Premio</span><div class="prize-card__icon">🥉</div><h3 class="prize-card__title">${r.prize3Title}</h3><p class="prize-card__desc">${r.prize3Desc}</p></div>
        </div>
      </div>
    </section>

    <section class="how-it-works" id="como-funciona">
      <div class="container container--narrow">
        <h2 class="section-title fade-up">¿Cómo Funciona? 🤔</h2>
        <p class="section-subtitle fade-up">Participar es muy fácil, seguí estos simples pasos</p>
        <div class="steps fade-up">
          <div class="step"><div class="step__number">1</div><div class="step__content"><h3 class="step__title">Elegí tu número</h3><p class="step__desc">Seleccioná uno o más números disponibles de la grilla.</p></div></div>
          <div class="step"><div class="step__number">2</div><div class="step__content"><h3 class="step__title">Completá tus datos</h3><p class="step__desc">Ingresá tu nombre y teléfono para que podamos contactarte.</p></div></div>
          <div class="step"><div class="step__number">3</div><div class="step__content"><h3 class="step__title">Confirmá por WhatsApp</h3><p class="step__desc">Te redirigimos a WhatsApp con tu reserva armada para confirmar el pago.</p></div></div>
          <div class="step"><div class="step__number">4</div><div class="step__content"><h3 class="step__title">¡Listo! Esperá el sorteo</h3><p class="step__desc">Una vez confirmado el pago, tu número queda reservado. ¡Suerte! 🍀</p></div></div>
        </div>
      </div>
    </section>

    <section class="contact" id="contacto">
      <div class="container container--narrow">
        <div class="contact__card glass fade-up">
          <div class="contact__icon">💬</div>
          <h2 class="contact__title">¿Tenés dudas? ¡Escribinos!</h2>
          <p class="contact__desc">Cualquier pregunta sobre este sorteo, contactanos por WhatsApp.</p>
          <a href="#" class="contact__whatsapp" onclick="openWhatsAppRaffle(); return false;"><span class="contact__whatsapp-icon">📱</span>Escribinos por WhatsApp</a>
          <div style="margin-top:20px;">
            <button class="share-btn" onclick="shareRaffle('${r.id}')">🔗 Compartir este sorteo</button>
          </div>
        </div>
      </div>
    </section>

    <footer class="footer"><div class="container"><p class="footer__text">Hecho con <span class="footer__heart">❤️</span> y mucha solidaridad<br />${r.name} 2026</p></div></footer>
    <a href="#" class="fab-whatsapp" onclick="openWhatsAppRaffle(); return false;" title="WhatsApp">💬</a>

    <div class="modal-overlay" id="modal-overlay">
      <div class="modal glass" role="dialog">
        <h3 class="modal__title">📲 Reservar Números</h3>
        <p class="modal__subtitle">Completá tus datos y te enviamos la confirmación por WhatsApp</p>
        <form class="modal__form" onsubmit="submitReservation(event)">
          <div class="form-group"><label for="input-name">Nombre y Apellido *</label><input type="text" id="input-name" placeholder="Ej: Juan Pérez" required /></div>
          <div class="form-group"><label for="input-phone">Teléfono / WhatsApp *</label><input type="tel" id="input-phone" placeholder="Ej: 11 2345-6789" required /></div>
          <div class="form-group"><label>Números seleccionados</label><div class="modal__selected-numbers" id="modal-numbers"></div></div>
          <div class="modal__total"><span class="modal__total-label">Total a abonar:</span><span class="modal__total-value" id="modal-total-value">$0</span></div>
          <div class="modal__payment-info"><h4>💳 Medios de pago</h4><p>Se paga por transferencia y se manda el comprobante por privado.</p><p style="margin-top:8px;"><strong>ALIAS:</strong> GADIEL.SORTEOS</p><hr style="border-color:rgba(255,255,255,0.08);margin:10px 0;"/><p style="font-size:0.82rem;color:var(--text-muted);">📌 No se reservan números por privado · El ganador se publica en el grupo · Se sortea por lotería provincial una vez agotados todos los números.</p></div>
          <button type="submit" class="btn btn--primary btn--large modal__submit">📲 Confirmar por WhatsApp</button>
          <button type="button" class="btn btn--outline" onclick="closeModal()" style="width:100%;">Cancelar</button>
        </form>
      </div>
    </div>`;
}

function initRafflePage(raffle) {
  initParticles(); initNavbar(); initMobileMenu();
  initRaffleGrid(raffle);
  initScrollAnimations(); initCountUp(); initModal();
  if (raffle.raffleDate) initCountdown(raffle.raffleDate);
}

// ============================================
// COUNTDOWN
// ============================================
function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function initCountdown(dateStr) {
  const target = new Date(dateStr + 'T00:00:00');
  function tick() {
    const now = new Date();
    const diff = target - now;
    const el = {
      days: document.getElementById('cd-days'),
      hours: document.getElementById('cd-hours'),
      mins: document.getElementById('cd-mins'),
      secs: document.getElementById('cd-secs'),
    };
    if (!el.days) { clearCountdown(); return; }
    if (diff <= 0) {
      el.days.textContent = '00'; el.hours.textContent = '00';
      el.mins.textContent = '00'; el.secs.textContent = '00';
      clearCountdown(); return;
    }
    const pad = n => String(n).padStart(2, '0');
    el.days.textContent = pad(Math.floor(diff / 86400000));
    el.hours.textContent = pad(Math.floor((diff % 86400000) / 3600000));
    el.mins.textContent = pad(Math.floor((diff % 3600000) / 60000));
    el.secs.textContent = pad(Math.floor((diff % 60000) / 1000));
  }
  tick();
  _countdownInterval = setInterval(tick, 1000);
}

// ============================================
// SHARE
// ============================================
function shareRaffle(id) {
  const raffle = APP.raffles.find(r => r.id === id);
  if (!raffle) return;
  const url = `${window.location.origin}${window.location.pathname}#sorteo/${id}`;
  const text = `🎟️ *${raffle.name}*\n\nSumate al sorteo solidario y ayudá a quien más lo necesita. ¡Cada número cuenta!\n\n${url}`;

  if (navigator.share) {
    navigator.share({ title: raffle.name, text, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('🔗 Link copiado al portapapeles'));
  } else {
    const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(wa, '_blank');
  }
}

// ============================================
// SHARED COMPONENTS
// ============================================
function initParticles() {
  const container = document.getElementById('hero-particles');
  if (!container) return;
  const colors = ['#6C63FF', '#FF6B9D', '#00D4AA', '#8B85FF', '#FF8FB3'];
  const shapes = ['💙', '⭐', '✨', '💜', '🌟'];
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div'); p.className = 'particle';
    if (Math.random() > 0.5) { p.textContent = shapes[Math.floor(Math.random() * shapes.length)]; p.style.fontSize = `${Math.random() * 16 + 10}px`; }
    else { const s = Math.random() * 6 + 3; p.style.width = `${s}px`; p.style.height = `${s}px`; p.style.background = colors[Math.floor(Math.random() * colors.length)]; }
    p.style.left = `${Math.random() * 100}%`; p.style.animationDuration = `${Math.random() * 8 + 6}s`; p.style.animationDelay = `${Math.random() * 5}s`;
    container.appendChild(p);
  }
}

function scrollToSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const navbar = document.getElementById('navbar');
  const offset = navbar ? navbar.offsetHeight + 8 : 8;
  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
  // Cerrar menú mobile si estaba abierto
  const menu = document.getElementById('mobile-menu');
  const btn = document.getElementById('mobile-menu-btn');
  if (menu) { menu.classList.remove('open'); document.body.style.overflow = ''; }
  if (btn) btn.classList.remove('active');
}

function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;
  window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 50));
}

function initMobileMenu() {
  const btn = document.getElementById('mobile-menu-btn'), menu = document.getElementById('mobile-menu');
  if (!btn || !menu) return;
  const navbar = document.getElementById('navbar');

  btn.addEventListener('click', () => { btn.classList.toggle('active'); menu.classList.toggle('open'); document.body.style.overflow = menu.classList.contains('open') ? 'hidden' : ''; });

  menu.querySelectorAll('.mobile-menu__link, .mobile-menu__cta').forEach(l => {
    l.addEventListener('click', () => {
      btn.classList.remove('active'); menu.classList.remove('open'); document.body.style.overflow = '';
    });
  });

  // Smooth scroll para los links de anclaje del menú mobile
  menu.querySelectorAll('a[href^="#"]').forEach(link => {
    const href = link.getAttribute('href');
    if (href === '#' || href.startsWith('#sorteo/')) return;
    link.addEventListener('click', e => {
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        const offset = (navbar ? navbar.offsetHeight : 0) + 8;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });
}

function initScrollAnimations() {
  const ob = new IntersectionObserver((entries) => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); ob.unobserve(e.target); } }), { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.fade-up').forEach(el => ob.observe(el));
}

function initCountUp() {
  const ob = new IntersectionObserver((entries) => entries.forEach(e => { if (e.isIntersecting) { animateCount(e.target, 0, parseInt(e.target.dataset.count, 10), 1500); ob.unobserve(e.target); } }), { threshold: 0.5 });
  document.querySelectorAll('[data-count]').forEach(c => ob.observe(c));
}

function animateCount(el, start, end, dur) {
  const t0 = performance.now();
  function f(t) { const p = Math.min((t - t0) / dur, 1); el.textContent = Math.floor(start + (end - start) * (1 - Math.pow(1 - p, 3))).toLocaleString('es-AR'); if (p < 1) requestAnimationFrame(f); }
  requestAnimationFrame(f);
}

// ---- Raffle Grid ----
function getCurrentRaffle() { return APP.raffles.find(r => r.id === state.currentRaffleId); }

function initRaffleGrid(raffle) {
  const grid = document.getElementById('raffle-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < raffle.totalNumbers; i++) {
    const btn = document.createElement('button');
    btn.className = 'raffle__number'; btn.textContent = i.toString().padStart(2, '0'); btn.dataset.number = i;
    if (raffle.soldNumbers.includes(i)) {
      btn.classList.add('raffle__number--sold');
      btn.title = 'Ver quién tiene este número';
      btn.addEventListener('click', () => showNumberOwner(i, raffle));
    } else {
      btn.addEventListener('click', () => toggleNumber(i, btn));
    }
    grid.appendChild(btn);
  }
  const search = document.getElementById('raffle-search');
  if (search) search.addEventListener('input', e => { const q = e.target.value.trim(); grid.querySelectorAll('.raffle__number').forEach(b => b.style.display = (!q || b.textContent.includes(q)) ? '' : 'none'); });
}

// ---- Popup: quién tiene un número vendido ----
function showNumberOwner(num, raffle) {
  const res = raffle.reservations?.find(r => r.numbers.includes(num));
  const numStr = num.toString().padStart(2, '0');
  const existing = document.getElementById('number-owner-popup');
  if (existing) existing.remove();
  const popup = document.createElement('div');
  popup.id = 'number-owner-popup';
  popup.className = 'modal-overlay active';
  popup.innerHTML = res ? `
    <div class="modal glass" style="max-width:340px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:8px;">🎟️</div>
      <h3 class="modal__title">Número #${numStr}</h3>
      <div style="background:rgba(0,212,170,0.08);border:1px solid rgba(0,212,170,0.2);border-radius:12px;padding:16px;margin:16px 0;text-align:left;display:flex;flex-direction:column;gap:8px;">
        <p><strong>👤</strong> ${res.name}</p>
        <p><strong>📱</strong> ${res.phone}</p>
        <p><strong>🎟️</strong> ${res.numbers.map(n => `#${n.toString().padStart(2,'0')}`).join(', ')}</p>
        <p><strong>💰</strong> ${raffle.currency}${res.total.toLocaleString('es-AR')}</p>
        <p><strong>${res.paid ? '✅ Pagó' : '⏳ Pendiente de pago'}</strong></p>
        <p style="color:var(--text-muted);font-size:0.82rem;">📅 ${new Date(res.date).toLocaleDateString('es-AR')}</p>
      </div>
      <button class="btn btn--outline" style="width:100%;" onclick="document.getElementById('number-owner-popup').remove();document.body.style.overflow='';">Cerrar</button>
    </div>` : `
    <div class="modal glass" style="max-width:340px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:8px;">🔍</div>
      <h3 class="modal__title">Número #${numStr}</h3>
      <p class="modal__subtitle">Este número está marcado como vendido pero no tiene reserva registrada.</p>
      <button class="btn btn--outline" style="width:100%;margin-top:16px;" onclick="document.getElementById('number-owner-popup').remove();document.body.style.overflow='';">Cerrar</button>
    </div>`;
  popup.addEventListener('click', e => { if (e.target === popup) { popup.remove(); document.body.style.overflow = ''; } });
  document.body.appendChild(popup);
  document.body.style.overflow = 'hidden';
}

function toggleNumber(num, btn) {
  const idx = state.selectedNumbers.indexOf(num);
  if (idx > -1) { state.selectedNumbers.splice(idx, 1); btn.classList.remove('raffle__number--selected'); }
  else { state.selectedNumbers.push(num); btn.classList.add('raffle__number--selected'); }
  state.selectedNumbers.sort((a, b) => a - b);
  updateSelectionSummary();
}

function removeNumber(num) {
  const idx = state.selectedNumbers.indexOf(num);
  if (idx > -1) { state.selectedNumbers.splice(idx, 1); const b = document.querySelector(`.raffle__number[data-number="${num}"]`); if (b) b.classList.remove('raffle__number--selected'); updateSelectionSummary(); }
}

function updateSelectionSummary() {
  const raffle = getCurrentRaffle(); if (!raffle) return;
  const panel = document.getElementById('raffle-selection'), chips = document.getElementById('selection-chips'), totEl = document.getElementById('selection-total'), cntEl = document.getElementById('selection-count');
  if (!panel) return;
  if (state.selectedNumbers.length === 0) { panel.classList.remove('active'); return; }
  panel.classList.add('active');
  chips.innerHTML = state.selectedNumbers.map(n => `<span class="raffle__selection-chip">#${n.toString().padStart(2,'0')}<button onclick="removeNumber(${n})">&times;</button></span>`).join('');
  const total = state.selectedNumbers.length * raffle.pricePerNumber;
  totEl.textContent = `${raffle.currency}${total.toLocaleString('es-AR')}`;
  cntEl.textContent = `${state.selectedNumbers.length} número${state.selectedNumbers.length > 1 ? 's' : ''}`;
}



// ---- Modal ----
function initModal() {
  const overlay = document.getElementById('modal-overlay'); if (!overlay) return;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function openCheckoutModal() {
  if (state.selectedNumbers.length === 0) return;
  const raffle = getCurrentRaffle(); if (!raffle) return;
  const overlay = document.getElementById('modal-overlay'), nums = document.getElementById('modal-numbers'), tot = document.getElementById('modal-total-value');
  if (nums) nums.innerHTML = state.selectedNumbers.map(n => `<span class="modal__selected-chip">#${n.toString().padStart(2,'0')}</span>`).join('');
  const total = state.selectedNumbers.length * raffle.pricePerNumber;
  if (tot) tot.textContent = `${raffle.currency}${total.toLocaleString('es-AR')}`;
  overlay.classList.add('active'); document.body.style.overflow = 'hidden';
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay'); if (overlay) { overlay.classList.remove('active'); document.body.style.overflow = ''; }
}

function submitReservation(e) {
  e.preventDefault();
  const raffle = getCurrentRaffle(); if (!raffle) return;
  const name = document.getElementById('input-name').value.trim();
  const phone = document.getElementById('input-phone').value.trim();
  if (!name || !phone) { alert('Por favor completá tu nombre y teléfono.'); return; }

  // Save reservation to localStorage
  const reservation = {
    id: 'res_' + Date.now(),
    name, phone,
    numbers: [...state.selectedNumbers],
    total: state.selectedNumbers.length * raffle.pricePerNumber,
    date: new Date().toISOString(),
    paid: false,
  };
  raffle.reservations = raffle.reservations || [];
  raffle.reservations.push(reservation);
  // Mark numbers as sold
  state.selectedNumbers.forEach(n => { if (!raffle.soldNumbers.includes(n)) raffle.soldNumbers.push(n); });
  raffle.soldNumbers.sort((a, b) => a - b);
  saveAppData(APP);

  // Open WhatsApp
  const numbers = state.selectedNumbers.map(n => `#${n.toString().padStart(2,'0')}`).join(', ');
  const msg = encodeURIComponent(`¡Hola! 🎉 Quiero reservar números del *${raffle.name}*:\n\n👤 *Nombre:* ${name}\n📱 *Teléfono:* ${phone}\n🎟️ *Números:* ${numbers}\n💰 *Total:* ${raffle.currency}${reservation.total.toLocaleString('es-AR')}\n\n¡Gracias por la solidaridad! 💙`);
  window.open(`https://wa.me/${raffle.whatsappNumber}?text=${msg}`, '_blank');

  closeModal();
  state.selectedNumbers = [];
  updateSelectionSummary();
  // Refresh grid
  initRaffleGrid(raffle);
  showToast('✅ ¡Reserva registrada! Te esperamos por WhatsApp.');
}

function openWhatsAppRaffle() {
  const raffle = getCurrentRaffle(); if (!raffle) return;
  window.open(`https://wa.me/${raffle.whatsappNumber}?text=${encodeURIComponent(`¡Hola! Me interesa participar del ${raffle.name}. ¿Me podés dar más información? 💙`)}`, '_blank');
}

function openWhatsAppGeneral() {
  const r = APP.raffles.find(r => r.active);
  const num = r ? r.whatsappNumber : '5491100000000';
  window.open(`https://wa.me/${num}?text=${encodeURIComponent('¡Hola! Me interesa participar de los sorteos solidarios. ¿Me podés dar más información? 💙')}`, '_blank');
}

// ============================================
// ADMIN PANEL
// ============================================
function initAdminFab() {
  if (document.querySelector('.admin-fab')) return;
  const btn = document.createElement('button');
  btn.className = 'admin-fab'; btn.innerHTML = '⚙️'; btn.title = 'Panel de administración';
  btn.onclick = () => openAdminLogin();
  document.body.appendChild(btn);
}

function openAdminLogin() {
  if (state.adminUnlocked) { openAdminPanel(); return; }
  const existing = document.getElementById('admin-overlay'); if (existing) existing.remove();
  const div = document.createElement('div'); div.id = 'admin-overlay'; div.className = 'modal-overlay active';
  div.innerHTML = `<div class="modal glass" style="max-width:380px;"><h3 class="modal__title">🔒 Panel de Admin</h3><p class="modal__subtitle">Ingresá la contraseña para administrar</p><form onsubmit="checkAdminPassword(event)" class="modal__form"><div class="form-group"><label>Contraseña</label><input type="password" id="admin-password" placeholder="Contraseña..." required autofocus /></div><p id="admin-error" style="color:#FF6B9D;font-size:0.85rem;display:none;">Contraseña incorrecta</p><button type="submit" class="btn btn--primary" style="width:100%;">Entrar</button><button type="button" class="btn btn--outline" style="width:100%;" onclick="closeAdminLogin()">Cancelar</button></form></div>`;
  div.addEventListener('click', e => { if (e.target === div) closeAdminLogin(); });
  document.body.appendChild(div); document.body.style.overflow = 'hidden';
}

function closeAdminLogin() { const el = document.getElementById('admin-overlay'); if (el) { el.remove(); document.body.style.overflow = ''; } }

function checkAdminPassword(e) {
  e.preventDefault();
  const input = document.getElementById('admin-password');
  if (input.value === APP.adminPassword) { state.adminUnlocked = true; closeAdminLogin(); openAdminPanel(); }
  else { document.getElementById('admin-error').style.display = 'block'; input.value = ''; input.focus(); }
}

function openAdminPanel() {
  const existing = document.getElementById('admin-panel-overlay'); if (existing) existing.remove();
  const overlay = document.createElement('div'); overlay.id = 'admin-panel-overlay'; overlay.className = 'modal-overlay active';

  const raffleListHtml = APP.raffles.length > 0
    ? APP.raffles.map(r => `
      <div class="admin-raffle-item glass">
        <div class="admin-raffle-item__info">
          <h4>${r.name}</h4>
          <p>${r.soldNumbers.length}/${r.totalNumbers} vendidos · ${r.reservations?.length || 0} reservas · ${r.active ? '🟢 Activo' : '🔴 Inactivo'}</p>
        </div>
        <div class="admin-raffle-item__actions">
          <button class="admin-icon-btn" onclick="editRaffle('${r.id}')" title="Editar">✏️</button>
          <button class="admin-icon-btn" onclick="viewBuyers('${r.id}')" title="Ver compradores">👥</button>
          <button class="admin-icon-btn" onclick="openWinnerDraw('${r.id}')" title="Sortear ganador">🎲</button>
          <button class="admin-icon-btn" onclick="toggleRaffleActive('${r.id}')" title="${r.active ? 'Desactivar' : 'Activar'}">${r.active ? '⏸️' : '▶️'}</button>
          <button class="admin-icon-btn admin-icon-btn--danger" onclick="deleteRaffle('${r.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>`)
    .join('')
    : `<p style="color:var(--text-muted);text-align:center;padding:20px;">No hay sorteos. ¡Creá el primero!</p>`;

  overlay.innerHTML = `
    <div class="modal glass admin-panel" style="max-width:620px;max-height:90vh;">
      <div class="admin-panel__header"><h3 class="modal__title">⚙️ Panel de Administración</h3><button class="admin-panel__close" onclick="closeAdminPanel()">&times;</button></div>
      <div class="admin-panel__section">
        <div class="admin-section-header"><h4>🎟️ Sorteos (${APP.raffles.length})</h4><button class="btn btn--primary" style="padding:8px 20px;font-size:0.85rem;" onclick="createNewRaffle()">+ Nuevo sorteo</button></div>
        <div class="admin-raffle-list">${raffleListHtml}</div>
      </div>
      <hr style="border-color:rgba(255,255,255,0.06);margin:16px 0;" />
      <div class="admin-panel__section">
        <h4 style="margin-bottom:12px;">🔒 Seguridad</h4>
        <div class="form-group"><label>Contraseña del panel</label><input type="text" id="cfg-global-password" value="${APP.adminPassword}" /></div>
        <button class="btn btn--outline" style="width:100%;margin-top:8px;" onclick="saveGlobalSettings()">💾 Guardar contraseña</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeAdminPanel(); });
  document.body.appendChild(overlay); document.body.style.overflow = 'hidden';
}

function closeAdminPanel() { const el = document.getElementById('admin-panel-overlay'); if (el) { el.remove(); document.body.style.overflow = ''; } }

function saveGlobalSettings() {
  APP.adminPassword = document.getElementById('cfg-global-password')?.value || APP.adminPassword;
  saveAppData(APP); showToast('✅ Contraseña guardada');
}

function createNewRaffle() {
  const nr = { ...DEFAULT_RAFFLE, id: generateId(), createdAt: Date.now(), reservations: [] };
  APP.raffles.push(nr); saveAppData(APP); closeAdminPanel(); editRaffle(nr.id); showToast('🎉 Sorteo creado. ¡Configuralo!');
}

function deleteRaffle(id) {
  const r = APP.raffles.find(x => x.id === id); if (!r) return;
  showConfirm(
    `🗑️ ¿Eliminar "${r.name}"?`,
    'Se perderán todos los datos del sorteo, compradores y números vendidos.',
    async () => {
      APP.raffles = APP.raffles.filter(x => x.id !== id);
      saveLocalCache(APP);
      // Eliminar de Firestore también
      if (db) {
        try { await db.collection('raffles').doc(id).delete(); }
        catch(e) { console.warn('Error eliminando de Firestore:', e); }
      }
      closeEditRaffle(); closeAdminPanel(); openAdminPanel(); render(); showToast('🗑️ Sorteo eliminado');
    }
  );
}

function toggleRaffleActive(id) {
  const r = APP.raffles.find(x => x.id === id); if (!r) return;
  r.active = !r.active; saveAppData(APP); closeAdminPanel(); openAdminPanel(); render();
  showToast(r.active ? '🟢 Sorteo activado' : '🔴 Sorteo desactivado');
}

// ---- Edit Raffle ----
function editRaffle(id) {
  const r = APP.raffles.find(x => x.id === id); if (!r) return;
  const existing = document.getElementById('edit-raffle-overlay'); if (existing) existing.remove();
  const overlay = document.createElement('div'); overlay.id = 'edit-raffle-overlay'; overlay.className = 'modal-overlay active';

  overlay.innerHTML = `
    <div class="modal glass admin-panel" style="max-width:600px;max-height:90vh;">
      <div class="admin-panel__header"><h3 class="modal__title">✏️ ${r.name}</h3><button class="admin-panel__close" onclick="closeEditRaffle()">&times;</button></div>
      <div class="admin-panel__tabs">
        <button class="admin-tab active" onclick="switchEditTab('general',this)">General</button>
        <button class="admin-tab" onclick="switchEditTab('textos',this)">Textos</button>
        <button class="admin-tab" onclick="switchEditTab('premios',this)">Premios</button>
        <button class="admin-tab" onclick="switchEditTab('numeros',this)">Números</button>
      </div>
      <div class="admin-panel__body">
        <div class="admin-tab-content active" id="edit-tab-general">
          <div class="form-group"><label>📱 WhatsApp</label><input type="text" id="ed-whatsapp" value="${r.whatsappNumber}" placeholder="5491112345678" /><small style="color:var(--text-muted);">Ej Argentina: 549 + código área + número (sin 15)</small></div>
          <div class="form-group"><label>🏷️ Nombre del sorteo</label><input type="text" id="ed-name" value="${r.name}" /></div>
          <div class="admin-row">
            <div class="form-group"><label>💰 Precio por número</label><input type="number" id="ed-price" value="${r.pricePerNumber}" min="1" /></div>
            <div class="form-group"><label>🔢 Total de números</label><input type="number" id="ed-total" value="${r.totalNumbers}" min="1" max="999" /></div>
          </div>

          <div class="form-group"><label>📅 Fecha del sorteo</label><input type="date" id="ed-date" value="${r.raffleDate || ''}" /><small style="color:var(--text-muted);">Activa el countdown en la página</small></div>
        </div>
        <div class="admin-tab-content" id="edit-tab-textos">
          <div class="form-group"><label>🌟 Título hero</label><input type="text" id="ed-heroTitle" value="${r.heroTitle}" /></div>
          <div class="form-group"><label>📝 Descripción hero</label><textarea id="ed-heroDesc" rows="3">${r.heroDescription}</textarea></div>
          <hr style="border-color:rgba(255,255,255,0.06);margin:12px 0;" />
          <div class="form-group"><label>💙 Título historia</label><input type="text" id="ed-storyTitle" value="${r.storyTitle}" /></div>
          <div class="form-group"><label>📝 Historia párrafo 1</label><textarea id="ed-storyP1" rows="3">${r.storyText1}</textarea></div>
          <div class="form-group"><label>📝 Historia párrafo 2</label><textarea id="ed-storyP2" rows="3">${r.storyText2}</textarea></div>
          <div class="form-group"><label>💬 Frase destacada</label><textarea id="ed-storyQuote" rows="2">${r.storyQuote}</textarea></div>
        </div>
        <div class="admin-tab-content" id="edit-tab-premios">
          <div class="admin-prize-group"><h4>🥇 Primer Premio</h4><div class="form-group"><label>Título</label><input type="text" id="ed-p1t" value="${r.prize1Title}" /></div><div class="form-group"><label>Descripción</label><textarea id="ed-p1d" rows="2">${r.prize1Desc}</textarea></div></div>
          <div class="admin-prize-group"><h4>🥈 Segundo Premio</h4><div class="form-group"><label>Título</label><input type="text" id="ed-p2t" value="${r.prize2Title}" /></div><div class="form-group"><label>Descripción</label><textarea id="ed-p2d" rows="2">${r.prize2Desc}</textarea></div></div>
          <div class="admin-prize-group"><h4>🥉 Tercer Premio</h4><div class="form-group"><label>Título</label><input type="text" id="ed-p3t" value="${r.prize3Title}" /></div><div class="form-group"><label>Descripción</label><textarea id="ed-p3d" rows="2">${r.prize3Desc}</textarea></div></div>
        </div>
        <div class="admin-tab-content" id="edit-tab-numeros">
          <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:16px;">Tocá los números para marcarlos como <strong style="color:#00D4AA;">vendidos</strong> o disponibles.</p>
          <div class="admin-numbers-grid" id="admin-numbers-grid"></div>
          <div style="margin-top:12px;padding:12px;background:rgba(0,212,170,0.1);border-radius:8px;"><span style="color:var(--text-secondary);font-size:0.85rem;">Vendidos: </span><strong id="admin-sold-display" style="color:#00D4AA;">${r.soldNumbers.length}</strong></div>
        </div>
      </div>
      <div class="admin-panel__footer">
        <button class="btn btn--danger" onclick="deleteRaffle('${r.id}')" style="margin-right:auto;">🗑️ Eliminar</button>
        <button class="btn btn--outline" onclick="closeEditRaffle()">Cancelar</button>
        <button class="btn btn--primary" onclick="saveRaffleEdit('${r.id}')">💾 Guardar</button>
      </div>
    </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) closeEditRaffle(); });
  document.body.appendChild(overlay); document.body.style.overflow = 'hidden';
  renderEditNumbersGrid(r);
}

function renderEditNumbersGrid(raffle) {
  const grid = document.getElementById('admin-numbers-grid'); if (!grid) return;
  grid.innerHTML = '';
  window._editSoldNumbers = [...raffle.soldNumbers];
  for (let i = 0; i < raffle.totalNumbers; i++) {
    const btn = document.createElement('button'); btn.className = 'admin-number-btn'; btn.textContent = i.toString().padStart(2, '0');
    if (window._editSoldNumbers.includes(i)) btn.classList.add('admin-number-btn--sold');
    btn.addEventListener('click', () => {
      const idx = window._editSoldNumbers.indexOf(i);
      if (idx > -1) { window._editSoldNumbers.splice(idx, 1); btn.classList.remove('admin-number-btn--sold'); }
      else { window._editSoldNumbers.push(i); btn.classList.add('admin-number-btn--sold'); }
      const d = document.getElementById('admin-sold-display'); if (d) d.textContent = window._editSoldNumbers.length;
    });
    grid.appendChild(btn);
  }
}

function switchEditTab(tabId, btn) {
  document.querySelectorAll('#edit-raffle-overlay .admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#edit-raffle-overlay .admin-tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const tab = document.getElementById(`edit-tab-${tabId}`); if (tab) tab.classList.add('active');
}

function saveRaffleEdit(id) {
  const r = APP.raffles.find(x => x.id === id); if (!r) return;
  r.whatsappNumber = document.getElementById('ed-whatsapp')?.value || r.whatsappNumber;
  r.name = document.getElementById('ed-name')?.value || r.name;
  r.pricePerNumber = parseInt(document.getElementById('ed-price')?.value) || r.pricePerNumber;
  r.totalNumbers = parseInt(document.getElementById('ed-total')?.value) || r.totalNumbers;
  r.raffleDate = document.getElementById('ed-date')?.value || '';
  r.heroTitle = document.getElementById('ed-heroTitle')?.value || r.heroTitle;
  r.heroDescription = document.getElementById('ed-heroDesc')?.value || r.heroDescription;
  r.storyTitle = document.getElementById('ed-storyTitle')?.value || r.storyTitle;
  r.storyText1 = document.getElementById('ed-storyP1')?.value || r.storyText1;
  r.storyText2 = document.getElementById('ed-storyP2')?.value || r.storyText2;
  r.storyQuote = document.getElementById('ed-storyQuote')?.value || r.storyQuote;
  r.prize1Title = document.getElementById('ed-p1t')?.value || r.prize1Title;
  r.prize1Desc = document.getElementById('ed-p1d')?.value || r.prize1Desc;
  r.prize2Title = document.getElementById('ed-p2t')?.value || r.prize2Title;
  r.prize2Desc = document.getElementById('ed-p2d')?.value || r.prize2Desc;
  r.prize3Title = document.getElementById('ed-p3t')?.value || r.prize3Title;
  r.prize3Desc = document.getElementById('ed-p3d')?.value || r.prize3Desc;
  if (window._editSoldNumbers) r.soldNumbers = [...window._editSoldNumbers].sort((a, b) => a - b);
  saveAppData(APP); closeEditRaffle(); render(); showToast('✅ ¡Sorteo guardado!');
}

function closeEditRaffle() { const el = document.getElementById('edit-raffle-overlay'); if (el) { el.remove(); document.body.style.overflow = ''; } delete window._editSoldNumbers; }

// ---- Buyers Panel ----
function viewBuyers(id) {
  const r = APP.raffles.find(x => x.id === id); if (!r) return;
  const existing = document.getElementById('buyers-overlay'); if (existing) existing.remove();
  const overlay = document.createElement('div'); overlay.id = 'buyers-overlay'; overlay.className = 'modal-overlay active';

  const reservations = r.reservations || [];
  const buyersHtml = reservations.length > 0
    ? reservations.map((res) => `
      <div class="buyer-row glass">
        <div class="buyer-row__info">
          <div class="buyer-row__name">${res.name}</div>
          <div class="buyer-row__meta">📱 ${res.phone} · 🎟️ ${res.numbers.map(n => `#${n.toString().padStart(2,'0')}`).join(', ')}</div>
          <div class="buyer-row__meta">💰 ${r.currency}${res.total.toLocaleString('es-AR')} · 📅 ${new Date(res.date).toLocaleDateString('es-AR')}</div>
        </div>
        <div class="buyer-row__actions">
          <button class="paid-btn ${res.paid ? 'paid-btn--paid' : ''}" onclick="togglePaid('${id}','${res.id}')">${res.paid ? '✅ Pagó' : '⏳ Pendiente'}</button>
          ${!res.paid ? `<button class="admin-icon-btn" onclick="remindPayment('${id}','${res.id}')" title="Recordar pago por WhatsApp">📲</button>` : ''}
          <button class="admin-icon-btn admin-icon-btn--danger" onclick="deleteReservation('${id}','${res.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>`).join('')
    : `<div class="empty-state" style="padding:40px 20px;"><div class="empty-state__icon">👥</div><h3 style="font-size:1.1rem;">Todavía no hay compradores</h3><p>Cuando alguien reserve un número, aparecerá acá.</p></div>`;

  const paid = reservations.filter(res => res.paid).length;
  overlay.innerHTML = `
    <div class="modal glass admin-panel" style="max-width:620px;max-height:90vh;">
      <div class="admin-panel__header"><h3 class="modal__title">👥 Compradores — ${r.name}</h3><button class="admin-panel__close" onclick="closeBuyers()">&times;</button></div>
      <div class="buyers-summary">
        <div class="buyers-stat"><span>${reservations.length}</span><small>Reservas</small></div>
        <div class="buyers-stat"><span>${paid}</span><small>Pagaron</small></div>
        <div class="buyers-stat"><span>${reservations.length - paid}</span><small>Pendientes</small></div>
        <div class="buyers-stat"><span>${r.soldNumbers.length}</span><small>Nros vendidos</small></div>
      </div>
      <div class="buyers-list">${buyersHtml}</div>
      <div class="admin-panel__footer">
        <button class="btn btn--outline" style="font-size:0.85rem;padding:8px 16px;" onclick="exportBuyersCSV('${id}')">📊 Exportar CSV</button>
        <button class="btn btn--outline" onclick="closeBuyers()">Cerrar</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeBuyers(); });
  document.body.appendChild(overlay); document.body.style.overflow = 'hidden';
}

function closeBuyers() { const el = document.getElementById('buyers-overlay'); if (el) { el.remove(); document.body.style.overflow = ''; } }

function togglePaid(raffleId, resId) {
  const r = APP.raffles.find(x => x.id === raffleId); if (!r) return;
  const res = r.reservations?.find(x => x.id === resId); if (!res) return;
  res.paid = !res.paid;
  saveAppData(APP); closeBuyers(); viewBuyers(raffleId);
  showToast(res.paid ? '✅ Marcado como pagado' : '⏳ Marcado como pendiente');
}

function deleteReservation(raffleId, resId) {
  const r = APP.raffles.find(x => x.id === raffleId); if (!r) return;
  if (!confirm('¿Eliminar esta reserva? Los números volverán a estar disponibles.')) return;
  const res = r.reservations?.find(x => x.id === resId);
  if (res) { r.soldNumbers = r.soldNumbers.filter(n => !res.numbers.includes(n)); r.reservations = r.reservations.filter(x => x.id !== resId); }
  saveAppData(APP); closeBuyers(); viewBuyers(raffleId); showToast('🗑️ Reserva eliminada');
}

// ---- Recordar pago por WhatsApp ----
function remindPayment(raffleId, resId) {
  const r = APP.raffles.find(x => x.id === raffleId); if (!r) return;
  const res = r.reservations?.find(x => x.id === resId); if (!res) return;
  const numbers = res.numbers.map(n => `#${n.toString().padStart(2,'0')}`).join(', ');
  const msg = `¡Hola ${res.name}! 💙 Te recordamos que tenés pendiente el pago de los números ${numbers} del sorteo *${r.name}*.

💰 *Total:* ${r.currency}${res.total.toLocaleString('es-AR')}
🏦 *Alias:* GADIEL.SORTEOS

Una vez que hagas la transferencia, mandanos el comprobante por privado. ¡Muchas gracias por tu solidaridad! 🙏`;
  const digits = res.phone.replace(/\D/g, '');
  const waPhone = digits.startsWith('54') ? digits : `549${digits}`;
  window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ---- Exportar compradores a CSV ----
function exportBuyersCSV(raffleId) {
  const r = APP.raffles.find(x => x.id === raffleId); if (!r) return;
  const reservations = r.reservations || [];
  if (reservations.length === 0) { showToast('⚠️ No hay compradores para exportar'); return; }
  const headers = ['Nombre', 'Teléfono', 'Números', 'Total', 'Estado', 'Fecha'];
  const rows = reservations.map(res => [
    res.name,
    res.phone,
    res.numbers.map(n => `#${n.toString().padStart(2,'0')}`).join(' '),
    `${r.currency}${res.total.toLocaleString('es-AR')}`,
    res.paid ? 'Pagó' : 'Pendiente',
    new Date(res.date).toLocaleDateString('es-AR'),
  ]);
  const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `compradores-${r.name.replace(/\s+/g, '-')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📊 CSV descargado correctamente');
}

// ---- Winner Draw ----
function openWinnerDraw(id) {
  const r = APP.raffles.find(x => x.id === id); if (!r) return;
  const existing = document.getElementById('winner-overlay'); if (existing) existing.remove();

  if (r.soldNumbers.length === 0) { showToast('⚠️ No hay números vendidos para sortear'); return; }

  const overlay = document.createElement('div'); overlay.id = 'winner-overlay'; overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal glass winner-modal" style="max-width:440px;text-align:center;">
      <button class="admin-panel__close" style="position:absolute;top:12px;right:12px;" onclick="closeWinnerDraw()">&times;</button>
      <div class="winner-modal__icon">🎲</div>
      <h3 class="modal__title">Sortear Ganador</h3>
      <p class="modal__subtitle">${r.soldNumbers.length} números participan del sorteo <strong>${r.name}</strong></p>
      <div class="winner-display" id="winner-display">
        <span class="winner-number" id="winner-number">??</span>
      </div>
      <div id="winner-info" style="display:none;margin:16px 0;padding:16px;background:rgba(0,212,170,0.1);border-radius:12px;border:1px solid rgba(0,212,170,0.2);">
        <div class="winner-buyer" id="winner-buyer"></div>
      </div>
      <button class="btn btn--primary btn--large" id="draw-btn" onclick="doWinnerDraw('${id}')" style="width:100%;margin-top:16px;">🎲 ¡Sortear!</button>
      <button class="btn btn--outline" onclick="closeWinnerDraw()" style="width:100%;margin-top:8px;">Cerrar</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeWinnerDraw(); });
  document.body.appendChild(overlay); document.body.style.overflow = 'hidden';
}

function doWinnerDraw(id) {
  const r = APP.raffles.find(x => x.id === id); if (!r || r.soldNumbers.length === 0) return;
  const btn = document.getElementById('draw-btn'); if (btn) { btn.disabled = true; btn.textContent = '🎰 Sorteando...'; }
  const display = document.getElementById('winner-number');
  const infoEl = document.getElementById('winner-info');
  const buyerEl = document.getElementById('winner-buyer');
  if (infoEl) infoEl.style.display = 'none';

  // Shuffle animation
  let ticks = 0;
  const maxTicks = 25;
  const winner = r.soldNumbers[Math.floor(Math.random() * r.soldNumbers.length)];

  const interval = setInterval(() => {
    ticks++;
    const random = r.soldNumbers[Math.floor(Math.random() * r.soldNumbers.length)];
    if (display) display.textContent = random.toString().padStart(2, '0');
    if (ticks >= maxTicks) {
      clearInterval(interval);
      if (display) {
        display.textContent = winner.toString().padStart(2, '0');
        display.classList.add('winner-number--revealed');
      }
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Sortear de nuevo'; }
      // Find buyer
      const res = r.reservations?.find(res => res.numbers.includes(winner));
      if (res && infoEl && buyerEl) {
        buyerEl.innerHTML = `<strong>🎉 ¡Ganador!</strong><br/>👤 ${res.name}<br/>📱 ${res.phone}`;
        infoEl.style.display = 'block';
      }
    }
  }, 80);
}

function closeWinnerDraw() { const el = document.getElementById('winner-overlay'); if (el) { el.remove(); document.body.style.overflow = ''; } }

// ---- Toast ----
function showToast(message) {
  const ex = document.querySelector('.toast'); if (ex) ex.remove();
  const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// ---- Confirm Modal ----
function showConfirm(title, message, onConfirm) {
  const existing = document.getElementById('confirm-overlay'); if (existing) existing.remove();
  const overlay = document.createElement('div'); overlay.id = 'confirm-overlay'; overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal glass" style="max-width:380px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:12px;">⚠️</div>
      <h3 class="modal__title" style="font-size:1.1rem;">${title}</h3>
      <p class="modal__subtitle" style="margin-bottom:24px;">${message}</p>
      <div style="display:flex;gap:12px;">
        <button class="btn btn--outline" style="flex:1;" onclick="document.getElementById('confirm-overlay').remove();document.body.style.overflow='';">Cancelar</button>
        <button class="btn btn--danger" style="flex:1;" id="confirm-ok-btn">Eliminar</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); document.body.style.overflow = ''; } });
  document.body.appendChild(overlay); document.body.style.overflow = 'hidden';
  document.getElementById('confirm-ok-btn').addEventListener('click', () => {
    overlay.remove(); document.body.style.overflow = '';
    onConfirm();
  });
}

