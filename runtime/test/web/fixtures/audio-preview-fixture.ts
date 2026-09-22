const skin = new URLSearchParams(location.search).get("skin") || "classic";
const root = document.getElementById("app")!;
if (skin === "classic") {
  const { html, render, useState } = await import("../../../web/src/vendor/preact-htm.js");
  const { AttachmentPreviewModal } = await import("../../../web/src/components/attachment-preview-modal.js");
  function Fixture() {
    const [id, setId] = useState(0);
    return html`<div>
      <button onClick=${() => setId(1)}>Preview voice.wav</button>
      <button onClick=${() => setId(2)}>Preview broken.mp3</button>
      ${id > 0 && html`<${AttachmentPreviewModal} mediaId=${id} info=${{ filename: id === 1 ? "voice.wav" : "broken.mp3", content_type: id === 1 ? "audio/wav" : "audio/mpeg" }} onClose=${() => setId(0)} />`}
    </div>`;
  }
  render(html`<${Fixture} />`, root);
} else {
  const { h, render } = await import("preact");
  const { MessageItem } = await import("../../../web/static/visual/frontend/src/components/message-list/MessageItem");
  const surface = new URLSearchParams(location.search).get("surface") || "user";
  const base = { id: 42, timestamp: new Date().toISOString(), type: surface === "user" || surface === "mime-only" ? "user" : "agent", content: "", is_from_me: surface === "user" };
  const mixed = surface === "image-first" || surface === "audio-first";
  const imageBlock = { type: "image", filename: "picture.png", mime_type: "image/png" };
  const audioBlock = { type: "file", filename: "voice.wav", mime_type: "audio/wav" };
  const interaction = mixed
    ? { ...base, media_ids: surface === "image-first" ? [3, 1] : [1, 3], content_blocks: surface === "image-first" ? [imageBlock, audioBlock] : [audioBlock, imageBlock] }
    : surface === "assistant"
    ? { ...base, media_ids: [1, 2], content_blocks: [{ type: "file", filename: "voice.bin", mime_type: "audio/wav" }, { type: "file", filename: "broken.mp3", mime_type: "audio/mpeg" }] }
    : surface === "id-only"
      ? { ...base, media_ids: [1, 2] }
      : { ...base, content: `attachment:1 (${surface === "mime-only" ? "voice.bin" : "voice.wav"})\nattachment:2 (broken.mp3)` };
  render(h(MessageItem, { interaction, isCollapsed: false, onToggleCollapse: () => {}, onDelete: () => {} } as any), root);
}
