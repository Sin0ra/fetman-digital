(() => {
  const portfolio = document.querySelector('#portfolio');
  const legacyGrid = portfolio?.querySelector('.portfolio-collection .row');
  const legacyCollection = legacyGrid?.closest('.portfolio-collection');
  const departmentGrids = new Map([...document.querySelectorAll('[data-portfolio-department]')].map((grid) => [grid.dataset.portfolioDepartment, grid]));
  const managedCollections = [...departmentGrids.values()].map((grid) => grid.closest('.portfolio-collection')).filter(Boolean);
  const search = document.getElementById('search-bar');
  if (!portfolio || !legacyGrid || !legacyCollection || !search) return;

  legacyCollection.hidden = true;
  managedCollections.forEach((collection) => { collection.hidden = true; });

  const cards = () => [...document.querySelectorAll('.portfolio-item')];

  function update() {
    const query = search.value.trim().toLowerCase();
    cards().forEach((card) => {
      card.hidden = !card.textContent.toLowerCase().includes(query);
    });
  }

  function createProjectCard(project) {
    const card = document.createElement('article');
    const category = project.category.trim();
    const projectUrl = typeof project.projectUrl === 'string' ? project.projectUrl.trim() : '';
    card.className = 'col-md-6 portfolio-item website-project';
    const image = typeof project.imageUrl === 'string' ? project.imageUrl.trim() : '';
    const imageMarkup = image ? `<img class="card-img-top" width="1440" height="900" loading="lazy" decoding="async" alt="${escapeAttribute(project.title)} preview" src="${escapeAttribute(image)}">` : '';
    const mediaFrame = image
      ? (projectUrl
        ? `<a class="portfolio-image-link" href="${escapeAttribute(projectUrl)}" target="_blank" rel="noopener noreferrer">${imageMarkup}<span class="portfolio-image-cta">View project <span aria-hidden="true">↗</span></span></a>`
        : `<div class="portfolio-image-link">${imageMarkup}</div>`)
      : '';
    const projectLink = projectUrl
      ? `<a class="portfolio-link" href="${escapeAttribute(projectUrl)}" target="_blank" rel="noopener noreferrer">Explore project <span aria-hidden="true">↗</span></a>`
      : '<span class="portfolio-link portfolio-link-muted">Published project</span>';
    const descriptionMarkup = project.description ? `<p class="card-text">${escapeHtml(project.description)}</p>` : '';
    card.innerHTML = `<div class="card">${mediaFrame}<div class="card-body"><p class="portfolio-category">${escapeHtml(category)}</p><h4 class="card-title">${escapeHtml(project.title)}</h4>${descriptionMarkup}${projectLink}</div></div>`;
    return card;
  }

  function isValidProject(project) {
    if (!project || typeof project !== 'object') return false;
    if (typeof project.title !== 'string' || !project.title.trim()) return false;
    if (typeof project.category !== 'string' || !project.category.trim()) return false;
    if (!Object.hasOwn(project, 'department') || !Object.hasOwn(project, 'description') || !Object.hasOwn(project, 'projectUrl')) return false;
    if (project.department !== null && project.department !== undefined && !departmentGrids.has(project.department)) return false;
    if (project.description !== null && project.description !== undefined && typeof project.description !== 'string') return false;
    if (project.projectUrl !== null && project.projectUrl !== undefined && typeof project.projectUrl !== 'string') return false;
    if (project.imageUrl !== null && project.imageUrl !== undefined && typeof project.imageUrl !== 'string') return false;
    if (project.projectUrl && !isHttpUrl(project.projectUrl)) return false;
    if (project.imageUrl && !isImageUrl(project.imageUrl)) return false;
    return true;
  }

  async function loadProjects() {
    try {
      const response = await fetch('/api/public/portfolio', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      if (!Array.isArray(result.projects)) return;
      result.projects.forEach((project) => {
        if (!isValidProject(project)) return;
        const target = departmentGrids.get(project.department) || legacyGrid;
        target.append(createProjectCard(project));
      });
      legacyCollection.hidden = legacyGrid.children.length === 0;
      managedCollections.forEach((collection) => {
        const grid = collection.querySelector('[data-portfolio-department]');
        collection.hidden = !grid || grid.children.length === 0;
      });
      update();
    } catch {
      // An unavailable public API must leave the portfolio empty.
    }
  }

  search.addEventListener('input', update);
  update();
  void loadProjects();

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' }[character])); }
  function escapeAttribute(value) { return escapeHtml(value); }
  function isHttpUrl(value) { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } }
  function isImageUrl(value) { return isHttpUrl(value) || (value.startsWith('/') && !value.startsWith('//')); }
})();
