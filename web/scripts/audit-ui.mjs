#!/usr/bin/env node
import { chromium } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, ".playwright-mcp", "audit");
const SCREENS_DIR = path.join(OUT_DIR, "screens");
const WEB_URL = (process.env.AUDIT_WEB_URL || "http://localhost:3000").replace(/\/$/, "");
const API_URL = (process.env.AUDIT_API_URL || "http://localhost:8010").replace(/\/$/, "");
const AXE_SOURCE = fs.readFileSync(path.join(path.dirname(require.resolve("axe-core/package.json")), "axe.min.js"), "utf8");

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

const SIGN_IN_VIEWPORT = { width: 1280, height: 800 };

const ROLES = [
  {
    id: "anonymous",
    label: "Anonymous",
    routes: ["/", "/menu", "/cart", "/checkout", "/party", "/privacy", "/login", "/does-not-exist"],
  },
  {
    id: "customer",
    label: "Customer",
    routes: ["/orders", "/rewards", "/profile", "/party/mine"],
    expectRole: "customer",
    signIn: { kind: "otp", phone: "8000000999", otp: "123456", name: "Audit Customer" },
  },
  {
    id: "kitchen",
    label: "Kitchen",
    routes: ["/kitchen", "/kitchen/items", "/kitchen/stats"],
    expectRole: "kitchen",
    signIn: { kind: "password", phone: "9000000011", envVar: "AUDIT_KITCHEN_PASSWORD" },
  },
  {
    id: "admin",
    label: "Admin",
    routes: ["/admin/menu", "/admin/coupons", "/admin/dashboard", "/admin/menu/new"],
    expectRole: "admin",
    signIn: { kind: "password", phone: "9000000099", envVar: "AUDIT_ADMIN_PASSWORD" },
  },
  {
    id: "catering",
    label: "Catering",
    routes: ["/catering"],
    expectRole: "catering",
    signIn: { kind: "password", phone: "9000000014", envVar: "AUDIT_CATERING_PASSWORD" },
  },
];

const CHECK_CODES = [
  ["A", "overflow", "horizontal overflow"],
  ["B", "clipped", "clipped content"],
  ["C", "smallText", "text under 14px"],
  ["D", "tapTargets", "tap targets under 44x44"],
  ["E", "headerCover", "sticky header over heading"],
  ["F", "images", "images"],
  ["G", "consoleNetwork", "console/network"],
  ["H", "axe", "axe serious/critical"],
  ["I", "contrast", "colour contrast"],
];

function isAccessDenied(error) {
  const code = error?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return true;
  return /WinError 5|Access is denied|permission denied/i.test(String(error?.message || ""));
}

function writeSafely(filePath, contents) {
  fs.writeFileSync(filePath, contents);
}

function shotName(route, width) {
  const slug = route === "/" ? "home" : route.replace(/^\//, "").replace(/\//g, "-");
  return `${slug}-${width}.png`;
}

function viewportKey(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

async function settle(page, idleTimeout = 4000) {
  try {
    await page.waitForLoadState("networkidle", { timeout: idleTimeout });
  } catch {
    // SSE streams and long polling never go idle; the fixed delay below still applies.
  }
}

async function scrollForLazyContent(page) {
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    let step = 0;
    let y = 0;
    while (step < 250) {
      step += 1;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 40)));
      if (y >= max) break;
      y = Math.min(y + Math.max(320, Math.round(window.innerHeight * 0.8)), max);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

async function waitForImages(page) {
  await page.evaluate(() => {
    const images = Array.from(document.images || []);
    return Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          setTimeout(done, 3000);
        });
      }),
    );
  });
}

