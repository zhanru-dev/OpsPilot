import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID, createHmac } from "node:crypto";
import { API_URL } from "./support/env";
const db = new PrismaClient();
const api = API_URL;

test.afterAll(() => db.$disconnect());
for (const scenario of ["membership", "expired-access"] as const) {
  test(`live operations ${scenario}: current permissions and private-state cleanup`, async ({
    page,
  }) => {
    const workspaceId = randomUUID(),
      userId = randomUUID(),
      eventId = randomUUID();
    const template = await db.user.findUniqueOrThrow({
      where: { email: "alex.morgan@opspilot.demo" },
    });
    await db.workspace.create({
      data: {
        id: workspaceId,
        name: "Authority browser fixture",
        slug: workspaceId,
      },
    });
    await db.user.create({
      data: {
        id: userId,
        name: "Authority browser operator",
        email: `${userId}@browser.invalid`,
        passwordHash: template.passwordHash,
        avatarInitials: "AB",
        memberships: { create: { workspaceId, role: "OPERATIONS_MANAGER" } },
      },
    });
    const secretText = "Private operations " + randomUUID();
    await db.streamEvent.create({
      data: {
        id: eventId,
        workspaceId,
        ownerId: userId,
        title: "Authority browser event",
        description: "Owned test fixture",
        slug: eventId,
        status: "LIVE",
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 3600000),
        liveSession: {
          create: {
            workspaceId,
            startedById: userId,
            updates: {
              create: {
                actorId: userId,
                message: secretText,
                severity: "INFO",
              },
            },
          },
        },
      },
    });
    try {
      await page.goto("/login");
      await page.getByLabel("Email address").fill(`${userId}@browser.invalid`);
      await page.getByLabel("Password", { exact: true }).fill("DemoPass123!");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await page.goto(`/streamops/events/${eventId}/live`);
      await expect(page.getByText(secretText, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "New poll" }),
      ).toBeVisible();
      if (scenario === "membership") {
        await db.workspaceMembership.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role: "VIEWER" },
        });
        await expect(
          page.getByRole("button", { name: "New poll" }),
        ).toHaveCount(0, { timeout: 8000 });
        expect(
          (
            await page.request.post(
              `${api}/stream-events/${eventId}/live-polls`,
              {
                data: {
                  question: "Denied stale role?",
                  options: ["One", "Two"],
                },
              },
            )
          ).status(),
        ).toBe(403);
        await db.workspaceMembership.delete({
          where: { workspaceId_userId: { workspaceId, userId } },
        });
      } else {
        const original = (await page.context().cookies()).find(
          (c) => c.name === "opspilot_access",
        )!;
        const body = JSON.parse(
          Buffer.from(original.value.split(".")[1], "base64url").toString(),
        );
        body.iat = Math.floor(Date.now() / 1000);
        body.exp = body.iat + 3;
        const head = Buffer.from(
          JSON.stringify({ alg: "HS256", typ: "JWT" }),
        ).toString("base64url");
        const message =
          head + "." + Buffer.from(JSON.stringify(body)).toString("base64url");
        const short =
          message +
          "." +
          createHmac("sha256", process.env.JWT_ACCESS_SECRET!)
            .update(message)
            .digest("base64url");
        await page.context().addCookies([{ ...original, value: short }]);
        await page.reload();
        await expect(page.getByText(secretText, { exact: true })).toBeVisible();
        await expect
          .poll(
            async () =>
              (await page.context().cookies()).find(
                (c) => c.name === "opspilot_access",
              )?.value !== short,
            { timeout: 12000 },
          )
          .toBe(true);
        await expect(page.getByText("Live updates connected")).toBeVisible();
        expect((await page.request.post(`${api}/auth/logout`)).status()).toBe(
          204,
        );
      }
      await expect(
        page.getByText("Live operations access is no longer available.", {
          exact: false,
        }),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(secretText, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New poll" })).toHaveCount(
        0,
      );
    } finally {
      await page.goto("/login");
      await db.workspace.delete({ where: { id: workspaceId } });
      await db.user.delete({ where: { id: userId } });
    }
  });
}
