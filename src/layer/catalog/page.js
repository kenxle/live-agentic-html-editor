// The Library page script.
//
// Owner: Library 2.2. Plan: docs/features/20260922.02_lahe_library/03_plan_lahe_library.md,
// Task 2.2. Architecture: 02_architecture_lahe_library.md, "Open" and "Helper
// lifetime (R10a)".
//
// Served raw from src/ by catalog.asset, never bundled into dist/. It runs
// under script-src 'self', so it reads the Library token from the page's meta
// tag, and every name (the meta name, header names, route paths, POLL_MS) from
// protocol.js, which the page loads first. Every wording and every rule lives
// in view_model.js; this file owns only the network, the DOM, and the order
// things happen in.
//
// THREE RULES THIS FILE KEEPS:
//
//  1. TEXT ONLY. Every string from the list (titles, file names, answers) goes
//     into the DOM through textContent or a plain attribute. Nothing here ever
//     assigns HTML.
//  2. OPEN'S TAB SEQUENCE. A click opens about:blank synchronously (a pop-up
//     must come from the click itself), sets its opener to null, and only then
//     asks the helper. The tab is sent to the answer's URL only if the view
//     model's check passes (loopback http:), and closed otherwise.
//  3. HONEST TIMING. The page polls every POLL_MS whether or not its tab is
//     visible (the helper counts a recent poll as a reason to stay up), polls
//     again right after each of its own actions, and stops for good on a 401:
//     the helper restarted and only a reload brings a working token.
//
// window.__laheCatalogPollNow() polls at once and resolves after the render,
// so browser tests never wait out a 15 second poll.
//
// Browser-only.