function runDomChecks() {
  document.documentElement.style.scrollBehavior = "auto";
  const vw = window.innerWidth;
  const tol = 1;

  const cssEscape = (value) =>
    window.CSS && typeof window.CSS.escape === "function" ? window.CSS.escape(value) : String(value).replace(/[^\w-]/g, "\\$&");

  const selectorFor = (element) => {
    if (!(element instanceof Element)) return "";
    if (element.id) return element.tagName.toLowerCase() + "#" + cssEscape(element.id);
    const classes = Array.from(element.classList).map((entry) => "." + cssEscape(entry)).join("");
    const own = element.tagName.toLowerCase() + classes;
    if (classes || !element.parentElement) return own;
    const parent = element.parentElement;
    const parentClasses = Array.from(parent.classList)
      .slice(0, 2)
      .map((entry) => "." + cssEscape(entry))
      .join("");
    return parent.tagName.toLowerCase() + parentClasses + " > " + own;
  };

  const classNameOf = (element) => {
    const raw = typeof element.className === "string" ? element.className : element.getAttribute("class");
    return raw ? raw.trim() : "";
  };

  const isVisible = (element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const isHiddenFromA11y = (element) => {
    for (let node = element; node; node = node.parentElement) {
      if (node === document.body) break;
      if (node.hidden) return true;
      if (node.hasAttribute && (node.hasAttribute("aria-hidden") || node.hasAttribute("inert"))) return true;
    }
    return false;
  };

  const insideHorizontalScroller = (element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    return false;
  };

  const hasOwnText = (element) => {
    for (const node of element.childNodes) {
      if (node.nodeType === 3 && node.textContent && node.textContent.trim()) return true;
    }
    return false;
  };

  const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea", "summary"]);
  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "checkbox",
    "radio",
    "switch",
    "option",
    "combobox",
    "textbox",
    "slider",
    "spinbutton",
  ]);
  const isInteractive = (element) =>
    INTERACTIVE_TAGS.has(element.tagName.toLowerCase()) ||
    INTERACTIVE_ROLES.has((element.getAttribute("role") || "").toLowerCase());

  const describe = (element) => ({
    selector: selectorFor(element),
    tag: element.tagName.toLowerCase(),
    class: classNameOf(element),
  });

  // (a) horizontal overflow
  const docOverflow = document.documentElement.scrollWidth > window.innerWidth;
  const overflowItems = [];
  let overflowCount = 0;
  for (const element of document.querySelectorAll("body *")) {
    if (!isVisible(element)) continue;
    const rect = element.getBoundingClientRect();
    const overflowsRight = rect.right > vw + tol;
    const widerThanViewport = rect.width > vw + tol;
    if (!overflowsRight && !widerThanViewport) continue;
    if (insideHorizontalScroller(element) || isHiddenFromA11y(element)) continue;
    overflowCount += 1;
    if (overflowItems.length < 5) {
      overflowItems.push({
        ...describe(element),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      });
    }
  }

  // (b) clipped content
  const clippedItems = [];
  let clippedCount = 0;
  for (const element of document.querySelectorAll("body *")) {
    if (!isVisible(element) || isHiddenFromA11y(element)) continue;
    const ownText = hasOwnText(element) || (element.childElementCount === 0 && Boolean((element.textContent || "").trim()));
    if (!ownText && !isInteractive(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const reasons = [];
    const partlyOutsideViewport =
      !insideHorizontalScroller(element) &&
      ((rect.left < -tol && rect.right > tol) || (rect.right > vw + tol && rect.left < vw - tol));
    if (partlyOutsideViewport) reasons.push("outside-viewport");

    let clippedBy = null;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const hidden = style.overflow === "hidden" || style.overflowX === "hidden" || style.overflow === "clip" || style.overflowX === "clip";
      if (!hidden) continue;
      const ancestorRect = node.getBoundingClientRect();
      if (rect.left < ancestorRect.left - tol || rect.right > ancestorRect.right + tol) {
        clippedBy = selectorFor(node);
        reasons.push("clipped-by-overflow-hidden");
        break;
      }
    }

    if (reasons.length === 0) continue;
    clippedCount += 1;
    if (clippedItems.length < 10) {
      clippedItems.push({
        ...describe(element),
        reasons,
        clippedBy,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        viewportWidth: vw,
        text: (element.innerText || "").trim().slice(0, 60),
      });
    }
  }

  // (c) text smaller than 14px
  const sizeBuckets = new Map();
  let smallTextCount = 0;
  for (const element of document.querySelectorAll("body *")) {
    if (!isVisible(element) || !hasOwnText(element)) continue;
    const fontSize = parseFloat(getComputedStyle(element).fontSize);
    if (!(fontSize < 14)) continue;
    smallTextCount += 1;
    const key = selectorFor(element);
    sizeBuckets.set(key, (sizeBuckets.get(key) || 0) + 1);
  }
  const smallTextSelectors = Array.from(sizeBuckets, ([selector, count]) => ({ selector, count }))
    .sort((a, b) => b.count - a.count || a.selector.localeCompare(b.selector))
    .slice(0, 5);

  // (d) tap targets
  const tapItems = [];
  let tapCount = 0;
  const tapCandidates = document.querySelectorAll(
    'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="switch"]',
  );
  for (const element of tapCandidates) {
    if (!isVisible(element) || isHiddenFromA11y(element)) continue;
    if (element.tagName.toLowerCase() === "a" && element.closest('p, [role="paragraph"]')) {
      const display = getComputedStyle(element).display;
      if (display === "inline" || display === "inline-block") continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width >= 44 && rect.height >= 44) continue;
    tapCount += 1;
    if (tapItems.length < 10) {
      tapItems.push({
        ...describe(element),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: (element.innerText || element.getAttribute("aria-label") || "").trim().slice(0, 40),
      });
    }
  }

  // (e) fixed/sticky header covering a heading
  const headerCover = { count: 0, covered: false, heading: null, header: null, headingTop: null, headerBottom: null };
  const headerCandidates = document.querySelectorAll('header, [role="banner"], .site-header, .kd-header');
  let stickyHeader = null;
  for (const candidate of headerCandidates) {
    const position = getComputedStyle(candidate).position;
    if (position === "fixed" || position === "sticky") {
      stickyHeader = candidate;
      break;
    }
  }
  if (stickyHeader) {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).filter(
      (heading) => isVisible(heading) && !stickyHeader.contains(heading),
    );
    const heading = headings[0];
    if (heading) {
      const targetTop = window.scrollY + heading.getBoundingClientRect().top;
      window.scrollTo({ top: targetTop, behavior: "instant" });
      const headingRect = heading.getBoundingClientRect();
      const headerRect = stickyHeader.getBoundingClientRect();
      const covered = headingRect.top >= -tol && headingRect.top < headerRect.bottom && headerRect.height > 0;
      headerCover.count = covered ? 1 : 0;
      headerCover.covered = covered;
      headerCover.heading = selectorFor(heading);
      headerCover.header = selectorFor(stickyHeader);
      headerCover.headingTop = Math.round(headingRect.top);
      headerCover.headerBottom = Math.round(headerRect.bottom);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  // (f) broken images and images wider than their container
  const imageItems = [];
  let imageCount = 0;
  for (const image of document.querySelectorAll("img")) {
    if (!isVisible(image)) continue;
    const rect = image.getBoundingClientRect();
    if (image.complete && image.naturalWidth === 0) {
      imageCount += 1;
      if (imageItems.length < 10) {
        imageItems.push({ ...describe(image), reason: "broken", src: (image.getAttribute("src") || "").slice(0, 120) });
      }
      continue;
    }
    const parent = image.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      if (rect.width > parentRect.width + tol) {
        imageCount += 1;
        if (imageItems.length < 10) {
          imageItems.push({
            ...describe(image),
            reason: "wider-than-container",
            width: Math.round(rect.width),
            containerWidth: Math.round(parentRect.width),
            container: selectorFor(parent),
          });
        }
      }
    }
  }

  return {
    overflow: { count: overflowCount, docOverflow, items: overflowItems },
    clipped: { count: clippedCount, items: clippedItems },
    smallText: { count: smallTextCount, selectors: smallTextSelectors },
    tapTargets: { count: tapCount, items: tapItems },
    headerCover,
    images: { count: imageCount, items: imageItems },
  };
}

