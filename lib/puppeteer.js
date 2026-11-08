// lib/puppeteer.js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

/**
 * Nis Chromium-in e paketuar për ambiente serverless si Vercel.
 * Siguron që arkivat Brotli të paketohen me funksionin dhe që
 * libraritë native të ekstraktuara të jenë në LD_LIBRARY_PATH.
 */
export async function getBrowser() {
  chromium.setGraphicsMode = false;

  // Kjo nxjerr binarin dhe libraritë native nga paketa në /tmp.
  const executablePath = await chromium.executablePath();

  const libraryDirs = ['/tmp/al2023/lib', '/tmp/al2/lib'];
  const libraryDir = libraryDirs.find((dir) =>
    existsSync(`${dir}/libnss3.so`)
  );

  if (!libraryDir) {
    throw new Error(
      'Chromium u ekstraktua, por libnss3.so mungon. ' +
      'Kontrollo paketimin e node_modules/@sparticuz/chromium/bin/*.tar.br ' +
      'në Vercel Function.'
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
    headless: chromium.headless
  });
}
