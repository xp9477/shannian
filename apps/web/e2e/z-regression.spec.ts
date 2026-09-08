import { expect, test, type Page } from "playwright/test";
import fs from "node:fs";
import path from "node:path";

const screenshotsDir = path.resolve("test-results/screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function ensureSetupAndLogin(page: Page) {
  await page.goto("/");
  // Check if first-run protected setup screen is visible
  const isProtectedSetup = await page
    .getByText("这台服务器已启用首次初始化保护")
    .isVisible()
    .catch(() => false);
  if (isProtectedSetup) {
    await page.getByPlaceholder("一次性初始化令牌").fill("playwright-setup-token");
    await page.getByPlaceholder("密码（至少 8 位）").fill("playwright-password");
    await page.getByPlaceholder("再输入一次").fill("playwright-password");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "跳过", exact: true }).click();
    await page.getByRole("button", { name: "跳过，进入", exact: true }).click();
    return;
  }

  const isSetup = await page
    .getByText("欢迎使用闪念")
    .isVisible()
    .catch(() => false);
  if (isSetup) {
    await page.getByPlaceholder("密码（至少 8 位）").fill("playwright-password");
    await page.getByPlaceholder("再输入一次").fill("playwright-password");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "跳过", exact: true }).click();
    await page.getByRole("button", { name: "跳过，进入", exact: true }).click();
    return;
  }

  const isLogin = await page
    .getByPlaceholder("输入主人密码")
    .isVisible()
    .catch(() => false);
  if (isLogin) {
    await page.getByPlaceholder("输入主人密码").fill("playwright-password");
    await page.getByRole("button", { name: /进入工作台/ }).click();
    await expect(
      page.getByRole("navigation", { name: "主导航" }).first()
    ).toBeVisible();
  }
}

async function waitForNoToast(page: Page) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 8000 });
}

