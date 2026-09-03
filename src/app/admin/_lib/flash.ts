import { redirect } from "next/navigation";

/** Redirect back to a list page carrying a one-shot ?ok= / ?error= flash message. */
export function redirectWithFlash(path: string, kind: "ok" | "error", message: string): never {
  const url = new URL(path, "http://x");
  url.searchParams.set(kind, message);
  redirect(url.pathname + "?" + url.searchParams.toString());
}

export async function runAction(path: string, fn: () => Promise<void>, okMessage: string): Promise<never> {
  try {
    await fn();
  } catch (e) {
    redirectWithFlash(path, "error", e instanceof Error ? e.message : "Something went wrong.");
  }
  redirectWithFlash(path, "ok", okMessage);
}
