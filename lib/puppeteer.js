// lib/puppeteer.js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

/**
 * Nis Chromium-in serverless në Vercel.
 *
 * Versionet e reja të @sparticuz/chromium njohin ambientin Vercel
 * dhe Node 20+ dhe për këtë arsye nxjerrin al2023.tar.br, i cili
 * përmban bibliotekat native si libnss3.so.
 */
export async function getBrowser() {
  chromium.setGraphicsMode = false;

  const executablePath = await chromium.executablePath();

  // Në Vercel Node 24, Chromium duhet të ketë nxjerrë bibliotekat AL2023.
  const libraryDir = '/tmp/al2023/lib';
  const nssLibrary = `${libraryDir}/libnss3.so`;

  if (!existsSync(nssLibrary)) {
    throw new Error(
      'Chromium u ekstraktua, por libraritë AL2023 mungojnë. ' +
      `Kontrollo paketimin e al2023.tar.br. Node: ${process.version}; VERCEL: ${Boolean(process.env.VERCEL)}.`
    );
  }

  // Sigurohemi që libraritë e paketuara të jenë të kërkueshme nga Chromium.
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
}
