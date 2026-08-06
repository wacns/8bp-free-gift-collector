import puppeteer from "puppeteer";

import { logger } from "./logger.js";
import { makeRewardData } from "./utils.js";

const waitForVisibleButtonByText = async (page, texts, timeout) => {
  const handle = await page.waitForFunction(
    (labels) => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        return (
          style &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      };
      const buttons = [...document.querySelectorAll("button")];
      const normalize = (value) =>
        (value || "").replace(/\s+/g, " ").trim().toLowerCase();

      for (const label of labels) {
        const target = normalize(label);
        const button = buttons.find(
          (candidate) =>
            isVisible(candidate) && normalize(candidate.textContent) === target
        );

        if (button) {
          return button;
        }
      }

      return null;
    },
    { timeout },
    texts
  );

  return handle.asElement();
};

const waitForVisibleInput = async (page, timeout) => {
  const handle = await page.waitForFunction(
    () => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        return (
          style &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      };
      const inputs = [...document.querySelectorAll("input")];
      const input = inputs.find((candidate) => isVisible(candidate));
      return input || null;
    },
    { timeout }
  );

  return handle.asElement();
};

const resolveImageUrl = async (productElement) => {
  return productElement.evaluate((root) => {
    const toAbsoluteUrl = (value) => {
      if (!value) {
        return null;
      }

      const trimmed = value.trim();
      if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
        return null;
      }

      try {
        return new URL(trimmed, document.baseURI).href;
      } catch {
        return null;
      }
    };

    const fromSrcset = (value) => {
      if (!value) {
        return null;
      }

      const candidates = value
        .split(",")
        .map((entry) => entry.trim().split(/\s+/)[0])
        .filter(Boolean)
        .reverse();

      for (const candidate of candidates) {
        const resolved = toAbsoluteUrl(candidate);
        if (resolved) {
          return resolved;
        }
      }

      return null;
    };

    const extractBackgroundUrl = (element) => {
      if (!element) {
        return null;
      }

      const backgroundImage = window.getComputedStyle(element).backgroundImage;
      if (!backgroundImage || backgroundImage === "none") {
        return null;
      }

      const match = backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      return match ? toAbsoluteUrl(match[1]) : null;
    };

    const imageSelectors = [
      ".item-image img",
      ".bundle-item__icons img",
      'img[alt="Item Image"]',
      ".single-card img",
      ".bundle-card img",
      "img",
    ];

    for (const selector of imageSelectors) {
      for (const img of root.querySelectorAll(selector)) {
        const attributes = [
          img.currentSrc,
          img.getAttribute("src"),
          img.getAttribute("data-src"),
          img.getAttribute("data-lazy-src"),
          img.getAttribute("data-original"),
        ];

        for (const attribute of attributes) {
          const resolved = toAbsoluteUrl(attribute);
          if (resolved) {
            return resolved;
          }
        }

        const srcset =
          fromSrcset(img.getAttribute("srcset")) ||
          fromSrcset(img.getAttribute("data-srcset"));
        if (srcset) {
          return srcset;
        }
      }
    }

    const backgroundSelectors = [
      ".item-image",
      ".bundle-item__icons",
      ".single-card",
      ".bundle-card",
      ".product-card",
      ".product-list-item",
    ];

    for (const selector of backgroundSelectors) {
      const target = root.querySelector(selector);
      const resolved = extractBackgroundUrl(target);
      if (resolved) {
        return resolved;
      }
    }

    return extractBackgroundUrl(root);
  });
};

/**
 *
 * @param {string} userUniqueID
 * @returns {string[]}
 *
 */
export const collectRewards = async (userUniqueID) => {
  const pageUrl = "https://8ballpool.com/en/shop";
  const delay = 100;
  const BROWSER_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
  ];
  const TIMEOUT = 15000;

  logger("debug", "🚀 Launching browser...");
  const browser = await puppeteer.launch({
    headless: "shell",
    // headless: false,
    slowMo: delay,
    args: BROWSER_ARGS,
  });
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send("Network.clearBrowserCache");
  await client.send("Network.clearBrowserCookies");
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36"
  );

  logger("info", `🌐 Navigating to ${pageUrl}`);
  await page.goto(pageUrl, { waitUntil: "networkidle2" });
  logger("debug", `✅ Navigation complete, waiting for login button.`);

  const loginButton = await waitForVisibleButtonByText(page, ["Login"], TIMEOUT);

  if (loginButton) {
    logger("debug", "🔍 Login button found, clicking.");
    await loginButton.click();

    const input = await waitForVisibleInput(page, TIMEOUT);
    if (!input) {
      throw new Error("Unable to find login input.");
    }

    await input.click({ clickCount: 3 });
    await input.type(userUniqueID, { delay });

    const goButton = await waitForVisibleButtonByText(
      page,
      ["Go", "Continue", "Submit"],
      TIMEOUT
    );
    if (!goButton) {
      throw new Error("Unable to find login submit button.");
    }

    await goButton.click();
    logger("success", "✅ User logged in.");
  } else {
    logger("warn", "⚠️ Login button not found. Continuing without login.");
  }

  let rewards = [];
  const PRODUCTS_SELECTOR = ".product-list-item";
  logger("debug", `🔍 Searching for products with selector: ${PRODUCTS_SELECTOR}`);
  const products = await page.$$(PRODUCTS_SELECTOR);
  const N = products.length;

  logger("info", `💡 ${N} products found.`);

  for (const [index, product] of products.entries()) {
    logger("debug", `➡️ Processing product [${index + 1}/${N}]`);
    
    const priceButton = await product.$("button");
    const price = await priceButton.evaluate((el) =>
      el.textContent.trim().toUpperCase()
    );

    const imageSrc = await resolveImageUrl(product);

    const nameElement = await product.$("h3");
    const name = await nameElement.evaluate((el) => el.textContent.trim());

    const quantityElement = await product.$(".amount-text");

    let quantity = "";
    if (quantityElement) {
      quantity = await quantityElement.evaluate((el) => el.textContent.trim());
    }

    logger("info", `🚲 [${index + 1}/${N}] ${price} ${name}`);

    if (["FREE", "CLAIM", "CLAIMED"].includes(price.toUpperCase())) {
      logger("info", `⏳ Claiming: [${index + 1}/${N}]`);
      await priceButton.click();
      rewards.push(makeRewardData(imageSrc, name, quantity));
      logger("success", `🎉 Claimed: [${index + 1}/${N}]`);
    } else {
      logger("debug", `💰 Product [${index + 1}/${N}] skipped. Price: ${price}`);
    }
  }

  await browser.close();
  logger("info", "❎ Browser closed.");

  if (rewards.length === 0) {
    logger("warn", "⚠️ No free rewards found.");
    throw new Error("No rewards found");
  }

  return rewards;
};
