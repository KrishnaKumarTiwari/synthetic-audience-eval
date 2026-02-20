// ==========================================
// SAEP Prototype — Main Application
// ==========================================

import {
  campaign as defaultCampaign,
  segments,
  seoQueries,
  frictionPoints,
  overallResults,
  personaBreakdown,
  pipelineStages,
  recentCampaigns,
  simulationLogs,
  keyInsights,
  trendData,
  notifications,
  observabilityData,
  syntheticPersonas,
} from './mock-data.js';
import { fetchProduct as fetchProductPage } from './product-scraper.js';

// --- State ---
let currentView = null;
let selectedCampaign = null;
const campaign = { ...defaultCampaign };
let simulationConfig = {
  url: campaign.url,
  segment: 'all',
  personaCount: 500,
  budget: 250,
};
let elapsedTimerInterval = null;
let navigateTimer = null;
let runBtnTimer = null;

// Product fetch state
let productFetchState = 'idle'; // 'idle' | 'loading' | 'loaded' | 'error'
let productData = null;
let productError = null;
let fetchDebounceTimer = null;
let fetchAbortController = null;

// --- DOM refs ---
const content = document.getElementById('content');
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const breadcrumbPage = document.getElementById('breadcrumb-page');
const breadcrumbProduct = document.getElementById('breadcrumb-product');
const navItems = document.querySelectorAll('.nav-item');
const toastContainer = document.getElementById('toast-container');

// --- Sidebar: Recent Campaigns ---
function renderRecentCampaigns() {
  const el = document.getElementById('recent-campaigns');
  if (!el) return;
  el.innerHTML = recentCampaigns.map((c) => `
    <button class="recent-campaign-item" title="${c.product}">
      <span class="recent-campaign-name">${c.product}</span>
      <span class="recent-campaign-meta">
        ${c.date} &middot; <span class="recent-campaign-score">${c.score}/10</span>
      </span>
    </button>
  `).join('');

  el.querySelectorAll('.recent-campaign-item').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      selectedCampaign = recentCampaigns[i];
      navigate('results');
    });
  });
}

// --- Sidebar: Collapse ---
const collapseBtn = document.getElementById('sidebar-collapse');
const sidebar = document.getElementById('sidebar');
if (collapseBtn) {
  collapseBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });
}

// --- Keyboard Shortcuts ---
// (Handled by handleKeyboardShortcuts registered below)

// --- Utilities ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function animateValue(el, start, end, duration, suffix = '') {
  const startTime = performance.now();
  const isFloat = String(end).includes('.');

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + (end - start) * eased;
    el.textContent = (isFloat ? current.toFixed(1) : Math.round(current)) + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-dismiss');
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// --- Product Fetching ---
function updateProductPreview() {
  const imageEl = document.querySelector('.product-preview-image');
  const nameEl = document.querySelector('.product-preview-name');
  const subtitleEl = document.querySelector('.product-preview-subtitle');
  const brandEl = document.querySelector('.product-preview-brand');
  const priceEl = document.querySelector('.product-preview-price');
  const colorEl = document.querySelector('.product-preview-color');
  const styleEl = document.querySelector('.product-preview-style-code');
  const availEl = document.querySelector('.product-preview-availability');
  const descEl = document.querySelector('.product-preview-description');

  if (!imageEl) return;

  // Helper: clear the detail fields
  function clearDetails() {
    if (subtitleEl) subtitleEl.textContent = '';
    if (priceEl) priceEl.textContent = '';
    if (colorEl) colorEl.textContent = '';
    if (styleEl) styleEl.textContent = '';
    if (availEl) availEl.remove();
    if (descEl) descEl.textContent = '';
  }

  if (productFetchState === 'loading') {
    imageEl.innerHTML = '<div class="spinner" style="width:28px;height:28px;border-width:3px;color:var(--accent-light)"></div>';
    imageEl.classList.remove('product-fetch-error');
    imageEl.classList.add('product-fetch-loading');
    if (nameEl) nameEl.innerHTML = '<span class="skeleton" style="display:inline-block;width:180px;height:18px;"></span>';
    if (brandEl) brandEl.innerHTML = '<span class="skeleton" style="display:inline-block;width:120px;height:14px;"></span>';
    clearDetails();
    return;
  }

  imageEl.classList.remove('product-fetch-loading', 'product-fetch-error');

  if (productFetchState === 'error') {
    imageEl.innerHTML = '<span style="font-size:24px;">&#9888;</span>';
    imageEl.classList.add('product-fetch-error');
    if (nameEl) nameEl.textContent = 'Failed to load product';
    if (brandEl) brandEl.innerHTML = `<span style="color:var(--danger);font-size:12px;">${productError}</span>`;
    clearDetails();
    return;
  }

  if (productFetchState === 'loaded' && productData) {
    if (productData.image) {
      imageEl.innerHTML = `<img src="${productData.image}" alt="${productData.name}" />`;
    } else {
      imageEl.innerHTML = '&#128095;';
    }
    if (nameEl) nameEl.textContent = productData.name;
    if (subtitleEl) subtitleEl.textContent = productData.subtitle || '';
    if (brandEl) brandEl.textContent = `${productData.brand} \u00b7 ${productData.category}`;
    if (priceEl) priceEl.textContent = productData.price ? `$${productData.price}` : '';
    if (colorEl) colorEl.textContent = productData.colorDescription || '';
    if (styleEl) styleEl.textContent = productData.styleColor || '';
    // Insert availability badge if not already present
    const detailsRow = document.querySelector('.product-preview-details-row');
    if (detailsRow && !detailsRow.querySelector('.product-preview-availability')) {
      const badge = document.createElement('span');
      badge.className = `product-preview-availability ${productData.isAvailable !== false ? 'in-stock' : 'out-of-stock'}`;
      badge.textContent = productData.isAvailable !== false ? 'In Stock' : 'Out of Stock';
      detailsRow.appendChild(badge);
    }
    if (descEl) {
      const desc = productData.description || '';
      descEl.textContent = desc.length > 180 ? desc.slice(0, 180) + '...' : desc;
    }
    if (breadcrumbProduct) breadcrumbProduct.textContent = productData.name;
    return;
  }

  // idle — show defaults
  imageEl.innerHTML = '&#128095;';
  if (nameEl) nameEl.textContent = campaign.name;
  if (brandEl) brandEl.textContent = `${campaign.brand} \u00b7 ${campaign.category}`;
  clearDetails();
}

async function fetchProduct(url) {
  // Abort any previous in-flight fetch
  if (fetchAbortController) {
    fetchAbortController.abort();
  }
  fetchAbortController = new AbortController();

  productFetchState = 'loading';
  productData = null;
  productError = null;
  updateProductPreview();

  try {
    // Timeout after 10s to prevent hung proxy
    const controller = fetchAbortController;
    const timeoutId = setTimeout(() => controller?.abort(), 10000);
    const data = await fetchProductPage(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    productData = data;
    productFetchState = 'loaded';

    // Update campaign object so simulation/results use real data
    campaign.name = data.fullTitle || data.name;
    campaign.brand = data.brand;
    campaign.category = data.category;
    campaign.url = url;
  } catch (err) {
    if (err.name === 'AbortError') {
      // Reset to idle so the dashboard can retry on next visit
      productFetchState = productData ? 'loaded' : 'idle';
      return;
    }
    productFetchState = 'error';
    productError = err.message;
  } finally {
    fetchAbortController = null;
  }

  updateProductPreview();
}

function debouncedFetchProduct(url) {
  if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer);
  fetchDebounceTimer = setTimeout(() => fetchProduct(url), 600);
}

// --- Routing ---
let navigateId = 0;

