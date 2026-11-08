// lib/puppeteer.js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

/**
 * Nis Chromium-in e paketuar për ambiente serverless si Vercel.
 * Nuk përdor stealth plugins dhe nuk tenton të anashkalojë kontrollet
 * e aksesit të faqes.
 */
export async function getBrowser() {
  chromium.setGraphicsMode = false;

  const executablePath = await chromium.executablePath();

  return puppeteer.launch({
    args: [...chromium.args, '--hide-scrollbars'],
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless
  });
}
