export const config = { runtime: "edge" };

const ALLOWED_HOSTS = new Set(["videasy.ws", "player.videasy.ws"]);
const MAX_REDIRECTS = 6;

function isAllowedHost(host) {
  const value = String(host || "").toLowerCase().replace(/\.$/, "");
  return ALLOWED_HOSTS.has(value) || value.endsWith(".videasy.ws");
}

function rewriteText(source, origin, host, contentType) {
  let output = String(source);
  const hosts = ["player.videasy.ws", "videasy.ws"];
  for (const upstreamHost of hosts) {
    const local = origin + "/videasy/" + upstreamHost;
    output = output.replace(new RegExp("https?://" + upstreamHost.replace(/\./g, "\\.") , "gi"), local);
    output = output.replace(new RegExp("//" + upstreamHost.replace(/\./g, "\\.") , "gi"), "//" + new URL(origin).host + "/videasy/" + upstreamHost);
  }

  if (/text\/html/i.test(contentType)) {
    const root = origin + "/videasy/" + host + "/";
    output = output.replace(/(<(?:script|img|iframe|source|video|audio|link|a|form|meta)\b[^>]*?\b(?:src|href|action|poster|data-src)\s*=\s*["'])\/(?!\/)/gi, "$1" + root);
    output = output.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "");
    output = output.replace(/<base\b[^>]*>/gi, "");
    const guard = `<script data-flix-popup-guard>
(()=> {
  const host = ${JSON.stringify(host)};
  const prefix = "/videasy/" + host + "/";
  const blocked = () => null;
  try { Object.defineProperty(window, "open", { value: blocked, writable: false, configurable: false }); }
  catch (_) { try { window.open = blocked; } catch (_) {} }

  const route = value => {
    try {
      const raw = typeof value === "string" ? value : value && value.url;
      if (!raw) return value;
      const url = new URL(raw, location.href);
      if (url.origin === location.origin && !url.pathname.startsWith("/videasy/")) {
        url.pathname = prefix + url.pathname.replace(/^\/+/, "");
        return url.href;
      }
      return value;
    } catch (_) { return value; }
  };

  if (typeof window.fetch === "function") {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const mapped = route(input);
      if (typeof Request !== "undefined" && input instanceof Request && mapped !== input) {
        try { return nativeFetch(new Request(mapped, input), init); } catch (_) {}
      }
      return nativeFetch(mapped, init);
    };
  }
  if (window.XMLHttpRequest) {
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      return nativeOpen.call(this, method, route(url), ...args);
    };
  }

  const blockLink = event => {
    const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (link && (link.dataset.flixBlocked === "1" || (link.target && link.target.toLowerCase() !== "_self"))) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  document.addEventListener("click", blockLink, true);
  document.addEventListener("auxclick", blockLink, true);
  document.addEventListener("submit", event => {
    const form = event.target;
    if (form && form.tagName === "FORM" && form.target && form.target.toLowerCase() !== "_self") {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);

  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (this.dataset.flixBlocked === "1" || (this.target && this.target.toLowerCase() !== "_self")) return;
    return nativeAnchorClick.call(this);
  };
  const watch = new MutationObserver(records => records.forEach(record => {
    record.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      const links = [];
      if (node.matches && node.matches("a[target]")) links.push(node);
      if (node.querySelectorAll) links.push(...node.querySelectorAll("a[target]"));
      links.forEach(link => { if (link.target.toLowerCase() !== "_self") link.dataset.flixBlocked = "1"; });
    });
  }));
  if (document.documentElement) watch.observe(document.documentElement, { childList: true, subtree: true });
  console.info("[FLIXTV Proxy] Popup protection active");
})();
</script>`;
    const headMatch = output.match(/<head\b[^>]*>/i);
    if (headMatch) output = output.replace(headMatch[0], headMatch[0] + guard);
    else output = guard + output;
  } else if (/text\/css/i.test(contentType)) {
    const root = origin + "/videasy/" + host + "/";
    output = output.replace(/url\(\s*(["']?)\/(?!\/)/gi, "url($1" + root);
  }

  return output;
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g) : [];
}

function safeCookie(raw) {
  return raw
    .replace(/;\s*domain=[^;]*/i, "")
    .replace(/;\s*path=[^;]*/i, "; Path=/videasy");
}

export default async function handler(request) {
  const incoming = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, POST, OPTIONS" } });
  }

  const host = String(incoming.searchParams.get("host") || "").toLowerCase();
  const path = String(incoming.searchParams.get("path") || "");
  if (!isAllowedHost(host) || path.includes("..") || path.includes("\\")) {
    return new Response("Videasy proxy: host ose path nuk lejohet.", { status: 403 });
  }

  const upstreamUrl = new URL("https://" + host + "/" + path.replace(/^\/+/, ""));
  for (const [key, value] of incoming.searchParams) {
    if (key !== "host" && key !== "path") upstreamUrl.searchParams.append(key, value);
  }

  const headers = new Headers({
    "User-Agent": request.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
    "Accept": request.headers.get("accept") || "*/*",
    "Accept-Language": request.headers.get("accept-language") || "en-US,en;q=0.9",
    "Referer": "https://player.videasy.ws/",
    "Origin": "https://" + host
  });
  for (const name of ["range", "if-range", "content-type", "cookie"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let method = request.method;
  let body;
  if (method !== "GET" && method !== "HEAD") body = await request.arrayBuffer();
  let currentUrl = upstreamUrl;
  let upstream;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (currentUrl.protocol !== "https:" || !isAllowedHost(currentUrl.hostname)) {
        return new Response("Videasy proxy: redirect jashtë host-eve të lejuara.", { status: 502 });
      }
      upstream = await fetch(currentUrl.toString(), {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual"
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location) break;
      const next = new URL(location, currentUrl);
      if (!isAllowedHost(next.hostname)) {
        return new Response("Videasy proxy: redirect te një host i jashtëm u ndalua.", { status: 502 });
      }
      if (upstream.status === 303 || ((upstream.status === 301 || upstream.status === 302) && method !== "HEAD")) {
        method = "GET";
        body = undefined;
      }
      currentUrl = next;
    }

    if (!upstream) return new Response("Videasy upstream unavailable.", { status: 502 });
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const textual = /text\/html|javascript|ecmascript|text\/css|application\/json/i.test(contentType);
    const responseHeaders = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    });

    for (const name of ["content-range", "accept-ranges", "content-length", "last-modified", "etag"]) {
      const value = upstream.headers.get(name);
      if (value && !textual) responseHeaders.set(name, value);
    }
    for (const cookie of getSetCookies(upstream.headers)) responseHeaders.append("Set-Cookie", safeCookie(cookie));

    if (request.method === "HEAD") {
      try { await upstream.body?.cancel(); } catch (_) {}
      return new Response(null, { status: upstream.status, headers: responseHeaders });
    }

    if (textual) {
      const text = await upstream.text();
      const rewritten = rewriteText(text, incoming.origin, host, contentType);
      responseHeaders.delete("Content-Length");
      responseHeaders.delete("Content-Encoding");
      return new Response(rewritten, { status: upstream.status, headers: responseHeaders });
    }

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error("[Videasy Proxy]", error && error.message ? error.message : String(error));
    return new Response("Videasy proxy request failed.", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
