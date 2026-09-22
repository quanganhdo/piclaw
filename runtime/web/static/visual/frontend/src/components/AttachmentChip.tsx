import { useEffect, useState } from "preact/hooks";
import { ImageLightbox } from "./ImageLightbox";
import { AudioPreview } from "./AudioPreview";
import { resolveAudioContentType } from "../../../../../../src/utils/audio-media.js";

interface AttachmentChipProps {
  mediaId: number;
  filename: string;
  contentType?: string;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

function isImageFilename(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.includes(ext);
}

export function AttachmentChip({ mediaId, filename, contentType }: AttachmentChipProps) {
  const [showPreview, setShowPreview] = useState(false);
  const mediaUrl = `/media/${mediaId}`;
  const downloadUrl = mediaUrl;
  const audioHint = resolveAudioContentType(contentType, filename);
  const isImage = !audioHint && isImageFilename(filename);
  const [metadataAudioType, setMetadataAudioType] = useState<string | null>(null);
  useEffect(() => {
    setMetadataAudioType(null);
    if (contentType || audioHint || isImage) return;
    const controller = new AbortController();
    // User attachment text may name an audio file without an audio extension.
    void fetch(`${mediaUrl}/info`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const info = await response.json();
        if (!controller.signal.aborted) setMetadataAudioType(resolveAudioContentType(info.content_type, info.filename));
      })
      .catch(() => {
        // Preserve the existing raw/download fallback when metadata is unavailable.
        if (!controller.signal.aborted) setMetadataAudioType(null);
      });
    return () => controller.abort();
  }, [contentType, audioHint, isImage, mediaUrl]);
  const isAudio = audioHint !== null || metadataAudioType !== null;

  const handlePreview = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isImage || isAudio) {
      setShowPreview(true);
      return;
    }

    window.open(mediaUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="attachment-chip">
      <span className="attachment-chip__icon" aria-hidden="true">📎</span>
      <a
        className="attachment-chip__name"
        href={downloadUrl}
        download={filename}
        onClick={(e) => e.stopPropagation()}
      >
        {filename}
      </a>
      <button
        type="button"
        className="attachment-chip__preview"
        onClick={handlePreview}
        aria-label={`Preview ${filename}`}
        aria-haspopup={isImage || isAudio ? "dialog" : undefined}
      >
        <i className="codicon codicon-open-preview" />
      </button>
      {showPreview && isImage && (
        <ImageLightbox
          src={mediaUrl}
          alt={filename}
          onClose={() => setShowPreview(false)}
        />
      )}
      {showPreview && isAudio && (
        <AudioPreview mediaId={mediaId} filename={filename} onClose={() => setShowPreview(false)} />
      )}
    </div>
  );
}
