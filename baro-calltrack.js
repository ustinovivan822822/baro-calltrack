/* BARO call tracking: определяет, откуда пришёл посетитель (SEO / Google Ads / Google Maps / ChatGPT / Facebook / Instagram / Other),
   запоминает это в браузере и при нажатии на номер телефона отправляет запись в веб-приложение таблицы (Apps Script).
   С GTM и dataLayer не связан. Личных данных посетителя не собирает.
   Адрес веб-приложения таблицы — в WEBHOOK ниже (или window.BARO_CT_WEBHOOK, если сайт задаёт его сам). */
(function () {
  var WEBHOOK = "https://script.google.com/macros/s/AKfycby0UZMudJgr-hCLuhWuKYyXkp_uMejHvQuTSPzRwteRk6Z5APqHT6CC5Uqc5dAItMGLIQ/exec";
  var KEY = "baro_ct_source";
  var DAYS = 30;

  function param(name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)", "i").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  function host(url) {
    var m = /^https?:\/\/([^\/?#]+)/i.exec(url || "");
    return m ? m[1].toLowerCase().replace(/^www\./, "") : "";
  }

  var AI = /(chatgpt\.com|chat\.openai\.com|openai|perplexity|gemini\.google|bard\.google|copilot|claude\.ai|anthropic|you\.com|phind)/i;
  var SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.com|duckduckgo\.com|search\.brave\.com|ecosia\.org|yandex\.[a-z]+|aol\.com)$/i;

  // Источник текущего захода: {channel, detail, campaign} или null, если заход прямой.
  function detect() {
    var src = param("utm_source"), med = param("utm_medium"), camp = param("utm_campaign");
    var ref = host(document.referrer);
    if (ref && ref === host(location.href)) ref = "";

    if (param("gclid") || param("gbraid") || param("wbraid") || param("gad_source") ||
        (/google/i.test(src) && /^(cpc|ppc|paid|paidsearch|sem)$/i.test(med)) ||
        /(googleadservices\.com|syndicatedsearch\.goog|doubleclick\.net)$/i.test(ref)) {
      var adCamp = camp || param("gad_campaignid") || param("utm_id");
      return { channel: "Google Ads", detail: adCamp ? "Campaign " + adCamp : "Google Ads", campaign: adCamp };
    }
    // Метки кликов других рекламных и соцсетей: без них Bing Ads выглядел бы как органика Bing.
    if (param("msclkid")) return { channel: "Other", detail: "Microsoft Ads", campaign: camp };
    if (param("ttclid")) return { channel: "Other", detail: "TikTok Ads", campaign: camp };
    // Facebook / Instagram и ChatGPT — отдельные категории: метка fbclid, utm_source или переход с их сайтов.
    if (param("fbclid") || /(facebook|instagram|^fb$|^ig$|^meta$)/i.test(src) ||
        /(^|\.)(facebook\.com|instagram\.com|fb\.com|fb\.me)$/i.test(ref)) {
      var social = /^(cpc|ppc|paid|paid_social|paidsocial|ads?)$/i.test(med) ? "Ads" : (src || ref || "fbclid");
      return { channel: "Facebook / Instagram", detail: social, campaign: camp };
    }
    if (/chatgpt|openai/i.test(src) || /(^|\.)(chatgpt\.com|chat\.openai\.com)$/i.test(ref)) {
      return { channel: "ChatGPT", detail: "chatgpt.com", campaign: camp };
    }
    // Карточка Google: метка на ссылке «Сайт» в Business Profile. Без метки переход из карточки неотличим от поиска.
    if ((/google/i.test(src) && /(maps|gbp|gmb|business|local)/i.test(med)) || /^maps\.google\./i.test(ref)) {
      return { channel: "Google Maps", detail: "Google Maps", campaign: camp };
    }
    if (src || med) {
      return { channel: AI.test(src) ? "Other" : (/organic/i.test(med) ? "SEO" : "Other"),
               detail: (AI.test(src) ? "AI: " : "") + (src || med), campaign: camp };
    }
    if (ref && AI.test(ref)) return { channel: "Other", detail: "AI: " + ref, campaign: "" };
    if (ref && SEARCH.test(ref)) return { channel: "SEO", detail: "Organic: " + ref, campaign: "" };
    if (ref && /(baro|brepairs)/i.test(ref)) return { channel: "Other", detail: "Own site: " + ref, campaign: "" };
    if (ref) return { channel: "Other", detail: "Referral: " + ref, campaign: "" };
    return null;
  }

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      return v && v.exp > Date.now() ? v : null;
    } catch (e) { return null; }
  }

  function save(v) {
    try { v.exp = Date.now() + DAYS * 864e5; localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
  }

  // Новый заход с явным источником перезаписывает старый; прямой заход сохранённый источник не стирает.
  // Google Maps держится 30 дней: его заменяет только новый клик по рекламе Google.
  var current = detect();
  var stored = load();
  if (current && stored && stored.channel === "Google Maps" && current.channel !== "Google Ads") current = null;
  var source = current || stored || { channel: "Other", detail: "Direct", campaign: "" };
  if (current) {
    current.landing = location.pathname;
    save(current);
    source = current;
  }

  function send(tel) {
    var url = window.BARO_CT_WEBHOOK || WEBHOOK;
    if (!url) return;
    var body = new URLSearchParams({
      site: host(location.href),
      page: location.pathname,
      phone: tel,
      channel: source.channel,
      detail: source.detail || "",
      campaign: source.campaign || "",
      landing: source.landing || "",
      time: new Date().toISOString()
    });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
    } catch (e) {}
    try { fetch(url, { method: "POST", body: body, mode: "no-cors", keepalive: true }); } catch (e) {}
  }

  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="tel:"]') : null;
    if (!a) return;
    var digits = a.getAttribute("href").replace(/\D/g, "");
    if (digits.length === 10) digits = "1" + digits;
    send(digits);
  }, true);
})();
