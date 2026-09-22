import { useEffect, useRef, useState } from "preact/hooks";
import { OverlayShell } from "./OverlayShell";
import { resolveAudioContentType } from "../../../../../../src/utils/audio-media.js";

export function AudioPreview({ mediaId, filename, onClose }: { mediaId: number; filename: string; onClose: () => void }) {
  const player = useRef<HTMLAudioElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const mediaUrl = `/media/${mediaId}`;

  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setError("");
    // Filenames in message text are only hints. Use owned server metadata before
    // offering inline audio; never promote an explicitly unsafe stored MIME.
    void fetch(`${mediaUrl}/info`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Unable to load audio metadata.");
        const info = await response.json();
        if (!resolveAudioContentType(info.content_type, info.filename)) throw new Error("Audio preview is unavailable for this file type.");
        if (!controller.signal.aborted) setReady(true);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load audio metadata.");
      });
    return () => controller.abort();
  }, [mediaUrl]);

  useEffect(() => {
    const audio = player.current;
    return () => {
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [ready, mediaUrl]);

  return (
    <OverlayShell open onClose={onClose} escape="close" backdrop="close" tier="overlay" className="lightbox__backdrop" ariaLabel={filename}>
      <div className="audio-preview" onMouseDown={event => event.stopPropagation()}>
        <header className="audio-preview__header">
          <strong className="audio-preview__filename">{filename}</strong>
          <a href={mediaUrl} download={filename}>Download</a>
          <button type="button" onClick={onClose} aria-label="Close preview">Close</button>
        </header>
        {!ready && !error && <p role="status">Loading audio…</p>}
        {ready && <audio ref={player} src={mediaUrl} controls preload="metadata" aria-label={filename}
          onError={() => setError("Unable to play this audio. The file may be damaged or its format unsupported by your browser.")} />}
        {error && <p role="alert">{error} Download the file to listen to it.</p>}
      </div>
    </OverlayShell>
  );
}