function navigate(view) {
  if (currentView === view && content.innerHTML !== '') return;
  currentView = view;

  // Cancel any pending navigate timeout to prevent stale renders
  if (navigateTimer) {
    clearTimeout(navigateTimer);
    navigateTimer = null;
  }

  // Clear timers
  if (elapsedTimerInterval) {
    clearInterval(elapsedTimerInterval);
    elapsedTimerInterval = null;
  }

  // Clear pipeline log timer (set by runPipeline)
  if (pipelineLogTimer) {
    clearInterval(pipelineLogTimer);
    pipelineLogTimer = null;
  }

  // Clear Run button delayed navigation
  if (runBtnTimer) {
    clearTimeout(runBtnTimer);
    runBtnTimer = null;
  }

  // Cancel any pending product fetch debounce
  if (fetchDebounceTimer) {
    clearTimeout(fetchDebounceTimer);
    fetchDebounceTimer = null;
  }

  // Abort any in-flight product fetch
  if (fetchAbortController) {
    fetchAbortController.abort();
    fetchAbortController = null;
  }

  navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  const viewConfig = {
    dashboard: {
      title: 'Campaign Setup',
      subtitle: 'Configure and launch your synthetic audience evaluation',
      breadcrumb: 'Setup',
    },
    simulation: {
      title: 'Simulation in Progress',
      subtitle: 'Running synthetic audience evaluation pipeline',
      breadcrumb: 'Simulation',
    },
    results: {
      title: 'Evaluation Results',
      subtitle: `${campaign.name} — ${overallResults.totalPersonas} synthetic personas evaluated`,
      breadcrumb: 'Results',
    },
    personas: {
      title: 'Synthetic Personas',
      subtitle: `${syntheticPersonas.length} AI-generated personas across ${segments.length} audience segments`,
      breadcrumb: 'Personas',
    },
    observability: {
      title: 'Observability',
      subtitle: 'LLM calls, token usage, cost breakdown, and cache performance',
      breadcrumb: 'Observability',
    },
  };

  // Reset selectedCampaign when navigating away from results
  if (view === 'dashboard' || view === 'simulation') {
    selectedCampaign = null;
  }

  const cfg = viewConfig[view];
  pageTitle.textContent = cfg.title;
  pageSubtitle.textContent = cfg.subtitle;
  if (breadcrumbPage) breadcrumbPage.textContent = cfg.breadcrumb;
  if (breadcrumbProduct) {
    breadcrumbProduct.textContent = selectedCampaign?.product || productData?.name || campaign.name;
  }

  // Hide content instantly (remove transition so opacity=0 applies immediately)
  content.style.transition = 'none';
  content.style.opacity = '0';
  content.style.transform = 'translateY(8px)';

  const thisNavId = ++navigateId;

  navigateTimer = setTimeout(() => {
    navigateTimer = null;

    // Bail out if a newer navigate happened while we were waiting
    if (thisNavId !== navigateId) return;

    const renderers = {
      dashboard: renderDashboard,
      personas: renderPersonasLibrary,
      simulation: renderSimulation,
      results: renderResults,
      observability: renderObservability,
    };

    try {
      if (renderers[view]) {
        renderers[view]();
      }
    } catch (err) {
      console.error('Render error:', err);
      content.innerHTML = `<div style="padding:40px;color:var(--danger);">Render error: ${err.message}</div>`;
    }

    // Always restore visibility, even if render threw
    requestAnimationFrame(() => {
      content.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      content.style.opacity = '1';
      content.style.transform = 'translateY(0)';
    });
  }, 150);
}

navItems.forEach((item) => {
  item.addEventListener('click', () => navigate(item.dataset.view));
});

// ==========================================
// View 1 — Dashboard (Campaign Setup)
// ==========================================
function renderDashboard() {
  const perPersonaCost = 0.48;
  const estTotal = (simulationConfig.personaCount * perPersonaCost).toFixed(0);

  content.innerHTML = `
    <div class="dashboard-grid view-enter">
      <!-- Product Preview -->
      <div class="card-hero full-width no-hover">
        <div class="product-preview">
          <div class="product-preview-image">${productData?.image ? `<img src="${productData.image}" alt="${productData.name}" />` : '&#128095;'}</div>
          <div class="product-preview-info">
            <div class="product-preview-name">${productData?.name || campaign.name}</div>
            <div class="product-preview-subtitle">${productData?.subtitle || ''}</div>
            <div class="product-preview-brand">${productData?.brand || campaign.brand} &middot; ${productData?.category || campaign.category}</div>
            <div class="product-preview-details-row">
              <span class="product-preview-price">${productData?.price ? `$${productData.price}` : ''}</span>
              <span class="product-preview-color">${productData?.colorDescription || ''}</span>
              <span class="product-preview-style-code">${productData?.styleColor || ''}</span>
              ${productData ? `<span class="product-preview-availability ${productData.isAvailable !== false ? 'in-stock' : 'out-of-stock'}">${productData.isAvailable !== false ? 'In Stock' : 'Out of Stock'}</span>` : ''}
            </div>
            <div class="product-preview-description">${productData?.description ? (productData.description.length > 180 ? productData.description.slice(0, 180) + '...' : productData.description) : ''}</div>
            <div class="product-preview-category">${simulationConfig.url}</div>
          </div>
        </div>
      </div>

      <!-- Step 1: Target -->
      <div class="card full-width no-hover">
        <div class="step-indicator"><div class="step-number">1</div><div class="step-label">Target</div></div>
        <div class="card-header">
          <div class="card-title">Campaign Target</div>
          <div class="card-subtitle">Enter the product URL to evaluate</div>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Product URL</label>
          <input class="form-input" type="url" id="url-input" value="${simulationConfig.url}" />
        </div>
      </div>

      <!-- Step 2: Audience -->
      <div class="card no-hover">
        <div class="step-indicator"><div class="step-number">2</div><div class="step-label">Audience</div></div>
        <div class="card-header">
          <div class="card-title">Audience Segment</div>
          <div class="card-subtitle">Select target persona group</div>
        </div>
        <div class="form-group">
          <label class="form-label">Segment</label>
          <select class="form-select" id="segment-select">
            <option value="all" ${simulationConfig.segment === 'all' ? 'selected' : ''}>All Segments (${syntheticPersonas.length} personas)</option>
            ${segments.map((s) => {
              const count = syntheticPersonas.filter((p) => p.segmentId === s.id).length;
              return `<option value="${s.id}" ${simulationConfig.segment === s.id ? 'selected' : ''}>${s.name} (${count} personas)</option>`;
            }).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Persona Count</label>
          <div class="form-range-wrapper">
            <input class="form-range" type="range" id="persona-slider" min="100" max="1000" step="50" value="${simulationConfig.personaCount}" />
            <span class="range-value" id="persona-value">${simulationConfig.personaCount}</span>
          </div>
        </div>
      </div>

      <!-- Step 3: Budget -->
      <div class="card no-hover">
        <div class="step-indicator"><div class="step-number">3</div><div class="step-label">Budget</div></div>
        <div class="card-header">
          <div class="card-title">Budget & Limits</div>
          <div class="card-subtitle">Set cost constraints for this run</div>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Budget Cap (USD)</label>
          <input class="form-input" type="number" id="budget-input" value="${simulationConfig.budget}" min="10" max="5000" step="10" />
        </div>
        <div class="cost-estimator" id="cost-estimator">
          <div class="cost-row"><span>Per persona cost</span><span>$${perPersonaCost.toFixed(2)}</span></div>
          <div class="cost-row"><span>Persona count</span><span id="cost-count">${simulationConfig.personaCount}</span></div>
          <div class="cost-total"><span>Estimated total</span><span id="cost-total">~$${estTotal}</span></div>
        </div>
      </div>

      <!-- Launch -->
      <div class="card full-width no-hover" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div class="card-title">Ready to Run</div>
          <div class="card-subtitle">Launch the synthetic audience evaluation pipeline</div>
        </div>
        <button class="btn btn-primary btn-lg" id="run-btn">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="6,3 18,10 6,17" fill="currentColor" stroke="none"/>
          </svg>
          Run Simulation
        </button>
      </div>

      <!-- Recent Simulations Table -->
      <div class="card full-width no-hover">
        <div class="card-header">
          <div class="card-title">Recent Simulations</div>
          <div class="card-subtitle">Past evaluation runs</div>
        </div>
        <table class="recent-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Date</th>
              <th>Score</th>
              <th>Personas</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${recentCampaigns.map((c) => `
              <tr class="recent-row">
                <td style="font-weight:500">${c.product}</td>
                <td style="color:var(--text-secondary)">${c.date}</td>
                <td>
                  <span class="score-inline">
                    <span class="score-dot ${c.score >= 7.5 ? 'good' : c.score >= 7 ? 'ok' : 'bad'}"></span>
                    ${c.score}/10
                  </span>
                </td>
                <td style="color:var(--text-secondary)">${c.personaCount}</td>
                <td><span class="status-completed">${c.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Bind events — null-guard every element since DOM may not match expectations
  const slider = document.getElementById('persona-slider');
  const sliderVal = document.getElementById('persona-value');
  const costCount = document.getElementById('cost-count');
  const costTotal = document.getElementById('cost-total');
  const perCost = 0.48;

  if (slider) {
    slider.addEventListener('input', () => {
      simulationConfig.personaCount = parseInt(slider.value);
      if (sliderVal) sliderVal.textContent = slider.value;
      if (costCount) costCount.textContent = slider.value;
      if (costTotal) costTotal.textContent = `~$${(parseInt(slider.value) * perCost).toFixed(0)}`;
    });
  }

  const urlInput = document.getElementById('url-input');
  if (urlInput) {
    urlInput.addEventListener('input', (e) => {
      simulationConfig.url = e.target.value;
      debouncedFetchProduct(e.target.value);
    });
    urlInput.addEventListener('change', (e) => {
      simulationConfig.url = e.target.value;
    });
  }

  const segmentSelect = document.getElementById('segment-select');
  if (segmentSelect) {
    segmentSelect.addEventListener('change', (e) => {
      simulationConfig.segment = e.target.value;
    });
  }

  const budgetInput = document.getElementById('budget-input');
  if (budgetInput) {
    budgetInput.addEventListener('change', (e) => {
      simulationConfig.budget = parseFloat(e.target.value);
    });
  }

  const runBtn = document.getElementById('run-btn');
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      runBtn.disabled = true;
      runBtn.innerHTML = '<div class="spinner"></div> Starting...';
      runBtnTimer = setTimeout(() => {
        runBtnTimer = null;
        navigate('simulation');
      }, 800);
    });
  }

  document.querySelectorAll('.recent-row').forEach((row, i) => {
    row.addEventListener('click', () => {
      selectedCampaign = recentCampaigns[i];
      navigate('results');
    });
  });

  // Fetch product only on first ever load — skip if already attempted
  if (productFetchState === 'idle' && simulationConfig.url) {
    fetchProduct(simulationConfig.url);
  }
}

