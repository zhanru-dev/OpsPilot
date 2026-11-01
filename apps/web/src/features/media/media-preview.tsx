"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function MediaPreview({
  url,
  kind,
}: {
  url: string;
  kind: "VIDEO" | "AUDIO";
}) {
  const video = useRef<HTMLVideoElement>(null),
    audio = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const node = kind === "VIDEO" ? video.current : audio.current;
    if (!node) return;
    node.src = url;
    node.load();
    return () => {
      node.pause();
      node.removeAttribute("src");
      node.load();
    };
  }, [url, kind]);
  return (
    <div className="space-y-2">
      {kind === "VIDEO" ? (
        <video
          ref={video}
          controls
          autoPlay
          playsInline
          className="aspect-video w-full rounded-md bg-black"
          onError={() => setError(true)}
          onLoadedData={() => setError(false)}
        />
      ) : (
        <audio
          ref={audio}
          controls
          autoPlay
          className="w-full"
          onError={() => setError(true)}
          onLoadedData={() => setError(false)}
        />
      )}
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          Preview could not be loaded. Close it and request a fresh preview.
        </p>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const node = video.current ?? audio.current;
          if (node) void node.play().catch(() => setError(true));
        }}
      >
        Play
      </Button>
    </div>
  );
}
