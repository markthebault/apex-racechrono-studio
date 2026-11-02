import type { Binding, Session } from "../model";
import { videoTime } from "../storage";
export async function captureFrames(
  session: Session,
  lapId: string,
  times: number[],
  binding: Binding | undefined,
  files: Record<string, string>,
) {
  const lap = session.laps.find((l) => l.id === lapId);
  if (!lap) throw Error("unknown_lap");
  if (!binding?.anchors.length)
    throw Error("video_unavailable_or_unsynchronized");
  if (
    !Array.isArray(times) ||
    !times.length ||
    times.length > 6 ||
    times.some(
      (t) => !Number.isFinite(t) || t < 0 || t * 1000 > lap.end - lap.start,
    )
  )
    throw Error("Request 1–6 lap times in seconds within the lap");
  const frames = [];
  // A detached decoder preserves the user’s playback position and playing state.
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  const wait = (event: string, action: () => void) =>
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener(event, done);
        video.removeEventListener("error", fail);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(Error("video_decode_failed"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(Error("video_decode_timeout"));
      }, 15000);
      video.addEventListener(event, done, { once: true });
      video.addEventListener("error", fail, { once: true });
      action();
    });
  try {
    for (const seconds of times) {
      const stamp = lap.start + seconds * 1000,
        timeline = videoTime(binding, stamp);
      const clip = binding.clips.find(
        (c) => timeline >= c.start && timeline < c.start + c.duration,
      );
      const url = clip && files[clip.sha256];
      if (!clip || !url) throw Error("video_not_linked_or_time_outside_clip");
      if (video.src !== url)
        await wait("loadeddata", () => {
          video.src = url;
          video.load();
        });
      const target = timeline - clip.start;
      if (Math.abs(video.currentTime - target) > 0.00001)
        await wait("seeked", () => {
          video.currentTime = target;
        });
      if (!video.videoWidth || video.readyState < 2)
        throw Error("video_frame_unavailable");
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas
        .getContext("2d")!
        .drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({
        lapSeconds: seconds,
        sessionTimestamp: stamp,
        clip: clip.name,
        clipSeconds: video.currentTime,
        width: canvas.width,
        height: canvas.height,
        data: canvas.toDataURL("image/jpeg", 0.82).split(",")[1],
      });
    }
    return {
      lapId,
      frames,
      limitations: [
        "Synchronization is user supplied; verify offset. Seek timestamps are requested media times, not calibrated camera exposure times. Camera perspective cannot establish metric edge clearance or an optimal racing line.",
      ],
    };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
