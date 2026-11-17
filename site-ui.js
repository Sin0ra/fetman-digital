(() => {
  document.body.classList.add('js-ready');
  const navToggle = document.querySelector('[data-nav-toggle]');
  const navLinks = document.querySelector('[data-nav-links]');
  navToggle?.addEventListener('click', () => {
    const open = navLinks?.classList.toggle('is-open') || false;
    navToggle.setAttribute('aria-expanded', String(open));
  });
  navLinks?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    navLinks.classList.remove('is-open');
    navToggle?.setAttribute('aria-expanded', 'false');
  }));

  const legacyRoutes = { pricing: 'pricing.html', contact: 'contact.html', 'it-division': 'it-services.html' };
  const legacyHash = window.location.hash.slice(1);
  if (legacyRoutes[legacyHash] && !document.getElementById(legacyHash)) window.location.replace(legacyRoutes[legacyHash]);

  const year = document.querySelector('[data-current-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  const revealTargets = document.querySelectorAll('.section-heading, .about-grid, .service-feature, .process-step, .portfolio-item, .contact-grid');
  revealTargets.forEach((node) => node.classList.add('reveal'));
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries, instance) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        instance.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealTargets.forEach((node) => observer.observe(node));
  } else {
    revealTargets.forEach((node) => node.classList.add('is-visible'));
  }

  async function loadEditableContent() {
    try {
      const response = await fetch('/api/public/site-content', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return;
      const { content } = await response.json();
      const setText = (id, value) => { const node = document.getElementById(id); if (node && value) node.textContent = value; };
      setText('hero-title', content.heroTitle);
      setText('hero-description', content.heroDescription);
      setText('about-description', content.aboutDescription);
      setText('hero-primary-cta', content.primaryCta);
      if (Array.isArray(content.services)) content.services.forEach((description, index) => setText(`service-description-${index + 1}`, description));
      if (content.contactEmail) document.querySelectorAll('[data-contact-email]').forEach((node) => { node.textContent = content.contactEmail; node.href = `mailto:${content.contactEmail}`; });
      if (content.contactWhatsapp) document.querySelectorAll('[data-contact-whatsapp]').forEach((node) => { const phone = content.contactWhatsapp.replace(/\D/g, ''); node.textContent = phone; node.href = `tel:${phone}`; });
    } catch { /* Static fallback content remains visible when the API is unavailable. */ }
  }
  void loadEditableContent();

  const form = document.getElementById('projectEnquiryForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const error = form.querySelector('[data-enquiry-error]');
    const success = form.querySelector('[data-enquiry-success]');
    const button = form.querySelector('button[type="submit"]');
    if (error) { error.hidden = true; error.textContent = ''; }
    if (success) success.hidden = true;
    if (button) { button.disabled = true; button.textContent = 'Sending…'; }
    try {
      const business = String(data.get('business') || '').trim();
      const message = String(data.get('project') || '').trim();
      const response = await fetch('/api/public/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ fullName: String(data.get('name') || '').trim(), email: String(data.get('email') || '').trim(), service: String(data.get('service') || '').trim(), message: `${business ? `Business: ${business}\n\n` : ''}${message}`, website: String(data.get('website') || '').trim() }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Unable to send your enquiry.');
      form.reset();
      if (success) success.hidden = false;
    } catch (submissionError) {
      if (error) { error.textContent = submissionError instanceof Error ? submissionError.message : 'Unable to send your enquiry.'; error.hidden = false; }
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Send enquiry'; }
    }
  });
})();
