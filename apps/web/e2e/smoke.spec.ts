import { expect, test } from "playwright/test";

test("first run, capture, keep, edit, global search, and export error", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const unexpectedHttp: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    const expectedExportError =
      pathname.endsWith("/obsidian") && response.status() === 422;
    if (response.status() >= 400 && !expectedExportError) {
      unexpectedHttp.push(`${response.status()} ${pathname}`);
    }
  });

  await page.goto("/");
  await expect(
    page.getByText("这台服务器已启用首次初始化保护", { exact: true })
  ).toBeVisible();
  await page.getByPlaceholder("一次性初始化令牌").fill("playwright-setup-token");
  await page.getByPlaceholder("密码（至少 8 位）").fill("playwright-password");
  await page.getByPlaceholder("再输入一次").fill("playwright-password");
  await page.getByRole("button", { name: "下一步", exact: true }).click();

  await expect(page.getByText("步骤 2 / 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await expect(page.getByText("步骤 3 / 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "跳过，进入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "收件箱", exact: true })).toBeVisible();

  const originalTitle = "浏览器闭环测试 惟一短语 可恢复";
  const capture = page.getByPlaceholder("粘贴链接或写下想法… Enter 保存");
  await capture.fill(originalTitle);
  await capture.press("Enter");
  await expect(page.getByText(originalTitle, { exact: false })).toBeVisible();

  const cardButton = page.locator("button").filter({ hasText: "浏览器闭环测试" }).first();
  await expect(cardButton).toBeVisible();
  await cardButton.click();
  const heading = page.getByRole("heading", { name: /浏览器闭环测试/ });
  await expect(heading).toBeVisible();

  await page.getByRole("button", { name: "保留", exact: true }).first().click();
  await expect(page.getByText("已保留", { exact: true }).last()).toBeVisible();

  await heading.click();
  const titleInput = page.locator("#main-content input").first();
  await expect(titleInput).toHaveValue(/浏览器闭环测试/);
  await titleInput.fill("浏览器闭环编辑稳定");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "浏览器闭环编辑稳定", exact: true })
  ).toBeVisible();

  // Leave the organized card, open the inbox, then prove keyword search
  // deliberately crosses the current status filter.
  await page.getByRole("button", { name: /收件箱/ }).first().click();
  await expect(page.getByRole("heading", { name: "收件箱", exact: true })).toBeVisible();
  await expect(page.getByText("浏览器闭环编辑稳定", { exact: true })).toHaveCount(0);
  await page.getByPlaceholder("搜索标题、摘要、想法…").fill("浏览器闭环编辑稳定");
  await expect(page.getByText("浏览器闭环编辑稳定", { exact: true })).toBeVisible();
  await page.getByText("浏览器闭环编辑稳定", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "浏览器闭环编辑稳定", exact: true })
  ).toBeVisible();

  await page
    .getByRole("button", { name: "导出到 Obsidian", exact: true })
    .click();
  await expect(
    page.getByText("请先配置 MinIO / Obsidian 存储", { exact: true })
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(unexpectedHttp).toEqual([]);
});
