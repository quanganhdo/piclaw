import { expect, test } from "bun:test";

import { initDatabase, createMedia } from "../../../src/db.js";
import { handleMedia } from "../../../src/channels/web/handlers/media.js";
import { getTestWorkspace, setEnv } from "../../helpers.js";

class StubChannel {
  json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

test("handleMedia forces SVG downloads to attachment disposition", () => {
  const ws = getTestWorkspace();
  const restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  try {
    initDatabase();
    const mediaId = createMedia(
      "vector.svg",
      "image/svg+xml",
      new TextEncoder().encode("<svg></svg>"),
      null,
      { size: 11 },
    );

    const res = handleMedia(new StubChannel() as any, mediaId, false);
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="vector.svg"; filename*=UTF-8''vector.svg`);
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Content-Length")).toBe("11");
  } finally {
    restoreEnv();
  }
});
