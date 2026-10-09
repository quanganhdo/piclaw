import { createPortal } from "preact/compat";
import { OverlayShell } from "./OverlayShell";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  // Message panes can clip or establish a fixed-position containing block.
  // The lightbox belongs to the viewport, not the thumbnail's pane.
  return createPortal(
    <OverlayShell open onClose={onClose} escape="close" backdrop="close" tier="overlay" className="lightbox__backdrop" ariaLabel={alt || "Image preview"}>
      <div className="lightbox__container" onMouseDown={e => e.stopPropagation()}>
        <button type="button" className="lightbox__close" onClick={onClose} aria-label="Close preview">✕</button>
        <img className="lightbox__image" src={src} alt={alt || "Preview"} loading="lazy" />
      </div>
    </OverlayShell>,
    document.body,
  );
}
