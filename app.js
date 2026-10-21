(function () {
  "use strict";

  /* =========================================================================
     日常打卡 · 共享内核 app.js
     v1.2
       - 本地多账号：注册 / 登录 / 切换账号 / 数据隔离
       - 每日「应完成项数」快照，供统计与项目总台算历史完成率

     隔离方式 —— 每个账号一套独立的 localStorage 命名空间：
       petlog_tasks__<账号>    任务
       petlog_records__<账号>  打卡记录（键 yyyy-mm-dd -> taskId 数组）
       petlog_totals__<账号>   每日应完成项数快照
       petlog_theme__<账号>    外观主题
     账号表 petlog_users，当前登录态 petlog_session。

     说明：纯前端原型，账号只存在于当前浏览器，不上云、不跨设备；
     密码仅做本地散列（非加密），不具备生产环境安全性。
     ========================================================================= */

  var BASE_T = "petlog_tasks";
  var BASE_R = "petlog_records";
  var BASE_THEME = "petlog_theme";
  var BASE_TOTALS = "petlog_totals";
  var USERS_KEY = "petlog_users";
  var SESSION_KEY = "petlog_session";
  var MAX_USERS = 8;

  /* ------------------------------ 基础工具 ------------------------------ */

  function uid() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function ymd(d) {
    return (
      d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }
  function today() { return ymd(new Date()); }

  function readJSON(key, fallback) {
    if (!key) return fallback;
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, val) {
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(val));
  }

  function normName(u) { return String(u == null ? "" : u).trim().toLowerCase(); }

  function makeSalt() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }
  /* 口令散列：用于避免明文落盘，属于演示级实现，不是加密算法 */
  function hashPwd(pwd, salt) {
    var s = salt + "::" + String(pwd == null ? "" : pwd) + "::petlog";
    var h1 = 5381, h2 = 52711;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = ((h1 << 5) + h1) ^ c;
      h2 = ((h2 << 5) + h2) + c * (i + 7);
    }
    return (h1 >>> 0).toString(36) + "-" + (h2 >>> 0).toString(36);
  }

  /* ------------------------------ 账号存储 ------------------------------ */

  var currentName = "";

  function loadSession() {
    try { currentName = localStorage.getItem(SESSION_KEY) || ""; } catch (e) { currentName = ""; }
  }
  function getUsers() {
    var arr = readJSON(USERS_KEY, null);
    return Array.isArray(arr) ? arr : [];
  }
  function saveUsers(arr) { writeJSON(USERS_KEY, arr); }
  function findUser(username) {
    var k = normName(username);
    if (!k) return null;
    var arr = getUsers();
    for (var i = 0; i < arr.length; i++) {
      if (normName(arr[i].u) === k) return arr[i];
    }
    return null;
  }
  function currentUser() {
    if (!currentName) return null;
    return findUser(currentName);
  }

  /* 每个账号一套命名空间，互不覆盖 */
  function keyT() { return currentName ? BASE_T + "__" + normName(currentName) : null; }
  function keyR() { return currentName ? BASE_R + "__" + normName(currentName) : null; }
  function keyTheme() { return currentName ? BASE_THEME + "__" + normName(currentName) : null; }
  function keyTotals() { return currentName ? BASE_TOTALS + "__" + normName(currentName) : null; }
  function initFlagKey() { return currentName ? "petlog_init__" + normName(currentName) : null; }

  /* 首次运行：建立内置账号，并把旧版无账号时期的数据迁移进来 */
  function ensureFirstUser() {
    if (getUsers().length) return;
    var legacyT = null, legacyR = null, legacyTh = null;
    try {
      legacyT = localStorage.getItem(BASE_T);
      legacyR = localStorage.getItem(BASE_R);
      legacyTh = localStorage.getItem(BASE_THEME);
    } catch (e) {}

    var u = { u: "local", n: "本地用户", s: makeSalt(), at: Date.now() };
    u.p = hashPwd("123456", u.s);
    saveUsers([u]);

    try {
      if (legacyT) { localStorage.setItem(BASE_T + "__local", legacyT); localStorage.removeItem(BASE_T); }
      if (legacyR) { localStorage.setItem(BASE_R + "__local", legacyR); localStorage.removeItem(BASE_R); }
      if (legacyTh) { localStorage.setItem(BASE_THEME + "__local", legacyTh); localStorage.removeItem(BASE_THEME); }
    } catch (e) {}
  }

  /* ------------------------------ 业务数据 ------------------------------ */

  function seedIfEmpty() {
    var flag = initFlagKey();
    if (!flag) return;
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, "1");
    if (sink.getTasks().length) return;
    var d = today();
    var base = [
      { name: "每天晚上背30个英语单词", type: "循环任务" },
      { name: "每天喝水8杯", type: "循环任务" },
      { name: "晨跑/锻炼30分钟", type: "循环任务" }
    ];
    var arr = base.map(function (t) {
      return {
        id: uid(), name: t.name, type: t.type,
        cycle: "每天", start: d, end: "", enable: true, target: ""
      };
    });
    sink.saveTasks(arr);
  }

  /* 每天记录一次「当日应完成项数」快照，供统计与项目总台算历史完成率 */
  function enabledCount() {
    return sink.getTasks().filter(function (t) { return t.enable !== false; }).length;
  }
  function snapshotToday() {
    var key = keyTotals();
    if (!key) return;
    var map = readJSON(key, {});
    var n = enabledCount();
    if (n > 0) map[today()] = n;
    writeJSON(key, map);
  }
  function totalsOn(date) {
    if (date === today()) return enabledCount();
    var map = readJSON(keyTotals(), {});
    return map[date] || 0;
  }

  function setDone(taskId, date, done) {
    var map = readJSON(keyR(), {});
    var list = map[date] ? map[date].slice() : [];
    var idx = list.indexOf(taskId);
    if (done && idx === -1) list.push(taskId);
    if (!done && idx > -1) {
      list.splice(idx, 1);
      if (list.length === 0) delete map[date];
    }
    if (done) map[date] = list;
    writeJSON(keyR(), map);
  }
  function isDone(taskId, date) {
    var map = readJSON(keyR(), {});
    return !!(map[date] && map[date].indexOf(taskId) > -1);
  }
  function recordsBetween(from, to) {
    var map = readJSON(keyR(), {});
    var out = {};
    Object.keys(map).forEach(function (k) {
      if (k >= from && k <= to) out[k] = map[k];
    });
    return out;
  }
  function doneOn(date) {
    var map = readJSON(keyR(), {});
    return (map[date] || []).slice();
  }
  function streakCurrent() {
    var map = readJSON(keyR(), {});
    var n = 0;
    var d = new Date();
    while (map[ymd(d)] && map[ymd(d)].length) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function totalDoneDays() {
    var map = readJSON(keyR(), {});
    return Object.keys(map).filter(function (k) { return map[k].length; }).length;
  }
  function countBetween(from, to) {
    var map = readJSON(keyR(), {});
    var n = 0;
    Object.keys(map).forEach(function (k) { if (k >= from && k <= to) n += map[k].length; });
    return n;
  }

  /* ------------------------------ 通用 UI ------------------------------ */

  function toast(msg) {
    var el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("show"); }, 1800);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function iconFor(name) {
    var first = String(name || "").trim().charAt(0);
    return esc(first || "✓");
  }

  /* ------------------------------ 账号 API ------------------------------ */

  var auth = {
    current: function () {
      var u = currentUser();
      return u ? { u: u.u, n: u.n } : null;
    },
    users: function () {
      var cur = currentName;
      return getUsers().map(function (u) {
        return { u: u.u, n: u.n, at: u.at, current: normName(u.u) === normName(cur) };
      });
    },
    count: function () { return getUsers().length; },
    max: MAX_USERS,
    stats: function (username) {
      var k = normName(username);
      var tasks = readJSON(BASE_T + "__" + k, []);
      var rec = readJSON(BASE_R + "__" + k, {});
      var days = 0, done = 0;
      Object.keys(rec).forEach(function (d) {
        if (rec[d] && rec[d].length) { days++; done += rec[d].length; }
      });
      return { tasks: Array.isArray(tasks) ? tasks.length : 0, days: days, done: done };
    },
    verify: function (username, password) {
      var u = findUser(username);
      if (!u) return { ok: false, msg: "账号不存在" };
      if (hashPwd(password, u.s) !== u.p) return { ok: false, msg: "密码不正确" };
      return { ok: true, msg: "验证通过" };
    },
    register: function (username, password, nickname) {
      var name = String(username == null ? "" : username).trim();
      var pwd = String(password == null ? "" : password);
      var nick = String(nickname == null ? "" : nickname).trim().slice(0, 12);
      if (!name) return { ok: false, msg: "请输入用户名" };
      if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) {
        return { ok: false, msg: "用户名需为 2–16 位字母、数字或下划线" };
      }
      if (pwd.length < 6) return { ok: false, msg: "密码至少 6 位" };
      if (findUser(name)) return { ok: false, msg: "该用户名已被占用" };
      if (getUsers().length >= MAX_USERS) {
        return { ok: false, msg: "本机最多创建 " + MAX_USERS + " 个账号" };
      }
      var u = { u: name, n: nick || name, s: makeSalt(), at: Date.now() };
      u.p = hashPwd(pwd, u.s);
      var arr = getUsers();
      arr.push(u);
      saveUsers(arr);
      return { ok: true, msg: "账号创建成功", user: { u: u.u, n: u.n } };
    },
    login: function (username, password) {
      var r = auth.verify(username, password);
      if (!r.ok) return r;
      var u = findUser(username);
      try { localStorage.setItem(SESSION_KEY, u.u); } catch (e) {}
      currentName = u.u;
      return { ok: true, msg: "登录成功", user: { u: u.u, n: u.n } };
    },
    switchTo: function (username, password) { return auth.login(username, password); },
    logout: function () {
      try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
      currentName = "";
      return { ok: true, msg: "已退出登录" };
    },
    changePassword: function (oldPwd, newPwd) {
      var u = currentUser();
      if (!u) return { ok: false, msg: "请先登录" };
      if (hashPwd(oldPwd, u.s) !== u.p) return { ok: false, msg: "当前密码不正确" };
      var pwd = String(newPwd == null ? "" : newPwd);
      if (pwd.length < 6) return { ok: false, msg: "新密码至少 6 位" };
      var arr = getUsers();
      for (var i = 0; i < arr.length; i++) {
        if (normName(arr[i].u) === normName(u.u)) {
          arr[i].s = makeSalt();
          arr[i].p = hashPwd(pwd, arr[i].s);
        }
      }
      saveUsers(arr);
      return { ok: true, msg: "密码已更新" };
    },
    removeAccount: function (username, password) {
      if (normName(username) === normName(currentName)) {
        return { ok: false, msg: "不能删除当前登录的账号，请先切换到其他账号" };
      }
      var r = auth.verify(username, password);
      if (!r.ok) return r;
      var k = normName(username);
      try {
        localStorage.removeItem(BASE_T + "__" + k);
        localStorage.removeItem(BASE_R + "__" + k);
        localStorage.removeItem(BASE_TOTALS + "__" + k);
        localStorage.removeItem(BASE_THEME + "__" + k);
        localStorage.removeItem("petlog_init__" + k);
      } catch (e) {}
      saveUsers(getUsers().filter(function (u) { return normName(u.u) !== k; }));
      return { ok: true, msg: "账号已删除" };
    },
    themeKey: function () { return keyTheme(); }
  };

  /* --------------------------- 登录门禁界面 --------------------------- */

  var GATE = "authGate";

  function gateLogo() {
    return (
      '<svg viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">' +
      '<rect width="48" height="48" rx="15" fill="#3f6a53"/>' +
      '<path d="M14 24.5l7 7L34 17.5" fill="none" stroke="#ffffff" stroke-width="4" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );
  }

  function renderGate() {
    if (!document.body || document.getElementById(GATE)) return;

    var wrap = document.createElement("div");
    wrap.className = "auth-gate";
    wrap.id = GATE;
    wrap.innerHTML =
      '<div class="auth-card" id="authCard" data-mode="login">' +
        '<div class="auth-logo">' + gateLogo() + "</div>" +
        '<div class="auth-title">日常打卡</div>' +
        '<div class="auth-sub">登录后进入你自己的任务与打卡记录</div>' +
        '<div class="seg auth-tabs">' +
          '<button class="seg-btn on" type="button" data-mode="login">登录</button>' +
          '<button class="seg-btn" type="button" data-mode="register">注册新账号</button>' +
        "</div>" +
        '<form id="authForm" novalidate>' +
          '<div class="field" data-only="register"><label for="auNick">昵称（可留空）</label>' +
            '<input id="auNick" type="text" maxlength="12" placeholder="例如：小豆" autocomplete="off"></div>' +
          '<div class="field"><label for="auUser">用户名</label>' +
            '<input id="auUser" type="text" maxlength="16" placeholder="2–16 位字母 / 数字" autocomplete="username"></div>' +
          '<div class="field"><label for="auPass">密码</label>' +
            '<input id="auPass" type="password" maxlength="32" placeholder="至少 6 位" autocomplete="current-password"></div>' +
          '<div class="field" data-only="register"><label for="auPass2">确认密码</label>' +
            '<input id="auPass2" type="password" maxlength="32" placeholder="再输入一次" autocomplete="new-password"></div>' +
          '<div class="auth-err" id="authErr" role="alert"></div>' +
          '<button class="btn block" id="authSubmit" type="submit">登录</button>' +
        "</form>" +
        '<button class="auth-tip" type="button" id="authFill">' +
          "首次使用？点此填入内置账号 local / 123456</button>" +
        '<div class="auth-foot">账号与数据仅保存在本机浏览器，账号之间互不影响</div>' +
      "</div>";
    document.body.appendChild(wrap);

    var card = document.getElementById("authCard");
    var errEl = document.getElementById("authErr");
    var submit = document.getElementById("authSubmit");
    var mode = "login";

    function setMode(m) {
      mode = m;
      card.setAttribute("data-mode", m);
      wrap.querySelectorAll(".auth-tabs .seg-btn").forEach(function (b) {
        b.classList.toggle("on", b.dataset.mode === m);
      });
      submit.textContent = m === "login" ? "登录" : "注册并登录";
      errEl.textContent = "";
      document.getElementById("auPass").setAttribute(
        "autocomplete", m === "login" ? "current-password" : "new-password"
      );
    }
    wrap.querySelectorAll(".auth-tabs .seg-btn").forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.dataset.mode); });
    });

    document.getElementById("authFill").addEventListener("click", function () {
      setMode("login");
      document.getElementById("auUser").value = "local";
      document.getElementById("auPass").value = "123456";
      errEl.textContent = "";
    });

    document.getElementById("authForm").addEventListener("submit", function (e) {
      e.preventDefault();
      errEl.textContent = "";
      var name = document.getElementById("auUser").value;
      var pwd = document.getElementById("auPass").value;

      if (mode === "register") {
        var p2 = document.getElementById("auPass2").value;
        if (pwd !== p2) { errEl.textContent = "两次输入的密码不一致"; return; }
        var r = auth.register(name, pwd, document.getElementById("auNick").value);
        if (!r.ok) { errEl.textContent = r.msg; return; }
        var l = auth.login(name, pwd);
        if (!l.ok) { errEl.textContent = l.msg; return; }
        toast("账号已创建，正在进入");
      } else {
        var r2 = auth.login(name, pwd);
        if (!r2.ok) { errEl.textContent = r2.msg; return; }
        toast("登录成功");
      }
      /* 登录 / 注册成功后统一进入「今日」页 */
      setTimeout(function () { location.href = "index.html"; }, 450);
    });

    var first = document.getElementById("auUser");
    if (first) { try { first.focus(); } catch (e) {} }
  }

  /* ------------------------------ 对外导出 ------------------------------ */

  var sink = {};
  sink.uid = uid;
  sink.today = today;
  sink.ymd = ymd;
  sink.seedIfEmpty = seedIfEmpty;
  sink.getTasks = function () { return readJSON(keyT(), []); };
  sink.saveTasks = function (t) { writeJSON(keyT(), t); };
  sink.addTask = function (data) {
    var t = sink.getTasks();
    t.push({
      id: uid(), name: data.name, type: data.type,
      cycle: data.cycle || "每天", start: data.start || today(), end: data.end || "",
      enable: data.enable !== false, target: data.target || ""
    });
    sink.saveTasks(t);
    return t;
  };
  sink.setDone = setDone;
  sink.isDone = isDone;
  sink.doneOn = doneOn;
  sink.recordsBetween = recordsBetween;
  sink.streakCurrent = streakCurrent;
  sink.totalDoneDays = totalDoneDays;
  sink.countBetween = countBetween;
  sink.toast = toast;
  sink.esc = esc;
  sink.iconFor = iconFor;
  sink.getRecords = function () { return readJSON(keyR(), {}); };
  sink.saveRecords = function (r) { writeJSON(keyR(), r); };
  sink.getTotals = function () { return readJSON(keyTotals(), {}); };
  sink.totalsOn = totalsOn;
  sink.snapshotToday = snapshotToday;
  sink.auth = auth;

  /* 兼容旧写法：A.KEY_T / A.KEY_R 始终指向「当前账号」的存储键 */
  try {
    Object.defineProperty(sink, "KEY_T", { get: function () { return keyT(); } });
    Object.defineProperty(sink, "KEY_R", { get: function () { return keyR(); } });
    Object.defineProperty(sink, "KEY_TOTALS", { get: function () { return keyTotals(); } });
  } catch (e) {
    sink.KEY_T = null;
    sink.KEY_R = null;
    sink.KEY_TOTALS = null;
  }

  window.App = sink;

  /* ------------------------------ 启动 ------------------------------ */

  loadSession();
  ensureFirstUser();

  var bootUser = currentUser();
  if (!bootUser) {
    currentName = "";
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function boot() {
    if (!bootUser) {
      document.body.setAttribute("data-user", "guest");
      document.body.classList.add("auth-locked");
      renderGate();
      return;
    }
    document.body.setAttribute("data-user", bootUser.u);
    try { seedIfEmpty(); } catch (e) {}
    try { snapshotToday(); } catch (e) {}
  }

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