function attachWatchers(page) {
  const watch = { console: [], pageErrors: [], responses: [], requestFailures: [] };
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    watch.console.push({ type, text: message.text() });
  });
  page.on("pageerror", (error) => {
    watch.pageErrors.push(String(error?.message || error));
  });
  page.on("response", (response) => {
    if (response.status() >= 400) watch.responses.push({ url: response.url(), status: response.status() });
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "request failed";
    if (failure.includes("ERR_ABORTED")) return;
    if (!/^https?:/i.test(request.url())) return;
    watch.requestFailures.push({ url: request.url(), error: failure });
  });
  return watch;
}

function resetWatch(watch) {
  watch.console.length = 0;
  watch.pageErrors.length = 0;
  watch.responses.length = 0;
  watch.requestFailures.length = 0;
}

function collectNetworkConsole(watch, route) {
  const deliberate = route === "/does-not-exist";
  const items = [];
  for (const response of watch.responses) {
    if (deliberate && response.status === 404 && response.url.includes("does-not-exist")) continue;
    items.push({ kind: "http", text: `${response.status} ${response.url}` });
  }
  for (const failure of watch.requestFailures) {
    if (deliberate && failure.url.includes("does-not-exist")) continue;
    items.push({ kind: "request-failed", text: `${failure.error} ${failure.url}` });
  }
  for (const entry of watch.console) {
    if (deliberate && entry.text.includes("does-not-exist")) continue;
    items.push({ kind: `console-${entry.type}`, text: entry.text });
  }
  for (const error of watch.pageErrors) {
    items.push({ kind: "pageerror", text: error });
  }
  return { count: items.length, items: items.slice(0, 20), hydration: items.filter((item) => /hydrat/i.test(item.text)).length };
}

