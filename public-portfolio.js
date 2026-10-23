(() => {
    const filterButtons = document.querySelectorAll(".filter-btn");
    const searchBar = document.getElementById("search-bar");
    const portfolioGrid = document.querySelector("#portfolio .row");
    const portfolioStatus = document.getElementById("portfolio-source-status");
    let activeFilter = "all";

    if (!searchBar || !portfolioGrid) return;

    const entranceObserver = "IntersectionObserver" in window
        ? new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-visible");
                    entranceObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 })
        : null;

    function preparePortfolioCard(element, index) {
        element.style.setProperty("--portfolio-order", String(index % 5));
        const cardBody = element.querySelector(".card-body");
        const cardTitle = element.querySelector(".card-title");
        let categoryText = cardBody.querySelector(".portfolio-category");
        if (!categoryText) {
            categoryText = document.createElement("p");
            categoryText.className = "portfolio-category";
            categoryText.setAttribute("aria-label", "Category");
            cardBody.insertBefore(categoryText, cardTitle);
        }
        const category = element.classList.contains("logo")
            ? "logo"
            : element.classList.contains("print")
                ? "print"
                : "branding";
        categoryText.textContent = categoryLabel(category);
        const image = element.querySelector("img");
        image.sizes = "(max-width: 767px) calc(100vw - 48px), (max-width: 1199px) calc((100vw - 80px) / 2), (max-width: 1399px) calc((100vw - 96px) / 2), 640px";
        if (entranceObserver && !element.classList.contains("is-visible")) {
            element.classList.add("reveal");
            entranceObserver.observe(element);
        }
    }

    function categoryLabel(category) {
        return ({ logo: "Logo design", branding: "Branding", print: "Print" })[category] || "Branding";
    }

    [...portfolioGrid.querySelectorAll(".portfolio-item")].forEach(preparePortfolioCard);

    function setPortfolioStatus(source, message) {
        if (!portfolioStatus) return;
        portfolioStatus.dataset.source = source;
        portfolioStatus.textContent = message;
    }

    function updatePortfolio() {
        const query = searchBar.value.trim().toLowerCase();

        portfolioGrid.querySelectorAll(".portfolio-item").forEach(item => {
            const matchesCategory = activeFilter === "all" || item.classList.contains(activeFilter);
            const matchesSearch = item.textContent.toLowerCase().includes(query);
            item.hidden = !matchesCategory || !matchesSearch;
        });
    }

    searchBar.addEventListener("input", updatePortfolio);
    filterButtons.forEach(button => {
        button.addEventListener("click", () => {
            activeFilter = button.dataset.filter;
            filterButtons.forEach(filterButton => {
                const isActive = filterButton === button;
                filterButton.classList.toggle("btn-primary", isActive);
                filterButton.classList.toggle("btn-outline-primary", !isActive);
                filterButton.setAttribute("aria-pressed", String(isActive));
            });
            updatePortfolio();
        });
        button.setAttribute("aria-pressed", String(button.dataset.filter === activeFilter));
    });

    updatePortfolio();

    function renderPortfolioTags(cardBody, tags) {
        cardBody.querySelector(".portfolio-tags")?.remove();
        if (!Array.isArray(tags) || tags.length === 0) return;
        const tagList = document.createElement("p");
        tagList.className = "portfolio-tags";
        tagList.textContent = tags.join(" · ");
        cardBody.append(tagList);
    }

    function updatePortfolioCard(element, project, portfolioUrl) {
        const category = ["logo", "branding", "print"].includes(project.category)
            ? project.category
            : "branding";
        element.classList.remove("logo", "branding", "print");
        element.classList.add(category);
        element.dataset.cmsKey = project.source_key || `content-${project.id}`;

        const title = element.querySelector(".card-title");
        const description = element.querySelector(".card-text");
        const image = element.querySelector("img");
        title.textContent = project.title;
        description.textContent = project.description;
        const altText = project.alt_text.trim();
        image.alt = altText && !["logo design", "branding", "print"].includes(altText.toLowerCase())
            ? altText
            : project.title;
        let imageUrl = "";
        if (project.asset_id) {
            imageUrl = new URL(`/api/public/design-assets/${encodeURIComponent(project.asset_id)}`, portfolioUrl).href;
        } else if (project.legacy_image_url) {
            imageUrl = new URL(project.legacy_image_url, window.location.href).href;
        }
        if (imageUrl && image.src !== imageUrl) {
            image.src = imageUrl;
            image.removeAttribute("srcset");
            image.removeAttribute("sizes");
        } else if (!imageUrl) {
            image.removeAttribute("src");
            image.removeAttribute("srcset");
            image.removeAttribute("sizes");
        }
        const cardBody = element.querySelector(".card-body");
        let categoryText = cardBody.querySelector(".portfolio-category");
        if (!categoryText) {
            categoryText = document.createElement("p");
            categoryText.className = "portfolio-category";
            categoryText.setAttribute("aria-label", "Category");
            cardBody.insertBefore(categoryText, title);
        }
        categoryText.textContent = categoryLabel(category);
        element.classList.toggle("is-featured", project.featured === true);
        renderPortfolioTags(cardBody, project.tags);
        return element;
    }

    function createPortfolioCard(project, portfolioUrl) {
        const element = document.createElement("div");
        element.className = "col-md-4 portfolio-item";
        const card = document.createElement("div");
        card.className = "card";
        const image = document.createElement("img");
        image.className = "card-img-top";
        image.width = 1200;
        image.height = 900;
        image.loading = "lazy";
        image.decoding = "async";
        const body = document.createElement("div");
        body.className = "card-body";
        const title = document.createElement("h5");
        title.className = "card-title";
        const description = document.createElement("p");
        description.className = "card-text";
        body.append(title, description);
        card.append(image, body);
        element.append(card);
        return updatePortfolioCard(element, project, portfolioUrl);
    }

    function isCompletePortfolio(result, existingCards) {
        if (
            result?.complete !== true ||
            !Array.isArray(result.projects) ||
            !Array.isArray(result.managedLegacyKeys) ||
            !Array.isArray(result.retiredLegacyKeys) ||
            result.managedLegacyKeys.some(key => typeof key !== "string")
        ) return false;

        const managedKeys = new Set(result.managedLegacyKeys);
        if (managedKeys.size !== result.managedLegacyKeys.length) return false;
        if (managedKeys.size && [...existingCards.keys()].some(key => key.startsWith("legacy-") && !managedKeys.has(key))) return false;
        if (result.retiredLegacyKeys.some(key => !managedKeys.has(key))) return false;

        const projectKeys = new Set();
        return result.projects.every(project => {
            if (
                !project ||
                project.type !== "portfolio" ||
                typeof project.title !== "string" ||
                typeof project.description !== "string" ||
                typeof project.alt_text !== "string" ||
                typeof project.category !== "string" ||
                !Array.isArray(project.tags) ||
                !project.tags.every(tag => typeof tag === "string") ||
                !(typeof project.id === "number" && Number.isSafeInteger(project.id) && project.id > 0) ||
                !(project.source_key === null || typeof project.source_key === "string") ||
                !(project.asset_id === null || typeof project.asset_id === "string" || typeof project.asset_id === "number") ||
                !(project.legacy_image_url === null || typeof project.legacy_image_url === "string") ||
                !(project.featured === undefined || typeof project.featured === "boolean")
            ) return false;
            const key = project.source_key || `content-${project.id}`;
            if (projectKeys.has(key)) return false;
            projectKeys.add(key);
            return true;
        });
    }

    async function loadPublishedPortfolio() {
        const configuredBase = document.querySelector('meta[name="design-api-base"]')?.content.trim().replace(/\/+$/, "") || "";
        try {
            const localSite =
                window.location.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
            const defaultBase = localSite
                ? "http://127.0.0.1:3000"
                : window.location.origin;
            const apiBase = new URL(configuredBase || defaultBase);
            const localHttp = apiBase.protocol === "http:" && ["localhost", "127.0.0.1"].includes(apiBase.hostname);
            if ((apiBase.protocol !== "https:" && !localHttp) || apiBase.pathname !== "/" || apiBase.search || apiBase.hash) {
                throw new Error("The public design API must use an HTTPS origin.");
            }
            const portfolioUrl = new URL("/api/public/design-portfolio", apiBase);
            const response = await fetch(portfolioUrl, {
                headers: { Accept: "application/json" },
                credentials: "omit",
                cache: "no-store",
            });
            if (!response.ok) throw new Error(`Portfolio request failed with ${response.status}`);
            const result = await response.json();
            const existingCards = new Map(
                [...portfolioGrid.querySelectorAll("[data-cms-key]")].map(card => [card.dataset.cmsKey, card]),
            );
            if (!isCompletePortfolio(result, existingCards)) throw new Error("Portfolio response was incomplete");
            [...portfolioGrid.querySelectorAll(".portfolio-item")].forEach(preparePortfolioCard);
            const managedKeys = new Set(result.managedLegacyKeys);
            const hasUnmanagedLegacyCards = [...existingCards.keys()].some(
                key => key.startsWith("legacy-") && !managedKeys.has(key),
            );

            for (const project of result.projects) {
                const key = project.source_key || `content-${project.id}`;
                const card = existingCards.get(key) || createPortfolioCard(project, portfolioUrl);
                if (!existingCards.has(key)) preparePortfolioCard(card, portfolioGrid.children.length);
                updatePortfolioCard(card, project, portfolioUrl);
                portfolioGrid.append(card);
            }
            for (const key of result.retiredLegacyKeys) existingCards.get(key)?.remove();
            updatePortfolio();
            if (hasUnmanagedLegacyCards) {
                setPortfolioStatus(
                    result.projects.length > 0 ? "mixed" : "fallback",
                    result.projects.length > 0
                        ? "Published projects loaded. Saved legacy portfolio cards remain until managed."
                        : "No published CMS projects are available; showing the saved website portfolio.",
                );
            } else if (result.projects.length > 0) {
                setPortfolioStatus("live", "Live published portfolio loaded from the management API.");
            } else {
                setPortfolioStatus("live", "Portfolio connected; no projects are currently published.");
            }
        } catch (error) {
            console.warn("Published portfolio is unavailable; showing the saved website portfolio.", error);
            setPortfolioStatus("fallback", "Live portfolio unavailable; showing the saved website portfolio.");
        }
    }

    setPortfolioStatus("loading", "Loading published portfolio from the management API…");
    void loadPublishedPortfolio();
})();
