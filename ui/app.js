// CHAYLUEKLAB AI COMMAND CENTER
// Core UI shell: host bridge, shared store, router, sidebar, modal/toast and UI helpers.

"use strict";

window.__errors = [];

window.addEventListener("error", e =>
  window.__errors.push(String(e.message))
);

window.addEventListener("unhandledrejection", e =>
  window.__errors.push(String(e.reason))
);

// Optional artwork may not exist.
// If an optional image fails, remove it and keep the fallback initials.
document.addEventListener(
  "error",
  e => {
    if (e.target.matches?.("img[data-optional]")) {
      e.target.remove();
    }
  },
  true
);

const App = (() => {

  // ============================================================
  // HOST BRIDGE
  // C# MainWindow.Dispatch / WebView2
  // ============================================================

  const pending = new Map();
  const subs = new Map();

  let seq = 0;

  const webview =
    window.chrome &&
    window.chrome.webview;

  if (webview) {
    webview.addEventListener("message", e => {
      const m = e.data;

      if (m.sub != null) {
        const h = subs.get(m.sub);

        if (h) h(m);

        return;
      }

      if (m.nav) {
        go(m.nav);
        return;
      }

      const p = pending.get(m.id);

      if (!p) return;

      pending.delete(m.id);

      m.ok
        ? p.resolve(m.result)
        : p.reject(new Error(m.error || "error"));
    });
  }

  function call(op, args) {

    if (!webview) {
      return Promise.reject(
        new Error(
          "ต้องเปิดผ่านแอป CHAYLUEKLAB AI COMMAND CENTER"
        )
      );
    }

    return new Promise((resolve, reject) => {

      const id = ++seq;

      pending.set(id, {
        resolve,
        reject
      });

      webview.postMessage({
        id,
        op,
        args: args || {}
      });

    });
  }

  // ============================================================
  // STREAMING
  // ============================================================

  function subscribe(op, args, onMsg) {

    const sub = ++seq;

    subs.set(sub, onMsg);

    call(
      op,
      Object.assign(
        {
          sub
        },
        args
      )
    ).catch(err =>
      onMsg({
        sub,
        error: err.message
      })
    );

    return () => {

      subs.delete(sub);

      call("sub.close", {
        sub
      }).catch(() => {});

    };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  const $ = (
    sel,
    root = document
  ) => root.querySelector(sel);

  const esc = s =>
    String(
      s == null
        ? ""
        : s
    ).replace(
      /[&<>"']/g,
      c =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[c])
    );

  // ============================================================
  // ICONS
  // ============================================================

  const ICONS = {

    plus:
      '<path d="M12 5v14M5 12h14"/>',

    activity:
      '<path d="M3 12h4l3 8 4-16 3 8h4"/>',

    send:
      '<path d="M5 12h14M13 6l6 6-6 6"/>',

    play:
      '<path d="M7 5v14l11-7z"/>',

    stop:
      '<rect x="6" y="6" width="12" height="12" rx="2"/>',

    refresh:
      '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',

    external:
      '<path d="M14 4h6v6M10 14 20 4M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',

    x:
      '<path d="M6 6l12 12M18 6 6 18"/>',

    users:
      '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',

    terminal:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>',

    monitor:
      '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',

    check:
      '<path d="m5 12 5 5 9-10"/>',

    sparkles:
      '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',

    chat:
      '<path d="M4 5h16v11H9l-5 4z"/>',

    chevron:
      '<path d="m9 6 6 6-6 6"/>',

    trash:
      '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',

    inbox:
      '<path d="M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z"/>',

    clock:
      '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',

    brain:
      '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h1V4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h-1V4z"/>',

    edit:
      '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',

    folder:
      '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',

    coin:
      '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-.9-1.4-1.3-2.5-1.3-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.3 5 3.9 0 1.1-1 1.9-2.5 1.9-1.1 0-2-.4-2.5-1.3M12 6.5v1.7M12 15.8v1.7"/>',

    book:
      '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6M9 10.5h6"/>',

    clip:
      '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>'
  };

  const icon = (
    n,
    cls = "i"
  ) =>
    `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[n] || ""}</svg>`;

  // ============================================================
  // CHAYLUEKLAB BRAND PALETTE
  // ============================================================

  const PALETTE = [

    ["#d4af37", "#8f6b18"],

    ["#5e0b15", "#b32134"],

    ["#181818", "#d4af37"],

    ["#222222", "#777777"],

    ["#3b0a10", "#8e1d2c"],

    ["#917226", "#d4af37"],

    ["#101010", "#5e0b15"],

    ["#272727", "#b28a2e"]

  ];

  // ============================================================
  // AGENT PORTRAITS
  //
  // รองรับทั้งชื่อทีม CHAYLUEKLAB ใหม่
  // และชื่อทีมข่าวเดิมระหว่างช่วง Migration
  // ============================================================

  const PORTRAITS = {

    // CHAYLUEKLAB TEAM

    "CHAYLUEKLAB Boss":
      "editor-in-chief",

    "Web Agent":
      "news-editor",

    "Content Agent":
      "reporter-ai",

    "LINE Agent":
      "reporter-gadget",

    "Affiliate Agent":
      "reporter-software",

    "Ads Agent":
      "reporter-startup",

    "Research Agent":
      "reporter-security",

    "Automation Agent":
      "reporter-gaming",

    "Analytics Agent":
      "reporter-cloud",

    "SEO Agent":
      "reporter-policy",

    "QA Agent 1":
      "checker-1",

    "QA Agent 2":
      "checker-2",

    "Editor Agent":
      "copy-editor",

    "Social Agent":
      "social",

    "Design Agent":
      "photo",

    // LEGACY NEWSROOM NAMES
    // เก็บไว้ชั่วคราวจนกว่า seed-bots.mjs จะเปลี่ยนเสร็จ

    "บก.บห.":
      "editor-in-chief",

    "หัวหน้าข่าว":
      "news-editor",

    "นักข่าว AI":
      "reporter-ai",

    "นักข่าว Gadget":
      "reporter-gadget",

    "นักข่าวซอฟต์แวร์":
      "reporter-software",

    "นักข่าวสตาร์ทอัพ":
      "reporter-startup",

    "นักข่าวไซเบอร์":
      "reporter-security",

    "นักข่าวเกม":
      "reporter-gaming",

    "นักข่าวคลาวด์":
      "reporter-cloud",

    "นักข่าวนโยบายเทค":
      "reporter-policy",

    "ผู้ตรวจข่าว 1":
      "checker-1",

    "ผู้ตรวจข่าว 2":
      "checker-2",

    "บก.ต้นฉบับ":
      "copy-editor",

    "ฝ่ายโซเชียล":
      "social",

    "ฝ่ายภาพ":
      "photo"
  };

  // ============================================================
  // AVATAR
  // ============================================================

  function hash(s) {

    let h = 0;

    for (
      const c of String(s)
    ) {
      h =
        (
          h * 31 +
          c.codePointAt(0)
        ) | 0;
    }

    return Math.abs(h);
  }

  function avatar(
    name,
    opts = {}
  ) {

    const [
      a,
      b
    ] =
      PALETTE[
        (
          opts.color != null
            ? opts.color
            : hash(name)
        ) %
        PALETTE.length
      ];

    const letter =
      esc(
        (
          String(
            name || ""
          ).match(
            /[ก-ฮA-Za-z0-9]/
          ) || ["?"]
        )[0]
      ).toUpperCase();

    const face =
      Object.hasOwn(
        PORTRAITS,
        name
      ) &&
      PORTRAITS[name];

    return `
      <div
        class="av ${opts.size || ""} ${opts.state || ""}${face ? " photo" : ""}"
        style="background:linear-gradient(145deg,${a},${b})"
      >
        ${letter}
        ${
          face
            ? `<img src="avatars/${face}.png" alt="" data-optional>`
            : ""
        }
      </div>
    `;
  }

  // ============================================================
  // NUMBER ANIMATION
  // ============================================================

  function animateNumber(
    el,
    to,
    decimals = 0,
    suffix = ""
  ) {

    if (!el) return;

    const from =
      parseFloat(
        el.dataset.v || "0"
      );

    const start =
      performance.now();

    const dur = 700;

    el.dataset.v = to;

    const fmt = v =>
      v.toLocaleString(
        "en-US",
        {
          minimumFractionDigits:
            decimals,

          maximumFractionDigits:
            decimals
        }
      ) + suffix;

    if (from === to) {

      el.textContent =
        fmt(to);

      return;
    }

    const step = t => {

      const k =
        Math.min(
          1,
          (
            t -
            start
          ) /
          dur
        );

      const e =
        1 -
        Math.pow(
          1 - k,
          3
        );

      el.textContent =
        fmt(
          from +
          (
            to -
            from
          ) *
          e
        );

      if (k < 1) {
        requestAnimationFrame(
          step
        );
      }
    };

    requestAnimationFrame(
      step
    );
  }

  // ============================================================
  // RELATIVE TIME
  // ============================================================

  function relTime(ts) {

    if (!ts) return "";

    const d =
      new Date(ts);

    const now =
      new Date();

    const diff =
      (
        now -
        d
      ) /
      1000;

    if (diff < 60) {
      return "เมื่อสักครู่";
    }

    if (diff < 3600) {
      return (
        Math.floor(
          diff / 60
        ) +
        " นาที"
      );
    }

    if (
      d.toDateString() ===
      now.toDateString()
    ) {
      return d.toLocaleTimeString(
        "th-TH",
        {
          hour:
            "2-digit",

          minute:
            "2-digit"
        }
      );
    }

    const y =
      new Date(now);

    y.setDate(
      now.getDate() -
      1
    );

    if (
      d.toDateString() ===
      y.toDateString()
    ) {
      return "เมื่อวาน";
    }

    return d.toLocaleDateString(
      "th-TH",
      {
        day:
          "numeric",

        month:
          "short"
      }
    );
  }

  // ============================================================
  // TOAST
  // ============================================================

  function toast(
    text,
    kind = ""
  ) {

    const el =
      document.createElement(
        "div"
      );

    el.className =
      "toast";

    el.innerHTML =
      `
        <span class="dot ${kind}"></span>
        <span>${esc(text)}</span>
      `;

    $("#toasts")
      .appendChild(el);

    setTimeout(
      () => {

        el.classList.add(
          "out"
        );

        setTimeout(
          () =>
            el.remove(),
          300
        );

      },
      3600
    );
  }

  // ============================================================
  // MODAL
  // ============================================================

  const inertBehind =
    () => {

      const open =
        [
          ...document.querySelectorAll(
            ".scrim:not(.out)"
          )
        ];

      const top =
        open.at(-1);

      $(".app").inert =
        !!top;

      for (
        const s of
        document.querySelectorAll(
          ".scrim"
        )
      ) {

        const out =
          s.classList.contains(
            "out"
          );

        s.inert =
          !out &&
          s !== top;

        s.firstElementChild.inert =
          out;
      }
    };

  function modal(
    html,
    {
      wide = false,
      onClose
    } = {}
  ) {

    const scrim =
      document.createElement(
        "div"
      );

    scrim.className =
      "scrim";

    scrim.innerHTML =
      `
        <div
          class="modal ${wide ? "wide" : ""}"
          role="dialog"
          tabindex="-1"
        >
          ${html}
        </div>
      `;

    const back =
      document.activeElement;

    const close =
      () => {

        if (
          scrim.classList.contains(
            "out"
          )
        ) {
          return;
        }

        scrim.classList.add(
          "out"
        );

        setTimeout(
          () =>
            scrim.remove(),
          500
        );

        document.removeEventListener(
          "keydown",
          onKey
        );

        inertBehind();

        if (
          back?.isConnected &&
          (
            back.closest(
              ".scrim:not(.out)"
            ) ||
            !document.querySelector(
              ".scrim:not(.out)"
            )
          )
        ) {
          back.focus();
        }

        if (onClose) {
          onClose();
        }
      };

    const onKey =
      e => {

        if (
          e.key ===
          "Escape" &&
          scrim ===
          [
            ...document.querySelectorAll(
              ".scrim:not(.out)"
            )
          ].pop()
        ) {
          close();
        }
      };

    const opened =
      performance.now();

    const echo =
      e =>
        e.detail > 1 &&
        performance.now() -
        opened <
        500;

    scrim.addEventListener(
      "click",
      e => {

        if (
          echo(e)
        ) {

          e.preventDefault();

          e.stopPropagation();
        }
      },
      true
    );

    scrim.addEventListener(
      "mousedown",
      e => {

        if (
          e.target !==
          scrim
        ) {
          return;
        }

        e.preventDefault();

        if (
          !echo(e)
        ) {
          close();
        }
      }
    );

    document.addEventListener(
      "keydown",
      onKey
    );

    document.body.appendChild(
      scrim
    );

    inertBehind();

    const el =
      $(
        ".modal",
        scrim
      );

    (
      el.querySelector(
        "textarea, input:not([type=checkbox]):not([type=radio]), select"
      ) ||
      el
    ).focus({
      preventScroll:
        true
    });

    return {
      el,
      close
    };
  }

  // ============================================================
  // CONFIRM
  // ============================================================

  function confirm({
    title,
    body,
    ok = "ยืนยัน",
    danger = false
  }) {

    return new Promise(
      resolve => {

        let done =
          false;

        const m =
          modal(
            `
              <h2>${esc(title)}</h2>

              <div
                class="muted"
                style="white-space:pre-line"
              >
                ${esc(body)}
              </div>

              <div class="actions">

                <button
                  class="btn ghost"
                  data-a="no"
                >
                  ยกเลิก
                </button>

                <button
                  class="btn ${danger ? "danger" : "primary"}"
                  data-a="yes"
                >
                  ${esc(ok)}
                </button>

              </div>
            `,
            {
              onClose:
                () => {

                  if (!done) {
                    resolve(false);
                  }

                }
            }
          );

        m.el.addEventListener(
          "click",
          e => {

            const a =
              e.target.closest(
                "[data-a]"
              );

            if (!a) return;

            done =
              true;

            resolve(
              a.dataset.a ===
              "yes"
            );

            m.close();
          }
        );

        setTimeout(
          () =>
            $(
              danger
                ? '[data-a="no"]'
                : '[data-a="yes"]',
              m.el
            ).focus(),
          50
        );
      }
    );
  }

  // ============================================================
  // ACTION HELPER
  // ============================================================

  async function act(
    btn,
    label,
    op,
    args
  ) {

    const html =
      btn
        ? btn.innerHTML
        : "";

    if (btn) {

      btn.disabled =
        true;

      btn.innerHTML =
        `
          <span class="spin"></span>
          ${esc(label)}
        `;
    }

    try {

      const r =
        await call(
          op,
          args
        );

      toast(
        label +
        " สำเร็จ",
        "good"
      );

      return r;

    } catch (e) {

      toast(
        label +
        " ไม่สำเร็จ: " +
        e.message,
        "bad"
      );

      throw e;

    } finally {

      if (btn) {

        btn.disabled =
          false;

        btn.innerHTML =
          html;
      }

      refresh();
    }
  }

  // ============================================================
  // SYSTEM SNAPSHOT STORE
  // ============================================================

  const store = {

    snap:
      null,

    history: {

      vram:
        [],

      gpu:
        [],

      tps:
        [],

      cpu:
        []
    },

    listeners:
      new Set()
  };

  let polling =
    false;

  async function refresh() {

    if (polling) {
      return;
    }

    polling =
      true;

    try {

      const s =
        await call(
          "snapshot"
        );

      store.snap =
        s;

      const h =
        store.history;

      const push =
        (
          k,
          v
        ) => {

          h[k].push(
            v
          );

          if (
            h[k].length >
            100
          ) {
            h[k].shift();
          }
        };

      if (s.gpu) {

        push(
          "vram",
          100 *
          s.gpu.vramUsed /
          s.gpu.vramTotal
        );

        push(
          "gpu",
          s.gpu.util
        );
      }

      push(
        "tps",
        s.llm.tps
      );

      push(
        "cpu",
        s.cpuPct
      );

      store.listeners.forEach(
        fn =>
          fn(s)
      );

    } catch (e) {

      // Host may be busy.
      // Next refresh retries.

    } finally {

      polling =
        false;
    }
  }

  const onSnapshot =
    fn => {

      store.listeners.add(
        fn
      );

      if (
        store.snap
      ) {
        fn(
          store.snap
        );
      }

      return () =>
        store.listeners.delete(
          fn
        );
    };

  // ============================================================
  // ROUTER
  // ============================================================

  const views =
    {};

  let current =
    null;

  let cleanup =
    null;

  function register(
    type,
    render
  ) {

    views[type] =
      render;
  }

  function go(route) {

    current =
      route;

    if (cleanup) {

      cleanup();

      cleanup =
        null;
    }

    const main =
      $("#main");

    main.innerHTML =
      "";

    const view =
      document.createElement(
        "section"
      );

    view.className =
      "view";

    main.appendChild(
      view
    );

    cleanup =
      (
        views[route.type] ||
        views.home
      )(
        view,
        route
      ) ||
      null;

    renderSide();
  }

  const route =
    () =>
      current;

  // ============================================================
  // SIDEBAR
  // ============================================================

  const sideSections =
    [];

  const THEMES = [

    [
      "system",
      "🖥 ระบบ"
    ],

    [
      "light",
      "☀️ สว่าง"
    ],

    [
      "dark",
      "🌙 Dark"
    ]
  ];

  function renderSide() {

    const q =
      (
        $("#search").value ||
        ""
      )
        .trim()
        .toLowerCase();

    const list =
      $("#sideList");

    const html =
      sideSections
        .map(
          s =>
            s.render(q)
        )
        .join("");

    if (
      html !==
      list.dataset.html
    ) {

      list.innerHTML =
        html;

      list.dataset.html =
        html;

      if (
        !list.dataset.settled &&
        list.querySelector(
          ".item[data-id]"
        )
      ) {

        setTimeout(
          () => {

            list.dataset.settled =
              1;

          },
          900
        );
      }
    }

    sideSections.forEach(
      s =>
        s.bind &&
        s.bind(list)
    );

    renderFoot();
  }

  // ============================================================
  // LLM MODE
  // ============================================================

  let llmMode =
    null;

  const LLM_MODES = [

    [
      "local",
      "🖥 Local"
    ],

    [
      "bcai",
      "🔀 BCAiRouter"
    ]
  ];

  const LLM_TOAST = {

    bcai:
      "AI Agent ทุกตัวใช้ BCAiRouter แล้ว"
  };

  async function setLlmMode(
    mode
  ) {

    try {

      llmMode =
        (
          await call(
            "llm.mode.set",
            {
              mode
            }
          )
        ).mode;

      toast(
        LLM_TOAST[
          llmMode
        ] ||
        "AI Agent ทุกตัวใช้ Local model แล้ว",
        "good"
      );

    } catch (e) {

      toast(
        "สลับโหมดไม่สำเร็จ: " +
        e.message,
        "bad"
      );
    }

    renderFoot();
  }

  // ============================================================
  // SIDEBAR FOOTER
  // ============================================================

  function renderFoot() {

    const s =
      store.snap;

    const llm =
      s &&
      s.llm;

    const rk =
      s &&
      s.rakazo;

    const llmDot =
      !s
        ? ""
        : llm.health ===
          "พร้อม"
          ? "good"
          : llm.process
            ? "warn"
            : "bad";

    const rkDot =
      !s
        ? ""
        : rk.health.startsWith(
            "พร้อม"
          )
          ? "good"
          : "bad";

    const q =
      llmMode ===
      "local" &&
      llm &&
      (
        llm.busy ||
        llm.deferred
      )
        ? `
          <span
            class="muted"
            style="font-size:11px;margin-left:6px"
          >
            🧠
            ${llm.busy}
            กำลังคิด
            ${
              llm.deferred
                ? ` · ${llm.deferred} รอคิว`
                : ""
            }
          </span>
        `
        : "";

    $("#sideFoot").innerHTML =
      `

      ${
        llmMode
          ? `
            <div
              class="llm-mode"
              title="โมเดล AI ที่ Agent ทุกตัวใช้"
            >
              ${
                LLM_MODES
                  .map(
                    ([m, t]) =>
                      `
                        <button
                          class="${m === llmMode ? "on" : ""}"
                          data-mode="${m}"
                        >
                          ${t}
                        </button>
                      `
                  )
                  .join("")
              }
            </div>
          `
          : ""
      }

      <div
        class="llm-mode"
        title="ธีม CHAYLUEKLAB"
      >
        ${
          THEMES
            .map(
              ([t, l]) =>
                `
                  <button
                    class="${t === Theme.choice() ? "on" : ""}"
                    data-theme-pick="${t}"
                  >
                    ${l}
                  </button>
                `
            )
            .join("")
        }
      </div>

      <div
        class="nav ${current && current.type === "desk" ? "active" : ""}"
        data-go="desk"
      >
        ${icon("book")}

        <span class="grow">
          ศูนย์บัญชาการ
        </span>
      </div>

      <div
        class="nav ${current && current.type === "work" ? "active" : ""}"
        data-go="work"
      >
        ${icon("inbox")}

        <span class="grow">
          ศูนย์งาน
        </span>

        ${
          store.waiting
            ? `
              <span
                class="badge"
                title="งานที่รออนุมัติ"
              >
                ${store.waiting}
              </span>
            `
            : ""
        }
      </div>

      <div
        class="nav ${current && current.type === "monitor" ? "active" : ""}"
        data-go="monitor"
      >
        ${icon("activity")}

        <span class="grow">
          System Monitor
          ${q}
        </span>

        <span
          class="dot ${llmDot}"
          title="LLM"
        ></span>

        <span
          class="dot ${rkDot}"
          title="Rakazo"
        ></span>
      </div>
    `;

    $("#sideFoot")
      .querySelectorAll(
        "[data-go]"
      )
      .forEach(
        n =>
          n.onclick =
            () =>
              go({
                type:
                  n.dataset.go
              })
      );

    $("#sideFoot")
      .querySelectorAll(
        "[data-mode]"
      )
      .forEach(
        b =>
          b.onclick =
            () =>
              setLlmMode(
                b.dataset.mode
              )
      );

    $("#sideFoot")
      .querySelectorAll(
        "[data-theme-pick]"
      )
      .forEach(
        b =>
          b.onclick =
            () => {

              Theme.set(
                b.dataset.themePick
              );

              renderSide();
            }
      );
  }

  // ============================================================
  // AUTOSTART SERVICES
  // ============================================================

  async function autostart() {

    await refresh();

    const s =
      store.snap;

    if (!s) {
      return;
    }

    const jobs =
      [];

    if (
      !s.llm.process
    ) {
      jobs.push([
        "llm.start",
        "เปิด AI Engine"
      ]);
    }

    if (
      !s.rakazo.health.startsWith(
        "พร้อม"
      )
    ) {
      jobs.push([
        "rakazo.start",
        "เปิด Agent Engine"
      ]);
    }

    for (
      const [
        op,
        label
      ] of jobs
    ) {

      toast(
        label +
        "…"
      );

      call(op).then(
        () => {

          toast(
            label +
            " สำเร็จ",
            "good"
          );

          refresh();

          document.dispatchEvent(
            new CustomEvent(
              "app:services"
            )
          );

        },

        e =>
          toast(
            label +
            " ไม่สำเร็จ: " +
            e.message,
            "bad"
          )
      );
    }
  }

  // ============================================================
  // START
  // ============================================================

  function start() {

    $("#search")
      .addEventListener(
        "input",
        renderSide
      );

    $("#brand").onclick =
      () =>
        go({
          type:
            "home"
        });

    $("#brand").onkeydown =
      e => {

        if (
          e.key ===
          "Enter" ||
          e.key ===
          " "
        ) {

          e.preventDefault();

          go({
            type:
              "home"
          });
        }
      };

    onSnapshot(
      renderFoot
    );

    let modeLoading =
      false;

    let modeAt =
      0;

    onSnapshot(
      snap => {

        if (
          modeLoading ||
          Date.now() -
          modeAt <
          30000 ||
          !snap.rakazo.health.startsWith(
            "พร้อม"
          )
        ) {
          return;
        }

        modeLoading =
          true;

        call(
          "llm.mode"
        )
          .then(
            m => {

              modeAt =
                Date.now();

              if (
                m.mode !==
                llmMode
              ) {

                llmMode =
                  m.mode;

                renderFoot();
              }
            },

            () => {}
          )
          .finally(
            () => {

              modeLoading =
                false;

            }
          );
      }
    );

    autostart();

    // Refresh status every 3 seconds.
    setInterval(
      refresh,
      3000
    );

    // Keep Agent infrastructure alive.
    setInterval(
      () => {

        if (
          store.snap
            ?.rakazo
            ?.health
            ?.startsWith(
              "พร้อม"
            )
        ) {

          call(
            "rakazo.revive"
          ).catch(
            () => {}
          );
        }
      },
      60000
    );

    document.dispatchEvent(
      new CustomEvent(
        "app:start"
      )
    );

    if (!current) {

      go({
        type:
          "home"
      });
    }
  }

  window.addEventListener(
    "DOMContentLoaded",
    () =>
      start()
  );

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {

    PALETTE,

    call,

    subscribe,

    $,

    esc,

    icon,

    avatar,

    animateNumber,

    relTime,

    toast,

    modal,

    confirm,

    act,

    store,

    refresh,

    onSnapshot,

    register,

    go,

    route,

    renderSide,

    sideSections
  };

})();
