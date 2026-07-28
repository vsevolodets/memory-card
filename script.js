/*
 * script.js — вся интерактивность лендинга.
 * Данные берутся из глобального объекта landingData (см. data.js).
 * Логику/структуру верстки менять здесь можно, содержимое — только в data.js.
 */
(function () {
  "use strict";

  var qs = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var qsa = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  function el(tag, className, html) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Экранирует текст, затем оборачивает переданные слова/фразы в акцентный
  // <span>, чтобы важные формулировки (штраф, пени, блокировка…) были заметны.
  function highlightWords(text, words) {
    var escaped = escapeHtml(text);
    (words || []).forEach(function (w) {
      var safe = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var re = new RegExp("(" + safe + ")", "gi");
      escaped = escaped.replace(re, '<span class="word-highlight">$1</span>');
    });
    return escaped;
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  // Плавная замена содержимого контейнера: затухание → обновление → проявление.
  function crossFadeUpdate(node, updateFn) {
    if (!node) { updateFn(); return; }
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { updateFn(); return; }
    node.style.transition = "opacity .16s ease";
    node.style.opacity = "0";
    setTimeout(function () {
      updateFn();
      requestAnimationFrame(function () { node.style.opacity = "1"; });
    }, 160);
  }

  // Фикс для мобильных браузеров: если страница восстановлена из bfcache
  // (кнопка «назад»), состояние анимаций может «залипнуть» — перезагружаем.
  window.addEventListener("pageshow", function (ev) {
    if (ev.persisted) window.location.reload();
  });

  // ---------------------------------------------------------------------
  // Языки интерфейса (i18n). Переводится только "обвязка" сайта — кнопки,
  // заголовки, подписи. Содержимое из data.js (штрафы, чеклист, FAQ и т.д.)
  // остаётся на русском независимо от выбранного языка.
  // ---------------------------------------------------------------------
  var LANG_STORAGE_KEY = "taxi_lang";
  var currentLang = "ru";

  function tr(key) {
    var dict = (window.I18N && window.I18N[currentLang]) || {};
    var ru = (window.I18N && window.I18N.ru) || {};
    return dict[key] !== undefined ? dict[key] : (ru[key] !== undefined ? ru[key] : key);
  }

  function applyLanguage(lang) {
    if (!window.I18N || !window.I18N[lang]) lang = "ru";
    currentLang = lang;
    document.documentElement.lang = lang === "ru" ? "ru" : lang;

    qsa("[data-i18n]").forEach(function (node) {
      var key = node.getAttribute("data-i18n");
      var val = tr(key);
      if (val) node.textContent = val;
    });
    qsa("[data-i18n-placeholder]").forEach(function (node) {
      node.setAttribute("placeholder", tr(node.getAttribute("data-i18n-placeholder")));
    });
    qsa("[data-i18n-aria-label]").forEach(function (node) {
      node.setAttribute("aria-label", tr(node.getAttribute("data-i18n-aria-label")));
    });

    // элементы, которые генерируются в JS и содержат переводимый текст
    if (typeof renderFaqCategories === "function") crossFadeUpdate(qs("#faq-categories"), renderFaqCategories);
    if (typeof renderFaqList === "function") crossFadeUpdate(qs("#faq-list"), renderFaqList);
    if (selectedColumnId && typeof selectColumn === "function") selectColumn(selectedColumnId, false);

    var note = qs("#lang-note");
    if (note) {
      var noteText = tr("langNote");
      if (lang === "ru" || !noteText) {
        note.hidden = true;
      } else {
        note.textContent = noteText;
        note.hidden = false;
      }
    }

    var meta = (window.LANG_META && window.LANG_META[lang]) || { flag: "🇷🇺", short: "RU" };
    var flagEl = qs("#lang-toggle-flag");
    var labelEl = qs("#lang-toggle-label");
    if (flagEl) flagEl.textContent = meta.flag;
    if (labelEl) labelEl.textContent = meta.short;

    qsa(".lang-opt").forEach(function (btn) {
      var isCurrent = btn.getAttribute("data-lang") === lang;
      if (isCurrent) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    });

    try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch (e) { /* noop */ }
  }

  function initLanguageSwitcher() {
    var wrap = qs("#lang-switch");
    var toggle = qs("#lang-toggle");
    if (!wrap || !toggle) return;

    function close() {
      wrap.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }
    function open() {
      wrap.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
    }

    toggle.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (wrap.classList.contains("is-open")) close(); else open();
    });
    qsa(".lang-opt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyLanguage(btn.getAttribute("data-lang"));
        close();
      });
    });
    document.addEventListener("click", function (ev) {
      if (wrap.classList.contains("is-open") && !wrap.contains(ev.target)) close();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
    });

    var saved = null;
    try { saved = localStorage.getItem(LANG_STORAGE_KEY); } catch (e) { /* noop */ }
    applyLanguage(saved || "ru");
  }

  // ---------------------------------------------------------------------
  // Плавная навигация по data-scroll / якорям
  // ---------------------------------------------------------------------
  function initSmoothScroll() {
    qsa("a[href^='#']").forEach(function (a) {
      a.addEventListener("click", function (ev) {
        var id = a.getAttribute("href").slice(1);
        var target = document.getElementById(id);
        if (!target) return;
        ev.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      });
    });
  }

  // ---------------------------------------------------------------------
  // Колонны и менеджеры
  // ---------------------------------------------------------------------
  var selectedColumnId = null;

  function iconPhone() {
    return '<svg class="btn__icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.2 1L6.6 10.8Z"/></svg>';
  }
  function iconMax() {
    return '<svg class="btn__icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><text x="12" y="16" font-size="9" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">MAX</text></svg>';
  }
  function iconTelegram() {
    return '<svg class="btn__icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M21.8 4.6 3.4 11.5c-1 .4-1 1.7.1 2l4.4 1.4 1.7 5.2c.2.6.9.8 1.4.4l2.6-2.2 4.5 3.3c.6.5 1.6.1 1.8-.6l3.3-15.3c.2-1-.7-1.7-1.4-1.1ZM8.6 14l9.5-6.6c.3-.2.6.1.3.4l-7.9 7.4c-.3.3-.5.7-.6 1.1l-.3 2.3-1-4.6Z"/></svg>';
  }

  function renderColumnPicker() {
    var wrap = qs(".column-picker");
    wrap.innerHTML = "";
    landingData.columns.forEach(function (col) {
      var btn = el("button", "column-btn", "");
      btn.type = "button";
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("data-column", col.id);
      btn.innerHTML = "<span>" + escapeHtml(col.title) + "</span>" +
        '<svg class="column-btn__chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>';
      btn.addEventListener("click", function () { selectColumn(col.id, true); });
      wrap.appendChild(btn);
    });
  }

  function managerCardHtml(m) {
    var badge = m.isSupervisor ? '<span class="manager-card__badge">Руководитель</span>' : "";
    var meta = "";
    if (m.workDays) {
      meta += "<dt>Рабочие дни</dt><dd>" + escapeHtml(m.workDays) + "</dd>";
    }
    if (m.daysOff) {
      meta += "<dt>Выходные</dt><dd>" + escapeHtml(m.daysOff) + "</dd>";
    }
    if (m.hours) {
      meta += "<dt>Время работы</dt><dd>" + escapeHtml(m.hours) + "</dd>";
    }
    if (!m.workDays && !m.hours) {
      meta += "<dt>График</dt><dd>не указан</dd>";
    }

    var actions = '<a class="btn btn--primary" href="tel:' + m.phone + '">' + iconPhone() + escapeHtml(m.phoneDisplay) + "</a>";
    if (m.maxUrl) {
      actions += '<a class="btn btn--accent" href="' + m.maxUrl + '" target="_blank" rel="noopener">' + iconMax() + "Написать в MAX</a>";
    }
    if (m.telegramUrl) {
      actions += '<a class="btn btn--secondary" href="' + m.telegramUrl + '" target="_blank" rel="noopener">' + iconTelegram() + "Написать в Telegram</a>";
    }

    return (
      '<article class="manager-card' + (m.isSupervisor ? " manager-card--supervisor" : "") + '">' +
      '<div class="manager-card__top"><span class="manager-card__name">' + escapeHtml(m.name) + "</span>" + badge + "</div>" +
      '<dl class="manager-card__meta">' + meta + "</dl>" +
      '<div class="manager-card__actions">' + actions + "</div>" +
      "</article>"
    );
  }

  function selectColumn(columnId, userInitiated) {
    selectedColumnId = columnId;
    var col = landingData.columns.filter(function (c) { return c.id === columnId; })[0];
    qsa(".column-btn").forEach(function (btn) {
      var isActive = btn.getAttribute("data-column") === columnId;
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    var list = qs("#managers-list");
    if (!col) {
      list.innerHTML = '<p class="managers-list__placeholder">' + escapeHtml(tr("managersPlaceholder")) + "</p>";
      return;
    }
    var html = col.managers.map(managerCardHtml).join("");
    if (userInitiated) {
      crossFadeUpdate(list, function () { list.innerHTML = html; });
      list.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      list.innerHTML = html;
    }
  }

  // ---------------------------------------------------------------------
  // Перед выходом на линию
  // ---------------------------------------------------------------------
  function renderChecklist() {
    var list = qs("#checklist-list");
    list.innerHTML = landingData.checklist.map(function (item) {
      return (
        "<li><svg class=\"checklist__icon\" aria-hidden=\"true\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"4\"/></svg><span>" +
        escapeHtml(item.text) +
        "</span></li>"
      );
    }).join("");

    qs("#checklist-warning").innerHTML =
      '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2 1 21h22L12 2Zm1 15h-2v2h2v-2Zm0-7h-2v5h2v-5Z"/></svg><span>' +
      highlightWords(landingData.checklistWarning, ["штраф 60 000 ₽", "эвакуация"]) + "</span>";
  }

  // ---------------------------------------------------------------------
  // Аренда и выплаты
  // ---------------------------------------------------------------------
  function renderPayments() {
    var list = qs("#payments-list");
    list.innerHTML = landingData.payments.map(function (p) {
      var note = p.note ? '<div class="fact-row__note">' + escapeHtml(p.note) + "</div>" : "";
      return (
        '<div class="fact-row"><dt>' + escapeHtml(p.label) + "</dt><dd>" + escapeHtml(p.value) + note + "</dd></div>"
      );
    }).join("");
  }

  // ---------------------------------------------------------------------
  // Заработок
  // ---------------------------------------------------------------------
  function renderEarnings() {
    var list = qs("#earnings-list");
    list.innerHTML = landingData.earnings.map(function (item) {
      var badge = item.badge ? '<span class="earnings-list__badge">' + escapeHtml(item.badge) + "</span>" : "";
      return "<li><span>" + escapeHtml(item.text) + "</span>" + badge + "</li>";
    }).join("");
  }

  // ---------------------------------------------------------------------
  // Штрафы
  // ---------------------------------------------------------------------
  function renderFines() {
    var list = qs("#fines-list");
    list.innerHTML = landingData.fines.map(function (f) {
      var note = f.note ? '<div class="fine-row__note">' + escapeHtml(f.note) + "</div>" : "";
      return (
        '<li class="fine-row"><span class="fine-row__code" aria-hidden="true">' + escapeHtml(f.code) + "</span>" +
        '<span class="fine-row__body"><span class="fine-row__name">' + escapeHtml(f.name) + "</span>" + note + "</span>" +
        '<span class="fine-row__amount">' + escapeHtml(f.amount) + "</span></li>"
      );
    }).join("");
    qs("#fines-note").textContent = landingData.finesNote;
    qs("#fines-warning").innerHTML =
      '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2 1 21h22L12 2Zm1 15h-2v2h2v-2Zm0-7h-2v5h2v-5Z"/></svg><span>' +
      highlightWords(landingData.finesWarning, ["разрешено"]) + "</span>";
  }

  // ---------------------------------------------------------------------
  // Осмотр + карта
  // ---------------------------------------------------------------------
  function renderInspection() {
    var i = landingData.inspection;
    qs("#inspection-frequency").textContent = i.frequency;
    qs("#inspection-time").textContent = i.time;
    qs("#inspection-address").textContent = i.address;
    qs("#inspection-coords").textContent = i.coordinates;
    qs("#inspection-note").textContent = i.note;

    var routeBtn = qs("#route-btn");
    routeBtn.href = "https://yandex.ru/maps/?rtext=~" + i.latitude + "%2C" + i.longitude + "&rtt=auto";

    var yandexBtn = qs("#yandex-maps-btn");
    yandexBtn.href = "https://yandex.ru/maps/?pt=" + i.longitude + "," + i.latitude + "&z=17&l=map";

    qs("#copy-coords-btn").addEventListener("click", function () {
      copyToClipboard(i.coordinates).then(function () {
        var toast = qs("#copy-toast");
        toast.hidden = false;
        setTimeout(function () { toast.hidden = true; }, 2200);
      });
    });

    initMap(i);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) { /* noop */ }
      document.body.removeChild(ta);
      resolve();
    });
  }

  function initMap(inspection) {
    var mapEl = qs("#inspection-map");
    var fallback = qs("#map-fallback");
    try {
      if (typeof L === "undefined") throw new Error("Leaflet not loaded");
      var map = L.map(mapEl, {
        center: [inspection.latitude, inspection.longitude],
        zoom: 16,
        scrollWheelZoom: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      L.marker([inspection.latitude, inspection.longitude])
        .addTo(map)
        .bindPopup(inspection.address);

      // Leaflet needs a size recalculation once the surrounding layout settles.
      setTimeout(function () { map.invalidateSize(); }, 250);
      window.addEventListener("resize", function () { map.invalidateSize(); });
    } catch (err) {
      mapEl.hidden = true;
      fallback.hidden = false;
    }
  }

  // ---------------------------------------------------------------------
  // Возврат автомобиля
  // ---------------------------------------------------------------------
  function renderReturnRules() {
    var list = qs("#return-list");
    list.innerHTML = landingData.returnRules.map(function (rule) {
      return "<li>" + escapeHtml(rule) + "</li>";
    }).join("");
  }

  // ---------------------------------------------------------------------
  // FAQ
  // ---------------------------------------------------------------------
  var activeCategory = "all";
  var searchQuery = "";

  function renderFaqCategories() {
    var wrap = qs("#faq-categories");
    var all = [{ id: "all", label: tr("faqCategoryAll") }].concat(landingData.faqCategories);
    wrap.innerHTML = "";
    all.forEach(function (cat) {
      var btn = el("button", "faq-cat-btn", escapeHtml(cat.label));
      btn.type = "button";
      btn.setAttribute("data-cat", cat.id);
      btn.setAttribute("aria-pressed", cat.id === "all" ? "true" : "false");
      btn.addEventListener("click", function () {
        activeCategory = cat.id;
        qsa(".faq-cat-btn", wrap).forEach(function (b) {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        crossFadeUpdate(qs("#faq-list"), renderFaqList);
      });
      wrap.appendChild(btn);
    });
  }

  function categoryLabel(id) {
    var found = landingData.faqCategories.filter(function (c) { return c.id === id; })[0];
    return found ? found.label : id;
  }

  function renderFaqList() {
    var list = qs("#faq-list");
    var empty = qs("#faq-empty");
    var q = searchQuery.trim().toLowerCase();

    var items = landingData.faq.filter(function (item) {
      var matchesCat = activeCategory === "all" || item.category === activeCategory;
      var matchesQuery = !q ||
        item.question.toLowerCase().indexOf(q) !== -1 ||
        item.answer.toLowerCase().indexOf(q) !== -1;
      return matchesCat && matchesQuery;
    });

    if (items.length === 0) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    list.innerHTML = items.map(function (item, idx) {
      var mapBtn = item.showMapButton
        ? '<a class="btn btn--secondary btn--block faq-map-btn" data-scroll-to="inspection">' + escapeHtml(tr("faqOpenOnMap")) + "</a>"
        : "";
      var qid = "faq-q-" + idx;
      var aid = "faq-a-" + idx;
      return (
        '<div class="faq-item">' +
        '<h3 style="margin:0;">' +
        '<button class="faq-item__question" id="' + qid + '" aria-expanded="false" aria-controls="' + aid + '">' +
        "<span><span class=\"faq-item__category\">" + escapeHtml(categoryLabel(item.category)) + "</span><br>" + escapeHtml(item.question) + "</span>" +
        '<svg class="faq-item__chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>' +
        "</button></h3>" +
        '<div class="faq-item__answer" id="' + aid + '" role="region" aria-labelledby="' + qid + '">' +
        "<p>" + escapeHtml(item.answer) + "</p>" + mapBtn +
        "</div>" +
        "</div>"
      );
    }).join("");

    qsa(".faq-item__question", list).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var expanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", expanded ? "false" : "true");
        var answer = document.getElementById(btn.getAttribute("aria-controls"));
        answer.classList.toggle("is-open", !expanded);
      });
      btn.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          // native button already handles this; kept for clarity/no-op
        }
      });
    });

    qsa(".faq-map-btn", list).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById("inspection");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function initFaq() {
    renderFaqCategories();
    renderFaqList();
    var input = qs("#faq-search-input");
    var applySearch = debounce(function () {
      searchQuery = input.value;
      renderFaqList();
    }, 120);
    input.addEventListener("input", applySearch);
  }

  // ---------------------------------------------------------------------
  // Плавность: hero проявляется сразу, остальные секции — при подскролле
  // ---------------------------------------------------------------------
  function initRevealAnimations() {
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var hero = qs(".hero");
    if (hero) {
      if (reduced) {
        hero.classList.add("is-visible");
      } else {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { hero.classList.add("is-visible"); });
        });
      }
    }

    var sections = qsa("main .section");
    if (reduced || typeof IntersectionObserver === "undefined") {
      sections.forEach(function (s) { s.classList.add("reveal", "is-visible"); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .12, rootMargin: "0px 0px -60px 0px" });
    sections.forEach(function (s) {
      s.classList.add("reveal");
      observer.observe(s);
    });
  }

  // ---------------------------------------------------------------------
  // Быстрые действия (бот + заявки) — раскрывающаяся кнопка внизу справа
  // ---------------------------------------------------------------------
  function initQuickActions() {
    var wrap = qs("#quick-actions");
    var toggle = qs("#quick-actions-toggle");
    if (!wrap || !toggle) return;

    function close() {
      wrap.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }
    function open() {
      wrap.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
    }

    toggle.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (wrap.classList.contains("is-open")) { close(); } else { open(); }
    });
    document.addEventListener("click", function (ev) {
      if (wrap.classList.contains("is-open") && !wrap.contains(ev.target)) close();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
    });
  }

  // ---------------------------------------------------------------------
  // Scrollspy: подсветка активного пункта нижней навигации
  // ---------------------------------------------------------------------
  function initScrollspy() {
    var navItems = qsa(".nav-item[data-target]");
    if (!navItems.length || typeof IntersectionObserver === "undefined") return;
    var map = {};
    navItems.forEach(function (a) { map[a.getAttribute("data-target")] = a; });

    function setActive(id) {
      navItems.forEach(function (a) {
        var active = a.getAttribute("data-target") === id;
        a.classList.toggle("is-active", active);
        if (active) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: "-72px 0px -55% 0px", threshold: 0 });

    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) observer.observe(el);
    });
  }

  // ---------------------------------------------------------------------
  // Back to top
  // ---------------------------------------------------------------------
  function initBackToTop() {
    var btn = qs("#back-to-top");
    window.addEventListener("scroll", function () {
      btn.hidden = window.scrollY < 480;
    });
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    renderColumnPicker();
    renderChecklist();
    renderPayments();
    renderEarnings();
    renderFines();
    renderInspection();
    renderReturnRules();
    initFaq();
    initSmoothScroll();
    initBackToTop();
    initRevealAnimations();
    initQuickActions();
    initScrollspy();
    initLanguageSwitcher();
  });
})();
