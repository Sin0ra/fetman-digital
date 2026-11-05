(() => {
  const portfolio = document.querySelector('#portfolio');
  const legacyGrid = portfolio?.querySelector('.portfolio-collection .row');
  const legacyCollection = legacyGrid?.closest('.portfolio-collection');
  const departmentGrids = new Map([...document.querySelectorAll('[data-portfolio-department]')].map((grid) => [grid.dataset.portfolioDepartment, grid]));
  const managedCollections = [...departmentGrids.values()].map((grid) => grid.closest('.portfolio-collection')).filter(Boolean);
  const search = document.getElementById('search-bar');
  let graphicCarousel;
  if (!portfolio || !legacyGrid || !legacyCollection || !search) return;

  legacyCollection.hidden = true;
  managedCollections.forEach((collection) => { collection.hidden = true; });

  const cards = () => [...document.querySelectorAll('.portfolio-item')];

  function update() {
    const query = search.value.trim().toLowerCase();
    cards().forEach((card) => {
      card.hidden = !card.textContent.toLowerCase().includes(query);
    });
    graphicCarousel?.refresh();
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
      graphicCarousel = createGraphicDesignCarousel(departmentGrids.get('Graphic Design'));
      update();
    } catch {
      // An unavailable public API must leave the portfolio empty.
    }
  }

  search.addEventListener('input', update);
  update();
  void loadProjects();

  function createGraphicDesignCarousel(grid) {
    if (!grid) return null;
    const collection = grid.closest('.portfolio-collection');
    if (!collection || collection.querySelector('.graphic-carousel-controls')) return null;
    collection.classList.add('graphic-design-carousel');
    const controls = document.createElement('div');
    controls.className = 'graphic-carousel-controls';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'graphic-carousel-button';
    previous.setAttribute('aria-label', 'Previous Graphic Design project');
    previous.textContent = '←';
    const status = document.createElement('span');
    status.className = 'graphic-carousel-status';
    status.setAttribute('aria-live', 'polite');
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'graphic-carousel-button';
    next.setAttribute('aria-label', 'Next Graphic Design project');
    next.textContent = '→';
    controls.append(previous, status, next);
    collection.append(controls);

    let activeIndex = 0;
    let timer;
    let touchStartX;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const visibleCards = () => [...grid.querySelectorAll('.portfolio-item')].filter((card) => !card.hidden);
    const stop = () => { if (timer) window.clearInterval(timer); timer = undefined; };
    const start = () => {
      stop();
      if (!reducedMotion && visibleCards().length > 1) timer = window.setInterval(() => show(activeIndex + 1), 5000);
    };
    function show(index) {
      const cardsToShow = visibleCards();
      if (!cardsToShow.length) {
        grid.querySelectorAll('.portfolio-item').forEach((card) => card.classList.remove('is-active'));
        status.textContent = '';
        controls.hidden = true;
        return;
      }
      activeIndex = (index + cardsToShow.length) % cardsToShow.length;
      grid.querySelectorAll('.portfolio-item').forEach((card) => card.classList.remove('is-active'));
      cardsToShow[activeIndex].classList.add('is-active');
      controls.hidden = cardsToShow.length < 2;
      status.textContent = `${activeIndex + 1} / ${cardsToShow.length}`;
    }
    previous.addEventListener('click', () => { show(activeIndex - 1); start(); });
    next.addEventListener('click', () => { show(activeIndex + 1); start(); });
    collection.addEventListener('mouseenter', stop);
    collection.addEventListener('mouseleave', start);
    collection.addEventListener('focusin', stop);
    collection.addEventListener('focusout', (event) => { if (!collection.contains(event.relatedTarget)) start(); });
    collection.addEventListener('touchstart', (event) => {
      touchStartX = event.changedTouches[0]?.clientX;
      stop();
    }, { passive: true });
    collection.addEventListener('touchend', (event) => {
      const endX = event.changedTouches[0]?.clientX;
      if (typeof touchStartX === 'number' && typeof endX === 'number' && Math.abs(endX - touchStartX) > 40) show(endX < touchStartX ? activeIndex + 1 : activeIndex - 1);
      touchStartX = undefined;
      start();
    }, { passive: true });
    return { refresh() { show(activeIndex); start(); } };
  }

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' }[character])); }
  function escapeAttribute(value) { return escapeHtml(value); }
  function isHttpUrl(value) { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } }
  function isImageUrl(value) { return isHttpUrl(value) || (value.startsWith('/') && !value.startsWith('//')); }
})();
