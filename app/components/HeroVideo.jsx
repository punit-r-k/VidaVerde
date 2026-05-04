"use client";

import { useEffect, useRef } from "react";

const HERO_VIDEO_SRC = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const HERO_VIDEO_TYPE = "video/mp4";
const HERO_VIDEO_DELAY_MS = 8000;

export default function HeroVideo() {
  const videoRef = useRef(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const video = videoRef.current;
      if (!(video instanceof HTMLVideoElement) || video.dataset.loaded === "true") {
        return;
      }

      const source = document.createElement("source");
      source.src = HERO_VIDEO_SRC;
      source.type = HERO_VIDEO_TYPE;
      video.appendChild(source);
      video.dataset.loaded = "true";
      video.load();
      void video.play().catch(() => {
        // Autoplay may be blocked; the poster remains as the hero background.
      });
    }, HERO_VIDEO_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className="hero__video"
      autoPlay
      muted
      loop
      playsInline
      preload="none"
      poster="/hero-poster.avif"
      fetchPriority="high"
      aria-hidden="true"
    />
  );
}