async function runAxe(page) {
  try {
    await page.addScriptTag({ content: AXE_SOURCE });
    const violations = await page.evaluate(async () => {
      const result = await window.axe.run(document, { resultTypes: ["violations"] });
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          target: Array.isArray(node.target) ? node.target.join(" ") : String(node.target),
          data: [...(node.any || []), ...(node.all || []), ...(node.none || [])]
            .map((check) => check.data)
            .find((data) => data && data.fgColor) || null,
        })),
      }));
    });

    const axeItems = [];
    let axeCount = 0;
    const contrastItems = [];
    let contrastCount = 0;
    for (const violation of violations) {
      if (violation.impact !== "serious" && violation.impact !== "critical") continue;
      for (const node of violation.nodes) {
        if (violation.id === "color-contrast") {
          contrastCount += 1;
          if (contrastItems.length < 20) {
            contrastItems.push({
              rule: violation.id,
              impact: violation.impact,
              target: node.target,
              fgColor: node.data?.fgColor ?? null,
              bgColor: node.data?.bgColor ?? null,
              contrastRatio: node.data?.contrastRatio ?? null,
              help: violation.help,
            });
          }
          continue;
        }
        axeCount += 1;
        if (axeItems.length < 20) {
          axeItems.push({ rule: violation.id, impact: violation.impact, target: node.target, help: violation.help });
        }
      }
    }
    return {
      axe: { count: axeCount, items: axeItems },
      contrast: { count: contrastCount, items: contrastItems },
      error: null,
    };
  } catch (error) {
    return {
      axe: { count: 0, items: [] },
      contrast: { count: 0, items: [] },
      error: String(error?.message || error),
    };
  }
}

async function waitForSignInOutcome(page, timeout = 25000) {
  await page
    .waitForFunction(
      () => {
        const dialog = document.querySelector("dialog.signin-dialog");
        if (!dialog) return false;
        if (!dialog.hasAttribute("open")) return true;
        return Boolean(dialog.querySelector(".form-error"));
      },
      null,
      { timeout },
    )
    .catch(() => undefined);
  const dialog = page.locator("dialog.signin-dialog");
  const stillOpen = (await dialog.getAttribute("open").catch(() => null)) !== null;
  if (stillOpen) {
    const message = await dialog
      .locator(".form-error")
      .first()
      .textContent()
      .catch(() => null);
    return { ok: false, reason: (message || "sign-in dialog stayed open").trim() };
  }
  return { ok: true };
}

async function readLocalStorage(page, key) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
    } catch (error) {
      const message = String(error?.message || error);
      if (!/Execution context was destroyed|Cannot find context|navigation/i.test(message)) throw error;
      await page.waitForTimeout(400);
    }
  }
  return null;
}

