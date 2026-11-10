// lib/puppeteer.js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

/**
 * Launch a clean Chromium process for each Vercel resolver invocation.
 * Vercel may freeze or discard serverless processes between requests, so
 * reusing a CDP browser can leave a stale connection after a warm start.
 */
export async function getBrowser() {
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
}
