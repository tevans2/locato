// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSitePage, createSiteHeader } from "../src/ui/shell/SiteHeader";
import type { ShellContext } from "../src/ui/shell/types";

function makeContext(answer: boolean): ShellContext & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openSection: (section) => calls.push(`section:${section}`),
    goHome: () => calls.push("home"),
    goBack: () => calls.push("back"),
    openGame: () => calls.push("game"),
    openGamePicker: () => calls.push("picker"),
    openCountry: (code) => calls.push(`country:${code}`),
    openCompete: () => calls.push("compete"),
    openAccount: () => calls.push("account"),
    controls: document.createElement("div"),
    confirmLeave: vi.fn(async () => answer),
    signedIn: () => false,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => document.body.replaceChildren());

describe("SiteHeader leave guard", () => {
  it("asks before leaving a page whose root has data-leave-confirm", async () => {
    const stay = makeContext(false);
    const page = createSitePage(stay, { section: "compete" });
    page.element.dataset.leaveConfirm = "Leave room ABCD?";
    document.body.append(page.element);
    page.element.querySelector<HTMLAnchorElement>('.shell-nav-link[data-section="play"]')!.click();
    await flush();
    expect(stay.confirmLeave).toHaveBeenCalledWith("Leave room ABCD?", expect.anything());
    expect(stay.calls).toEqual([]);

    const leave = makeContext(true);
    const other = createSitePage(leave, { section: "compete" });
    other.element.dataset.leaveConfirm = "Leave room ABCD?";
    document.body.append(other.element);
    other.element.querySelector<HTMLButtonElement>(".shell-brand")!.click();
    other.element.querySelector<HTMLAnchorElement>('.shell-tab[data-section="you"]')!.click();
    await flush();
    expect(leave.calls).toEqual(["home", "section:you"]);
  });

  it("navigates straight away without a pending question", () => {
    const ctx = makeContext(false);
    const page = createSitePage(ctx, { section: "learn" });
    document.body.append(page.element);
    page.element.querySelector<HTMLAnchorElement>('.shell-nav-link[data-section="daily"]')!.click();
    expect(ctx.confirmLeave).not.toHaveBeenCalled();
    expect(ctx.calls).toEqual(["section:daily"]);
  });

  it("uses an explicit leaveGuard and runs onLeave once confirmed", async () => {
    const ctx = makeContext(true);
    const onLeave = vi.fn();
    let message: string | null = null;
    const header = createSiteHeader(ctx, { section: "compete", leaveGuard: () => message, onLeave });
    document.body.append(header.element);
    header.element.querySelector<HTMLAnchorElement>('.shell-nav-link[data-section="learn"]')!.click();
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(ctx.confirmLeave).not.toHaveBeenCalled();
    message = "Leave this game?";
    header.element.querySelector<HTMLButtonElement>(".shell-brand")!.click();
    await flush();
    expect(ctx.confirmLeave).toHaveBeenCalledWith("Leave this game?", expect.anything());
    expect(onLeave).toHaveBeenCalledTimes(2);
    expect(ctx.calls).toEqual(["section:learn", "home"]);
  });

  it("renders a title link beside the heading", () => {
    const onClick = vi.fn();
    const header = createSiteHeader(makeContext(true), { section: "learn", title: "Academy", titleLink: { label: "Atlas", onClick } });
    const link = header.heading!.querySelector<HTMLButtonElement>(".shell-heading-link")!;
    expect(link.textContent).toBe("Atlas");
    link.click();
    expect(onClick).toHaveBeenCalled();
  });
});