// ==========================================
// View — Personas Library
// ==========================================
let personasFilter = 'all';
let personasSearch = '';

function renderPersonasLibrary() {
  const segCounts = segments.map((s) => ({
    ...s,
    count: syntheticPersonas.filter((p) => p.segmentId === s.id).length,
  }));

  content.innerHTML = `
    <div class="view-enter" style="max-width:1100px;">
      <!-- Header: filters + search -->
      <div class="persona-lib-header">
        <div class="persona-lib-filters">
          <button class="persona-lib-filter-chip ${personasFilter === 'all' ? 'active' : ''}" data-filter="all">All (${syntheticPersonas.length})</button>
          ${segCounts.map((s) => `
            <button class="persona-lib-filter-chip ${personasFilter === s.id ? 'active' : ''}" data-filter="${s.id}">${s.name} (${s.count})</button>
          `).join('')}
        </div>
        <input class="persona-lib-search" type="text" placeholder="Search personas..." value="${personasSearch}" id="persona-search" />
      </div>

      <!-- Stats -->
      <div class="persona-lib-stats">
        <div><span>${syntheticPersonas.length}</span> total personas</div>
        ${segCounts.map((s) => `<div><span>${s.count}</span> ${s.name}</div>`).join('')}
        <div style="margin-left:auto;color:var(--accent-light);font-weight:600;font-size:11px;">AI* All personas are synthetically generated</div>
      </div>

      <!-- Grid -->
      <div class="persona-lib-grid" id="persona-lib-grid">
        ${renderPersonaCards(getFilteredPersonas())}
      </div>
    </div>
  `;

  // Bind filters
  document.querySelectorAll('.persona-lib-filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      personasFilter = chip.dataset.filter;
      document.querySelectorAll('.persona-lib-filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      updatePersonaGrid();
    });
  });

  // Bind search
  const searchInput = document.getElementById('persona-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      personasSearch = e.target.value;
      updatePersonaGrid();
    });
  }
}

function getFilteredPersonas() {
  let list = syntheticPersonas;
  if (personasFilter !== 'all') {
    list = list.filter((p) => p.segmentId === personasFilter);
  }
  if (personasSearch.trim()) {
    const q = personasSearch.toLowerCase();
    list = list.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.traits.some((t) => t.toLowerCase().includes(q)) ||
      p.location.toLowerCase().includes(q) ||
      p.behavior.toLowerCase().includes(q)
    );
  }
  return list;
}

function renderPersonaCards(personas) {
  if (personas.length === 0) {
    return '<div class="persona-lib-empty">No personas match your search.</div>';
  }
  return personas.map((p) => {
    const initials = p.name.split(' ').map((n) => n[0]).join('');
    return `
      <div class="persona-lib-card">
        <span class="persona-lib-ai-badge">AI*</span>
        <div class="persona-lib-top">
          <div class="persona-lib-avatar ${p.segmentId}">${initials}</div>
          <div>
            <div class="persona-lib-name">${p.name}</div>
            <div class="persona-lib-age">Age ${p.age} &middot; ${p.location}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="persona-tag ${p.segmentId}">${p.segment}</span>
        </div>
        <div class="persona-lib-traits">
          ${p.traits.map((t) => `<span class="persona-lib-trait">${t}</span>`).join('')}
        </div>
        <div class="persona-lib-meta">
          <span>${p.device === 'mobile' ? '\u{1F4F1}' : '\u{1F5A5}'} ${p.device}</span>
          <span class="persona-lib-meta-dot"></span>
          <span>${p.referral}</span>
        </div>
        <div class="persona-lib-behavior">"${p.behavior}"</div>
      </div>
    `;
  }).join('');
}

function updatePersonaGrid() {
  const grid = document.getElementById('persona-lib-grid');
  if (grid) {
    grid.innerHTML = renderPersonaCards(getFilteredPersonas());
  }
}

