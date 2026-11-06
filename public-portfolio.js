(() => {
  // The public page owns the presentation layer; the API remains the source of truth
  // for published projects, departments, media routes, and project links.
  const portfolio = document.querySelector('#portfolio');
  const legacyGrid = portfolio?.querySelector('.portfolio-collection .row');
  const legacyCollection = legacyGrid?.closest('.portfolio-collection');
  const departmentGrids = new Map([...document.querySelectorAll('[data-portfolio-department]')].map((grid) => [grid.dataset.portfolioDepartment, grid]));
  const managedCollections = [...departmentGrids.values()].map((grid) => grid.closest('.portfolio-collection')).filter(Boolean);
  let graphicGallery;
  if (!portfolio || !legacyGrid || !legacyCollection) return;

  legacyCollection.hidden = true;
  managedCollections.forEach((collection) => { collection.hidden = true; });
  const initialGraphicCollection = departmentGrids.get('Graphic Design')?.closest('.portfolio-collection');
  if (initialGraphicCollection) initialGraphicCollection.hidden = false;

  const cards = () => [...document.querySelectorAll('.portfolio-item')];

  function update() {
    // Category filters own Graphic Design visibility; all other published cards
    // remain available in their existing department or legacy collection.
    const query = '';
    cards().forEach((card) => {
      card.hidden = !card.textContent.toLowerCase().includes(query);
    });
    graphicGallery?.refresh(query);
  }

  function createProjectCard(project) {
    // Project fields are escaped before being inserted because these values are
    // editable in the management dashboard and are rendered into HTML here.
    const card = document.createElement('article');
    const category = project.category.trim();
    const projectUrl = typeof project.projectUrl === 'string' ? project.projectUrl.trim() : '';
    card.className = 'col-md-6 portfolio-item website-project';
    card.dataset.portfolioCategory = project.department === 'Graphic Design' ? graphicCategoryBucket(category) : category.toLowerCase();
    card.dataset.portfolioDepartment = project.department || '';
    const images = getProjectImages(project);
    const image = images[0] || '';
    const imageAlt = project.title?.trim() || `${category} artwork`;
    const imageMarkup = image ? `<img class="card-img-top is-active" loading="lazy" decoding="async" alt="${escapeAttribute(imageAlt)} preview" src="${escapeAttribute(image)}">` : '';
    const mediaFrame = image
      ? (projectUrl
        ? `<a class="portfolio-image-link" href="${escapeAttribute(projectUrl)}" target="_blank" rel="noopener noreferrer">${imageMarkup}<span class="portfolio-image-cta">View project <span aria-hidden="true">↗</span></span></a>`
        : `<div class="portfolio-image-link">${imageMarkup}</div>`)
      : '';
    const projectLink = projectUrl
      ? `<a class="portfolio-link" href="${escapeAttribute(projectUrl)}" target="_blank" rel="noopener noreferrer">Explore project <span aria-hidden="true">↗</span></a>`
      : '<span class="portfolio-link portfolio-link-muted">Published project</span>';
    const descriptionMarkup = project.description ? `<p class="card-text">${escapeHtml(project.description)}</p>` : '';
    const titleMarkup = project.title?.trim() ? `<h4 class="card-title">${escapeHtml(project.title)}</h4>` : '';
    card.innerHTML = `<div class="card">${mediaFrame}<div class="card-body"><p class="portfolio-category">${escapeHtml(category)}</p>${titleMarkup}${descriptionMarkup}${project.title?.trim() || project.description?.trim() ? projectLink : ''}</div></div>`;
    const imageFrame = card.querySelector('.portfolio-image-link');
    return card;
  }

  function getProjectImages(project) {
    const image = typeof project.imageUrl === 'string' ? project.imageUrl.trim() : '';
    return image && isImageUrl(image) ? [image] : [];
  }

  function isValidProject(project) {
    if (!project || typeof project !== 'object') return false;
    if (project.title !== null && project.title !== undefined && typeof project.title !== 'string') return false;
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
      const graphicCollection = departmentGrids.get('Graphic Design')?.closest('.portfolio-collection');
      if (graphicCollection) graphicCollection.hidden = false;
      update();
    } catch {
      // An unavailable public API must leave the portfolio empty.
    }
  }

  graphicGallery = createGraphicDesignGallery(departmentGrids.get('Graphic Design'));
  update();
  void loadProjects();

  function createGraphicDesignGallery(grid) {
    if (!grid) return null;
    const collection = grid.closest('.portfolio-collection');
    if (!collection || collection.querySelector('.graphic-design-gallery-tools')) return null;
    collection.classList.add('graphic-design-gallery');
    const tools = document.createElement('div');
    tools.className = 'graphic-design-gallery-tools';
    tools.innerHTML = '<span class="graphic-design-gallery-label">Explore the collection</span><div class="graphic-design-filters" role="tablist" aria-label="Graphic Design categories"></div>';
    collection.querySelector('.collection-heading')?.after(tools);
    const filters = tools.querySelector('.graphic-design-filters');
    const empty = document.createElement('div');
    empty.className = 'graphic-design-empty-state';
    empty.innerHTML = '<span class="graphic-design-empty-mark" aria-hidden="true">✦</span><h4>New work is on its way.</h4><p>This collection will feature Fetman Digital artwork across branding, logos, posters, social media, packaging and campaigns.</p><a class="btn btn-outline-primary" href="#it-division">Explore our services</a>';
    grid.after(empty);
    const artworkModal = document.querySelector('[data-graphic-artwork-modal]');
    const artworkPreview = artworkModal?.querySelector('[data-graphic-artwork-preview]');
    const artworkTitle = artworkModal?.querySelector('[data-graphic-artwork-title]');
    let activeFilter = 'all';
    let artworkRestoreFocus;
    let observer;
    const categoryNames = ['Branding', 'Logos', 'Posters', 'Social Media', 'Packaging', 'Campaigns'];
    const normalized = (value) => String(value || '').trim().toLowerCase();
    const cardsInGrid = () => [...grid.querySelectorAll('.portfolio-item')];
    const matches = (card, query) => !query || card.textContent.toLowerCase().includes(query);
    const showEmptyState = (visible) => { empty.hidden = visible; };
    const applyEditorialLayout = (visible) => {
      const layoutClasses = ['editorial-featured', 'editorial-support-top', 'editorial-support-bottom', 'editorial-half', 'editorial-wide', 'editorial-narrow'];
      cardsInGrid().forEach((card) => {
        card.classList.remove(...layoutClasses);
      });
      visible.forEach((card, index) => {
        if (visible.length === 1) card.classList.add('editorial-featured');
        else if (visible.length === 2) card.classList.add('editorial-half');
        else if (visible.length === 3) card.classList.add(index === 0 ? 'editorial-featured' : index === 1 ? 'editorial-support-top' : 'editorial-support-bottom');
        else card.classList.add(index % 2 === 0 ? 'editorial-wide' : 'editorial-narrow');
      });
    };
    const refresh = (query = '') => {
      const cards = cardsInGrid();
      const visible = cards.filter((card) => (activeFilter === 'all' || normalized(card.dataset.portfolioCategory) === normalized(activeFilter)) && matches(card, query));
      cards.forEach((card) => { card.hidden = !visible.includes(card); card.classList.toggle('graphic-gallery-card-visible', visible.includes(card)); });
      applyEditorialLayout(visible);
      showEmptyState(visible.length > 0);
      return visible;
    };
    const openArtwork = (card) => {
      const image = card.querySelector('img');
      if (!artworkModal || !artworkPreview || !image) return;
      artworkRestoreFocus = card.querySelector('.portfolio-image-link');
      artworkPreview.replaceChildren(image.cloneNode(true));
      artworkPreview.querySelector('img').removeAttribute('loading');
      if (artworkTitle) artworkTitle.textContent = card.querySelector('.card-title')?.textContent.trim() || 'Graphic artwork';
      artworkModal.hidden = false;
      document.body.classList.add('graphic-artwork-modal-open');
      artworkModal.querySelector('[data-graphic-artwork-close]')?.focus();
    };
    const closeArtwork = () => { if (!artworkModal) return; artworkModal.hidden = true; artworkPreview?.replaceChildren(); document.body.classList.remove('graphic-artwork-modal-open'); artworkRestoreFocus?.focus?.(); };
    const renderFilters = () => {
      const available = new Set(cardsInGrid().map((card) => normalized(card.dataset.portfolioCategory)));
      const labels = ['All work', ...categoryNames.filter((name) => available.has(normalized(name)))];
      filters.innerHTML = labels.map((label) => { const filterId = label === 'All work' ? 'all' : normalized(label); return `<button type="button" role="tab" aria-selected="${filterId === activeFilter}" data-graphic-filter="${escapeAttribute(filterId)}">${escapeHtml(label)}</button>`; }).join('');
      filters.querySelectorAll('[data-graphic-filter]').forEach((button) => button.addEventListener('click', () => { activeFilter = button.dataset.graphicFilter; renderFilters(); refresh(); }));
    };
    grid.addEventListener('click', (event) => { const imageLink = event.target.closest('.portfolio-image-link'); if (imageLink && grid.contains(imageLink)) { event.preventDefault(); openArtwork(imageLink.closest('.portfolio-item')); } });
    artworkModal?.querySelectorAll('[data-graphic-artwork-close]').forEach((element) => element.addEventListener('click', closeArtwork));
    document.addEventListener('keydown', (event) => {
      if (!artworkModal || artworkModal.hidden) return;
      if (event.key === 'Escape') closeArtwork();
      if (event.key === 'Tab') {
        const focusable = [...artworkModal.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')];
        if (focusable.length && ((event.shiftKey && document.activeElement === focusable[0]) || (!event.shiftKey && document.activeElement === focusable.at(-1)))) { event.preventDefault(); (event.shiftKey ? focusable.at(-1) : focusable[0]).focus(); }
      }
    });
    if ('IntersectionObserver' in window) { observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('graphic-gallery-card-visible'); observer.unobserve(entry.target); } }), { threshold: .08 }); cardsInGrid().forEach((card) => observer.observe(card)); }
    renderFilters();
    return {
      refresh(query) { renderFilters(); return refresh(query); },
      destroy() {
        observer?.disconnect();
      },
    };
  }

  // Stage A catalog: stable IDs identify projects independently of display names.
  const PORTFOLIO_CATEGORY_LABELS = ['Template Website', 'Basic', 'Standard', 'Advanced', 'Premium Digital Experiences', 'Management Systems'];
  const PORTFOLIO_CATEGORY_IDS = ['template-website', 'basic', 'standard', 'advanced', 'premium-digital-experiences', 'management-systems'];
  const PORTFOLIO_PROJECTS = [
    { id: 'urban-bloom', name: 'Urban Bloom', category: 'Template Website', type: 'Lifestyle', description: 'A bright editorial storefront for a considered home and garden brand.', brand: 'urban bloom', eyebrow: 'Plants for modern living', headline: 'Make room for something beautiful.', cta: 'Explore the collection', theme: 'bloom', layout: 'editorial' },
    { id: 'cornerstone-cafe', name: 'Cornerstone Café', category: 'Template Website', type: 'Hospitality', description: 'A warm, welcoming web direction built around menus, moments and local discovery.', brand: 'cornerstone', eyebrow: 'Coffee · breakfast · slow days', headline: 'A good day starts here.', cta: 'View the menu', theme: 'cornerstone', layout: 'hospitality' },
    { id: 'clearsmile-dental', name: 'ClearSmile Dental', category: 'Basic', type: 'Healthcare', description: 'A calm, trust-led healthcare presence that makes the first appointment feel simple.', brand: 'ClearSmile', eyebrow: 'Thoughtful dental care', headline: 'A little more at ease.', cta: 'Meet the practice', theme: 'clearsmile', layout: 'healthcare' },
    { id: 'apex-plumbing', name: 'Apex Plumbing', category: 'Basic', type: 'Home Services', description: 'A direct, practical service website designed to turn urgent searches into confident enquiries.', brand: 'APEX / PLUMBING', eyebrow: 'Fast help. Done properly.', headline: 'The right call when it matters.', cta: 'Request a callout', theme: 'apex', layout: 'service' },
    { id: 'greenline-solar', name: 'Greenline Solar', category: 'Basic', type: 'Renewable Energy', description: 'A clear, optimistic service experience that turns a technical decision into a confident next step.', brand: 'GREENLINE', eyebrow: 'Power your next chapter', headline: 'A brighter way forward.', cta: 'Calculate your potential', theme: 'greenline', layout: 'solar' },
    { id: 'velora-properties', name: 'Velora Properties', category: 'Standard', type: 'Real Estate', description: 'A refined property discovery experience balancing editorial storytelling with clear search paths.', brand: 'VELORA', eyebrow: 'Property with perspective', headline: 'Find a place with presence.', cta: 'Explore properties', theme: 'velora', layout: 'property' },
    { id: 'meridian-consulting', name: 'Meridian Consulting', category: 'Standard', type: 'Corporate', description: 'A confident consulting platform that makes complex expertise feel clear, human and actionable.', brand: 'meridian / consulting', eyebrow: 'Strategy for what comes next', headline: 'Clarity creates momentum.', cta: 'See our approach', theme: 'meridian', layout: 'consulting' },
    { id: 'summit-academy', name: 'Summit Academy', category: 'Standard', type: 'Education', description: 'An inviting learning platform that makes programmes, outcomes and enrolment easy to understand.', brand: 'SUMMIT ACADEMY', eyebrow: 'Learn with intention', headline: 'Your next chapter starts here.', cta: 'Find your programme', theme: 'summit', layout: 'academy' },
    { id: 'maison-luxe', name: 'Maison Luxe', category: 'Advanced', type: 'Luxury E-commerce', description: 'A cinematic commerce direction for a premium label where product, story and desire meet.', brand: 'MAISON LUXE', eyebrow: 'The autumn collection', headline: 'Objects with a point of view.', cta: 'Shop the collection', theme: 'maison', layout: 'commerce' },
    { id: 'novatech-store', name: 'NovaTech Store', category: 'Advanced', type: 'Technology E-commerce', description: 'A high-performance retail experience for devices and tools that make modern work possible.', brand: 'NOVATECH', eyebrow: 'Tools for a faster world', headline: 'Technology, made tangible.', cta: 'Browse the range', theme: 'novatech', layout: 'commerce' },
    { id: 'autohaus', name: 'AutoHaus', category: 'Advanced', type: 'Automotive', description: 'A confident vehicle discovery platform pairing rich imagery with a considered buying journey.', brand: 'AUTOHAUS', eyebrow: 'Drive something considered', headline: 'The road starts with a choice.', cta: 'Discover the range', theme: 'autohaus', layout: 'automotive' },
    { id: 'eventsphere', name: 'EventSphere', category: 'Premium Digital Experiences', type: 'Events Platform', description: 'An immersive event discovery experience built around anticipation, atmosphere and easy planning.', brand: 'EVENTSPHERE', eyebrow: 'Find your next moment', headline: 'There is more to experience.', cta: 'Explore what is on', theme: 'eventsphere', layout: 'events' },
    { id: 'booklypro', name: 'BooklyPro', category: 'Premium Digital Experiences', type: 'Booking Platform', description: 'A polished booking journey that gives customers confidence from the first search to confirmation.', brand: 'booklypro', eyebrow: 'Appointments without friction', headline: 'Make time for what matters.', cta: 'Find a time', theme: 'booklypro', layout: 'booking' },
    { id: 'client-connect', name: 'ClientConnect', category: 'Premium Digital Experiences', type: 'Client Portal', description: 'A considered client workspace bringing updates, documents and conversations into one calm place.', brand: 'CLIENTCONNECT', eyebrow: 'A better way to work together', headline: 'Everything in step.', cta: 'Enter the workspace', theme: 'clientconnect', layout: 'portal' },
    { id: 'stockpilot-erp', name: 'StockPilot ERP', category: 'Management Systems', type: 'Inventory Management', description: 'A focused operations workspace for products, suppliers, stock movements and clear reporting.', brand: 'StockPilot', eyebrow: 'Inventory, in control', headline: 'Know what moves the business.', cta: 'Open the workspace', theme: 'stockpilot', layout: 'dashboard' },
    { id: 'finflow', name: 'FinFlow', category: 'Management Systems', type: 'Finance Management', description: 'A composed finance dashboard for invoices, expenses, payment status and useful summaries.', brand: 'FinFlow', eyebrow: 'Financial clarity, daily', headline: 'The numbers tell a story.', cta: 'View the dashboard', theme: 'finflow', layout: 'dashboard' },
    { id: 'staffcore', name: 'StaffCore', category: 'Management Systems', type: 'People Operations', description: 'A people operations system for employee records, attendance, leave and role visibility.', brand: 'StaffCore', eyebrow: 'People operations, humanised', headline: 'Give your team room to thrive.', cta: 'Explore the workspace', theme: 'staffcore', layout: 'dashboard' },
    { id: 'projectflow', name: 'ProjectFlow', category: 'Management Systems', type: 'Project Management', description: 'A clear project command centre for assignments, progress, deadlines and team momentum.', brand: 'ProjectFlow', eyebrow: 'Work moves better together', headline: 'Make progress visible.', cta: 'View the workflow', theme: 'projectflow', layout: 'kanban' },
    { id: 'service-desk-pro', name: 'ServiceDesk Pro', category: 'Management Systems', type: 'Support Operations', description: 'A practical support workspace for prioritised tickets, assignments, search and resolution.', brand: 'ServiceDesk', eyebrow: 'Support without the scramble', headline: 'Every request has a next step.', cta: 'Open the desk', theme: 'servicedesk', layout: 'support' },
  ];
  const PORTFOLIO_CATEGORIES = PORTFOLIO_CATEGORY_LABELS.map((label, index) => ({ id: PORTFOLIO_CATEGORY_IDS[index], label, count: PORTFOLIO_PROJECTS.filter((project) => project.category === label).length }));

  function createWebsitePortfolioPrototype() {
    const tabs = document.querySelector('[data-website-portfolio-tabs]');
    const grid = document.querySelector('[data-website-portfolio-grid]');
    const modal = document.querySelector('[data-website-portfolio-modal]');
    if (!tabs || !grid || !modal) return;

    // These concept projects intentionally live in this presentation module rather
    // than the public portfolio API. They are visual direction samples, not records
    // that should appear in the management dashboard or be mistaken for client work.
    const websiteDemoData = {
      'Urban Bloom': { kind: 'website', pageLabel: 'Lifestyle storefront', hero: 'Bring a little more life home.', intro: 'Urban Bloom curates plants, pots and small rituals for people creating calmer spaces in the city.', about: 'Founded by horticulturist Lindiwe Maseko, Urban Bloom began as a weekend plant stall in Observatory and grew into a considered home-greening studio.', itemsLabel: 'Featured collections', items: [['The Low-Light Edit', 'Resilient plants for north-facing rooms.', 'From R420'], ['Sunday Morning Pots', 'Hand-finished ceramic vessels in quiet glazes.', 'From R280'], ['Desk Garden Kits', 'A small ritual for a more generous workday.', 'From R195']], testimonials: [['Mia Jacobs', '“The team helped me turn a bare apartment into a place that feels like mine.”'], ['Thando Ndlovu', '“Every delivery feels beautifully considered, from the plant choice to the care card.”']], faqs: [['Do you deliver?','Yes. Urban Bloom delivers across Johannesburg and Pretoria on scheduled weekday routes.'], ['Can you help me choose a plant?','The studio offers a remote plant-matching consultation based on light, pets and your routine.']], contact: 'hello@urbanbloom.demo' },
      'Cornerstone Café': { kind: 'website', pageLabel: 'Hospitality website', hero: 'Good coffee. Slow mornings. A table for you.', intro: 'Cornerstone Café is a neighbourhood kitchen in Morningside serving generous breakfasts, seasonal plates and coffee worth lingering over.', about: 'Chef-owner Amara Botha opened Cornerstone after years in hotel kitchens, creating a room that feels like the best part of a Saturday morning.', itemsLabel: 'Today at Cornerstone', items: [['Breakfast', 'Whipped ricotta toast, seasonal fruit and sourdough.', 'R95'], ['Lunch', 'Charred chicken, herb couscous and lemon yoghurt.', 'R145'], ['Sweet things', 'Warm cardamom bun with burnt honey butter.', 'R58'], ['Coffee', 'House blend espresso, roasted in small batches.', 'From R32']], testimonials: [['Ayesha Khan', '“The kind of café where the staff remember your order and the light is always good.”'], ['Jonas Meyer', '“Our new favourite lunch meeting spot in the city.”']], faqs: [['Do you take bookings?','Tables for four or more can be booked by email. Walk-ins are always welcome.'], ['What are the opening hours?','Monday to Friday, 07:00–16:00. Saturday and Sunday, 08:00–15:00.']], contact: 'hello@cornerstone.demo' },
      'ClearSmile Dental': { kind: 'website', pageLabel: 'Healthcare website', hero: 'A little more at ease.', intro: 'ClearSmile Dental makes everyday dentistry feel calm, clear and personal for families in Rosebank.', about: 'Dr Naledi Mokoena and Dr James Patel created ClearSmile around a simple belief: patients deserve to understand every step of their care.', itemsLabel: 'Care at ClearSmile', items: [['Preventive dentistry', 'Gentle examinations, cleaning and practical home-care plans.', 'From R650'], ['Smile consultations', 'A considered conversation about whitening, alignment and confidence.', 'From R850'], ['Restorative care', 'Modern fillings, crowns and treatment planning with clear options.', 'From R1,200']], people: [['Dr Naledi Mokoena', 'Principal dentist · restorative care'], ['Dr James Patel', 'Dentist · family and preventive care']], testimonials: [['Sophie Daniels', '“I understood the plan before treatment started, and that made all the difference.”'], ['Ethan Williams', '“The whole team made my daughter feel safe and listened to.”']], faqs: [['Are new patients welcome?','Yes. New patient appointments include a full examination and a clear discussion of next steps.'], ['Do you offer Saturday appointments?','Saturday appointments are available twice a month by advance booking.']], contact: 'care@clearsmile.demo', details: 'Mon–Fri 08:00–17:00 · Sat 08:00–13:00' },
      'Apex Plumbing': { kind: 'website', pageLabel: 'Service business website', hero: 'The right call when it matters.', intro: 'Apex Plumbing helps homes and small businesses solve urgent water, drainage and maintenance problems without the runaround.', about: 'Apex is a fictional family-run plumbing team serving the northern suburbs with transparent callouts and qualified technicians.', itemsLabel: 'What Apex handles', items: [['Emergency callouts', 'Burst pipes, blocked drains and leaks assessed day or night.', 'Response within 90 min'], ['Home plumbing', 'Bathrooms, kitchens, geysers and preventative maintenance.', 'Quote after assessment'], ['Business maintenance', 'Planned checks and dependable support for busy premises.', 'Monthly plans available']], testimonials: [['Priya Naidoo', '“Clear communication from the first call and the leak was sorted properly.”'], ['Mark Ellis', '“A reliable team for our small office and no surprise invoice.”']], faqs: [['Do you provide a written quote?','Yes. Work is explained and approved before non-emergency repairs begin.'], ['Which areas do you cover?','Apex serves the northern Johannesburg suburbs in this demonstration.']], contact: 'dispatch@apexplumbing.demo' },
      'Greenline Solar': { kind: 'website', pageLabel: 'Renewable energy website', hero: 'A brighter way forward.', intro: 'Greenline Solar helps growing households and businesses make practical, informed moves toward reliable energy.', about: 'Greenline was imagined by two electrical engineers who wanted solar conversations to feel less intimidating and more useful.', itemsLabel: 'Greenline solutions', items: [['Home energy audit', 'A practical review of usage, backup needs and roof potential.', 'Book a review'], ['Battery backup', 'Keep essential systems running through planned or unexpected outages.', 'Designed to suit'], ['Business solar', 'Reduce operating pressure with a measured commercial energy plan.', 'Scope after survey']], testimonials: [['Ruben Jacobs', '“The explanation was clear enough for our whole family to make a confident decision.”'], ['Nandi Dlamini', '“A professional process from the first assessment to the handover.”']], faqs: [['Does Greenline sell a fixed package?','No. Every recommendation is based on the property, usage and backup priorities.'], ['Is this a live quote tool?','No. This is a demonstration enquiry flow using fictional information.']], contact: 'hello@greenline.demo' },
      'Velora Properties': { kind: 'properties', pageLabel: 'Property discovery platform', hero: 'Find a place with presence.', intro: 'Velora Properties brings a quieter, more editorial approach to discovering homes, workspaces and investment opportunities.', about: 'Velora is a fictional independent property studio built around better photography, useful details and a human buying journey.', itemsLabel: 'Featured properties', properties: [['The Fern House', 'Parkhurst · 3 bed home · 2 bath', 'R3,850,000', 'House'], ['The Atlas Loft', 'Braamfontein · 2 bed apartment · 1 bath', 'R1,920,000', 'Apartment'], ['Orchard View', 'Lanseria · 5 bed country home · 4 bath', 'R6,400,000', 'House'], ['The Foundry Office', 'Midrand · 240m² workspace', 'R42,000 / month', 'Commercial']], testimonials: [['Leah Morgan', '“Velora made the search feel considered instead of overwhelming.”'], ['Dumisani Khumalo', '“The property details were honest, useful and beautifully presented.”']], faqs: [['Are the listings real?','No. Every property in this demonstration is fictional and used to show a discovery experience.'], ['Can I save a property?','The save control is simulated locally for demonstration purposes.']], contact: 'viewings@velora.demo' },
      'Meridian Consulting': { kind: 'website', pageLabel: 'Corporate website', hero: 'Clarity creates momentum.', intro: 'Meridian Consulting helps leadership teams turn complex decisions into focused, measurable action.', about: 'Meridian is a fictional strategy practice founded by people who believe rigorous thinking should still feel human.', itemsLabel: 'What Meridian does', items: [['Growth strategy', 'Turn market signals into a clear set of commercial priorities.', 'For leadership teams'], ['Operating models', 'Design the decisions, roles and rhythms that make execution easier.', 'Built with your team'], ['Change programmes', 'Help people move from agreed direction to meaningful adoption.', 'Practical by design']], testimonials: [['Kabelo Mthembu', '“Meridian gave our leadership team a shared language for the work ahead.”'], ['Rachel Green', '“The recommendations were sharp, but the process remained deeply collaborative.”']], faqs: [['How does a first engagement begin?','A short discovery conversation clarifies the decision, context and people involved.'], ['Do you work with smaller businesses?','Yes. The demonstration includes flexible advisory formats for growing teams.']], contact: 'hello@meridian.demo' },
      'Summit Academy': { kind: 'website', pageLabel: 'Education platform', hero: 'Your next chapter starts here.', intro: 'Summit Academy makes practical learning feel possible, personal and connected to the work students want to do.', about: 'Summit is a fictional learning community offering short programmes for ambitious people changing direction or building momentum.', itemsLabel: 'Popular programmes', items: [['Brand foundations', 'A six-week studio programme for emerging creative leaders.', '6 weeks'], ['Project leadership', 'Build the habits that move teams from plan to delivery.', '8 weeks'], ['Digital commerce', 'Understand the customer journeys behind better online stores.', '4 weeks']], testimonials: [['Amina Khan', '“The programme gave me both a stronger portfolio and a clearer next step.”'], ['Luke Petersen', '“Practical, generous and easy to fit around a full-time role.”']], faqs: [['Are programmes self-paced?','Each programme combines guided sessions with flexible independent work.'], ['Can companies enrol a team?','Yes. Summit offers fictional team cohorts and private workshops in this demonstration.']], contact: 'hello@summitacademy.demo' },
      'Maison Luxe': { kind: 'commerce', pageLabel: 'Luxury e-commerce experience', hero: 'Objects with a point of view.', intro: 'Maison Luxe is a fictional house of considered objects, soft materials and lasting rituals for the home.', about: 'Maison Luxe curates small-batch pieces from imagined makers who care about material, proportion and the pleasure of everyday use.', itemsLabel: 'Featured collection', products: [['Serein Table Lamp', 'Warm alabaster light with a hand-brushed brass stem.', 'R4,800', 'Lighting', 'In stock'], ['Noma Linen Throw', 'Washed Belgian linen in a deep mineral blue.', 'R2,350', 'Textiles', 'In stock'], ['Arc Tray', 'Solid walnut serving tray with softened edges.', 'R1,180', 'Objects', 'Low stock'], ['Mora Vessel', 'Hand-thrown stoneware with a smoke-grey glaze.', 'R890', 'Objects', 'In stock']], testimonials: [['Elise Hart', '“The collection makes ordinary rituals feel beautifully intentional.”'], ['Noah Williams', '“The product details are exactly what I want before buying something special.”']], faqs: [['Are Maison Luxe products made to order?','Selected pieces are made in small batches and the stock label on each product is simulated.'], ['Is checkout real?','No. The cart and checkout demonstration never charges a card or sends an order.']], contact: 'concierge@maisonluxe.demo' },
      'NovaTech Store': { kind: 'commerce', pageLabel: 'Technology e-commerce experience', hero: 'Technology, made tangible.', intro: 'NovaTech brings useful devices, accessories and tools into one clear shopping experience for modern work.', about: 'NovaTech is a fictional technology retailer focused on honest specifications, useful comparisons and thoughtful support.', itemsLabel: 'Shop the range', products: [['Orbit Pro Laptop', 'A light, capable workstation for hybrid teams.', 'R18,990', 'Computing', 'In stock'], ['Halo Desk Light', 'Adaptive task light with a warmer evening setting.', 'R1,299', 'Workspace', 'In stock'], ['Slate Dock', 'One-cable connection for a calmer desk.', 'R1,899', 'Accessories', 'Low stock'], ['Pulse Headphones', 'Comfortable noise control for deep work and travel.', 'R3,499', 'Audio', 'In stock']], testimonials: [['Zanele Dube', '“Finally a store that explains the difference between products without the noise.”'], ['Michael Stone', '“The comparison view helped me choose quickly and confidently.”']], faqs: [['Can I compare products?','The demonstration catalogue is designed to support comparison, but no live stock or payments exist.'], ['Do you offer support?','Yes. NovaTech includes fictional setup and care guidance after purchase.']], contact: 'hello@novatech.demo' },
      'AutoHaus': { kind: 'website', pageLabel: 'Automotive website', hero: 'The road starts with a choice.', intro: 'AutoHaus helps drivers discover considered pre-owned vehicles with better information and less pressure.', about: 'AutoHaus is a fictional independent dealership that pairs carefully selected vehicles with transparent, human service.', itemsLabel: 'In the showroom', items: [['2023 Northline S', 'Hybrid SUV · 18,400 km · Glacier white', 'R489,000'], ['2022 Verve GT', 'Sport hatch · 26,100 km · Graphite', 'R329,000'], ['2021 Atlas Tourer', 'Family estate · 41,700 km · Deep blue', 'R365,000']], testimonials: [['Themba Radebe', '“The vehicle story and condition notes made the shortlist much easier.”'], ['Sarah Bell', '“A calm buying experience with no unnecessary pressure.”']], faqs: [['Can I book a test drive?','Yes. The enquiry flow records a fictional preferred time but does not contact a dealership.'], ['Are these vehicles available?','No. All vehicles and pricing are fictional demonstration content.']], contact: 'hello@autohaus.demo' },
      'EventSphere': { kind: 'website', pageLabel: 'Events platform', hero: 'There is more to experience.', intro: 'EventSphere brings music, culture and shared moments into one atmospheric discovery platform.', about: 'EventSphere is a fictional events guide designed to help people find what feels worth leaving the house for.', itemsLabel: 'Coming up', items: [['After Dark / Johannesburg', 'Live electronic set · 18 October · The Foundry', 'From R280'], ['Sunday Assembly', 'Food, design and local makers · 26 October', 'Free entry'], ['Open Air Cinema', 'A long-table film night under the city sky · 2 November', 'From R180']], testimonials: [['Mpho Dlamini', '“The event pages make me want to go before I have even checked the date.”'], ['Chloe Martin', '“A beautiful way to find the smaller things happening nearby.”']], faqs: [['Can I buy a ticket here?','Ticket actions are simulated and do not process payments.'], ['Can organisers submit an event?','The demonstration includes a fictional submission flow for organisers.']], contact: 'hello@eventsphere.demo' },
      'BooklyPro': { kind: 'website', pageLabel: 'Booking platform', hero: 'Make time for what matters.', intro: 'BooklyPro gives service businesses a composed way to show availability and gives customers a simpler way to book.', about: 'BooklyPro is a fictional scheduling product designed for studios, consultants and appointment-led businesses.', itemsLabel: 'Popular bookings', items: [['Strategy session', 'A focused 60-minute consultation with a specialist.', '60 min'], ['Wellness reset', 'A calm guided session built around your current routine.', '75 min'], ['Studio review', 'Bring a project, leave with a clear next action.', '45 min']], testimonials: [['Imani Cole', '“Booking took less time than writing the email I used to send.”'], ['Daniel Ross', '“The availability view is clear enough that clients arrive prepared.”']], faqs: [['Are appointment reminders real?','No. Booking confirmations and reminders are simulated in this demonstration.'], ['Can a business manage availability?','The demo includes selectable fictional time slots for presentation purposes.']], contact: 'hello@booklypro.demo' },
      'ClientConnect': { kind: 'website', pageLabel: 'Client portal experience', hero: 'Everything in step.', intro: 'ClientConnect brings updates, files, approvals and conversations into one calm shared workspace.', about: 'ClientConnect is a fictional portal concept for studios and service businesses that want clients to feel informed without adding more meetings.', itemsLabel: 'Your workspace', items: [['Project overview', 'See milestones, owners and the next decision in one view.', 'Ready to review'], ['Shared files', 'Keep approved documents and working files easy to find.', '12 files'], ['Feedback loop', 'Leave clear, contextual comments against the work.', '3 open notes']], testimonials: [['Ari Singh', '“The portal makes the project feel visible without turning it into more admin.”'], ['Nadia Jacobs', '“Approvals are much less ambiguous when everyone can see the same context.”']], faqs: [['Is this connected to a real project?','No. This is a fictional client portal demonstration with simulated records.'], ['Can comments be sent?','No. Comments remain inside the local demonstration only.']], contact: 'hello@clientconnect.demo' },
    };
    const managementDemoData = {
      'StockPilot ERP': { subtitle: 'Inventory operations workspace', tabs: { Products: { columns: ['Product', 'SKU', 'Category', 'Stock', 'Unit price'], records: [['Orbit Cable Kit', 'OCK-104', 'Accessories', '42', 'R480'], ['Meridian Router', 'MRT-220', 'Networking', '8', 'R2,850'], ['Slate Monitor Arm', 'SMA-018', 'Workspace', '3', 'R1,190'], ['Halo Desk Light', 'HDL-510', 'Workspace', '27', 'R799']] }, Suppliers: { columns: ['Supplier', 'Contact', 'Lead time', 'Status'], records: [['Northstar Components', 'Maya Patel', '5 days', 'Approved'], ['Kite & Co. Logistics', 'Ethan Cole', '3 days', 'Approved'], ['Brightline Imports', 'Nandi Maseko', '12 days', 'Review']] }, 'Stock movements': { columns: ['Date', 'Product', 'Movement', 'Quantity', 'Reference'], records: [['14 Oct 2026', 'Orbit Cable Kit', 'Received', '+24', 'PO-2048'], ['12 Oct 2026', 'Meridian Router', 'Allocated', '-3', 'ORD-8831'], ['10 Oct 2026', 'Slate Monitor Arm', 'Received', '+8', 'PO-2041']] } }, metricLabels: ['Products tracked', 'Low stock items', 'Suppliers'], metricValues: ['4', '2', '3'] },
      'FinFlow': { subtitle: 'Finance operations workspace', tabs: { Invoices: { columns: ['Invoice', 'Customer', 'Issue date', 'Amount', 'Status'], records: [['INV-2048', 'Northwind Studio', '15 Oct 2026', 'R18,750', 'Paid'], ['INV-2049', 'Morrow & Finch', '18 Oct 2026', 'R9,480', 'Awaiting payment'], ['INV-2050', 'Cedar House', '21 Oct 2026', 'R24,100', 'Draft']] }, Expenses: { columns: ['Expense', 'Supplier', 'Category', 'Date', 'Amount'], records: [['Adobe Creative Cloud', 'Adobe South Africa', 'Software', '02 Oct 2026', 'R1,299'], ['Courier run', 'CitySprint', 'Operations', '09 Oct 2026', 'R640'], ['Studio supplies', 'Paper & Grain', 'Office', '12 Oct 2026', 'R1,180']] }, Customers: { columns: ['Customer', 'Email', 'Open invoices', 'Account status'], records: [['Northwind Studio', 'accounts@northwind.demo', '0', 'Good standing'], ['Morrow & Finch', 'finance@morrow.demo', '1', 'Follow-up'], ['Cedar House', 'hello@cedarhouse.demo', '1', 'Good standing']] } }, metricLabels: ['October revenue', 'Awaiting payment', 'Recorded expenses'], metricValues: ['R52,330', 'R9,480', 'R3,119'] },
      'StaffCore': { subtitle: 'People operations workspace', tabs: { Employees: { columns: ['Employee', 'Department', 'Role', 'Status'], records: [['Amara Ndlovu', 'Client Services', 'Account director', 'Active'], ['Jon Bell', 'Engineering', 'Frontend developer', 'Active'], ['Lerato Maseko', 'Operations', 'People coordinator', 'On leave']] }, Attendance: { columns: ['Employee', 'Today', 'This month', 'Pattern'], records: [['Amara Ndlovu', 'Present', '19 / 21 days', 'Consistent'], ['Jon Bell', 'Present', '20 / 21 days', 'Consistent'], ['Lerato Maseko', 'Leave', '16 / 21 days', 'Approved leave']] }, 'Leave requests': { columns: ['Employee', 'Type', 'Dates', 'Days', 'Status'], records: [['Lerato Maseko', 'Annual leave', '21–25 Oct', '5', 'Approved'], ['Jon Bell', 'Personal day', '30 Oct', '1', 'Pending'], ['Amara Ndlovu', 'Annual leave', '04–06 Nov', '3', 'Approved']] } }, metricLabels: ['Active employees', 'On leave today', 'Pending requests'], metricValues: ['18', '1', '1'] },
      'ProjectFlow': { subtitle: 'Project and delivery workspace', tabs: { Projects: { columns: ['Project', 'Client', 'Owner', 'Progress', 'Status'], records: [['Brand refresh', 'Northwind Studio', 'Amara Ndlovu', '78%', 'Active'], ['Portal launch', 'Cedar House', 'Jon Bell', '42%', 'At risk'], ['Campaign rollout', 'Morrow & Finch', 'Lerato Maseko', '100%', 'Complete']] }, Tasks: { columns: ['Task', 'Project', 'Assignee', 'Due', 'Priority', 'Status'], records: [['Approve homepage direction', 'Brand refresh', 'Amara Ndlovu', '24 Oct', 'High', 'In progress'], ['Connect enquiry form', 'Portal launch', 'Jon Bell', '28 Oct', 'Medium', 'To do'], ['Prepare launch notes', 'Campaign rollout', 'Lerato Maseko', '18 Oct', 'Low', 'Complete']] }, Workflow: { columns: ['To do', 'In progress', 'Review', 'Complete'], records: [['Wireframe approvals', 'Homepage build', 'Copy review', 'Discovery workshop']] } }, metricLabels: ['Active projects', 'Tasks in sample', 'Average progress'], metricValues: ['2', '3', '73%'] },
      'ServiceDesk Pro': { subtitle: 'Support operations workspace', tabs: { Tickets: { columns: ['Ticket', 'Customer', 'Subject', 'Priority', 'Status'], records: [['SD-1048', 'Northwind Studio', 'Login link expires too quickly', 'High', 'Open'], ['SD-1049', 'Cedar House', 'Update billing contact', 'Low', 'Pending'], ['SD-1050', 'Morrow & Finch', 'Dashboard export is blank', 'Medium', 'In progress']] }, Customers: { columns: ['Customer', 'Plan', 'Open tickets', 'Last contact'], records: [['Northwind Studio', 'Growth', '1', 'Today'], ['Cedar House', 'Studio', '1', 'Yesterday'], ['Morrow & Finch', 'Growth', '1', '18 Oct 2026']] }, 'Ticket history': { columns: ['Ticket', 'Agent', 'Response', 'Time'], records: [['SD-1048', 'Priya Naidoo', 'Requested a secure screen recording', '10:42'], ['SD-1049', 'Jon Bell', 'Confirmed the billing update is queued', '09:18'], ['SD-1050', 'Amara Ndlovu', 'Shared a temporary export workaround', 'Yesterday']] } }, metricLabels: ['Open tickets', 'High priority', 'Average response'], metricValues: ['3', '1', '1h 48m'] },
    };
    let activeCategory = PORTFOLIO_CATEGORIES[0].id;
    let lastFocusedElement;
    let activeProject;

    // The demo studio keeps fictional content in browser storage only. This lets
    // reviewers test local changes without mixing sample records into the managed
    // portfolio API or the production database.
    const cloneDemoData = (value) => JSON.parse(JSON.stringify(value));
    const demoStorageKey = (project) => `fetman-demo:${project.id}`;
    const legacyDemoStorageKey = (project) => `fetman-demo:${project.name}`;

    const createDemoExperience = () => {
      const shell = document.querySelector('[data-demo-experience]');
      const root = shell?.querySelector('[data-demo-root]');
      const title = shell?.querySelector('[data-demo-title]');
      const resetButton = shell?.querySelector('[data-demo-reset]');
      if (!shell || !root || !title) return null;
      let currentProject;
      let currentState;
      let restoreFocus;

      const save = () => {
        if (currentProject && currentState) localStorage.setItem(demoStorageKey(currentProject), JSON.stringify(currentState));
      };
      const loadState = (project) => {
        const currentKey = demoStorageKey(project);
        const stored = localStorage.getItem(currentKey) || localStorage.getItem(legacyDemoStorageKey(project));
        if (stored) {
          if (!localStorage.getItem(currentKey)) localStorage.setItem(currentKey, stored);
          try { return JSON.parse(stored); } catch { localStorage.removeItem(demoStorageKey(project)); }
        }
        return project.category === 'Management Systems'
          ? { tabs: cloneDemoData(managementDemoData[project.name].tabs), activeTab: Object.keys(managementDemoData[project.name].tabs)[0] }
          : { cart: [] };
      };
      const close = () => {
        shell.hidden = true;
        document.body.classList.remove('demo-experience-open');
        root.replaceChildren();
        restoreFocus?.focus?.();
      };
      const render = () => {
        if (!currentProject) return;
        root.innerHTML = currentProject.category === 'Management Systems'
          ? renderManagementDemo(currentProject, managementDemoData[currentProject.name], currentState)
          : renderWebsiteDemo(currentProject, websiteDemoData[currentProject.name], currentState);
        bindDemoInteractions();
      };
      const open = (project) => {
        if (!shell.hidden) close();
        currentProject = project;
        currentState = loadState(project);
        restoreFocus = document.activeElement;
        title.textContent = project.name;
        resetButton.hidden = false;
        shell.hidden = false;
        document.body.classList.add('demo-experience-open');
        render();
        shell.querySelector('[data-demo-close]')?.focus();
      };
      const reset = () => {
        if (!currentProject) return;
        localStorage.removeItem(demoStorageKey(currentProject));
        localStorage.removeItem(legacyDemoStorageKey(currentProject));
        currentState = loadState(currentProject);
        render();
      };

      const renderWebsiteDemo = (project, content, state) => {
        if (!content) return '<p class="demo-empty">This demonstration is not available yet.</p>';
        const itemMarkup = content.properties ? renderPropertyCards(content.properties, state) : content.products ? renderProductCards(content.products, state) : (content.items || []).map(([name, description, detail]) => `<article class="demo-content-card"><span class="demo-card-detail">${escapeHtml(detail)}</span><h3>${escapeHtml(name)}</h3><p>${escapeHtml(description)}</p><button class="demo-inline-action" type="button" data-demo-item-action="${escapeAttribute(name)}">Explore this concept <span aria-hidden="true">↗</span></button></article>`).join('');
        const special = content.properties ? `<div class="demo-filter-bar"><label>Search properties <input type="search" data-property-search placeholder="Try ‘villa’ or ‘sea’"></label><label>Property type <select data-property-type><option value="all">All types</option>${[...new Set(content.properties.map((item) => item.type))].map((type) => `<option value="${escapeAttribute(type)}">${escapeHtml(type)}</option>`).join('')}</select></label></div>` : content.products ? `<div class="demo-cart-summary" data-demo-cart>${state.cart?.length ? `${state.cart.length} item${state.cart.length === 1 ? '' : 's'} in the simulated cart · <button type="button" data-demo-checkout>Continue to simulated checkout</button>` : 'Cart is empty · choose a product to begin'}</div>` : '';
        const people = content.people ? `<section class="demo-site-section"><div class="demo-section-heading"><span>Meet the team</span><h2>People who make the difference.</h2></div><div class="demo-people-grid">${content.people.map(([name, role, bio]) => `<article><div class="demo-avatar">${escapeHtml(name.split(' ').map((part) => part[0]).join(''))}</div><h3>${escapeHtml(name)}</h3><strong>${escapeHtml(role)}</strong><p>${escapeHtml(bio)}</p></article>`).join('')}</div></section>` : '';
        const faq = (content.faqs || []).map(([question, answer]) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join('');
        const details = content.details ? `<p class="demo-operating-details">${escapeHtml(content.details)}</p>` : '';
        const availability = project.name === 'ClearSmile Dental' ? `<div class="demo-availability"><strong>Example appointment availability</strong><span>Tue 10:30 · Routine examination</span><span>Wed 14:00 · Smile consultation</span><span>Sat 09:15 · Family appointment</span></div>` : '';
        return `<div class="demo-site-shell theme-${escapeAttribute(project.theme)}"><div class="demo-fake-browser-bar"><span></span><span></span><span></span><small>${escapeHtml(project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}.concept</small></div><div class="demo-demo-banner">Fictional ${escapeHtml(content.pageLabel || 'website')} · all forms, bookings and purchases are simulated for review.</div><nav class="demo-site-nav"><strong>${escapeHtml(project.brand)}</strong><div><button type="button" data-demo-scroll="overview">Overview</button><button type="button" data-demo-scroll="offerings">Offerings</button><button type="button" data-demo-scroll="faq">FAQ</button><button type="button" data-demo-scroll="contact">Contact</button></div><span class="demo-nav-mark">FD</span></nav><section class="demo-site-hero" id="overview"><div><span class="demo-eyebrow">${escapeHtml(project.eyebrow)}</span><h1>${escapeHtml(content.hero)}</h1><p>${escapeHtml(content.intro)}</p><button class="demo-primary-action" type="button" data-demo-scroll="offerings">${escapeHtml(project.cta)} <span aria-hidden="true">↗</span></button></div><div class="demo-hero-orbit"><span>${escapeHtml(project.type)}</span><b>Concept<br>studio</b></div></section><section class="demo-site-section demo-story"><div class="demo-section-heading"><span>About the business</span><h2>Built around a clear point of view.</h2></div><p>${escapeHtml(content.about)}</p>${details}${availability}</section>${people}<section class="demo-site-section" id="offerings"><div class="demo-section-heading"><span>${escapeHtml(content.itemsLabel || 'Explore the experience')}</span><h2>Designed to be useful, memorable and easy to move through.</h2></div>${special}<div class="demo-content-grid">${itemMarkup}</div></section><section class="demo-site-section demo-testimonials"><div class="demo-section-heading"><span>Fictional customer notes</span><h2>What the experience feels like.</h2></div><div class="demo-quote-grid">${(content.testimonials || []).map(([name, quote]) => `<blockquote><p>${escapeHtml(quote)}</p><cite>${escapeHtml(name)} · demonstration customer</cite></blockquote>`).join('')}</div></section><section class="demo-site-section demo-faq" id="faq"><div class="demo-section-heading"><span>Helpful answers</span><h2>Questions, answered.</h2></div>${faq}</section><section class="demo-site-section demo-contact" id="contact"><div><span class="demo-eyebrow">Start a conversation</span><h2>Ready when you are.</h2><p>Use the form to test the interaction. It never sends a message.</p><strong>${escapeHtml(content.contact || 'hello@fetman-demo.test')}</strong></div><form class="demo-form" data-demo-contact-form><label>Your name<input name="name" required minlength="2" placeholder="Alex Morgan"></label><label>Email address<input name="email" type="email" required placeholder="alex@example.test"></label><label>What can we help with?<textarea name="message" required minlength="10" placeholder="Tell us what you are exploring..."></textarea></label><button class="demo-primary-action" type="submit">Send simulated enquiry</button><p class="demo-feedback" data-demo-feedback role="status"></p></form></section><footer class="demo-site-footer"><strong>${escapeHtml(project.brand)}</strong><span>Concept demonstration · fictional content · no live transactions</span><span>${escapeHtml(content.contact || 'hello@fetman-demo.test')}</span></footer></div>`;
      };

      const renderPropertyCards = (properties, state) => {
        const query = (state.propertySearch || '').toLowerCase();
        const type = state.propertyType || 'all';
        const filtered = properties.filter(([name, details, price, propertyType]) => `${name} ${details}`.toLowerCase().includes(query) && (type === 'all' || propertyType === type));
        return filtered.length ? filtered.map(([name, details, price, propertyType]) => `<article class="demo-content-card demo-property-card"><div class="demo-property-image"><span>${escapeHtml(propertyType)}</span></div><span class="demo-card-detail">${escapeHtml(propertyType)}</span><h3>${escapeHtml(name)}</h3><p>${escapeHtml(details)}</p><strong>${escapeHtml(price)}</strong><button class="demo-inline-action" type="button" data-demo-item-action="${escapeAttribute(name)}">Request fictional viewing <span aria-hidden="true">↗</span></button></article>`).join('') : '<p class="demo-empty">No properties match those filters. Try a broader search.</p>';
      };

      const renderProductCards = (products, state) => products.map(([name, description, price, category, stock]) => `<article class="demo-content-card demo-product-card"><div class="demo-product-image"><span>${escapeHtml(category)}</span></div><span class="demo-card-detail">${escapeHtml(stock)}</span><h3>${escapeHtml(name)}</h3><p>${escapeHtml(description)}</p><strong>${escapeHtml(price)}</strong><button class="demo-inline-action" type="button" data-demo-add-product="${escapeAttribute(name)}">Add to simulated cart <span aria-hidden="true">+</span></button></article>`).join('');

      const renderManagementDemo = (project, content, state) => {
        const activeTab = state.activeTab || Object.keys(state.tabs)[0];
        const tab = state.tabs[activeTab];
        const searchValue = state.search || '';
        const records = (tab?.records || []).filter((record) => record.join(' ').toLowerCase().includes(searchValue.toLowerCase()));
        const rows = records.length ? records.map((record, index) => `<tr>${record.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}<td><button type="button" class="demo-table-action" data-demo-delete="${index}">Remove</button>${activeTab === 'Invoices' ? `<button type="button" class="demo-table-action" data-demo-print="${index}">Print</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="${(tab?.columns?.length || 1) + 1}><div class="demo-empty">No matching records. Add a record or reset the demonstration data.</div></td></tr>`;
        return `<div class="demo-management theme-${escapeAttribute(project.theme)}"><div class="demo-management-top"><div><span class="demo-eyebrow">${escapeHtml(content.subtitle)}</span><h2>${escapeHtml(project.name)}</h2><p>Interactive demonstration workspace · all edits stay in this browser only.</p></div><button type="button" class="demo-primary-action" data-demo-add-record>Add record</button></div><div class="demo-metrics">${content.metricLabels.map((label, index) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(content.metricValues[index])}</strong></article>`).join('')}</div><div class="demo-tabs" role="tablist">${Object.keys(state.tabs).map((tabName) => `<button type="button" role="tab" aria-selected="${tabName === activeTab}" class="${tabName === activeTab ? 'is-active' : ''}" data-demo-tab="${escapeAttribute(tabName)}">${escapeHtml(tabName)}</button>`).join('')}</div><div class="demo-toolbar"><label>Search records<input type="search" data-demo-search value="${escapeAttribute(searchValue)}" placeholder="Search this workspace"></label><span>${records.length} visible record${records.length === 1 ? '' : 's'}</span></div><div class="demo-table-wrap"><table class="demo-table"><thead><tr>${(tab?.columns || []).map((column) => `<th>${escapeHtml(column)}</th>`).join('')}<th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div><div class="demo-add-record-panel" data-demo-add-panel hidden><form data-demo-record-form><h3>Add a ${escapeHtml(activeTab.toLowerCase().replace(/s$/, ''))}</h3><div class="demo-record-fields">${(tab?.columns || []).map((column) => `<label>${escapeHtml(column)}<input name="${escapeAttribute(column)}" required></label>`).join('')}</div><button class="demo-primary-action" type="submit">Save locally</button><p class="demo-feedback" data-demo-feedback role="status"></p></form></div></div>`;
      };

      const bindDemoInteractions = () => {
        root.querySelectorAll('[data-demo-scroll]').forEach((button) => button.addEventListener('click', () => root.querySelector(`#${button.dataset.demoScroll}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
        root.querySelectorAll('[data-demo-contact-form]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); form.reset(); form.querySelector('[data-demo-feedback]').textContent = 'Thank you — this simulated enquiry is recorded only in the demonstration view.'; }));
        root.querySelectorAll('[data-demo-item-action]').forEach((button) => button.addEventListener('click', () => { const feedback = root.querySelector('[data-demo-feedback]') || root.querySelector('.demo-contact'); if (feedback) feedback.textContent = `${button.dataset.demoItemAction} selected for a simulated enquiry.`; }));
        root.querySelector('[data-property-search]')?.addEventListener('input', (event) => { currentState.propertySearch = event.target.value; save(); render(); });
        root.querySelector('[data-property-type]')?.addEventListener('change', (event) => { currentState.propertyType = event.target.value; save(); render(); });
        root.querySelectorAll('[data-demo-add-product]').forEach((button) => button.addEventListener('click', () => { currentState.cart ||= []; currentState.cart.push(button.dataset.demoAddProduct); save(); render(); }));
        root.querySelector('[data-demo-checkout]')?.addEventListener('click', () => { const feedback = root.querySelector('[data-demo-feedback]') || root.querySelector('[data-demo-cart]'); if (feedback) feedback.textContent = 'Simulated checkout ready — no payment or order has been created.'; });
        root.querySelectorAll('[data-demo-tab]').forEach((button) => button.addEventListener('click', () => { currentState.activeTab = button.dataset.demoTab; currentState.search = ''; save(); render(); }));
        root.querySelector('[data-demo-search]')?.addEventListener('input', (event) => { currentState.search = event.target.value; save(); render(); });
        root.querySelector('[data-demo-add-record]')?.addEventListener('click', () => { const panel = root.querySelector('[data-demo-add-panel]'); if (panel) panel.hidden = !panel.hidden; });
        root.querySelector('[data-demo-record-form]')?.addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget; const values = [...form.querySelectorAll('input')].map((input) => input.value.trim()); if (values.some((value) => !value)) return; currentState.tabs[currentState.activeTab].records.push(values); save(); render(); });
        root.querySelectorAll('[data-demo-delete]').forEach((button) => button.addEventListener('click', () => { currentState.tabs[currentState.activeTab].records.splice(Number(button.dataset.demoDelete), 1); save(); render(); }));
        root.querySelectorAll('[data-demo-print]').forEach((button) => button.addEventListener('click', () => { const record = currentState.tabs.Invoices.records[Number(button.dataset.demoPrint)]; const panel = document.createElement('div'); panel.className = 'demo-print-panel'; panel.innerHTML = `<h2>Printable invoice preview</h2><p><strong>${escapeHtml(record[0])}</strong><br>${escapeHtml(record[1])}</p><p>Amount due: <strong>${escapeHtml(record[3])}</strong><br>Status: ${escapeHtml(record[4])}</p><button type="button" class="demo-primary-action" data-demo-print-close>Close preview</button>`; root.append(panel); panel.querySelector('[data-demo-print-close]').addEventListener('click', () => panel.remove()); }));
      };
      shell.querySelectorAll('[data-demo-close]').forEach((element) => element.addEventListener('click', close));
      resetButton?.addEventListener('click', reset);
      document.addEventListener('keydown', (event) => {
        if (shell.hidden) return;
        if (event.key === 'Escape') close();
        if (event.key === 'Tab') trapDialogFocus(event, shell);
      });
      return { open };
    };
    const demoExperience = createDemoExperience();

    const trapDialogFocus = (event, dialog) => {
      const focusable = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };

    const renderPreviewBody = (project) => {
      if (project.layout === 'dashboard') return `<div class="concept-dashboard-preview"><div class="concept-dashboard-side"><b>${escapeHtml(project.brand)}</b><span>Overview</span><span>Records</span><span>Reports</span></div><div class="concept-dashboard-main"><span>${escapeHtml(project.eyebrow)}</span><h4>${escapeHtml(project.headline)}</h4><div class="concept-dashboard-stats"><i></i><i></i><i></i></div><div class="concept-dashboard-table"><i></i><i></i><i></i><i></i></div></div></div>`;
      if (project.layout === 'kanban') return `<div class="concept-kanban-preview"><span>${escapeHtml(project.eyebrow)}</span><h4>${escapeHtml(project.headline)}</h4><div class="concept-kanban-columns"><i><b>To do</b><em></em><em></em></i><i><b>In progress</b><em></em><em></em></i><i><b>Complete</b><em></em></i></div></div>`;
      if (project.layout === 'support') return `<div class="concept-support-preview"><div><span>${escapeHtml(project.eyebrow)}</span><h4>${escapeHtml(project.headline)}</h4></div><div class="concept-support-ticket"><b>Open requests</b><i></i><i></i><i></i></div></div>`;
      if (project.layout === 'commerce') return `<div class="concept-commerce-preview"><span>${escapeHtml(project.eyebrow)}</span><h4>${escapeHtml(project.headline)}</h4><div><i></i><i></i><i></i></div><em>${escapeHtml(project.cta)} <b>↗</b></em></div>`;
      if (['events', 'booking', 'portal'].includes(project.layout)) return `<div class="concept-experience-preview"><div><span>${escapeHtml(project.eyebrow)}</span><h4>${escapeHtml(project.headline)}</h4><em>${escapeHtml(project.cta)} <b>↗</b></em></div><i></i><i></i></div>`;
      return `<div class="concept-site-hero"><span>${escapeHtml(project.eyebrow)}</span><h4>${escapeHtml(project.headline)}</h4><p>Thoughtfully made for people who notice the details.</p><em>${escapeHtml(project.cta)} <b>↗</b></em></div><div class="concept-site-grid"><span></span><span></span><span></span></div>`;
    };

    const renderConceptPreview = (project, large = false) => `<div class="concept-browser-window layout-${project.layout} theme-${project.theme}${large ? ' is-large' : ''}">
      <div class="concept-browser-bar"><span class="concept-browser-dots"><i></i><i></i><i></i></span><span class="concept-browser-address">${escapeHtml(project.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}.concept</span><span class="concept-browser-mark">FD</span></div>
      <div class="concept-site-shell">
        <div class="concept-site-nav"><strong>${escapeHtml(project.brand)}</strong><span>About&nbsp;&nbsp;&nbsp; Services&nbsp;&nbsp;&nbsp; Journal</span><b>↗</b></div>
        ${renderPreviewBody(project)}
      </div>
    </div>`;

    const renderTabs = () => {
      tabs.innerHTML = PORTFOLIO_CATEGORIES.map((category) => `<button class="website-portfolio-tab${category.id === activeCategory ? ' is-active' : ''}" type="button" role="tab" aria-selected="${category.id === activeCategory}" aria-controls="website-portfolio-grid" data-website-category="${escapeAttribute(category.id)}">${escapeHtml(category.label)}</button>`).join('');
      tabs.querySelectorAll('[data-website-category]').forEach((button, index, buttons) => {
        button.addEventListener('click', () => {
          activeCategory = button.dataset.websiteCategory;
          renderTabs();
          renderProjects();
          tabs.querySelector(`[data-website-category="${activeCategory}"]`)?.focus();
        });
        button.addEventListener('keydown', (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[nextIndex].focus();
          buttons[nextIndex].click();
        });
      });
    };

    const openProject = (project) => {
      activeProject = project;
      lastFocusedElement = document.activeElement;
      modal.querySelector('[data-website-portfolio-modal-title]').textContent = project.name;
      modal.querySelector('[data-website-portfolio-modal-description]').textContent = `${project.type} · ${project.description} This is a fictional concept demonstration.`;
      modal.querySelector('[data-website-portfolio-modal-preview]').innerHTML = renderConceptPreview(project, true);
      modal.hidden = false;
      document.body.classList.add('website-portfolio-modal-open');
      modal.querySelector('.website-portfolio-modal-close')?.focus();
    };

    const closeProject = () => {
      modal.hidden = true;
      document.body.classList.remove('website-portfolio-modal-open');
      modal.querySelector('[data-website-portfolio-modal-preview]').replaceChildren();
      lastFocusedElement?.focus?.();
    };

    const renderProjects = () => {
      const category = PORTFOLIO_CATEGORIES.find((item) => item.id === activeCategory);
      const visibleProjects = category ? PORTFOLIO_PROJECTS.filter((project) => project.category === category.label) : [];
      grid.innerHTML = visibleProjects.map((project) => `<article class="website-portfolio-card-wrap"><button class="website-portfolio-card" type="button" aria-label="Open concept preview for ${escapeAttribute(project.name)}" data-website-project="${escapeAttribute(project.id)}"><span class="website-portfolio-card-preview">${renderConceptPreview(project)}</span><span class="website-portfolio-card-copy"><span class="website-portfolio-card-meta"><span>${escapeHtml(project.category)}</span><span>${escapeHtml(project.type)}</span></span><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.description)}</span><em>Open concept <b aria-hidden="true">↗</b></em></span></button></article>`).join('');
      grid.querySelectorAll('[data-website-project]').forEach((button) => button.addEventListener('click', () => openProject(PORTFOLIO_PROJECTS.find((project) => project.id === button.dataset.websiteProject))));
    };

    modal.querySelectorAll('[data-website-portfolio-close]').forEach((element) => element.addEventListener('click', closeProject));
    modal.querySelector('[data-website-demo-open]')?.addEventListener('click', () => {
      if (!activeProject) return;
      closeProject();
      demoExperience?.open(activeProject);
    });
    document.addEventListener('keydown', (event) => {
      if (!modal.hidden && event.key === 'Escape') closeProject();
      if (!modal.hidden && event.key === 'Tab') trapDialogFocus(event, modal);
    });
    renderTabs();
    renderProjects();
  }

  createWebsitePortfolioPrototype();

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' }[character])); }
  function graphicCategoryBucket(value) { const category = String(value || '').toLowerCase(); if (category.includes('logo')) return 'logos'; if (category.includes('poster')) return 'posters'; if (category.includes('social')) return 'social media'; if (category.includes('packag')) return 'packaging'; if (category.includes('campaign')) return 'campaigns'; return category.includes('brand') || category.includes('identity') ? 'branding' : category; }
  function escapeAttribute(value) { return escapeHtml(value); }
  function isHttpUrl(value) { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } }
  function isImageUrl(value) { return isHttpUrl(value) || (value.startsWith('/') && !value.startsWith('//')); }
})();
