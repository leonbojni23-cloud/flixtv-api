// lib/puppeteer.js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

let browserPromise = null;

/**
 * Keep Chromium warm in reused Vercel function instances.
 * Each request creates its own isolated BrowserContext in api/stream.js.
 */
export async function getBrowser() {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing && existing.connected) return existing;
    } catch {
      browserPromise = null;
    }
  }

  if (!browserPromise) {
    browserPromise = (async () => {
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

      return puppeteer.launch({
        args: [...chromium.args, '--hide-scrollbars'],
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: 'shell'
      });
    })();
  }

  try {
    const browser = await browserPromise;
    if (!browser || !browser.connected) {
      browserPromise = null;
      throw new Error('Chromium u shkëput gjatë inicializimit.');
    }
    return browser;
  } catch (error) {
    browserPromise = null;
    throw error;
  }
}