// ==========================================
// View 2 — Simulation Progress
// ==========================================
function renderSimulation() {
  const segmentName = simulationConfig.segment === 'all'
    ? 'All Segments'
    : segments.find((s) => s.id === simulationConfig.segment)?.name || 'Custom Segment';

  content.innerHTML = `
    <div class="view-enter" style="max-width:1100px;">
      <div class="card-elevated no-hover" style="margin-bottom:24px;text-align:center;">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:4px;">Evaluating</div>
        <div style="font-size:18px;font-weight:600;">${campaign.name}</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px;">${simulationConfig.personaCount} personas &middot; ${segmentName}</div>
      </div>

      <div class="simulation-layout">
        <!-- Left: Pipeline -->
        <div>
          <div id="pipeline">
            ${pipelineStages.map((stage, i) => `
              <div class="pipeline-stage pending" id="stage-${stage.id}" data-index="${i}">
                <div class="stage-icon">${stage.icon}</div>
                <div class="stage-content">
                  <div class="stage-title">${stage.title}</div>
                  <div class="stage-subtitle">${stage.subtitle}</div>
                  <div class="stage-progress"><div class="stage-progress-bar" id="bar-${stage.id}"></div></div>
                  <div class="stage-detail" id="detail-${stage.id}"></div>
                  <div id="chip-${stage.id}"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Right: Stats + Log -->
        <div class="stats-panel">
          <div class="card-compact no-hover">
            <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;font-weight:600;">Real-time Stats</div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              <div class="stat-box">
                <div class="stat-box-value" id="stat-elapsed">0:00</div>
                <div class="stat-box-label">Elapsed Time</div>
              </div>
              <div class="stat-box">
                <div class="stat-box-value" id="stat-agents">0</div>
                <div class="stat-box-label">Active Agents</div>
              </div>
              <div class="stat-box">
                <div class="stat-box-value" id="stat-completed">0</div>
                <div class="stat-box-label">Completed Journeys</div>
              </div>
              <div class="stat-box">
                <div class="stat-box-value" id="stat-remaining">--</div>
                <div class="stat-box-label">Est. Remaining</div>
              </div>
            </div>
          </div>

          <div class="card-compact no-hover">
            <div style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:600;">Activity Log</div>
            <div class="log-panel" id="log-panel"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  runPipeline();
}

let pipelineLogTimer = null;

async function runPipeline() {
  let logTimer = null;

  function cleanup() {
    if (elapsedTimerInterval) {
      clearInterval(elapsedTimerInterval);
      elapsedTimerInterval = null;
    }
    if (logTimer) {
      clearInterval(logTimer);
      logTimer = null;
    }
    pipelineLogTimer = null;
  }

  try {
    const totalDuration = pipelineStages.reduce((sum, s) => sum + s.duration, 0);
    let elapsedSeconds = 0;
    const statElapsed = document.getElementById('stat-elapsed');
    const statAgents = document.getElementById('stat-agents');
    const statCompleted = document.getElementById('stat-completed');
    const statRemaining = document.getElementById('stat-remaining');
    const logPanel = document.getElementById('log-panel');

    // Elapsed timer
    elapsedTimerInterval = setInterval(() => {
      if (currentView !== 'simulation') {
        clearInterval(elapsedTimerInterval);
        elapsedTimerInterval = null;
        return;
      }
      elapsedSeconds++;
      if (statElapsed) statElapsed.textContent = formatElapsed(elapsedSeconds);
    }, 1000);

    // Log message queue
    let logIndex = 0;
    const logInterval = totalDuration / simulationLogs.length;

    function appendLog() {
      if (currentView !== 'simulation' || !logPanel) return;
      if (logIndex < simulationLogs.length) {
        const line = document.createElement('div');
        line.className = 'log-line';
        line.textContent = simulationLogs[logIndex];
        logPanel.appendChild(line);
        logPanel.scrollTop = logPanel.scrollHeight;
        logIndex++;
      }
    }

    logTimer = setInterval(() => {
      appendLog();
      if (logIndex >= simulationLogs.length) {
        clearInterval(logTimer);
        logTimer = null;
      }
    }, logInterval);
    pipelineLogTimer = logTimer;

    // Summaries for completed stages
    const stageSummaries = {
      'persona-gen': `${simulationConfig.personaCount} personas created`,
      'query-synth': '8 query clusters identified',
      'serp-sim': '8 SERPs simulated',
      'browsing': `${simulationConfig.personaCount} journeys completed`,
      'eval': 'Scoring complete',
    };

    let completedJourneys = 0;

    for (let i = 0; i < pipelineStages.length; i++) {
      if (currentView !== 'simulation') break;

      const stage = pipelineStages[i];
      const el = document.getElementById(`stage-${stage.id}`);
      const bar = document.getElementById(`bar-${stage.id}`);
      const detail = document.getElementById(`detail-${stage.id}`);
      const chipEl = document.getElementById(`chip-${stage.id}`);

      if (!el || !bar) break;

      el.classList.remove('pending');
      el.classList.add('active');

      // Estimate remaining
      const remainingDuration = pipelineStages.slice(i).reduce((s, st) => s + st.duration, 0);
      if (statRemaining) statRemaining.textContent = `~${Math.ceil(remainingDuration / 1000)}s`;

      // Animate progress
      const steps = 20;
      const stepTime = stage.duration / steps;

      for (let s = 1; s <= steps; s++) {
        if (currentView !== 'simulation') break;
        await sleep(stepTime);
        if (currentView !== 'simulation') break;

        const pct = Math.round((s / steps) * 100);
        bar.style.width = `${pct}%`;

        // Update detail text and stats per stage
        if (stage.id === 'persona-gen') {
          const count = Math.round((pct / 100) * simulationConfig.personaCount);
          if (detail) detail.textContent = `${count} personas created`;
          if (statAgents) statAgents.textContent = count;
        } else if (stage.id === 'query-synth') {
          if (detail) detail.textContent = `${Math.round((pct / 100) * 8)} queries synthesized`;
        } else if (stage.id === 'serp-sim') {
          if (detail) detail.textContent = `${Math.round((pct / 100) * 8)} SERPs simulated`;
        } else if (stage.id === 'browsing') {
          const active = Math.round((pct / 100) * simulationConfig.personaCount);
          if (detail) detail.textContent = `${active} agents active`;
          if (statAgents) statAgents.textContent = active;
          completedJourneys = Math.round((pct / 100) * overallResults.completedJourneys);
          if (statCompleted) statCompleted.textContent = completedJourneys;
        } else if (stage.id === 'eval') {
          if (detail) detail.textContent = `Scoring ${Math.round((pct / 100) * simulationConfig.personaCount)} journeys`;
          if (statAgents) statAgents.textContent = Math.max(0, simulationConfig.personaCount - Math.round((pct / 100) * simulationConfig.personaCount));
        }
      }

      if (currentView !== 'simulation') break;

      el.classList.remove('active');
      el.classList.add('completed');

      // Show summary chip
      if (chipEl) {
        chipEl.innerHTML = `<div class="stage-summary-chip">${stageSummaries[stage.id]}</div>`;
      }

      if (stage.id === 'eval') {
        if (statAgents) statAgents.textContent = '0';
        if (statCompleted) statCompleted.textContent = overallResults.completedJourneys;
        if (statRemaining) statRemaining.textContent = 'Done';
      }
    }

    // Clean up log timer before flushing
    if (logTimer) {
      clearInterval(logTimer);
      logTimer = null;
      pipelineLogTimer = null;
    }

    // Flush remaining logs (only if still on simulation view)
    if (currentView === 'simulation') {
      while (logIndex < simulationLogs.length) {
        appendLog();
      }
    }

    // Toast + transition
    if (currentView === 'simulation') {
      showToast(`Evaluation complete — ${overallResults.completedJourneys} journeys analyzed`, 'success');
      await sleep(1500);
      if (currentView === 'simulation') {
        navigate('results');
      }
    }
  } catch (err) {
    console.error('Pipeline error:', err);
    if (currentView === 'simulation') {
      showToast(`Pipeline error: ${err.message}`, 'error');
    }
  } finally {
    cleanup();
  }
}

// ==========================================
// View 3 — Evaluation Results Dashboard
// ==========================================
let resultsActiveTab = 'overview';