(function () {
  "use strict";

  var protocol = window.LAHE && window.LAHE.protocol;
  var VM = window.LAHE && window.LAHE.catalogViewModel;
  var statusLine = document.getElementById("lahe-catalog-status");
  if (!protocol || !VM) {
    if (statusLine) statusLine.textContent = "The Library could not load its scripts. Reload this page.";
    return;
  }
  var meta = document.querySelector('meta[name="' + protocol.CATALOG_TOKEN_META + '"]');
  var token = meta && meta.getAttribute("content");
  if (!token) {
    if (statusLine) statusLine.textContent = "The Library token is missing. Reload this page.";
    return;
  }

  var ROUTE = {
    list: protocol.route("catalog.list"),
    open: protocol.route("catalog.open"),
    star: protocol.route("catalog.star"),
    rename: protocol.route("catalog.rename"),
    request: protocol.route("catalog.request")
  };

  var els = {
    agent: document.getElementById("lahe-catalog-agent"),
    search: document.getElementById("lahe-catalog-search"),
    project: document.getElementById("lahe-catalog-project"),
    banner: document.getElementById("lahe-catalog-banner"),
    main: document.getElementById("lahe-catalog-main"),
    dialog: document.getElementById("lahe-catalog-confirm")
  };

  var list = null;
  var state = VM.initialState();
  var lastRendered = null;
  var timer = null;

  // ---------------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------------

  function headers(json) {
    var h = {};
    h[protocol.HEADER.CLIENT] = protocol.CLIENT_CATALOG;
    h[protocol.HEADER.TOKEN] = token;
    if (json) h[protocol.HEADER.CONTENT_TYPE] = protocol.JSON_CONTENT_TYPE;
    return h;
  }

  // Every call resolves to the view model's result shape and never throws:
  // {ok: true, body} | {ok: false, status, error} | {ok: false, unreachable: true}.
  function call(route, body) {
    var init = {
      method: route.method,
      headers: headers(route.method !== "GET"),
      credentials: "same-origin",
      cache: "no-store"
    };
    if (route.method !== "GET") init.body = JSON.stringify(body || {});
    return fetch(route.path, init).then(
      function (res) {
        return res.text().then(function (text) {
          var parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch (err) {
            parsed = null;
          }
          if (res.ok) return { ok: true, status: res.status, body: parsed || {} };
          return { ok: false, status: res.status, error: (parsed && parsed.error) || null };
        });
      },
      function () {
        return { ok: false, unreachable: true };
      }
    );
  }

  var polling = null;

  function poll() {
    if (!VM.shouldPoll(state)) return Promise.resolve();
    if (polling) return polling;
    polling = call(ROUTE.list).then(function (result) {
      polling = null;
      if (result.ok && result.body && Array.isArray(result.body.sessions)) {
        list = result.body;
        state = VM.afterList(VM.withFetch(state, { ok: true }), list);
      } else if (result.ok) {
        state = VM.withFetch(state, { ok: false, status: 500, error: { message: "The helper sent a list the page cannot read." } });
      } else {
        state = VM.withFetch(state, result);
      }
      if (!VM.shouldPoll(state)) stopPolling();
      render();
    });
    return polling;
  }

  function stopPolling() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  window.__laheCatalogPollNow = function () {
    return poll().then(function () {
      render();
    });
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function update(next) {
    state = next;
    render();
  }

  function now() {
    return Date.now();
  }

  function act(reviewId, action, options) {
    var d = VM.decide(list, state, reviewId, action, options || {});
    if (d.kind === "none") return;
    if (d.kind === "handoff") {
      focusKey(reviewId + ":copy");
      update(VM.withDialog(VM.withPanel(state, reviewId, d.reason), null));
      return;
    }
    if (d.kind === "already") {
      update(VM.withNote(state, reviewId, d.note, now()));
      return;
    }
    if (d.kind === "confirm") {
      update(VM.withDialog(state, reviewId, d.action));
      return;
    }
    update(VM.withDialog(state, null));
    if (d.kind === "request") {
      call(ROUTE.request, d.body).then(function (result) {
        update(VM.afterRequest(state, list, reviewId, d.body.action, result, now()));
        poll();
      });
      return;
    }
    if (d.kind === "open") openReview(reviewId, d);
  }

  function openReview(reviewId, d) {
    var tab = null;
    if (d.tab) {
      // Synchronously, inside the click: a tab opened after an await is a
      // pop-up the browser blocks.
      tab = window.open("about:blank", "_blank");
      if (!tab) {
        update(VM.popupBlocked(state, reviewId, now()));
        return;
      }
      awayInTab = true;
      try {
        tab.opener = null;
      } catch (err) {
        // A browser that refuses the assignment already gave no opener.
      }
    }
    update(VM.beginOpen(state, list, reviewId, { handoff: d.body.handoff, tab: d.tab }));
    call(ROUTE.open, d.body).then(function (result) {
      var url = result.ok && result.body ? result.body.url : null;
      if (tab) {
        if (result.ok && VM.isLoopbackHttpUrl(url)) {
          tab.location.href = url;
        } else {
          tab.close();
          // url: null is an answer, not a bad address: no server could be
          // restarted and a pick-up was queued for the agent instead.
          if (result.ok && url !== null && url !== undefined) result = { ok: false, urlRefused: true };
        }
      }
      update(VM.afterOpen(state, list, reviewId, result, now()));
      poll();
    });
  }

  function star(reviewId, desired) {
    update(VM.beginStar(state, reviewId, desired));
    call(ROUTE.star, { review: reviewId, starred: desired }).then(function (result) {
      update(VM.afterStar(state, reviewId, desired, result, now()));
      poll();
    });
  }

  // What the reader has typed into a rename field, kept here so a poll that
  // redraws the list does not throw it away.
  var renameDraft = { id: null, value: "" };

  function startRename(reviewId) {
    var found = null;
    renameDraft = { id: null, value: "" };
    focusKey(reviewId + ":rename-input");
    update(VM.withRenaming(state, reviewId));
    found = els.main.querySelector('[data-key="' + cssEscape(reviewId + ":rename-input") + '"]');
    if (found && found.select) found.select();
  }

  // Set while an edit is being closed by Enter or Escape, so the blur that
  // closing causes does not save a second time (or save a cancelled edit).
  var renameClosing = false;

  /**
   * Save what the field holds. Empty or unchanged saves nothing and just
   * closes the field; typing the original name back clears the rename.
   */
  // True while the field is losing focus to somewhere else: the reader's
  // click goes where they put it, not back to the name.
  var blurTarget = false;
  function blurring() {
    return blurTarget;
  }

  function commitRename(input) {
    var id = input.getAttribute("data-rename");
    var typed = String(input.value || "").trim();
    var current = input.getAttribute("data-current") || "";
    var original = input.getAttribute("data-original") || "";
    if (!typed || typed === current) {
      cancelRename(id);
      return;
    }
    saveRename(id, typed === original ? "" : typed);
  }

  function saveRename(reviewId, value) {
    renameDraft = { id: null, value: "" };
    if (!blurring()) focusKey(reviewId + ":rename");
    update(VM.beginRename(state, reviewId, value));
    var body = reviewId.indexOf("session:") === 0
      ? { session: reviewId.slice("session:".length), name: value }
      : { review: reviewId, name: value };
    call(ROUTE.rename, body).then(function (result) {
      update(VM.afterRename(state, reviewId, result, now()));
      poll();
    });
  }

  function cancelRename(reviewId) {
    renameDraft = { id: null, value: "" };
    if (!blurring()) focusKey(reviewId + ":rename");
    update(VM.withRenaming(state, null));
  }

  function copyHandoff(reviewId, message) {
    var done = function (ok) {
      update(VM.withCopied(state, reviewId, ok));
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      done(false);
      return;
    }
    navigator.clipboard.writeText(message).then(
      function () {
        done(true);
      },
      function () {
        done(false);
      }
    );
  }

  // One listener for every button the list draws. Buttons carry data-act and
  // data-review; nothing is bound per row, so a re-render leaks nothing.
  function onClick(event) {
    var btn = event.target.closest ? event.target.closest("[data-act]") : null;
    if (!btn || btn.disabled) return;
    var id = btn.getAttribute("data-review");
    var what = btn.getAttribute("data-act");
    if (what === "open") act(id, what);
    else if (what === "pickup" || what === "launch") {
      state = VM.withMenu(state, null);
      act(id, what);
    } else if (what === "menu") {
      if (btn.getAttribute("aria-expanded") === "true") update(VM.withMenu(state, null));
      else {
        focusKey(id + ":pickup");
        update(VM.withMenu(state, id));
      }
    }
    else if (what === "star") star(id, btn.getAttribute("aria-pressed") !== "true");
    else if (what === "rename") {
      event.preventDefault();
      startRename(id);
    } else if (what === "rename-session") {
      // Inside the card's summary: the click renames and does not fold the card.
      event.preventDefault();
      startRename("session:" + btn.getAttribute("data-session"));
    }
    else if (what === "pages") update(VM.withPagesOpen(state, id, btn.getAttribute("aria-expanded") !== "true"));
    else if (what === "more") update(VM.withCardMore(state, btn.getAttribute("data-card"), btn.getAttribute("aria-expanded") !== "true"));
    else if (what === "handoff") {
      focusKey(id + ":copy");
      update(VM.withPanel(state, id, btn.getAttribute("data-reason") || "no_agent"));
    } else if (what === "copy") copyHandoff(id, btn.getAttribute("data-message") || "");
    else if (what === "close-panel") update(VM.withPanel(state, null));
    else if (what === "show-missing") update(VM.withShowMissing(state, true));
    else if (what === "hide-missing") update(VM.withShowMissing(state, false));
    else if (what === "reload") window.location.reload();
    else if (what === "move") act(id, btn.getAttribute("data-action"), { confirmed: true });
    else if (what === "read") act(id, "open", { read: true });
    else if (what === "cancel") update(VM.withDialog(state, null));
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  // Build an element. Text goes in through textContent, attributes through
  // setAttribute; there is no path to HTML.
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") node.textContent = String(v);
        else node.setAttribute(k, v === true ? "" : String(v));
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  // A path as text with a break opportunity after each slash, so a long one
  // wraps between folders and never mid-name. No characters are added.
  function slashBreaks(text) {
    var out = [];
    String(text).split("/").forEach(function (part, i, all) {
      out.push(part + (i < all.length - 1 ? "/" : ""));
      if (i < all.length - 1) out.push(document.createElement("wbr"));
    });
    return out;
  }

  function button(label, attrs) {
    return h("button", Object.assign({ type: "button", class: "lib-btn", text: label }, attrs || {}));
  }

  function actionButton(row, key, primary) {
    var b = row.buttons[key];
    return button(b.label, {
      "data-act": key,
      "data-review": row.id,
      "data-key": row.id + ":" + key,
      "data-primary": primary ? "true" : null,
      "aria-busy": b.busy ? "true" : null,
      title: b.reason || null,
      disabled: !b.enabled
    });
  }

  // "3 waiting": the attention dot, then the word. Plain text, not a link.
  function waitingMark(text) {
    return h("span", { class: "lib-waiting" }, [h("span", { class: "lib-dot", "aria-hidden": "true" }), text]);
  }

  function renderRow(row, extra) {
    // Line one: the name alone. Line two: the document's real path, in the
    // mono face, a step smaller. Then the time and the counts.
    // The reviewer can rename a row: the Rename button or a double-click on
    // the name opens a field; Enter saves, Escape cancels, empty goes back to
    // the original. Their name is shown first, the original under it.
    var nameLine;
    if (row.rename.editing) {
      var typed = renameDraft.id === row.id ? renameDraft.value : row.rename.value;
      nameLine = h("p", { class: "lib-name lib-rename" }, [
        h("input", {
          type: "text",
          class: "lib-rename-input",
          "data-rename": row.id,
          "data-key": row.id + ":rename-input",
          "data-current": row.rename.value,
          "data-original": row.rename.original,
          value: typed,
          maxlength: "80",
          "aria-label": row.rename.label + ": " + row.rename.original,
          placeholder: row.rename.original
        })
      ]);
    } else {
      // The name is the rename control: a click, or Enter on it, edits it.
      nameLine = h("p", { class: "lib-name-line" }, [
        h("button", {
          type: "button",
          class: "lib-name",
          "data-act": "rename",
          "data-review": row.id,
          "data-key": row.id + ":rename",
          "aria-label": row.rename.label + ": " + row.name,
          title: row.rename.label,
          text: row.name
        })
      ]);
    }
    var main = h("div", { class: "lib-row-main" }, [
      nameLine,
      row.originalName ? h("p", { class: "lib-original", text: row.originalName }) : null,
      row.path ? h("p", { class: "lib-where", title: row.pathTitle || null }, slashBreaks(row.path)) : null
    ]);

    var facts = [h("span", { text: row.lastText })];
    if (extra) facts.push(h("span", { text: extra }));
    if (row.counts.waiting) facts.push(waitingMark(row.counts.waiting));
    facts.push(h("span", { text: row.counts.comments }));
    if (row.counts.asOf) facts.push(h("span", { text: row.counts.asOf }));
    row.badges.forEach(function (b) {
      var kind = b.indexOf("agent listening") === 0 || b.indexOf("agent working") === 0 ? "watching" : b === "being served now" ? "served" : "ended";
      facts.push(h("span", { class: "lib-badge", "data-badge": kind, text: b }));
    });
    if (row.folded) facts.push(h("span", { text: row.folded }));
    main.appendChild(h("div", { class: "lib-facts" }, facts));

    if (row.pagesToggle) {
      main.appendChild(
        h("p", { class: "lib-line" }, [
          button(row.pagesToggle.text, {
            "data-act": "pages",
            "data-review": row.id,
            "data-key": row.id + ":pages",
            "data-quiet": "true",
            "data-disclosure": "true",
            "aria-expanded": row.pagesToggle.expanded ? "true" : "false"
          })
        ])
      );
    }
    if (row.pages.length) {
      main.appendChild(
        h(
          "ul",
          { class: "lib-pages", "aria-label": "Pages" },
          row.pages.map(function (p) {
            return h("li", null, [h("span", { text: p.title }), p.title !== p.path ? h("span", { class: "lib-path", text: p.path }) : null]);
          })
        )
      );
    }

    row.notices.forEach(function (n) {
      main.appendChild(h("p", { class: "lib-line", "data-tone": n.tone, text: n.text }));
    });

    if (row.note) {
      var noteKids = [h("span", { class: "lib-mark", "aria-hidden": "true" }), h("span", { class: "lib-note-text", text: row.note.text })];
      if (row.note.copyHandoff) {
        noteKids.push(
          button(row.handoffLabel, {
            "data-act": "handoff",
            "data-reason": "refused",
            "data-review": row.id,
            "data-key": row.id + ":handoff",
            "data-quiet": "true"
          })
        );
      }
      main.appendChild(
        h("p", { class: "lib-note", "data-tone": row.note.tone, "data-busy": row.note.busy ? "true" : "false" }, noteKids)
      );
    }

    if (row.offerHandoff) {
      main.appendChild(
        h("p", { class: "lib-line" }, [
          button(row.handoffLabel, {
            "data-act": "handoff",
            "data-reason": "no_agent",
            "data-review": row.id,
            "data-key": row.id + ":handoff",
            "data-quiet": "true"
          })
        ])
      );
    }

    var starBtn = h("button", {
      type: "button",
      class: "lib-star",
      "data-act": "star",
      "data-review": row.id,
      "data-key": row.id + ":star",
      "aria-pressed": row.star.on ? "true" : "false",
      "aria-label": row.star.label,
      title: row.star.label,
      "aria-busy": row.star.pending ? "true" : null,
      disabled: !row.star.enabled || row.star.pending,
      text: row.star.on ? "\u2605" : "\u2606"
    });

    // Open is the one button a row shows at rest. Pick this up and Launch sit
    // behind one Hand to agent menu, drawn only while it is open.
    var actKids = [actionButton(row, "open", true)];
    var hand = row.buttons.handTo;
    if (!hand.hidden) {
      var menuId = "lib-menu-" + row.id;
      var menuWrap = h("div", { class: "lib-menu" }, [
        button(hand.label, {
          "data-act": "menu",
          "data-review": row.id,
          "data-key": row.id + ":menu",
          "aria-haspopup": "true",
          "aria-expanded": hand.expanded ? "true" : "false",
          "aria-controls": hand.expanded ? menuId : null,
          "aria-busy": hand.busy ? "true" : null,
          title: hand.reason || null,
          disabled: !hand.enabled
        })
      ]);
      if (hand.expanded) {
        menuWrap.appendChild(
          h("div", { class: "lib-menu-list", id: menuId, role: "group", "aria-label": hand.label }, [
            actionButton(row, "pickup", false),
            actionButton(row, "launch", false)
          ])
        );
      }
      actKids.push(menuWrap);
    }
    var acts = h("div", { class: "lib-acts" }, actKids);

    var kids = [starBtn, main, acts];
    if (row.panel) {
      kids.push(
        h("div", { class: "lib-panel", role: "region", "aria-label": row.handoffLabel }, [
          h("p", { text: row.panel.intro }),
          row.panel.message ? h("pre", { text: row.panel.message }) : null,
          h("div", { class: "lib-panel-acts" }, [
            row.panel.message
              ? button(row.panel.copyLabel, {
                  "data-act": "copy",
                  "data-review": row.id,
                  "data-key": row.id + ":copy",
                  "data-message": row.panel.message,
                  "data-primary": "true"
                })
              : null,
            button(row.panel.closeLabel, { "data-act": "close-panel", "data-review": row.id, "data-key": row.id + ":close" }),
            row.panel.copyStatus ? h("span", { class: "lib-copy-status", role: "status", text: row.panel.copyStatus }) : null
          ])
        ])
      );
    }
    return h("li", { "data-review": row.id }, [h("div", { class: "lib-row" }, kids)]);
  }

  // A card's title is its rename control, like a row's name; the original
  // name sits small under it once renamed.
  function cardTitle(card) {
    if (card.rename && card.rename.editing) {
      var key = "session:" + card.session;
      var typed = renameDraft.id === key ? renameDraft.value : card.rename.value;
      return h("span", { class: "lib-card-title" }, [
        h("input", {
          type: "text",
          class: "lib-rename-input",
          "data-rename": key,
          "data-key": key + ":rename-input",
          "data-current": card.rename.value,
          "data-original": card.rename.original,
          value: typed,
          maxlength: "80",
          "aria-label": card.rename.label + ": " + card.rename.original,
          placeholder: card.rename.original
        })
      ]);
    }
    var kids = [];
    if (card.rename) {
      kids.push(h("button", {
        type: "button",
        class: "lib-card-name",
        "data-act": "rename-session",
        "data-session": card.session,
        "data-key": "session:" + card.session + ":rename",
        "aria-label": card.rename.label + ": " + card.title,
        title: card.rename.label,
        text: card.title
      }));
    } else {
      kids.push(h("span", { text: card.title }));
    }
    if (card.originalTitle) kids.push(h("span", { class: "lib-card-original", text: card.originalTitle }));
    return h("span", { class: "lib-card-title" }, kids);
  }

  function renderCard(card) {
    var metaKids = card.projects.map(function (p) {
      return h("span", { class: "lib-project", text: p });
    });
    metaKids.push(h("span", { text: card.reviewsText }));
    // The card names its watcher once, with the watching dot the rows used to
    // carry each; nested, so the meta line's separator rule leaves it alone.
    metaKids.push(
      card.watched
        ? h("span", { class: "lib-card-watch" }, [h("span", { class: "lib-badge", "data-badge": "watching", text: card.watchText })])
        : h("span", { class: "lib-card-watch", text: card.watchText })
    );
    if (card.waitingText) metaKids.push(waitingMark(card.waitingText));
    metaKids.push(h("span", { text: card.lastText }));
    var body = [
      h("summary", { "data-key": "card:" + card.id }, [
        h("span", { class: "lib-chev", "aria-hidden": "true" }),
        cardTitle(card),
        h("span", { class: "lib-card-meta" }, metaKids)
      ])
    ];
    // What applies to every review of the card is said once, here.
    if (card.notes && card.notes.length) {
      body.push(h("div", { class: "lib-card-notes" }, card.notes.map(function (n) {
        return h("p", { class: "lib-line", "data-tone": n.tone, text: n.text });
      })));
    }
    body.push(h("ul", { class: "lib-rows" }, card.rows.map(function (r) {
      return renderRow(r, null);
    })));
    if (card.more) {
      body.push(h("p", { class: "lib-card-more" }, [
        button(card.more.text, {
          "data-act": "more",
          "data-card": card.id,
          "data-key": "more:" + card.id,
          "data-quiet": "true",
          "data-disclosure": "true",
          "aria-expanded": card.more.expanded ? "true" : "false"
        })
      ]));
    }
    var details = h("details", { class: "lib-card", "data-session": card.id, open: card.open }, body);
    details.addEventListener("toggle", function () {
      if (details.open !== card.open) update(VM.withExpanded(state, card.id, details.open));
    });
    return details;
  }

  function renderMain(view) {
    var kids = [];
    if (view.notice) kids.push(h("p", { class: "lib-notice", text: view.notice }));
    if (view.loading) kids.push(h("p", { class: "lib-quiet", id: "lahe-catalog-status", text: view.loading }));
    if (view.empty) kids.push(h("p", { class: "lib-quiet", "data-state": "empty", text: view.empty }));
    if (view.noMatches) kids.push(h("p", { class: "lib-quiet", "data-state": "no-matches", text: view.noMatches }));
    view.sections.forEach(function (section) {
      kids.push(
        h("section", { class: "lib-section", "data-section": section.id }, [
          h("h2", { text: section.heading }),
          section.subtitle ? h("p", { class: "lib-section-sub", text: section.subtitle }) : null
        ].concat(section.cards.map(renderCard)))
      );
    });
    if (view.missing) {
      if (view.missing.section) {
        var sec = view.missing.section;
        kids.push(
          h("section", { class: "lib-section lib-missing", "data-section": "missing" }, [
            h("div", { class: "lib-section-head" }, [
              h("h2", { text: sec.heading }),
              button(sec.hideText, { "data-act": "hide-missing", "data-key": "missing:toggle", "data-quiet": "true" })
            ]),
            h("ul", { class: "lib-rows" }, sec.rows.map(function (r) {
              return renderRow(r, r.sessionText);
            }))
          ])
        );
      } else {
        kids.push(
          h("p", { class: "lib-missing-toggle" }, [
            button(view.missing.toggleText, { "data-act": "show-missing", "data-key": "missing:toggle", "data-quiet": "true" })
          ])
        );
      }
    }
    els.main.replaceChildren.apply(els.main, kids);
  }

  function renderBanner(banner) {
    if (!banner) {
      els.banner.replaceChildren();
      return;
    }
    var kids = [h("p", { text: banner.text })];
    if (banner.action === "reload") kids.push(button(banner.actionLabel, { "data-act": "reload", "data-key": "banner:reload", "data-primary": "true" }));
    var existing = els.banner.firstChild;
    // The same banner, re-rendered, keeps its node so its arrival animation
    // plays once, when the state it reports actually changes.
    if (existing && existing.getAttribute("data-text") === banner.text) return;
    els.banner.replaceChildren(h("div", { class: "lib-banner-box", "data-tone": banner.tone, "data-text": banner.text }, kids));
  }

  var lastDialog = null;
  function renderDialog(dialog) {
    var el = els.dialog;
    var serial = dialog ? JSON.stringify(dialog) : null;
    if (!dialog) {
      lastDialog = null;
      if (el.open) el.close();
      el.replaceChildren();
      return;
    }
    // A poll while the dialog is up must not rebuild it under the reader's
    // focus.
    if (serial === lastDialog && el.open) return;
    lastDialog = serial;
    // What is known about the other agent comes first, then what moving it does.
    var kids = [
      h("h2", { id: "lahe-catalog-confirm-title", text: dialog.title }),
      dialog.status ? h("p", { class: "lib-dialog-status", text: dialog.status }) : null,
      h("p", { class: "lib-dialog-body", text: dialog.body })
    ].filter(Boolean);
    if (dialog.reviews.length) {
      kids.push(h("ul", { class: "lib-dialog-list" }, dialog.reviews.map(function (name) {
        return h("li", { text: name });
      })));
    }
    kids.push(
      h("div", { class: "lib-dialog-acts" }, dialog.buttons.map(function (b) {
        return button(b.label, {
          "data-act": b.id,
          "data-review": dialog.review,
          "data-action": dialog.action,
          "data-key": "dialog:" + b.id,
          "data-primary": b.id === "move" ? "true" : null,
          "data-quiet": b.id === "cancel" ? "true" : null
        });
      }))
    );
    el.replaceChildren.apply(el, kids);
    if (!el.open) el.showModal();
    var first = el.querySelector('[data-act="move"]');
    if (first) first.focus();
  }

  function renderProjects(projects) {
    var current = Array.prototype.map.call(els.project.options, function (o) {
      return o.value + "\u0000" + o.textContent;
    }).join("\u0001");
    var wanted = projects.options.map(function (o) {
      return o.value + "\u0000" + o.label;
    }).join("\u0001");
    if (current !== wanted) {
      els.project.replaceChildren.apply(
        els.project,
        projects.options.map(function (o) {
          return h("option", { value: o.value, text: o.label });
        })
      );
    }
    els.project.value = projects.value;
    els.project.hidden = projects.options.length <= 1;
  }

  var pendingFocus = null;
  function focusKey(key) {
    pendingFocus = key;
  }

  // True from the moment Open opens a tab until the reader is back on this
  // page: it takes focus, or they press a key or a pointer here.
  var awayInTab = false;
  function backOnPage() {
    if (!awayInTab) return;
    awayInTab = false;
    if (pendingFocus !== null) render();
  }
  window.addEventListener("focus", backOnPage);
  document.addEventListener("pointerdown", backOnPage, true);
  document.addEventListener("keydown", backOnPage, true);

  function render() {
    var view = VM.build(list, state, now(), {});
    var serial = JSON.stringify(view);
    if (serial === lastRendered && pendingFocus === null) return;
    lastRendered = serial;

    var active = document.activeElement;
    var activeKey = active && active.getAttribute ? active.getAttribute("data-key") : null;

    els.agent.textContent = view.agent.text;
    els.agent.setAttribute("data-attached", view.agent.attached ? "true" : "false");
    els.search.placeholder = view.search.placeholder;
    if (els.search.value !== view.search.value) els.search.value = view.search.value;
    renderProjects(view.projects);
    renderBanner(view.banner);
    renderMain(view);
    renderDialog(view.dialog);

    // A re-render replaces the list's nodes, so the reader's focus is put back
    // on the same control by key: a keyboard user is not thrown to the top of
    // the page every POLL_MS.
    var key = pendingFocus || activeKey;
    pendingFocus = null;
    // Not while the reader is away in a tab Open just opened. A render here
    // focused the Open button again, and in Firefox focusing an element in
    // the Library pulled focus back from the new tab, so the comment box the
    // reader opened in the document never got the keyboard. The key waits
    // until the reader is back on this page.
    if (key && awayInTab) {
      pendingFocus = key;
      key = null;
    }
    if (key && !(view.dialog && els.dialog.open)) {
      var target = els.main.querySelector('[data-key="' + cssEscape(key) + '"]') || els.banner.querySelector('[data-key="' + cssEscape(key) + '"]');
      if (target && target !== document.activeElement) target.focus();
    }
  }

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  els.main.addEventListener("click", onClick);
  els.banner.addEventListener("click", onClick);
  els.dialog.addEventListener("click", onClick);
  // Escape closes a modal dialog by itself; the close lands here and means Cancel.
  els.dialog.addEventListener("close", function () {
    if (state.dialog) update(VM.withDialog(state, null));
  });
  // Escape closes an open Hand to agent menu and puts focus back on its button.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !state.menu) return;
    focusKey(state.menu + ":menu");
    update(VM.withMenu(state, null));
  });
  // The rename field: typing is kept across redraws; Enter saves, Escape
  // cancels (and closes nothing else).
  els.main.addEventListener("input", function (event) {
    var id = event.target && event.target.getAttribute && event.target.getAttribute("data-rename");
    if (id) renameDraft = { id: id, value: event.target.value };
  });
  els.main.addEventListener("keydown", function (event) {
    var id = event.target && event.target.getAttribute && event.target.getAttribute("data-rename");
    if (!id) return;
    if (event.key === "Enter") {
      event.preventDefault();
      renameClosing = true;
      commitRename(event.target);
      renameClosing = false;
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      renameClosing = true;
      cancelRename(id);
      renameClosing = false;
    }
  });
  // Clicking outside, or tabbing away, saves like Enter.
  els.main.addEventListener("focusout", function (event) {
    var input = event.target;
    if (renameClosing || !input || !input.getAttribute || !input.getAttribute("data-rename")) return;
    if (!input.isConnected) return;
    renameClosing = true;
    blurTarget = true;
    commitRename(input);
    blurTarget = false;
    renameClosing = false;
  });
  els.search.addEventListener("input", function () {
    update(VM.withQuery(state, els.search.value));
  });
  els.project.addEventListener("change", function () {
    update(VM.withProject(state, els.project.value));
  });

  render();
  poll();
  timer = setInterval(poll, protocol.CATALOG.POLL_MS);
})();
