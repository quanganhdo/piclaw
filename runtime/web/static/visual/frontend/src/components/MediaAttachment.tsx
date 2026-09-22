import { useEffect, useState } from "preact/hooks";
import { AttachmentChip } from "./AttachmentChip";

/** ID-only attachments need owned metadata before choosing an image or file UI. */
export function MediaAttachment({ mediaId }: { mediaId: number }) {
  const [info, setInfo] = useState<{ filename: string; content_type: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setInfo(null);
    void fetch(`/media/${mediaId}/info`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Attachment metadata unavailable");
        const value = await response.json();
        if (!controller.signal.aborted) setInfo(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setInfo({ filename: `attachment-${mediaId}`, content_type: "application/octet-stream" });
      });
    return () => controller.abort();
  }, [mediaId]);
  if (!info) return <span role="status">Loading attachment…</span>;
  if (info.content_type.startsWith("image/")) return <img className="message-list__media-img" src={`/media/${mediaId}`} alt={info.filename} loading="lazy" />;
  return <AttachmentChip mediaId={mediaId} filename={info.filename} contentType={info.content_type} />;
}
