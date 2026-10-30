"use client";
import { memo, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { API_URL, ApiError, apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { playbackSchema } from "./protocol";
export const LivePlayer = memo(function LivePlayer({
  base,
  sessionId,
  authority,
  mode,
}: {
  base: string;
  sessionId: string;
  authority: string;
  mode: "staff" | "attendee";
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0),
    [state, setState] = useState("loading"),
    [error, setError] = useState<string | null>(null);
  const consecutiveFailures = useRef(0);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    let active = true,
      hls: Hls | null = null,
      ticket: string | null = null,
      refreshQueued = false;
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const listeners: [string, EventListener][] = [];
    const later = (callback: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (active) callback();
      }, delay);
      timers.add(timer);
    };
    const release = (value: string) => {
      void apiFetch(
        `${base}/playback/release`,
        {
          method: "POST",
          body: JSON.stringify({ ticket: value }),
          keepalive: true,
        },
        mode === "staff",
      ).catch(() => undefined);
    };
    function retry(message: string, terminal = false) {
      if (!active || refreshQueued) return;
      setError(message);
      setState(terminal ? "denied" : "recovering");
      if (terminal || consecutiveFailures.current >= 4) {
        setState(terminal ? "denied" : "error");
        return;
      }
      refreshQueued = true;
      const delay = Math.min(8000, 1000 * 2 ** consecutiveFailures.current++);
      later(() => setAttempt((n) => n + 1), delay);
    }
    function play() {
      void node!.play().catch((reason: unknown) => {
        if (!active) return;
        if (
          reason instanceof DOMException &&
          reason.name === "NotAllowedError"
        ) {
          setState("ready");
          setError("Press Play to begin.");
        } else retry("Playback could not start. Retrying…");
      });
    }
    for (const event of ["playing", "pause", "waiting", "stalled", "error"]) {
      const listener = () => {
        if (!active) return;
        if (event === "playing") {
          setState("playing");
          setError(null);
          consecutiveFailures.current = 0;
        } else if (event === "error")
          retry("Video connection interrupted. Retrying…");
        else setState(event === "pause" ? "paused" : "buffering");
      };
      node.addEventListener(event, listener);
      listeners.push([event, listener]);
    }
    // Defer setup feedback to asynchronous work; effect ownership fences all callbacks.
    void (async () => {
      try {
        const grant = playbackSchema.parse(
          await apiFetch(
            `${base}/sessions/${sessionId}/playback`,
            { method: "POST", signal: controller.signal },
            mode === "staff",
          ),
        );
        if (!active) {
          release(grant.ticket);
          return;
        }
        ticket = grant.ticket;
        if (grant.sessionId !== sessionId || grant.authority !== authority) {
          retry("Event access changed. Refreshing playback.");
          return;
        }
        setState("loading");
        setError(null);
        const remaining = Date.parse(grant.expiresAt) - Date.now();
        later(
          () => setAttempt((n) => n + 1),
          Math.max(1000, remaining - Math.min(30000, remaining / 3)),
        );
        const url = `${API_URL}${base}/sessions/${sessionId}/hls/index.m3u8?ticket=${encodeURIComponent(grant.ticket)}`;
        const { default: HlsClass } = await import("hls.js");
        if (!active) return;
        if (HlsClass.isSupported()) {
          hls = new HlsClass({
            lowLatencyMode: false,
            backBufferLength: 10,
            maxBufferLength: 15,
            maxMaxBufferLength: 30,
            xhrSetup: (xhr) => {
              xhr.withCredentials = true;
            },
          });
          hls.on(HlsClass.Events.MANIFEST_PARSED, play);
          hls.on(HlsClass.Events.ERROR, (_event, data) => {
            if (!active) return;
            if (data.fatal) {
              hls?.stopLoad();
              retry("Live video interrupted. Retrying playback…");
            } else if (
              data.details === HlsClass.ErrorDetails.BUFFER_STALLED_ERROR
            )
              setState("buffering");
          });
          hls.loadSource(url);
          hls.attachMedia(node);
        } else if (node.canPlayType("application/vnd.apple.mpegurl")) {
          node.src = url;
          play();
        } else {
          setState("error");
          setError("This browser cannot play this HLS stream.");
        }
      } catch (cause) {
        if (active)
          retry(
            "Playback is unavailable. Check event access or retry.",
            cause instanceof ApiError && [401, 403, 404].includes(cause.status),
          );
      }
    })();
    const dispose = () => {
      if (!active) return;
      active = false;
      controller.abort();
      for (const timer of timers) clearTimeout(timer);
      listeners.forEach(([name, listener]) =>
        node.removeEventListener(name, listener),
      );
      hls?.destroy();
      node.pause();
      node.removeAttribute("src");
      node.load();
      if (ticket) release(ticket);
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setAttempt((n) => n + 1);
    };
    // Full-document navigation does not guarantee a React unmount. Release the
    // reader on pagehide as well; expiry still bounds a lost keepalive request.
    window.addEventListener("pagehide", dispose);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("pagehide", dispose);
      window.removeEventListener("pageshow", restored);
      dispose();
    };
  }, [base, sessionId, authority, mode, attempt]);
  return (
    <div data-testid="live-player" className="space-y-2">
      <video
        ref={video}
        aria-label="Live broadcast"
        controls
        muted
        playsInline
        crossOrigin="use-credentials"
        preload="none"
        className="aspect-video w-full rounded-lg bg-black"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          role="status"
          data-testid="player-state"
          className="text-xs text-[var(--muted)]"
        >
          {state}
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={state === "denied"}
          onClick={() => {
            consecutiveFailures.current = 0;
            setAttempt((n) => n + 1);
          }}
        >
          Retry video
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
});
