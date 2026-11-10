// lib/puppeteer.js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

let browserPromise = null;

async function launchBrowser() {
  chromium.setGraphicsMode = false;

  const executablePath = await chromium.executablePath();
  const libraryDir = '/tmp/al2023/lib';
  const nssLibrary = `${libraryDir}/libnss3.so`;

  if (!existsSync(nssLibrary)) {
    throw new Error(
      'Chromium u ekstraktua, por libraritë AL2023 mungojnë. ' +
      `Kontrollo paketimin e al2023.tar.br. Node: ${process.version}; VERCEL: ${Boolean(process.env.VERCEL)}.`
    );
  }

  const currentLibraryPath = process.env.LD_LIBRARY_PATH || '';
  const paths = currentLibraryPath.split(':').filter(Boolean);
  if (!paths.includes(libraryDir)) {
    process.env.LD_LIBRARY_PATH = [libraryDir, ...paths].join(':');
  }

  const browser = await puppeteer.launch({
    args: [...chromium.args, '--hide-scrollbars'],
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: 'shell'
  });

  browser.once('disconnected', () => {
    if (browserPromise) {
      browserPromise.then((current) => {
        if (current === browser) browserPromise = null;
      }).catch(() => {
        browserPromise = null;
      });
    }
  });

  return browser;
}

/** Reuse a healthy Chromium process in warm Vercel instances. */
export async function getBrowser() {
  if (browserPromise) {
    const cachedPromise = browserPromise;
    try {
      const cached = await cachedPromise;
      if (cached && cached.connected) return cached;
    } catch {
      // A rejected/disconnected browser is replaced below.
    }
    if (browserPromise === cachedPromise) browserPromise = null;
  }

  if (!browserPromise) browserPromise = launchBrowser();

  const launchPromise = browserPromise;
  try {
    const browser = await launchPromise;
    if (!browser || !browser.connected) {
      if (browserPromise === launchPromise) browserPromise = null;
      throw new Error('Chromium u shkëput gjatë inicializimit.');
    }
    return browser;
  } catch (error) {
    if (browserPromise === launchPromise) browserPromise = null;
    throw error;
  }
}

/** Discard a stale process so the next attempt starts a clean Chromium. */
export function resetBrowser(browser) {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;

  void pending.then((current) => {
    if (browser && current !== browser) return;
    if (current && current.connected) return current.close();
    return undefined;
  }).catch(() => {});
}
