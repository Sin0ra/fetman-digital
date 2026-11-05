(() => {
  // The public page owns the presentation layer; the API remains the source of truth
  // for published projects, departments, media routes, and project links.
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
    // Search filters every rendered card, then asks the carousel to select the next
    // valid item so a search can never leave an empty or hidden slide on screen.
    const query = search.value.trim().toLowerCase();
    cards().forEach((card) => {
      card.hidden = !card.textContent.toLowerCase().includes(query);
    });
    graphicCarousel?.refresh();
  }

  function createProjectCard(project) {
    // Project fields are escaped before being inserted because these values are
    // editable in the management dashboard and are rendered into HTML here.
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
    // Only published records are returned by /api/public/portfolio. We keep the
    // department split in the markup so the owner can classify work without losing
    // older unclassified projects.
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
    // Graphic Design is intentionally a sequential carousel: the current card is
    // hidden first, then the next card enters after a short editorial pause. This
    // avoids crossfading two artworks and keeps the image as the visual focus.
    if (!grid) return null;
    const collection = grid.closest('.portfolio-collection');
    if (!collection || collection.querySelector('.graphic-carousel-status')) return null;
    collection.classList.add('graphic-design-carousel');
    const status = document.createElement('span');
    status.className = 'graphic-carousel-status';
    status.setAttribute('aria-live', 'polite');
    collection.append(status);

    let activeIndex = 0;
    let timer;
    let pauseTimer;
    let touchStartX;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const visibleCards = () => [...grid.querySelectorAll('.portfolio-item')].filter((card) => !card.hidden);
    const stop = () => {
      if (timer) window.clearTimeout(timer);
      if (pauseTimer) window.clearTimeout(pauseTimer);
      timer = undefined;
      pauseTimer = undefined;
    };
    const start = () => {
      stop();
      if (!reducedMotion && visibleCards().length > 1) {
        timer = window.setTimeout(() => {
          grid.querySelectorAll('.portfolio-item').forEach((card) => card.classList.remove('is-active'));
          pauseTimer = window.setTimeout(() => show(activeIndex + 1), 500);
        }, 4500);
      }
    };
    function show(index) {
      const cardsToShow = visibleCards();
      if (!cardsToShow.length) {
        grid.querySelectorAll('.portfolio-item').forEach((card) => card.classList.remove('is-active'));
        status.textContent = '';
        return;
      }
      activeIndex = (index + cardsToShow.length) % cardsToShow.length;
      grid.querySelectorAll('.portfolio-item').forEach((card) => card.classList.remove('is-active'));
      cardsToShow[activeIndex].classList.add('is-active');
      status.textContent = `${activeIndex + 1} / ${cardsToShow.length}`;
    }
    // Hover, focus, and touch pause rotation so visitors can inspect artwork and
    // activate its project link without the slide changing underneath them.
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

  createWebsiteShowcase(document.querySelector('[data-website-showcase]'));

  function createWebsiteShowcase(stage) {
    // These are verified Fetman Digital demo links, not portfolio API records. A
    // Real iframe previews are used only for verified demo destinations, instead of
    // decorative cards pretending to show a live website. A destination that cannot
    // be verified is presented as a clear link-only state.
    if (!stage) return;
    const projects = [
      { name: 'Nakoba Services', url: 'https://nakobaservices.netlify.app/', status: 'Completed project.', preview: true },
      { name: 'DRV Dental Centre', url: 'https://drvvdentacentre.netlify.app/', status: 'Website demo.', preview: true },
      // This URL currently resolves to a different, unconfirmed presentation. Keep
      // the requested project link visible without embedding content we cannot verify.
      { name: 'Candyflossist', url: 'https://adorable-gumdrop-544616.netlify.app/', status: 'Website link.', preview: false },
    ];
    let activeIndex = 0;
    let timer;
    let pauseTimer;
    let isPaused = false;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const indicators = document.createElement('div');
    indicators.className = 'website-showcase-indicators';
    indicators.setAttribute('aria-label', 'Website demos');
    const updateIndicators = () => indicators.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-current', index === activeIndex ? 'true' : 'false'));
    const render = (index, animate = true) => {
      activeIndex = (index + projects.length) % projects.length;
      const project = projects[activeIndex];
      const previewMarkup = project.preview
        ? `<iframe title="${escapeAttribute(project.name)} website preview" src="${escapeAttribute(project.url)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        : '<div class="website-demo-preview-unavailable"><span>Preview unavailable</span><small>Open the website to view this project.</small></div>';
      stage.innerHTML = `<article class="website-demo-card${animate ? ' is-entering' : ''}">
        <div class="website-demo-preview">${previewMarkup}</div>
        <div class="website-demo-copy"><p class="website-demo-status">${escapeHtml(project.status)}</p><h4>${escapeHtml(project.name)}</h4><a class="portfolio-link" href="${escapeAttribute(project.url)}" target="_blank" rel="noopener noreferrer">Visit Website <span aria-hidden="true">↗</span></a></div>
      </article>`;
      updateIndicators();
    };
    projects.forEach((project, index) => {
      const indicator = document.createElement('button');
      indicator.type = 'button';
      indicator.className = 'website-showcase-indicator';
      indicator.setAttribute('aria-label', `Show ${project.name}`);
      indicator.addEventListener('click', () => { render(index); schedule(); });
      indicators.append(indicator);
    });
    stage.after(indicators);
    const interactionTarget = stage.parentElement;
    const stop = () => { if (timer) window.clearTimeout(timer); if (pauseTimer) window.clearTimeout(pauseTimer); timer = undefined; pauseTimer = undefined; };
    const schedule = () => {
      // The outgoing demo is removed before the next iframe is mounted, preserving
      // the same one-at-a-time rhythm as the Graphic Design presentation.
      stop();
      if (reducedMotion || isPaused || projects.length < 2) return;
      timer = window.setTimeout(() => {
        stage.querySelector('.website-demo-card')?.classList.add('is-exiting');
        pauseTimer = window.setTimeout(() => render(activeIndex + 1), 350);
      }, 5650);
    };
    const pause = () => { isPaused = true; stop(); };
    const resume = () => { isPaused = false; schedule(); };
    interactionTarget?.addEventListener('mouseenter', pause);
    interactionTarget?.addEventListener('mouseleave', resume);
    interactionTarget?.addEventListener('focusin', pause);
    interactionTarget?.addEventListener('focusout', (event) => { if (!interactionTarget.contains(event.relatedTarget)) resume(); });
    interactionTarget?.addEventListener('touchstart', pause, { passive: true });
    interactionTarget?.addEventListener('touchend', resume, { passive: true });
    render(0, false);
    schedule();
  }

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' }[character])); }
  function escapeAttribute(value) { return escapeHtml(value); }
  function isHttpUrl(value) { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } }
  function isImageUrl(value) { return isHttpUrl(value) || (value.startsWith('/') && !value.startsWith('//')); }
})();