async function signInRole(browser, role, statePath) {
  const context = await browser.newContext({ viewport: SIGN_IN_VIEWPORT });
  const page = await context.newPage();
  try {
    const url = role.signIn.kind === "otp" ? `${WEB_URL}/login?mode=customer` : `${WEB_URL}/login`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    const dialog = page.locator("dialog.signin-dialog");
    await dialog.waitFor({ state: "visible", timeout: 20000 });

    if (role.signIn.kind === "otp") {
      await page.locator("#signin-tab-customer").click();
      await dialog.locator('input[placeholder="10-digit phone number"]').fill(role.signIn.phone);
      await dialog.locator('button[type="submit"]').click();
      const otpInput = dialog.locator('input[placeholder="6-digit code"]');
      await otpInput.waitFor({ state: "visible", timeout: 20000 });
      await otpInput.fill(role.signIn.otp);
      const nameInput = dialog.locator('input[placeholder="Your name"]');
      if (await nameInput.isVisible().catch(() => false)) await nameInput.fill(role.signIn.name);
      await dialog.locator('button[type="submit"]').click();
    } else {
      await page.locator("#signin-tab-staff").click();
      await dialog.locator('input[placeholder="10-digit phone number"]').fill(role.signIn.phone);
      await dialog.locator('input[placeholder="Enter your password"]').fill(process.env[role.signIn.envVar] || "");
      await dialog.locator('button[type="submit"]').click();
    }

    const outcome = await waitForSignInOutcome(page);
    if (!outcome.ok) return { ok: false, reason: outcome.reason };

    const userRaw = await readLocalStorage(page, "hyderabad-biryani-user");
    const token = await readLocalStorage(page, "hyderabad-biryani-token");
    const user = userRaw ? JSON.parse(userRaw) : null;
    if (!token || !user) return { ok: false, reason: "no session was saved after sign-in" };
    if (role.expectRole && user.role !== role.expectRole) {
      return { ok: false, reason: `signed in as role "${user.role}", expected "${role.expectRole}"` };
    }
    await context.storageState({ path: statePath });
    return { ok: true, user };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function prepareAnonymous(browser, statePath) {
  const notes = [];
  const context = await browser.newContext({ viewport: SIGN_IN_VIEWPORT });
  const page = await context.newPage();
  try {
    await page.goto(`${WEB_URL}/menu`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await settle(page);
    const locationClose = page.locator("button.location-dialog-close");
    if (await locationClose.isVisible().catch(() => false)) {
      const areaChip = page.locator("button.area-chip").first();
      if (await areaChip.isVisible().catch(() => false)) await areaChip.click().catch(() => undefined);
      if (await locationClose.isVisible().catch(() => false)) await locationClose.click().catch(() => undefined);
    }
    const addButton = page.locator("button.landing-add-button").first();
    try {
      await addButton.waitFor({ state: "visible", timeout: 25000 });
      await addButton.click();
    } catch (error) {
      notes.push(`could not add an item from /menu: ${String(error?.message || error)}`);
    }
    const cartReady = await page
      .waitForFunction(
        () => {
          const raw = window.localStorage.getItem("hyderabad-biryani-cart");
          if (!raw) return false;
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.lines) && parsed.lines.length > 0;
          } catch {
            return false;
          }
        },
        null,
        { timeout: 10000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!cartReady) notes.push("the cart is empty, so /cart and /checkout will render without items");
    await context.storageState({ path: statePath });
    return { ok: true, notes };
  } catch (error) {
    return { ok: false, notes: [...notes, String(error?.message || error)] };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function findOrderRoute(browser, statePath) {
  const context = await browser.newContext({ viewport: SIGN_IN_VIEWPORT, storageState: statePath });
  const page = await context.newPage();
  try {
    await page.goto(`${WEB_URL}/orders`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await settle(page);
    const href = await page
      .locator('a[href^="/order/"]')
      .first()
      .getAttribute("href", { timeout: 5000 })
      .catch(() => null);
    if (!href) return { route: null, note: "no order link found on /orders" };
    return { route: href.split("?")[0], note: null };
  } catch (error) {
    return { route: null, note: `could not read /orders: ${String(error?.message || error)}` };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function auditRun(page, watch, role, route, viewport) {
  resetWatch(watch);
  const entry = {
    role,
    route,
    viewport: { width: viewport.width, height: viewport.height },
    url: `${WEB_URL}${route}`,
    error: null,
    screenshot: null,
    checks: {
      overflow: { count: 0, docOverflow: false, items: [] },
      clipped: { count: 0, items: [] },
      smallText: { count: 0, selectors: [] },
      tapTargets: { count: 0, items: [] },
      headerCover: { count: 0, covered: false, heading: null, header: null },
      images: { count: 0, items: [] },
      consoleNetwork: { count: 0, items: [], hydration: 0 },
      axe: { count: 0, items: [] },
      contrast: { count: 0, items: [] },
    },
  };

  try {
    await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (error) {
    entry.error = `navigation failed: ${String(error?.message || error)}`;
  }
  await settle(page);
  await page.waitForTimeout(800);

  await scrollForLazyContent(page);
  await waitForImages(page);

  try {
    const dom = await page.evaluate(runDomChecks);
    entry.checks.overflow = dom.overflow;
    entry.checks.clipped = dom.clipped;
    entry.checks.smallText = dom.smallText;
    entry.checks.tapTargets = dom.tapTargets;
    entry.checks.headerCover = dom.headerCover;
    entry.checks.images = dom.images;
  } catch (error) {
    entry.error = `DOM checks failed: ${String(error?.message || error)}`;
  }

  const axeResult = await runAxe(page);
  entry.checks.axe = axeResult.axe;
  entry.checks.contrast = axeResult.contrast;
  if (axeResult.error) entry.error = entry.error || `axe failed: ${axeResult.error}`;

  entry.checks.consoleNetwork = collectNetworkConsole(watch, route);
  return entry;
}

function collectTopProblems(results) {
  const map = new Map();
  const add = (selector, check, route, viewport, example) => {
    if (!selector) return;
    let entry = map.get(selector);
    if (!entry) {
      entry = { selector, pages: new Set(), routes: new Set(), checks: new Set(), example: null };
      map.set(selector, entry);
    }
    entry.pages.add(`${route}@${viewportKey(viewport)}`);
    entry.routes.add(route);
    entry.checks.add(check);
    if (!entry.example) entry.example = { route, viewport: viewportKey(viewport), check, ...example };
  };

  for (const result of results) {
    const { route, viewport, checks } = result;
    for (const item of checks.overflow.items) add(item.selector, "A overflow", route, viewport, { width: item.width, right: item.right });
    for (const item of checks.clipped.items) add(item.selector, "B clipped", route, viewport, { reasons: item.reasons.join("+") });
    for (const item of checks.smallText.selectors) add(item.selector, "C text under 14px", route, viewport, { elements: item.count });
    for (const item of checks.tapTargets.items) add(item.selector, "D tap target", route, viewport, { size: `${item.width}x${item.height}` });
    if (checks.headerCover.covered) {
      add(checks.headerCover.heading, "E header overlap", route, viewport, {
        header: checks.headerCover.header,
        headingTop: checks.headerCover.headingTop,
        headerBottom: checks.headerCover.headerBottom,
      });
    }
    for (const item of checks.images.items) add(item.selector, "F image", route, viewport, { reason: item.reason });
    for (const item of checks.axe.items) add(item.target, `H axe:${item.rule}`, route, viewport, { impact: item.impact });
    for (const item of checks.contrast.items) {
      add(item.target, "I contrast", route, viewport, {
        fg: item.fgColor,
        bg: item.bgColor,
        ratio: item.contrastRatio,
      });
    }
  }

  return Array.from(map.values())
    .map((entry) => ({
      selector: entry.selector,
      pages: entry.pages.size,
      routes: Array.from(entry.routes),
      checks: Array.from(entry.checks).sort(),
      example: entry.example,
    }))
    .sort((a, b) => b.pages - a.pages || b.routes.length - a.routes.length || a.selector.localeCompare(b.selector))
    .slice(0, 50);
}

function totalFor(results, key) {
  return results.reduce((sum, result) => sum + (result.checks[key]?.count || 0), 0);
}

function cellFor(result) {
  if (!result) return "—";
  const marks = [];
  for (const [code, key] of CHECK_CODES) {
    const check = result.checks[key];
    const count = check?.count || 0;
    if (count > 0) {
      marks.push(`${code}${count}`);
      continue;
    }
    if (key === "overflow" && check?.docOverflow) marks.push("Adoc");
  }
  if (result.error) marks.push("ERR");
  return marks.length ? `❌ ${marks.join(" ")}` : "–";
}

function buildMarkdown({ results, roleStatus, topProblems, totals, overflowFound, screenshots }) {
  const lines = [];
  lines.push("# UI audit report");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Web: ${WEB_URL} · API: ${API_URL}`);
  lines.push(`- Viewports: ${VIEWPORTS.map(viewportKey).join(", ")}`);
  lines.push(
    `- Roles: ${ROLES.map((role) => {
      const status = roleStatus[role.id];
      return `${role.label} ${status.status}${status.reason ? ` (${status.reason})` : ""}`;
    }).join(" · ")}`,
  );
  lines.push("");
  lines.push(
    `Legend — A horizontal overflow · B clipped content · C text under 14px · D tap target under 44×44 · E sticky header over heading · F images · G console/network · H axe serious/critical (excluding contrast) · I colour contrast · Adoc the page itself scrolls sideways · ❌ failure · – clean · ERR the route failed to load`,
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Role | Route | ${VIEWPORTS.map(viewportKey).join(" | ")} |`);
  lines.push(`| --- | --- | ${VIEWPORTS.map(() => "---").join(" | ")} |`);

  const byKey = new Map(results.map((result) => [`${result.role}|${result.route}|${viewportKey(result.viewport)}`, result]));
  for (const role of ROLES) {
    const status = roleStatus[role.id];
    if (!status.routes.length) continue;
    for (const route of status.routes) {
      const cells = VIEWPORTS.map((viewport) => cellFor(byKey.get(`${role.id}|${route}|${viewportKey(viewport)}`)));
      lines.push(`| ${role.label} | \`${route}\` | ${cells.join(" | ")} |`);
    }
  }
  lines.push("");

  lines.push("## Top problems");
  lines.push("");
  lines.push("Identical selectors grouped across every page they were seen on, ranked by the number of pages affected.");
  lines.push("");
  if (topProblems.length === 0) {
    lines.push("No selector-level problems were found.");
    lines.push("");
  } else {
    topProblems.forEach((problem, index) => {
      const example = problem.example || {};
      const detail = [];
      if (example.width) detail.push(`width ${example.width}`);
      if (example.right !== undefined) detail.push(`right edge ${example.right}px`);
      if (example.size) detail.push(`size ${example.size}`);
      if (example.elements) detail.push(`${example.elements} elements`);
      if (example.fg) detail.push(`${example.fg} on ${example.bg} (ratio ${example.ratio})`);
      if (example.header) detail.push(`header \`${example.header}\` bottom ${example.headerBottom}px, heading top ${example.headingTop}px`);
      if (example.reason) detail.push(example.reason);
      if (example.impact) detail.push(`impact ${example.impact}`);
      lines.push(`${index + 1}. \`${problem.selector}\` — ${problem.pages} page(s) across ${problem.routes.length} route(s)`);
      lines.push(`   - Checks: ${problem.checks.join(", ")}`);
      lines.push(`   - Example: ${example.route} @ ${example.viewport}${detail.length ? ` — ${detail.join(", ")}` : ""}`);
      lines.push(`   - Routes: ${problem.routes.map((route) => `\`${route}\``).join(", ")}`);
    });
    lines.push("");
  }

  lines.push("## Totals");
  lines.push("");
  lines.push("| Check | Findings |");
  lines.push("| --- | --- |");
  for (const [code, key, label] of CHECK_CODES) {
    lines.push(`| ${code} ${label} | ${totals[key]} |`);
  }
  lines.push(`| Screenshots saved | ${screenshots} |`);
  lines.push(`| Horizontal overflow present | ${overflowFound ? "YES" : "no"} |`);
  lines.push("");

  lines.push("## Skipped roles");
  lines.push("");
  const skipped = ROLES.map((role) => ({ role, status: roleStatus[role.id] })).filter(
    (row) => row.status.status !== "ok" || row.status.notes?.length,
  );
  if (!skipped.length) {
    lines.push("None.");
  } else {
    for (const row of skipped) {
      lines.push(`- **${row.role.label}** — ${row.status.status}${row.status.reason ? `: ${row.status.reason}` : ""}`);
      for (const note of row.status.notes || []) lines.push(`  - ${note}`);
    }
  }
  lines.push("");
  lines.push(`Full machine-readable data: \`report.json\`. Screenshots for runs with overflow or clipping: \`screens/<route>-<width>.png\`.`);
  lines.push("");
  return lines.join("\n");
}

async function checkApiReachable() {
  try {
    const response = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function main() {
  fs.mkdirSync(SCREENS_DIR, { recursive: true });

  const api = await checkApiReachable();
  if (!api.ok) console.log(`Warning: API at ${API_URL} did not answer /health (${api.status || api.error}).`);

  const roleStatus = {};
  const browser = await chromium.launch();
  const results = [];
  const screenshots = [];
  let exitCode = 0;

  try {
    for (const role of ROLES) {
      const statePath = path.join(OUT_DIR, `auth-${role.id}.json`);
      const routes = [...role.routes];

      if (role.id === "anonymous") {
        const prepared = await prepareAnonymous(browser, statePath);
        roleStatus[role.id] = { status: prepared.ok ? "ok" : "degraded", routes, notes: prepared.notes };
        console.log(`anonymous: cart state saved${prepared.notes.length ? ` (${prepared.notes.length} note(s))` : ""}`);
      } else {
        const password = role.signIn.envVar ? process.env[role.signIn.envVar] : undefined;
        if (role.signIn.envVar && !password) {
          roleStatus[role.id] = { status: "skipped", routes: [], reason: `missing ${role.signIn.envVar}` };
          console.log(`${role.id}: SKIPPED (set ${role.signIn.envVar})`);
          continue;
        }
        const signedIn = await signInRole(browser, role, statePath);
        if (!signedIn.ok) {
          roleStatus[role.id] = { status: "failed", routes: [], reason: signedIn.reason };
          console.log(`${role.id}: SIGN-IN FAILED (${signedIn.reason})`);
          continue;
        }
        console.log(`${role.id}: signed in`);
        if (role.id === "customer") {
          const order = await findOrderRoute(browser, statePath);
          if (order.route) routes.push(order.route);
          roleStatus[role.id] = { status: "ok", routes, notes: order.note ? [order.note] : [] };
        } else {
          roleStatus[role.id] = { status: "ok", routes, notes: [] };
        }
      }

      const hasState = fs.existsSync(statePath);
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({
          viewport,
          ...(hasState ? { storageState: statePath } : {}),
        });
        const page = await context.newPage();
        const watch = attachWatchers(page);
        for (const route of routes) {
          const entry = await auditRun(page, watch, role.id, route, viewport);
          results.push(entry);
          const hasProblem = entry.checks.overflow.docOverflow || entry.checks.overflow.count > 0 || entry.checks.clipped.count > 0;
          if (hasProblem) {
            const fileName = shotName(route, viewport.width);
            try {
              await page.screenshot({ path: path.join(SCREENS_DIR, fileName), fullPage: true });
              entry.screenshot = `screens/${fileName}`;
              screenshots.push(entry.screenshot);
            } catch (error) {
              if (isAccessDenied(error)) throw error;
              entry.error = entry.error || `screenshot failed: ${String(error?.message || error)}`;
            }
          }
          const marks = CHECK_CODES.filter(
            ([, key]) =>
              (entry.checks[key]?.count || 0) > 0 || (key === "overflow" && entry.checks.overflow.docOverflow),
          )
            .map(([code, key]) =>
              entry.checks[key].count > 0 ? `${code}${entry.checks[key].count}` : `${code}doc`,
            )
            .join(" ");
          console.log(`  ${role.id} ${route} @ ${viewportKey(viewport)}: ${marks || (entry.error ? "ERROR" : "clean")}`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const topProblems = collectTopProblems(results);
  const totals = {};
  for (const [, key] of CHECK_CODES) totals[key] = totalFor(results, key);
  const overflowFound = results.some((entry) => entry.checks.overflow.docOverflow || entry.checks.overflow.count > 0);
  if (overflowFound) exitCode = 1;

  const report = {
    generatedAt: new Date().toISOString(),
    webUrl: WEB_URL,
    apiUrl: API_URL,
    viewports: VIEWPORTS,
    roles: roleStatus,
    checkLegend: Object.fromEntries(CHECK_CODES.map(([code, key, label]) => [code, { key, label }])),
    totals,
    overflowFound,
    screenshots,
    topProblems,
    results,
  };

  writeSafely(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeSafely(
    path.join(OUT_DIR, "report.md"),
    buildMarkdown({ results, roleStatus, topProblems, totals, overflowFound, screenshots: screenshots.length }),
  );

  const runs = results.length;
  const overflowRuns = results.filter((entry) => entry.checks.overflow.count > 0 || entry.checks.overflow.docOverflow).length;
  const clipRuns = results.filter((entry) => entry.checks.clipped.count > 0).length;
  console.log("");
  console.log(`UI audit: ${runs} route×viewport runs across ${Object.keys(roleStatus).length} role(s).`);
  console.log(
    `overflow: ${totals.overflow} (${overflowRuns} page(s)) · clipped: ${totals.clipped} (${clipRuns} page(s)) · axe: ${totals.axe} · contrast: ${totals.contrast} · console/network: ${totals.consoleNetwork}`,
  );
  console.log(`screenshots: ${screenshots.length}`);
  console.log(`report: ${path.relative(REPO_ROOT, path.join(OUT_DIR, "report.md"))} and report.json`);
  console.log(overflowFound ? "RESULT: horizontal overflow present (exit 1)." : "RESULT: no horizontal overflow (exit 0).");
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    if (isAccessDenied(error)) {
      console.error("Audit stopped: access denied (WinError 5).");
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  });