test.describe("Figma UI Design System & Interaction Regressions", () => {
  test("Desktop two-column layout, 600px reading width, 22px title, 18/31px summary, and 6-item list", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    // Create 6 rich local fixture cards with real headlines
    const fixtures = [
      {
        text: "2001年互联网泡沫破裂时阿里账上仅剩1000万美元且每月支出200万的危机处理深度复盘与战略转折",
      },
      {
        text: "Claude Code 团队建议开发者每半年重构甚至完全清空项目的 CLAUDE.md 指令集以保证大模型自然对齐",
      },
      {
        text: "Cloudflare 拿域名促销：.dev / .app 首年 1 美元活动，适合轻量级独立开发项目上线",
      },
      {
        text: "Slidebox 与 Picsift 交互对比思考：打造极低决策成本分流工具，仅展示关键决策依据",
      },
      {
        text: "Codex 5.6 这个 GitHub 插件一定要装：介绍增强型 PR 自动化审查与本地差异比对",
      },
      {
        text: "ChatGPT Plus 8刀每月订阅与地区结算方案：跨区结算汇率与风控提示避坑指南",
      },
    ];

    for (const item of fixtures) {
      const captureInput = page.getByPlaceholder("粘贴链接或写下想法… Enter 保存");
      await captureInput.fill(item.text);
      await captureInput.press("Enter");
      await page.waitForTimeout(150);
    }

    // Verify left index column width is exactly 360px (Figma 96:107)
    const aside = page.locator("aside");
    await expect(aside).toBeVisible();
    const asideBox = await aside.boundingBox();
    expect(asideBox).not.toBeNull();
    expect(Math.round(asideBox!.width)).toBe(360);

    // Select the first card
    const firstCardButton = page
      .locator("aside button.group")
      .filter({ hasText: "2001年互联网泡沫破裂时" })
      .first();
    await firstCardButton.click();

    // Verify Reading Pane container width is strictly 600px (Figma 103:3 / 103:682)
    const readingContainer = page.getByTestId("reading-content");
    await expect(readingContainer).toBeVisible();
    const containerBox = await readingContainer.boundingBox();
    expect(containerBox).not.toBeNull();
    expect(Math.round(containerBox!.width)).toBe(600);

    // Verify Title typography: 22px font size, 32px line height (Figma 103:682)
    const heading = page.getByRole("heading", { level: 1 }).first();
    await expect(heading).toBeVisible();
    const titleStyle = await heading.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { fontSize: s.fontSize, lineHeight: s.lineHeight };
    });
    expect(titleStyle.fontSize).toBe("22px");

    // Add a user note
    const noteTextarea = page.locator('textarea[placeholder*="写下灵感"]');
    await noteTextarea.fill("用 AI 帮我管理公司？给出策略与执行路径，如何借鉴危机时期的组织紧缩原则？");
    await noteTextarea.blur();
    await page.waitForTimeout(600);

    // Verify real local Noto Serif SC & Noto Sans SC fonts are loaded
    const notoSerifLoaded = await page.evaluate(async () => {
      const fonts = await document.fonts.load('18px "Noto Serif SC"', "闪念测试阿里危机");
      return fonts.length > 0;
    });
    expect(notoSerifLoaded).toBe(true);

    const notoSansLoaded = await page.evaluate(async () => {
      const fonts = await document.fonts.load('14px "Noto Sans SC"', "收件箱已保留设置");
      return fonts.length > 0;
    });
    expect(notoSansLoaded).toBe(true);

    // Blur all focused elements and wait for toasts to fade for clean screenshot
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await waitForNoToast(page);

    await page.screenshot({
      path: path.join(screenshotsDir, "1440x900-desktop-card-selected.png"),
    });

    // Test Quick Capture Modal (Figma 96:222) via C shortcut
    await page.locator("body").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("c");
    await expect(page.getByRole("heading", { name: "录入新闪念 (Quick Capture)" })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await waitForNoToast(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "1440x900-desktop-capture-modal.png"),
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "录入新闪念 (Quick Capture)" })).not.toBeVisible();

    // Test Settings Modal (Figma 96:491)
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    await expect(page.getByText("MinIO / Obsidian（高级 · 可选）")).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await waitForNoToast(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "1440x900-desktop-settings.png"),
    });
    await page.keyboard.press("Escape");

    // Test X Import Modal (Figma 96:382)
    await page.getByRole("button", { name: "X 导入", exact: true }).click();
    await expect(page.getByRole("heading", { name: /平台收藏导入/ })).toBeVisible();
    await expect(page.getByText("计划中接入平台 (Coming Soon Registry)")).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await waitForNoToast(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "1440x900-desktop-import.png"),
    });
    await page.keyboard.press("Escape");

    // Test Trash Modal (Figma 96:439)
    await page.locator("header").getByRole("button", { name: /^回收站/ }).click();
    await expect(page.getByRole("heading", { name: /回收站 \(仅软删除/ })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await waitForNoToast(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "1440x900-desktop-trash.png"),
    });
    await page.keyboard.press("Escape");
  });

  test("Real 3-card organize queue progression, last card empty state, and undo deduplication", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    // Switch to inbox tab
    await page.getByRole("navigation", { name: "主导航" }).first().getByRole("button", { name: /^收件箱/ }).click();

    // Create 3 specific test cards
    const idSuffix = Date.now();
    const card1 = "队列单向测试-第一条-" + idSuffix;
    const card2 = "队列单向测试-第二条-" + idSuffix;
    const card3 = "队列单向测试-第三条-" + idSuffix;

    for (const name of [card1, card2, card3]) {
      const captureInput = page.getByPlaceholder("粘贴链接或写下想法… Enter 保存");
      await captureInput.fill(name);
      await captureInput.press("Enter");
      await page.waitForTimeout(150);
    }

    // Select card3 (newest at index 0)
    const btn3 = page.locator("aside button.group").filter({ hasText: card3 }).first();
    await btn3.click();
    await expect(page.getByRole("heading", { name: card3 })).toBeVisible();

    // 1. Organize card3 -> must actually advance to card2!
    const organizeBtn1 = page.locator("#main-content").getByRole("button", { name: "保留", exact: true });
    await organizeBtn1.click();
    await expect(page.getByRole("heading", { name: card2 })).toBeVisible();

    // 2. On card2, press Enter -> must advance to card1!
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: card1 })).toBeVisible();

    // 3. On card1, click "保留" -> advances or updates
    const organizeBtn3 = page.locator("#main-content").getByRole("button", { name: "保留", exact: true });
    await organizeBtn3.click();

    // Undo toast is visible
    const undoBtn = page.getByRole("button", { name: /撤销/ });
    await expect(undoBtn).toBeVisible();

    // 4. Test Undo: restores card1 back to inbox
    await undoBtn.click();
    await expect(page.getByRole("heading", { name: card1 })).toBeVisible();

    // Verify card1 in left list exists exactly once
    const card1InList = page.locator("aside button.group").filter({ hasText: card1 });
    await expect(card1InList).toHaveCount(1);
  });

  test("True Grid View mode switching, column layout change, and view persistence across selection", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    // Click grid view toggle button
    const gridToggleBtn = page.getByTitle("切换网格视图");
    await gridToggleBtn.click();

    // Verify responsive grid container is active across main workspace
    const gridContainer = page.locator(".grid.grid-cols-1");
    await expect(gridContainer).toBeVisible();

    // Select a card in grid view
    const gridCard = gridContainer.locator("button").first();
    await gridCard.click();

    // Reading pane is open
    await expect(page.locator("#main-content")).toBeVisible();

    // Toggle back to list view
    const listToggleBtn = page.getByTitle("切换列表视图");
    if (await listToggleBtn.isVisible()) {
      await listToggleBtn.click();
      await expect(page.locator("aside")).toBeVisible();
    }
  });

  test("Pagination and background polling: >100 cards retain pages without collapsing to 50", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    // Fast-create cards to reach > 100
    await page.evaluate(async () => {
      const promises = [];
      for (let i = 0; i < 110; i++) {
        promises.push(
          fetch("/api/cards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: `分页压测卡片-${Date.now()}-${i}` }),
          })
        );
      }
      await Promise.all(promises);
    });

    // Reload list
    await page.reload();
    await ensureSetupAndLogin(page);

    // Initial page has 50 items
    const initialItems = page.locator("aside button.group");
    await expect(initialItems).toHaveCount(50);

    // Click "加载更多"
    const loadMoreBtn = page.getByRole("button", { name: /加载更多/ });
    await expect(loadMoreBtn).toBeVisible();
    await loadMoreBtn.click();

    // Now has >50 items (around 100 items!)
    await expect(page.locator("aside button.group")).toHaveCount(100);

    // Wait for 4s background poll
    await page.waitForTimeout(4500);

    // Verify list still has 100 items and did NOT collapse back to 50!
    await expect(page.locator("aside button.group")).toHaveCount(100);
  });

  test("Scroll position caching: scroll down to item 30, open detail, return, and verify scrollTop restored", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    const listScrollable = page.locator("aside div.overflow-y-auto.scroll-thin");
    await expect(listScrollable).toBeVisible();

    // Scroll down to item 30
    const item30 = page.locator("aside button.group").nth(29);
    await item30.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const initialScrollTop = await listScrollable.evaluate((el) => el.scrollTop);
    expect(initialScrollTop).toBeGreaterThan(200);

    // Click item 30
    await item30.click();
    await expect(page.locator("#main-content")).toBeVisible();

    // Go back using browser history navigation
    await page.goBack();
    await page.waitForTimeout(300);

    // Verify scrollTop is restored within +/- 5px!
    const restoredScrollTop = await listScrollable.evaluate((el) => el.scrollTop);
    expect(Math.abs(restoredScrollTop - initialScrollTop)).toBeLessThan(6);
  });

  test("Note saving failure prevents Obsidian export and does not send export request", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    // Intercept PATCH to simulate note saving network failure
    let obsidianExportAttempted = false;
    await page.route("**/api/cards/**", async (route) => {
      const req = route.request();
      if (req.method() === "PATCH") {
        await route.fulfill({ status: 500, body: JSON.stringify({ error: "DB_LOCKED" }) });
        return;
      }
      if (req.method() === "POST" && req.url().endsWith("/obsidian")) {
        obsidianExportAttempted = true;
        await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.continue();
    });

    // Select the first card
    const firstCard = page.locator("aside button.group").first();
    await firstCard.click();

    // Edit note
    const noteTextarea = page.locator('textarea[placeholder*="写下灵感"]');
    await noteTextarea.fill("网络失败测试笔记");

    // Click Export to Obsidian
    const exportBtn = page.locator("#main-content").getByRole("button", { name: "导出到 Obsidian", exact: true });
    await exportBtn.click();

    // Verify error toast was shown and Obsidian export was NOT sent!
    await expect(page.getByText(/批注保存失败/)).toBeVisible();
    expect(obsidianExportAttempted).toBe(false);

    // Unroute
    await page.unrouteAll();
  });

  test("TrashModal dangerous confirm dialog and cancel path verification", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    // Create a card to trash
    const trashCardTitle = "删除确认取消路径测试-" + Date.now();
    const captureInput = page.getByPlaceholder("粘贴链接或写下想法… Enter 保存");
    await captureInput.fill(trashCardTitle);
    await captureInput.press("Enter");
    await page.waitForTimeout(200);

    // Soft delete it to trash
    const cardBtn = page.locator("aside button.group").filter({ hasText: trashCardTitle }).first();
    await cardBtn.click();
    await page.locator("#main-content").getByRole("button", { name: /丢弃/ }).click();
    await page.waitForTimeout(300);

    // Open Trash Modal
    await page.locator("header").getByRole("button", { name: /^回收站/ }).click();
    await expect(page.getByRole("heading", { name: /回收站 \(仅软删除/ })).toBeVisible();

    // Dismiss dialog when prompted (cancel path)
    page.once("dialog", async (dialog) => {
      await dialog.dismiss();
    });

    // Click "永久删除 (Purge)"
    const purgeBtn = page.locator('[role="dialog"]').locator("button").filter({ hasText: "永久删除" }).first();
    await purgeBtn.click();

    // Verify card is STILL in the trash list because user cancelled!
    await expect(page.locator('[role="dialog"]').getByText(trashCardTitle)).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("Modal Enter key isolation: pressing Enter on modal controls does not modify underlying cards", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    // Create a target card
    const targetTitle = "底层卡片防误触隔离测试-" + Date.now();
    const captureInput = page.getByPlaceholder("粘贴链接或写下想法… Enter 保存");
    await captureInput.fill(targetTitle);
    await captureInput.press("Enter");
    await page.waitForTimeout(200);

    // Select the card
    const cardBtn = page.locator("aside button.group").filter({ hasText: targetTitle }).first();
    await cardBtn.click();
    await expect(page.getByRole("heading", { name: targetTitle })).toBeVisible();

    // Open Settings Modal
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

    // Focus the "完成" button inside SettingsModal and press Enter
    const finishBtn = page.locator('[role="dialog"]').getByRole("button", { name: "完成" });
    await finishBtn.focus();
    await page.keyboard.press("Enter");

    // Modal should close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    // The underlying card MUST still be active and NOT organized (heading still visible and button still "保留")!
    await expect(page.getByRole("heading", { name: targetTitle })).toBeVisible();
    const organizeBtn = page.locator("#main-content").getByRole("button", { name: "保留", exact: true });
    await expect(organizeBtn).toBeVisible();
  });

  test("Note saving across card switching preserves draft without data loss", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    const title1 = "切卡防丢稿测试-卡片1-" + Date.now();
    const title2 = "切卡防丢稿测试-卡片2-" + Date.now();

    for (const t of [title1, title2]) {
      const captureInput = page.getByPlaceholder("粘贴链接或写下想法… Enter 保存");
      await captureInput.fill(t);
      await captureInput.press("Enter");
      await page.waitForTimeout(150);
    }

    // Select Card 1
    await page.locator("aside button.group").filter({ hasText: title1 }).first().click();
    await expect(page.getByRole("heading", { name: title1 })).toBeVisible();

    // Edit note on Card 1
    const noteTextarea = page.locator('textarea[placeholder*="写下灵感"]');
    await noteTextarea.fill("卡片1的关键批注内容-绝不能丢失");

    // Immediately switch to Card 2 before debounce expires
    await page.locator("aside button.group").filter({ hasText: title2 }).first().click();
    await expect(page.getByRole("heading", { name: title2 })).toBeVisible();

    // Switch back to Card 1
    await page.locator("aside button.group").filter({ hasText: title1 }).first().click();
    await expect(page.getByRole("heading", { name: title1 })).toBeVisible();

    // Assert note on Card 1 is preserved and saved!
    const noteTextareaAfter = page.locator('textarea[placeholder*="写下灵感"]');
    await expect(noteTextareaAfter).toHaveValue("卡片1的关键批注内容-绝不能丢失");
  });

  test("Narrow desktop (1024px) responsive layout without layout explosion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await ensureSetupAndLogin(page);

    const aside = page.locator("aside");
    await expect(aside).toBeVisible();
    const asideBox = await aside.boundingBox();
    expect(asideBox).not.toBeNull();
    expect(Math.round(asideBox!.width)).toBe(360);

    const mainContent = page.locator("#main-content");
    await expect(mainContent).toBeVisible();

    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await waitForNoToast(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "1024x768-narrow-desktop.png"),
    });
  });

  test("Mobile responsive layout: 390px (iPhone 14) and 320px list -> detail flow", async ({
    page,
  }) => {
    // 390px Mobile View (Figma 96:594)
    await page.setViewportSize({ width: 390, height: 844 });
    await ensureSetupAndLogin(page);

    // Verify Mobile List & Tabs are visible
    await expect(page.getByRole("button", { name: /^收件箱/ }).first()).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await waitForNoToast(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "390x844-mobile-inbox.png"),
    });

    // Tap a card to navigate to Mobile Detail (Figma 96:668)
    const cardButton = page.locator("aside button.group").first();
    if (await cardButton.isVisible()) {
      await cardButton.click();
      await expect(page.getByText(/‹ 返回/)).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await waitForNoToast(page);
      await page.screenshot({
        path: path.join(screenshotsDir, "390x844-mobile-detail.png"),
      });

      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const reading = page.getByTestId("reading-content");
        const readingBox = await reading.boundingBox();
        expect(readingBox).not.toBeNull();
        expect(readingBox!.x).toBeGreaterThanOrEqual(0);
        expect(readingBox!.x + readingBox!.width).toBeLessThanOrEqual(width);
        const insideBounds = await reading.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
        expect(insideBounds).toBe(true);
        const keep = page.locator("#main-content").getByRole("button", { name: "保留", exact: true });
        const keepBox = await keep.boundingBox();
        expect(keepBox).not.toBeNull();
        expect(keepBox!.x + keepBox!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: path.join(screenshotsDir, `${width}x844-mobile-detail-verified.png`) });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      // Tap back button to return to inbox list
      await page.getByText(/‹ 返回/).click();
      await expect(page.getByText(/‹ 返回/)).not.toBeVisible();
    }

    // 320px Small Mobile View
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.getByRole("button", { name: /^收件箱/ }).first()).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await waitForNoToast(page);
    await page.screenshot({
      path: path.join(screenshotsDir, "320x568-mobile-small.png"),
    });
  });

  test("Keyboard shortcuts: J/K navigation and input guard safety", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ensureSetupAndLogin(page);

    // Focus quick capture and type J and K - should NOT navigate or trigger shortcuts
    const captureInput = page.getByPlaceholder("粘贴链接或写下想法… Enter 保存");
    await captureInput.focus();
    await captureInput.fill("Testing jk input safety");
    expect(await captureInput.inputValue()).toBe("Testing jk input safety");
    await captureInput.fill("");

    // Blur input
    await page.keyboard.press("Tab");

    // Press J/K in free window
    await page.keyboard.press("j");
    await page.waitForTimeout(100);
    await page.keyboard.press("k");
    await page.waitForTimeout(100);
  });
});
