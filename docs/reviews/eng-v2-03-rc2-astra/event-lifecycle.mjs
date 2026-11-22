// Independent checks of RC2's window-resize event path. Instrumentation observes real
// registrations and calls; canceled-frame delivery is explicitly a forced diagnostic.
import fs from 'node:fs';
import path from 'node:path';
import { pw, out, pause, serve, measureFocus } from './browser-support.mjs';
const site = await serve('site-dist');
const report = { engines: {}, method: 'Native keyboard, native viewport changes, instrumented window resize listeners and scrollBy. Separate held/canceled callback diagnostics and synchronous event burst. No arbitrary lower-edge clearance.' };
function instrument() {
  const a = window.__audit = { listeners: [], hold: false, frames: [], scrolls: [], rejections: [], next: 9000000 };
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  const scroll = window.scrollBy.bind(window);
  const capture = (options) => typeof options === 'boolean' ? options : !!options?.capture;
  window.addEventListener = (type, callback, options) => {
    if (type !== 'resize') return add(type, callback, options);
    let r = a.listeners.find((r) => r.callback === callback && r.capture === capture(options));
    if (!r) {
      r = { id: a.listeners.length + 1, callback, capture: capture(options), active: false, adds: 0, removes: 0, calls: 0 };
      r.wrapper = (event) => { r.calls++; return typeof callback === 'function' ? callback.call(window, event) : callback.handleEvent(event); };
      a.listeners.push(r);
    }
    r.adds++; r.active = true; return add(type, r.wrapper, options);
  };
  window.removeEventListener = (type, callback, options) => {
    const r = a.listeners.find((r) => r.callback === callback && r.capture === capture(options));
    if (type !== 'resize' || !r) return remove(type, callback, options);
    r.removes++; r.active = false; return remove(type, r.wrapper, options);
  };
  window.requestAnimationFrame = (callback) => {
    if (!a.hold) return raf(callback);
    const id = ++a.next; a.frames.push({ id, callback, canceled: false }); return id;
  };
  window.cancelAnimationFrame = (id) => {
    const frame = a.frames.find((f) => f.id === id);
    if (frame) frame.canceled = true; else caf(id);
  };
  a.deliver = (evenCanceled) => {
    const frames = a.frames.splice(0), live = frames.filter((f) => !f.canceled);
    a.hold = false;
    for (const f of evenCanceled ? frames : live) f.callback(performance.now());
    return { delivered: evenCanceled ? frames.length : live.length, live: live.length, canceled: frames.length - live.length };
  };
  window.scrollBy = (...args) => {
    const before = scrollY; scroll(...args);
    a.scrolls.push({ before, after: scrollY, args, focused: document.activeElement?.textContent?.trim().slice(0, 70) });
  };
  add('unhandledrejection', (event) => a.rejections.push(String(event.reason)));
}
const stats = (page) => page.evaluate(() => ({
  active: window.__audit.listeners.filter((r) => r.active).map((r) => r.id),
  listeners: window.__audit.listeners.map(({ id, active, capture, adds, removes, calls }) => ({ id, active, capture, adds, removes, calls })),
  liveFrames: window.__audit.frames.filter((f) => !f.canceled).length,
  scrolls: window.__audit.scrolls, rejections: window.__audit.rejections,
}));
const position = (page) => page.evaluate(() => ({
  left: document.querySelector('.chip-row')?.scrollLeft ?? null, y: scrollY,
  focus: { tag: document.activeElement?.tagName, type: document.activeElement?.getAttribute('type'), text: document.activeElement?.textContent?.trim().slice(0, 80) },
  selected: document.querySelector('.chip-row [aria-pressed=true]')?.textContent?.trim() ?? null,
}));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function go(page, route) {
  await page.evaluate((value) => { location.hash = value; }, route);
  await page.locator(route === 'index' ? '.home-overview' : '.chip-row').waitFor(); await pause();
}
async function firstChip(page) {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => document.activeElement?.matches('.chip-row > button:first-child'))) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('No native keyboard entry into chip group');
}
async function search(page) {
  for (let i = 0; i < 15; i++) {
    if (await page.evaluate(() => document.activeElement?.matches('input[type=search]'))) return;
    await page.keyboard.press('Shift+Tab');
  }
  throw new Error('No native keyboard return to search');
}
async function hold(page) { await page.evaluate(() => { window.__audit.hold = true; }); }
async function deliver(page, all = true) { return page.evaluate((all) => window.__audit.deliver(all), all); }
try {
  for (const engine of ['chromium', 'firefox']) {
    const browser = await pw[engine].launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 320, height: 844 }, reducedMotion: 'reduce' });
    await ctx.route((url) => !url.href.startsWith(site.base), (r) => r.abort());
    await ctx.addInitScript(instrument);
    const page = await ctx.newPage(), e = { version: browser.version(), checks: [], errors: [], cases: {} };
    report.engines[engine] = e;
    const check = (ok, label) => e.checks.push({ label, passed: !!ok });
    page.on('pageerror', (error) => e.errors.push(String(error).replaceAll(site.base, '/eng-trainer/')));
    try {
      await page.goto(site.base + '#index', { waitUntil: 'networkidle' });
      await page.locator('.home-overview').waitFor(); await page.evaluate(() => document.fonts.ready); await pause();
      const baseline = (await stats(page)).active;
      const cycles = [];
      for (let n = 0; n < 3; n++) {
        await go(page, 'topic/small-talk'); const mounted = await stats(page);
        check(mounted.active.length === baseline.length + 1, 'Mount ' + n + ': exactly one additional active resize handler');
        await go(page, 'index'); const removed = await stats(page);
        check(same(removed.active, baseline), 'Unmount ' + n + ': original resize-listener set restored');
        cycles.push({ mounted: mounted.active, unmounted: removed.active });
      }
      e.cases.listenerCycles = cycles;
      await go(page, 'topic/small-talk'); await firstChip(page);
      for (let n = 0; n < 6; n++) await page.keyboard.press('Tab');
      await page.keyboard.press('Enter'); await pause();
      await search(page);
      const strip = await page.locator('.chip-row').boundingBox();
      await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
      await page.mouse.wheel(240, 0); await pause();
      const manualBefore = await position(page), callsBefore = (await stats(page)).listeners.reduce((s, r) => s + r.calls, 0);
      await page.setViewportSize({ width: 320, height: 480 }); await pause(400);
      const manualAfter = await position(page), callsAfter = (await stats(page)).listeners.reduce((s, r) => s + r.calls, 0);
      e.cases.outsideSelectedManual = { before: manualBefore, after: manualAfter, resizeHandlerCalls: callsAfter - callsBefore };
      check(manualBefore.left > 0 && manualBefore.selected === 'Traveling' && manualBefore.focus.type === 'search', 'Manual-scroll setup with selected unfocused chip');
      check(callsAfter > callsBefore && same(manualBefore, manualAfter), 'Native resize leaves Search focus, selection and manually scrolled strip unchanged');

      await page.setViewportSize({ width: 320, height: 844 }); await pause();
      await firstChip(page); for (let n = 0; n < 3; n++) await page.keyboard.press('Tab'); await pause();
      await page.evaluate(() => {
        window.__oldReads = 0; const old = document.activeElement, read = old.getBoundingClientRect.bind(old);
        old.getBoundingClientRect = () => { window.__oldReads++; return read(); };
      });
      await hold(page);
      await page.setViewportSize({ width: 320, height: 480 }); await pause(80);
      await search(page);
      const formerBefore = await position(page), formerDelivery = await deliver(page); await pause();
      e.cases.formerOwner = { before: formerBefore, after: await position(page), delivery: formerDelivery, reads: await page.evaluate(() => window.__oldReads) };
      check(formerDelivery.canceled > 0 && formerDelivery.delivered > 0, 'Former-owner diagnostic delivered actually canceled work');
      check(same(e.cases.formerOwner.before, e.cases.formerOwner.after) && e.cases.formerOwner.reads === 0, 'Former owner neither measured nor revealed after focus leaves');

      await page.setViewportSize({ width: 320, height: 844 }); await pause();
      await firstChip(page); for (let n = 0; n < 3; n++) await page.keyboard.press('Tab'); await pause();
      await hold(page);
      await page.setViewportSize({ width: 320, height: 480 }); await pause(80);
      await page.evaluate(() => {
        window.__detachedReads = 0; window.__oldStrip = document.querySelector('.chip-row');
        for (const el of [window.__oldStrip, document.activeElement]) {
          const read = el.getBoundingClientRect.bind(el);
          el.getBoundingClientRect = () => { window.__detachedReads++; return read(); };
        }
      });
      await go(page, 'index');
      const homeBefore = await position(page), beforeRemoved = await stats(page);
      const unmountDelivery = await deliver(page); await pause();
      await page.setViewportSize({ width: 320, height: 460 }); await pause();
      e.cases.unmount = { before: homeBefore, after: await position(page), delivery: unmountDelivery,
        beforeListeners: beforeRemoved.active, afterListeners: (await stats(page)).active,
        oldConnected: await page.evaluate(() => window.__oldStrip.isConnected),
        detachedReads: await page.evaluate(() => window.__detachedReads) };
      check(unmountDelivery.canceled > 0 && unmountDelivery.delivered > 0, 'Unmount diagnostic delivered canceled resize work');
      check(same(e.cases.unmount.before, e.cases.unmount.after) && !e.cases.unmount.oldConnected &&
        e.cases.unmount.detachedReads === 0 && same(e.cases.unmount.afterListeners, baseline), 'No late scroll/focus/detached reads or active handler after destruction');

      await page.setViewportSize({ width: 320, height: 844 }); await go(page, 'topic/small-talk');
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.evaluate(() => document.fonts.ready); await pause();
      await firstChip(page); for (let n = 0; n < 3; n++) await page.keyboard.press('Tab'); await pause();
      await page.evaluate(() => { window.__audit.scrolls.length = 0; });
      for (const height of [700, 620, 540, 500, 470, 480]) await page.setViewportSize({ width: 320, height });
      await pause(400);
      const settled = await position(page), settledStats = await stats(page), visible = await page.evaluate(measureFocus);
      await pause(1000);
      const later = await position(page), laterStats = await stats(page);
      e.cases.nativeBurst = { settled, later, geometry: visible, scrolls: settledStats.scrolls,
        scrollCountAfterSettle: settledStats.scrolls.length, scrollCountOneSecondLater: laterStats.scrolls.length };
      check(visible.complete && visible.label === 'Coffee and lunch breaks', 'Native resize burst leaves full focused label and outline accessible');
      check(same(settled, later) && settledStats.scrolls.length === laterStats.scrolls.length, 'No continuing movement after final native layout settles');
      check(laterStats.active.length === baseline.length + 1, 'Only one action listener after repeated topic visits');
      await hold(page);
      await page.evaluate(() => { for (let n = 0; n < 20; n++) window.dispatchEvent(new Event('resize')); });
      const pending = await stats(page), synchronousDelivery = await deliver(page, false); await pause();
      e.cases.sameFrameBurst = { liveBeforeDelivery: pending.liveFrames, delivery: synchronousDelivery,
        scrollCountAfter: (await stats(page)).scrolls.length };
      check(pending.liveFrames === 1 && synchronousDelivery.live === 1, 'Twenty same-frame resize events coalesce into one live callback');
      check((await stats(page)).scrolls.length === laterStats.scrolls.length, 'Already visible focus does not cause an unnecessary page jump');
      await go(page, 'index'); e.listenerRecords = (await stats(page)).listeners;
      check(same((await stats(page)).active, baseline), 'Final unmount restores listener baseline');
      check((await stats(page)).rejections.length === 0 && e.errors.length === 0, 'No uncaught errors or unhandled rejections');
    } catch (error) { e.errors.push(String(error).replaceAll(site.base, '/eng-trainer/')); }
    e.passed = e.errors.length === 0 && e.checks.every((c) => c.passed);
    console.log(engine, JSON.stringify({ passed: e.passed, checks: e.checks.length, failures: e.checks.filter((c) => !c.passed), errors: e.errors }));
    await ctx.close(); await browser.close();
  }
} finally { site.close(); }
report.passed = Object.values(report.engines).every((e) => e.passed);
fs.writeFileSync(path.join(out, 'event-lifecycle.json'), JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;
