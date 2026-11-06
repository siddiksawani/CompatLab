"use client";
import { activityPage, activitySource, type BrowserAction } from "@compatlab/contracts";
import { useEffect } from "react";

const sent = new Map<string, number>();
const pending = new Set<BrowserAction>();
let scheduled = false;
export function recordBrowserAction(action: BrowserAction) {
  try {
    if (
      navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
    )
      return;
    const key = `${activityPage(location.pathname)}:${action}`;
    const bucket = Math.floor(Date.now() / 600_000);
    if (sent.get(key) === bucket) return;
    sent.set(key, bucket);
    pending.add(action);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const actions = [...pending];
      pending.clear();
      try {
        void fetch("/api/v1/browser-activity", {
          method: "POST",
          credentials: "omit",
          keepalive: true,
          referrerPolicy: "no-referrer",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actions,
            page: activityPage(location.pathname),
            source: activitySource(document.referrer, location.origin),
            research: new URL(location.href).searchParams.get("research") === "1",
            automated: navigator.webdriver === true,
          }),
        }).catch(() => {});
      } catch {}
    });
  } catch {}
}
export function ActivitySignal({ action }: { action: BrowserAction }) {
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState !== "hidden") recordBrowserAction(action);
    };
    visible();
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [action]);
  return null;
}
export function BrowserActivity() {
  useEffect(() => {
    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.dataset.browserActivity === "version_selected")
        recordBrowserAction("version_selected");
    };
    document.addEventListener("submit", submit, true);
    return () => document.removeEventListener("submit", submit, true);
  }, []);
  return <ActivitySignal action="page_view" />;
}
