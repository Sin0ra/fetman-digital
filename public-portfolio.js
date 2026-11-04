(() => {
  const portfolio = document.querySelector('#portfolio');
  const legacyGrid = portfolio?.querySelector('.portfolio-collection .row');
  const departmentGrids = new Map([...document.querySelectorAll('[data-portfolio-department]')].map((grid) => [grid.dataset.portfolioDepartment, grid]));
  const search = document.getElementById('search-bar');
  const filters = [...document.querySelectorAll('.filter-btn')];
  if (!portfolio || !legacyGrid || !search) return;
  let activeFilter = 'all';

  const cards = () => [...document.querySelectorAll('.portfolio-item')];
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
    const imageMarkup = image ? `<img class="card-img-top" width="1440" height="900" loading="lazy" decoding="async" alt="${escapeAttribute(project.title)} preview" src="${escapeAttribute(image)}">` : '<div class="portfolio-image-placeholder" aria-label="No project image">No image</div>';
    card.innerHTML = `<div class="card"><a class="portfolio-image-link" href="${escapeAttribute(project.projectUrl)}" target="_blank" rel="noopener noreferrer">${imageMarkup}<span class="portfolio-image-cta">View project <span aria-hidden="true">↗</span></span></a><div class="card-body"><p class="portfolio-category">${escapeHtml(project.category)}</p><h4 class="card-title">${escapeHtml(project.title)}</h4><p class="card-text">${escapeHtml(project.description)}</p><a class="portfolio-link" href="${escapeAttribute(project.projectUrl)}" target="_blank" rel="noopener noreferrer">Explore project <span aria-hidden="true">↗</span></a></div></div>`;
    return card;
  }

  async function loadProjects() {
    try {
      const response = await fetch('/api/public/portfolio', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      if (!Array.isArray(result.projects)) return;
      result.projects.forEach((project) => {
        if (!project || !project.title || !project.projectUrl) return;
        const target = departmentGrids.get(project.department) || legacyGrid;
        target.append(createProjectCard(project));
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

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' }[character])); }
  function escapeAttribute(value) { return escapeHtml(value); }
})();