function renderResults() {
  content.innerHTML = `
    <div class="view-enter" style="max-width:1100px;">
      <!-- Header row with title + export -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <div>
          <div style="font-size:18px;font-weight:600;">${selectedCampaign?.product || campaign.name}</div>
          <div style="font-size:13px;color:var(--text-secondary);">${overallResults.completedJourneys} of ${overallResults.totalPersonas} journeys completed</div>
        </div>
        <button class="btn btn-ghost" id="export-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 10v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3"/>
            <polyline points="4.5 6.5 8 10 11.5 6.5"/>
            <line x1="8" y1="10" x2="8" y2="2"/>
          </svg>
          Export Report
        </button>
      </div>

      <!-- Tabs -->
      <div class="tabs" id="results-tabs">
        <button class="tab-item active" data-tab="overview">Overview</button>
        <button class="tab-item" data-tab="seo">SEO Deep Dive</button>
        <button class="tab-item" data-tab="friction">Friction Analysis</button>
        <button class="tab-item" data-tab="personas">Personas</button>
      </div>

      <!-- Tab Content -->
      <div id="results-tab-content"></div>
    </div>
  `;

  // Bind tabs
  document.querySelectorAll('#results-tabs .tab-item').forEach((tab) => {
    tab.addEventListener('click', () => {
      resultsActiveTab = tab.dataset.tab;
      document.querySelectorAll('#results-tabs .tab-item').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderResultsTab(resultsActiveTab);
    });
  });

  // Bind export button
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', handleExport);
  }

  renderResultsTab('overview');
}

function renderResultsTab(tab) {
  const container = document.getElementById('results-tab-content');
  if (!container) return;

  const renderers = {
    overview: renderOverviewTab,
    seo: renderSeoTab,
    friction: renderFrictionTab,
    personas: renderPersonasTab,
  };

  if (renderers[tab]) {
    renderers[tab](container);
  }
}

