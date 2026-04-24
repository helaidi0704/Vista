/* ==========================================
   App Router — SoundSense
   ========================================== */

const PAGES = {
  home:       { title: 'Accueil',                   init: initHome },
  viewer:     { title: 'Visualiseur & Annotation',  init: initImageViewer },
  analysis:   { title: 'Analyse & Comparaison',     init: initImageAnalysis },
  training:   { title: 'Entraînement de Modèles',   init: initTraining },
  testing:    { title: 'Test en live & Explicabilité', init: initLiveTesting },
  deployment: { title: 'Déploiement',               init: initDeployment },
};


let currentPage = null;

function navigate(pageId) {
  if (!PAGES[pageId]) return;
  if (currentPage === pageId) return;
  currentPage = pageId;

  // Update sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  // Update title
  document.getElementById('page-title').textContent = PAGES[pageId].title;

  // Update pages
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) {
    target.classList.add('active');
    if (!target._initialized) {
      PAGES[pageId].init(target);
      target._initialized = true;
    }
  }
}

// Attach nav listeners
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(el.dataset.page);
  });
});

// Start on home
navigate('home');
