import { test, expect } from "@playwright/test";

for (const account of ["A", "B"]) {
  test(`account ${account}: login, four tabs, restore, theme and logout`, async ({
    page,
    context,
  }) => {
    const email = process.env[`MUSCLE_TEST_${account}_EMAIL`];
    const password = process.env[`MUSCLE_TEST_${account}_PASSWORD`];
    if (!email || !password)
      throw new Error("Test account configuration unavailable");
    await page.setViewportSize(
      account === "A"
        ? { width: 375, height: 812 }
        : { width: 1280, height: 900 },
    );
    // Use the managed Node proxy and CA trust for real Supabase HTTP transport.
    // No responses, headers, credentials, screenshots or browser storage are logged.
    await context.route(
      "https://mcuiikilwrxuylwuljmk.supabase.co/**",
      async (route) => {
        const request = route.request();
        try {
          const headers = { ...request.headers() };
          delete headers.host;
          delete headers["content-length"];
          const response = await fetch(request.url(), {
            method: request.method(),
            headers,
            body: request.postData() ?? undefined,
          });
          const responseHeaders = Object.fromEntries(
            response.headers.entries(),
          );
          delete responseHeaders["content-encoding"];
          delete responseHeaders["content-length"];
          await route.fulfill({
            status: response.status,
            headers: responseHeaders,
            body: Buffer.from(await response.arrayBuffer()),
          });
        } catch {
          await route.abort("failed");
        }
      },
    );
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "ログイン", exact: true }),
    ).toBeVisible();
    // Evaluate keeps secret argument values out of Playwright fill action failure logs.
    await page.evaluate(
      ({ email, password }) => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        for (const [id, value] of [
          ["email", email],
          ["password", password],
        ]) {
          const input = document.getElementById(id) as HTMLInputElement;
          setter.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      { email, password },
    );
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(
      page.getByText("端末保存基盤：利用可能", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    const tabs = [
      ["記録", "/"],
      ["履歴", "/history"],
      ["分析", "/analysis"],
      ["InBody", "/inbody"],
    ];
    for (const [label, path] of tabs) {
      const tab = page
        .getByRole("navigation")
        .getByRole("link", { name: label, exact: true });
      await tab.click();
      await expect(page).toHaveURL(`http://127.0.0.1:3102${path}`);
      await expect(tab).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByRole("heading", { name: label, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.reload();
    await expect(
      page.getByRole("button", { name: "ログアウト", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("端末保存基盤：利用可能", { exact: true }),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: "light" });
    const light = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(light).not.toBe(dark);
    await page.getByRole("button", { name: "ログアウト", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "ログイン", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "ログイン", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
}