function renderOverviewTab(container) {
  const severityIcons = { critical: '&#128308;', warning: '&#128993;', positive: '&#128994;', info: '&#128309;' };

  container.innerHTML = `
    <div class="stagger">
      <!-- KPI Row -->
      <div class="kpi-row" style="margin-bottom:24px;">
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Overall Score</div>
          <div class="kpi-value" id="kpi-score" style="background:var(--accent);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">0</div>
          <div class="kpi-trend ${trendData.score.direction === 'up' ? 'up' : 'down'}">
            ${trendData.score.direction === 'up' ? '&#9650;' : '&#9660;'} ${trendData.score.delta > 0 ? '+' : ''}${trendData.score.delta} ${trendData.score.label}
          </div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Bounce Rate</div>
          <div class="kpi-value" id="kpi-bounce">0%</div>
          <div class="kpi-trend ${trendData.bounceRate.direction === 'down' ? 'up' : 'down'}">
            ${trendData.bounceRate.direction === 'down' ? '&#9660;' : '&#9650;'} ${trendData.bounceRate.delta}% ${trendData.bounceRate.label}
          </div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Intent Alignment</div>
          <div class="kpi-value" id="kpi-intent">0</div>
          <div class="kpi-trend ${trendData.intentAlignment.direction === 'up' ? 'up' : 'down'}">
            ${trendData.intentAlignment.direction === 'up' ? '&#9650;' : '&#9660;'} +${trendData.intentAlignment.delta} ${trendData.intentAlignment.label}
          </div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Conversion Proxy</div>
          <div class="kpi-value" id="kpi-conversion">0%</div>
          <div class="kpi-trend ${trendData.conversionProxy.direction === 'up' ? 'up' : 'down'}">
            ${trendData.conversionProxy.direction === 'up' ? '&#9650;' : '&#9660;'} +${trendData.conversionProxy.delta}% ${trendData.conversionProxy.label}
          </div>
        </div>
      </div>

      <!-- Key Insights -->
      <div class="card-elevated no-hover" style="margin-bottom:20px;">
        <div class="card-header">
          <div class="card-title">Key Insights</div>
          <div class="card-subtitle">AI-generated findings from this evaluation</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${keyInsights.map((insight) => `
            <div class="insight-card ${insight.severity}">
              <div class="insight-icon">${severityIcons[insight.severity]}</div>
              <div class="insight-content">
                <div class="insight-title">${insight.title}</div>
                <div class="insight-desc">${insight.description}</div>
                <div class="insight-metric">${insight.metric}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- SEO Coverage + Friction side by side -->
      <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:20px;margin-bottom:20px;">
        <!-- SEO Coverage -->
        <div class="card no-hover">
          <div class="card-header">
            <div class="card-title">SEO Query Coverage</div>
            <div class="card-subtitle">How well the product page ranks for target queries</div>
          </div>
          <div class="bar-chart">
            ${seoQueries.map((q) => `
              <div class="bar-row">
                <span class="bar-label">
                  ${q.query}
                  <span class="bar-label-sub">#${q.position} &middot; ${q.searchVolume.toLocaleString()} vol &middot; ${q.trend === 'up' ? '&#9650;' : q.trend === 'down' ? '&#9660;' : '&#8212;'}</span>
                </span>
                <div class="bar-track">
                  <div class="bar-fill ${q.status}" style="width:${q.coverage}%"></div>
                </div>
                <span class="bar-value">${q.coverage}%</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Friction Points -->
        <div class="card no-hover">
          <div class="card-header">
            <div class="card-title">Friction Points</div>
            <div class="card-subtitle">UX issues detected by agents</div>
          </div>
          <div class="friction-list">
            ${frictionPoints.map((f) => `
              <div class="friction-item ${f.severity}">
                <div style="flex:1;">
                  <div class="friction-text">${f.description}</div>
                  <div style="display:flex;gap:6px;align-items:center;margin-top:4px;">
                    <span class="friction-page-tag">${f.page}</span>
                    <span style="font-size:10px;color:var(--text-tertiary);">${f.affectedPersonas} personas affected</span>
                  </div>
                </div>
                <span class="friction-severity ${f.severity}">${f.severity}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Persona Segment Cards -->
      <div class="card no-hover" style="margin-bottom:20px;">
        <div class="card-header">
          <div class="card-title">Persona Segment Breakdown</div>
          <div class="card-subtitle">Performance metrics by audience segment</div>
        </div>
        <div class="persona-cards-grid">
          ${personaBreakdown.map((p) => `
            <div class="persona-card">
              <div class="persona-card-header">
                <div class="avatar" style="font-size:14px;">${p.segment.charAt(0)}</div>
                <div class="persona-card-info">
                  <div class="persona-card-name">${p.segment}</div>
                  <div class="persona-card-meta">${p.count} personas &middot; ${p.avgTimeOnPage} avg</div>
                </div>
                <span class="persona-tag ${p.segmentId}">${p.segmentId}</span>
              </div>
              <div class="persona-card-metrics">
                <div class="persona-metric">
                  <div class="persona-metric-value">${p.avgScore}/10</div>
                  <div class="persona-metric-label">Avg Score</div>
                </div>
                <div class="persona-metric">
                  <div class="persona-metric-value">${p.bounceRate}%</div>
                  <div class="persona-metric-label">Bounce Rate</div>
                </div>
                <div class="persona-metric">
                  <div class="persona-metric-value">${p.intentMatch}/10</div>
                  <div class="persona-metric-label">Intent</div>
                </div>
              </div>
              <div style="display:flex;gap:8px;font-size:10px;color:var(--text-tertiary);">
                <span>${p.pagesViewed} pages viewed</span>
                <span>&middot;</span>
                <span>${p.device.mobile}% mobile</span>
              </div>
              <div class="persona-card-friction">Top friction: ${p.topFriction}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Animate KPI values
  requestAnimationFrame(() => {
    const kpiScore = document.getElementById('kpi-score');
    const kpiBounce = document.getElementById('kpi-bounce');
    const kpiIntent = document.getElementById('kpi-intent');
    const kpiConversion = document.getElementById('kpi-conversion');

    if (kpiScore) animateValue(kpiScore, 0, overallResults.score, 800);
    if (kpiBounce) animateValue(kpiBounce, 0, overallResults.bounceRate, 800, '%');
    if (kpiIntent) animateValue(kpiIntent, 0, overallResults.intentAlignment, 800);
    if (kpiConversion) animateValue(kpiConversion, 0, parseFloat(overallResults.conversionProxy), 800, '%');
  });
}

// ==========================================
// SEO Deep Dive Tab
// ==========================================
function renderSeoTab(container) {
  const coveredCount = seoQueries.filter((q) => q.status === 'covered').length;
  const partialCount = seoQueries.filter((q) => q.status === 'partial').length;
  const missingCount = seoQueries.filter((q) => q.status === 'missing').length;
  const avgCoverage = Math.round(seoQueries.reduce((sum, q) => sum + q.coverage, 0) / seoQueries.length);
  const totalVolume = seoQueries.reduce((sum, q) => sum + q.searchVolume, 0);

  const trendIcon = (t) => t === 'up' ? '<span class="seo-trend-up">&#9650;</span>' : t === 'down' ? '<span class="seo-trend-down">&#9660;</span>' : '<span class="seo-trend-flat">&#8212;</span>';

  container.innerHTML = `
    <div class="stagger">
      <!-- KPI Row -->
      <div class="kpi-row" style="margin-bottom:24px;">
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Avg Coverage</div>
          <div class="kpi-value">${avgCoverage}%</div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Covered Queries</div>
          <div class="kpi-value" style="color:var(--success)">${coveredCount}</div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Missing Queries</div>
          <div class="kpi-value" style="color:var(--danger)">${missingCount}</div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Total Monthly Vol</div>
          <div class="kpi-value">${(totalVolume / 1000).toFixed(1)}K</div>
        </div>
      </div>

      <!-- Data Table -->
      <div class="card no-hover" style="margin-bottom:20px;">
        <div class="card-header">
          <div class="card-title">Query Coverage Detail</div>
          <div class="card-subtitle">Full breakdown of SEO query performance</div>
        </div>
        <table class="recent-table">
          <thead>
            <tr>
              <th>Query</th>
              <th>Position</th>
              <th>Volume</th>
              <th>Trend</th>
              <th>Coverage</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${seoQueries.map((q) => `
              <tr>
                <td style="font-weight:500">${q.query}</td>
                <td style="color:var(--text-secondary)">#${q.position}</td>
                <td style="color:var(--text-secondary)">${q.searchVolume.toLocaleString()}</td>
                <td>${trendIcon(q.trend)}</td>
                <td>
                  <div class="seo-coverage-cell">
                    <div class="bar-track" style="width:80px;"><div class="bar-fill ${q.status}" style="width:${q.coverage}%"></div></div>
                    <span>${q.coverage}%</span>
                  </div>
                </td>
                <td><span class="seo-status-tag ${q.status}">${q.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Coverage Bar Chart -->
      <div class="card no-hover">
        <div class="card-header">
          <div class="card-title">Coverage by Query</div>
          <div class="card-subtitle">Visual comparison of query coverage percentages</div>
        </div>
        <div class="bar-chart">
          ${seoQueries.map((q) => `
            <div class="bar-row">
              <span class="bar-label">
                ${q.query}
                <span class="bar-label-sub">#${q.position} &middot; ${q.searchVolume.toLocaleString()} vol</span>
              </span>
              <div class="bar-track">
                <div class="bar-fill ${q.status}" style="width:${q.coverage}%"></div>
              </div>
              <span class="bar-value">${q.coverage}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// Friction Analysis Tab
// ==========================================
function renderFrictionTab(container) {
  const totalFriction = frictionPoints.length;
  const highCount = frictionPoints.filter((f) => f.severity === 'high').length;
  const totalAffected = new Set(frictionPoints.flatMap((f) => Array.from({ length: f.affectedPersonas }, (_, i) => i))).size;
  const avgImpact = (frictionPoints.reduce((sum, f) => sum + f.impactPercent, 0) / frictionPoints.length).toFixed(1);
  const sorted = [...frictionPoints].sort((a, b) => b.impactPercent - a.impactPercent);

  container.innerHTML = `
    <div class="stagger">
      <!-- KPI Row -->
      <div class="kpi-row" style="margin-bottom:24px;">
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Total Friction Points</div>
          <div class="kpi-value">${totalFriction}</div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">High Severity</div>
          <div class="kpi-value" style="color:var(--danger)">${highCount}</div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Max Affected Personas</div>
          <div class="kpi-value">${Math.max(...frictionPoints.map((f) => f.affectedPersonas))}</div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Avg Impact</div>
          <div class="kpi-value">${avgImpact}%</div>
        </div>
      </div>

      <!-- Friction Detail Cards -->
      <div class="card no-hover" style="margin-bottom:20px;">
        <div class="card-header">
          <div class="card-title">Friction Points by Impact</div>
          <div class="card-subtitle">Detailed breakdown sorted by impact percentage</div>
        </div>
        <div class="friction-detail-list">
          ${sorted.map((f, i) => `
            <div class="friction-detail-item ${f.severity}">
              <div class="friction-detail-header">
                <span class="friction-detail-rank">#${i + 1}</span>
                <span style="flex:1;font-weight:500;">${f.description}</span>
                <span class="friction-severity ${f.severity}">${f.severity}</span>
                <span class="friction-page-tag">${f.page}</span>
                <span class="friction-impact-value">${f.impactPercent}%</span>
              </div>
              <div class="friction-detail-recommendation">
                <span class="friction-rec-label">Recommendation</span>
                ${f.recommendation}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Impact Bar Chart -->
      <div class="card no-hover">
        <div class="card-header">
          <div class="card-title">Impact Distribution</div>
          <div class="card-subtitle">Friction point impact as percentage of total drop-off</div>
        </div>
        <div class="bar-chart">
          ${sorted.map((f) => `
            <div class="bar-row">
              <span class="bar-label">
                ${f.description.length > 40 ? f.description.slice(0, 40) + '...' : f.description}
                <span class="bar-label-sub">${f.severity} &middot; ${f.affectedPersonas} personas</span>
              </span>
              <div class="bar-track">
                <div class="bar-fill ${f.severity === 'high' ? 'missing' : f.severity === 'medium' ? 'partial' : 'covered'}" style="width:${f.impactPercent * 3}%"></div>
              </div>
              <span class="bar-value">${f.impactPercent}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// Personas Tab
// ==========================================
function renderPersonasTab(container) {
  // Join personaBreakdown with segments by segmentId
  const enriched = personaBreakdown.map((p) => {
    const seg = segments.find((s) => s.id === p.segmentId) || {};
    return { ...p, ...seg, segment: p.segment, count: p.count };
  });

  container.innerHTML = `
    <div class="stagger">
      ${enriched.map((p) => `
        <div class="card no-hover" style="margin-bottom:20px;">
          <div class="persona-card-header" style="margin-bottom:16px;">
            <div class="avatar avatar-lg">${p.segment.charAt(0)}</div>
            <div class="persona-card-info" style="flex:1;">
              <div class="persona-card-name" style="font-size:16px;">${p.segment}</div>
              <div class="persona-card-meta">${p.count} personas &middot; ${p.ageRange || ''} &middot; ${p.description || ''}</div>
            </div>
            <span class="persona-tag ${p.segmentId}">${p.segmentId}</span>
          </div>

          <!-- 6-column metrics grid -->
          <div class="persona-detail-metrics">
            <div class="persona-metric">
              <div class="persona-metric-value">${p.avgScore}/10</div>
              <div class="persona-metric-label">Avg Score</div>
            </div>
            <div class="persona-metric">
              <div class="persona-metric-value">${p.bounceRate}%</div>
              <div class="persona-metric-label">Bounce Rate</div>
            </div>
            <div class="persona-metric">
              <div class="persona-metric-value">${p.intentMatch}/10</div>
              <div class="persona-metric-label">Intent Match</div>
            </div>
            <div class="persona-metric">
              <div class="persona-metric-value">${p.avgTimeOnPage}</div>
              <div class="persona-metric-label">Avg Time</div>
            </div>
            <div class="persona-metric">
              <div class="persona-metric-value">${p.pagesViewed}</div>
              <div class="persona-metric-label">Pages Viewed</div>
            </div>
            <div class="persona-metric">
              <div class="persona-metric-value">${p.count}</div>
              <div class="persona-metric-label">Sample Size</div>
            </div>
          </div>

          <!-- Extra details -->
          <div class="persona-detail-extra">
            <div class="persona-detail-grid">
              <div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Device Split</div>
                <div class="persona-device-bar">
                  <div class="persona-device-fill mobile" style="width:${p.device.mobile}%">${p.device.mobile}% Mobile</div>
                  <div class="persona-device-fill desktop" style="width:${p.device.desktop}%">${p.device.desktop}% Desktop</div>
                </div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Referral Source</div>
                <div style="font-size:14px;font-weight:500;">${p.referralSource || 'N/A'}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Session Duration</div>
                <div style="font-size:14px;font-weight:500;">${p.avgSessionDuration || p.avgTimeOnPage}</div>
              </div>
            </div>
          </div>

          <!-- Top friction callout -->
          <div class="persona-card-friction" style="margin-top:4px;">Top friction: ${p.topFriction}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ==========================================
// Export Report
// ==========================================
function handleExport() {
  const name = selectedCampaign?.product || campaign.name;
  const date = new Date().toISOString().split('T')[0];
  const report = {
    exportDate: new Date().toISOString(),
    campaign: selectedCampaign || campaign,
    simulationConfig,
    overallResults,
    seoQueries,
    frictionPoints,
    personaBreakdown,
    keyInsights,
    trendData,
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saep-report-${name.replace(/\s+/g, '-').toLowerCase()}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Report exported successfully', 'success');
}

// ==========================================
// Notification Dropdown
// ==========================================
let notificationsOpen = false;
let notificationItems = notifications.map((n) => ({ ...n }));

function toggleNotifications() {
  const wrapper = document.getElementById('notification-wrapper');
  if (!wrapper) return;

  if (notificationsOpen) {
    closeNotifications();
    return;
  }

  notificationsOpen = true;
  const unreadCount = notificationItems.filter((n) => n.unread).length;

  const dropdown = document.createElement('div');
  dropdown.className = 'notification-dropdown';
  dropdown.id = 'notification-dropdown';
  dropdown.innerHTML = `
    <div class="notification-dropdown-header">
      <span style="font-weight:600;font-size:14px;">Notifications</span>
      <button class="notification-mark-read" id="mark-all-read">Mark all read</button>
    </div>
    <div class="notification-dropdown-body">
      ${notificationItems.map((n) => `
        <div class="notification-item ${n.unread ? 'unread' : ''}" data-id="${n.id}">
          <div class="notification-dot ${n.unread ? 'active' : ''}"></div>
          <div class="notification-item-content">
            <div class="notification-item-title">${n.title}</div>
            <div class="notification-item-message">${n.message}</div>
            <div class="notification-item-time">${n.time}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  wrapper.appendChild(dropdown);

  // Mark all read handler
  document.getElementById('mark-all-read').addEventListener('click', (e) => {
    e.stopPropagation();
    notificationItems.forEach((n) => { n.unread = false; });
    const badge = document.getElementById('notification-badge');
    if (badge) badge.style.display = 'none';
    dropdown.querySelectorAll('.notification-item').forEach((el) => el.classList.remove('unread'));
    dropdown.querySelectorAll('.notification-dot').forEach((el) => el.classList.remove('active'));
  });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', handleNotificationOutsideClick);
  }, 0);
}

function closeNotifications() {
  notificationsOpen = false;
  const dropdown = document.getElementById('notification-dropdown');
  if (dropdown) dropdown.remove();
  document.removeEventListener('click', handleNotificationOutsideClick);
}

function handleNotificationOutsideClick(e) {
  const wrapper = document.getElementById('notification-wrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    closeNotifications();
  }
}

// Bind notification button
const notificationBtn = document.getElementById('notification-btn');
if (notificationBtn) {
  notificationBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNotifications();
  });
}

// ==========================================
// Command Palette (Cmd+K)
// ==========================================
let commandPaletteOpen = false;

const commandPaletteItems = [
  { label: 'Go to Dashboard', shortcut: 'D', action: () => navigate('dashboard') },
  { label: 'Go to Personas', shortcut: 'P', action: () => navigate('personas') },
  { label: 'Go to Simulation', shortcut: 'S', action: () => navigate('simulation') },
  { label: 'Go to Results', shortcut: 'R', action: () => navigate('results') },
  { label: 'Go to Observability', shortcut: 'O', action: () => navigate('observability') },
  { label: 'Run Simulation', shortcut: null, action: () => navigate('simulation') },
  { label: 'Export Report', shortcut: null, action: () => { navigate('results'); setTimeout(handleExport, 400); } },
];

function openCommandPalette() {
  if (commandPaletteOpen) return;
  commandPaletteOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';
  overlay.id = 'command-palette-overlay';

  const palette = document.createElement('div');
  palette.className = 'command-palette';

  palette.innerHTML = `
    <input class="command-palette-input" id="command-palette-input" type="text" placeholder="Type a command..." autofocus />
    <div class="command-palette-group-label">Actions</div>
    <div class="command-palette-list" id="command-palette-list">
      ${commandPaletteItems.map((item, i) => `
        <div class="command-palette-item" data-index="${i}">
          <span>${item.label}</span>
          ${item.shortcut ? `<kbd>${item.shortcut}</kbd>` : ''}
        </div>
      `).join('')}
    </div>
  `;

  overlay.appendChild(palette);
  document.body.appendChild(overlay);

  const input = document.getElementById('command-palette-input');
  const list = document.getElementById('command-palette-list');
  let activeIndex = 0;

  function updateActive() {
    const items = list.querySelectorAll('.command-palette-item');
    items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
    const activeEl = items[activeIndex];
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function filterItems(query) {
    const q = query.toLowerCase();
    list.innerHTML = commandPaletteItems
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item.label.toLowerCase().includes(q))
      .map(({ item, i }) => `
        <div class="command-palette-item" data-index="${i}">
          <span>${item.label}</span>
          ${item.shortcut ? `<kbd>${item.shortcut}</kbd>` : ''}
        </div>
      `).join('');
    activeIndex = 0;
    updateActive();
    bindItemClicks();
  }

  function executeItem(index) {
    closeCommandPalette();
    commandPaletteItems[index]?.action();
  }

  function bindItemClicks() {
    list.querySelectorAll('.command-palette-item').forEach((el) => {
      el.addEventListener('click', () => {
        executeItem(parseInt(el.dataset.index));
      });
      el.addEventListener('mouseenter', () => {
        activeIndex = Array.from(list.children).indexOf(el);
        updateActive();
      });
    });
  }

  input.addEventListener('input', () => filterItems(input.value));

  input.addEventListener('keydown', (e) => {
    const visibleItems = list.querySelectorAll('.command-palette-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, visibleItems.length - 1);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const activeEl = visibleItems[activeIndex];
      if (activeEl) executeItem(parseInt(activeEl.dataset.index));
    } else if (e.key === 'Escape') {
      closeCommandPalette();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCommandPalette();
  });

  updateActive();
  bindItemClicks();
  input.focus();
}

function closeCommandPalette() {
  commandPaletteOpen = false;
  const overlay = document.getElementById('command-palette-overlay');
  if (overlay) overlay.remove();
}

// ==========================================
// Observability View
// ==========================================
function renderObservability() {
  const s = observabilityData.summary;
  const pctCached = ((s.totalCachedTokens / s.totalInputTokens) * 100).toFixed(1);
  const pctSavings = ((s.cacheSavings / s.costWithoutCache) * 100).toFixed(1);

  function fmtTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  }

  function modelShort(m) {
    if (m.includes('sonnet')) return 'Sonnet 4.5';
    if (m.includes('haiku')) return 'Haiku 3.5';
    if (m.includes('embedding')) return 'Embedding';
    return m;
  }

  function modelTag(m) {
    if (m.includes('sonnet')) return 'obs-model-sonnet';
    if (m.includes('haiku')) return 'obs-model-haiku';
    return 'obs-model-embed';
  }

  content.innerHTML = `
    <div class="view-enter" style="max-width:1100px;">
      <!-- KPI Row -->
      <div class="kpi-row" style="margin-bottom:24px;">
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Total LLM Calls</div>
          <div class="kpi-value">${s.totalCalls}</div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Total Tokens</div>
          <div class="kpi-value">${fmtTokens(s.totalInputTokens + s.totalOutputTokens)}</div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${fmtTokens(s.totalInputTokens)} in / ${fmtTokens(s.totalOutputTokens)} out</div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Total Cost</div>
          <div class="kpi-value" style="color:var(--warning)">$${s.totalCost.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">$${s.costWithoutCache.toFixed(2)} without cache</div>
        </div>
        <div class="card-compact no-hover kpi-card">
          <div class="kpi-label">Cache Savings</div>
          <div class="kpi-value" style="color:var(--success)">$${s.cacheSavings.toFixed(2)}</div>
          <div class="kpi-trend up">${pctSavings}% saved &middot; ${pctCached}% tokens cached</div>
        </div>
      </div>

      <!-- Latency + Model breakdown side by side -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
        <!-- Latency -->
        <div class="card no-hover">
          <div class="card-header">
            <div class="card-title">Latency</div>
            <div class="card-subtitle">Response time across all LLM calls</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
            <div class="stat-box">
              <div class="stat-box-value">${s.avgLatency}s</div>
              <div class="stat-box-label">Avg Latency</div>
            </div>
            <div class="stat-box">
              <div class="stat-box-value">${s.p99Latency}s</div>
              <div class="stat-box-label">p99 Latency</div>
            </div>
            <div class="stat-box">
              <div class="stat-box-value">${s.totalDuration}s</div>
              <div class="stat-box-label">Total Duration</div>
            </div>
          </div>
        </div>

        <!-- Model Breakdown -->
        <div class="card no-hover">
          <div class="card-header">
            <div class="card-title">Model Breakdown</div>
            <div class="card-subtitle">Cost and token usage per model</div>
          </div>
          <div class="obs-model-list">
            ${observabilityData.models.map((m) => `
              <div class="obs-model-row">
                <div class="obs-model-info">
                  <span class="obs-model-tag ${modelTag(m.model)}">${modelShort(m.model)}</span>
                  <span class="obs-model-calls">${m.calls} calls</span>
                </div>
                <div class="obs-model-stats">
                  <span>${fmtTokens(m.inputTokens + m.outputTokens)} tok</span>
                  <span class="obs-model-cost">$${m.cost.toFixed(2)}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Cache Performance Bar -->
      <div class="card no-hover" style="margin-bottom:20px;">
        <div class="card-header">
          <div class="card-title">Cache Performance</div>
          <div class="card-subtitle">Prompt caching hit rate across input tokens</div>
        </div>
        <div class="obs-cache-bar-wrapper">
          <div class="obs-cache-bar">
            <div class="obs-cache-fill cached" style="width:${pctCached}%">
              <span>${fmtTokens(s.totalCachedTokens)} cached (${pctCached}%)</span>
            </div>
            <div class="obs-cache-fill uncached" style="width:${(100 - parseFloat(pctCached)).toFixed(1)}%">
              <span>${fmtTokens(s.totalInputTokens - s.totalCachedTokens)} uncached</span>
            </div>
          </div>
          <div class="obs-cache-legend">
            <span><span class="obs-legend-dot cached"></span>Cached tokens (75% discount)</span>
            <span><span class="obs-legend-dot uncached"></span>Uncached tokens (full price)</span>
          </div>
        </div>
      </div>

      <!-- Per-Stage Call Log -->
      <div class="card no-hover">
        <div class="card-header">
          <div class="card-title">Call Log by Pipeline Stage</div>
          <div class="card-subtitle">Every LLM call made during the evaluation, grouped by stage</div>
        </div>
        <div class="obs-stages">
          ${observabilityData.stages.map((stage) => {
            const stageCost = stage.calls.reduce((sum, c) => sum + c.cost, 0);
            const stageTokens = stage.calls.reduce((sum, c) => sum + c.inputTokens + c.outputTokens, 0);
            const stageCached = stage.calls.reduce((sum, c) => sum + c.cachedTokens, 0);
            return `
              <div class="obs-stage-group">
                <div class="obs-stage-header">
                  <span class="obs-stage-name">${stage.stage}</span>
                  <span class="obs-stage-meta">${stage.calls.length} calls &middot; ${fmtTokens(stageTokens)} tokens &middot; $${stageCost.toFixed(2)}${stageCached > 0 ? ` &middot; ${fmtTokens(stageCached)} cached` : ''}</span>
                </div>
                <table class="recent-table obs-call-table">
                  <thead>
                    <tr>
                      <th>Operation</th>
                      <th>Model</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Cached</th>
                      <th>Latency</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${stage.calls.map((c) => `
                      <tr>
                        <td style="font-weight:500;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${c.operation}">${c.operation}</td>
                        <td><span class="obs-model-tag ${modelTag(c.model)}" style="font-size:10px;padding:1px 6px;">${modelShort(c.model)}</span></td>
                        <td style="color:var(--text-secondary)">${fmtTokens(c.inputTokens)}</td>
                        <td style="color:var(--text-secondary)">${fmtTokens(c.outputTokens)}</td>
                        <td>${c.cachedTokens > 0 ? `<span style="color:var(--success)">${fmtTokens(c.cachedTokens)}</span>` : '<span style="color:var(--text-tertiary)">—</span>'}</td>
                        <td style="color:var(--text-secondary)">${c.latency}s</td>
                        <td style="font-weight:600">$${c.cost.toFixed(2)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

// Cmd+K handler — unified keyboard shortcuts
function handleKeyboardShortcuts(e) {
  // Command palette: Cmd+K / Ctrl+K
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if (commandPaletteOpen) closeCommandPalette();
    else openCommandPalette();
    return;
  }

  // Don't handle shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'd' || e.key === 'D') navigate('dashboard');
  if (e.key === 'p' || e.key === 'P') navigate('personas');
  if (e.key === 's' || e.key === 'S') navigate('simulation');
  if (e.key === 'r' || e.key === 'R') navigate('results');
  if (e.key === 'o' || e.key === 'O') navigate('observability');
}

document.addEventListener('keydown', handleKeyboardShortcuts);

// Make the Cmd+K hint in header clickable
const kbdHint = document.querySelector('.kbd-hint');
if (kbdHint) {
  kbdHint.style.cursor = 'pointer';
  kbdHint.addEventListener('click', () => openCommandPalette());
}

// --- Global error handler ---
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  showToast(`Error: ${e.reason?.message || 'Something went wrong'}`, 'error');
});

// --- Boot ---
renderRecentCampaigns();
navigate('dashboard');
