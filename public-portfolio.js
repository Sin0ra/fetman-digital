(() => {
  const portfolio = document.querySelector('#portfolio');
  const clientGrid = portfolio?.querySelector('.portfolio-collection .row');
  const search = document.getElementById('search-bar');
  const filters = [...document.querySelectorAll('.filter-btn')];
  if (!portfolio || !clientGrid || !search) return;
  let activeFilter = 'all';

  const cards = () => [...portfolio.querySelectorAll('.portfolio-item')];
  const classify = (card) => card.classList.contains('concept') ? 'concept' : card.classList.contains('client-work') ? 'client-work' : 'branding';

  function update() {
    const query = search.value.trim().toLowerCase();
    cards().forEach((card) => {
      const matchesFilter = activeFilter === 'all' || classify(card) === activeFilter;
      card.hidden = !matchesFilter || !card.textContent.toLowerCase().includes(query);
    });
  }

  function createProjectCard(project) {
    const card = document.createElement('article');
    card.className = `col-md-6 portfolio-item website-project ${project.category.toLowerCase().includes('concept') ? 'concept' : 'client-work'}`;
    const image = project.imageUrl || '';
    card.innerHTML = `<div class="card"><a class="portfolio-image-link" href="${escapeAttribute(project.projectUrl)}" target="_blank" rel="noopener noreferrer"><img class="card-img-top" width="1440" height="900" loading="lazy" decoding="async" alt="${escapeAttribute(project.title)} website preview" src="${escapeAttribute(image)}"><span class="portfolio-image-cta">View website <span aria-hidden="true">↗</span></span></a><div class="card-body"><p class="portfolio-category">${escapeHtml(project.category)}</p><h4 class="card-title">${escapeHtml(project.title)}</h4><p class="card-text">${escapeHtml(project.description)}</p><a class="portfolio-link" href="${escapeAttribute(project.projectUrl)}" target="_blank" rel="noopener noreferrer">Explore project <span aria-hidden="true">↗</span></a></div></div>`;
    return card;
  }

  async function loadProjects() {
    try {
      const response = await fetch('/api/public/portfolio', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      if (!Array.isArray(result.projects)) return;
      result.projects.forEach((project) => {
        if (!project || !project.title || !project.projectUrl || !project.imageUrl) return;
        clientGrid.append(createProjectCard(project));
      });
      update();
    } catch (error) {
      console.warn('Published website projects are unavailable; showing the saved portfolio.', error);
    }
  }

  search.addEventListener('input', update);
  filters.forEach((button) => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter || 'all';
    filters.forEach((item) => { const active = item === button; item.classList.toggle('btn-primary', active); item.classList.toggle('btn-outline-primary', !active); item.setAttribute('aria-pressed', String(active)); });
    update();
  }));
  update();
  void loadProjects();

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
  function escapeAttribute(value) { return escapeHtml(value); }
})();
