import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import "../helpers.js";

import { closeDatabase, getDb, initDatabase, initializeDatabaseSchema } from "../../src/db/connection.js";
import { getTimeline, hasOlderMessages } from "../../src/db/messages.js";

const CHAT_INDEX = "idx_messages_chat_jid";
const chats = ["web:timeline-a", "web:timeline-b", "web:timeline-c"];

beforeEach(() => {
  closeDatabase();
  expect(process.env.PICLAW_DB_IN_MEMORY).toBe("1");
  initDatabase();
  const main = getDb().query("PRAGMA database_list").all() as Array<{ name: string; file: string }>;
  expect(main.find(row => row.name === "main")?.file).toBe("");
});
afterEach(() => closeDatabase());

function seedMessages(): Map<string, number[]> {
  const db = getDb();
  const ids = new Map(chats.map(chat => [chat, [] as number[]]));
  const insert = db.prepare(`INSERT INTO messages
    (id, chat_jid, sender, sender_name, content, timestamp, is_bot_message, thread_id)
    VALUES (?, ?, 'fixture', 'Fixture', ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const chat of chats) db.prepare("INSERT INTO chats(jid) VALUES (?)").run(chat);
    for (let i = 0; i < 27; i++) {
      const chat = chats[i % chats.length]!;
      // Deliberately reverse timestamps: rowid pagination must not become time ordering.
      const timestamp = new Date(Date.UTC(2025, 0, 27 - i)).toISOString();
      const result = insert.run(`message-${Math.floor(i / 3)}`, chat, `content-${i}`, timestamp, i % 2, i % 4);
      ids.get(chat)!.push(Number(result.lastInsertRowid));
    }
  })();
  return ids;
}

function messageRows() {
  return getDb().query("SELECT rowid, * FROM messages ORDER BY rowid").all();
}

function indexDefinitions() {
  return getDb().query(`SELECT name, sql, rootpage FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'messages' ORDER BY name`).all() as Array<{
    name: string; sql: string | null; rootpage: number;
  }>;
}

function assertIndexes() {
  const db = getDb();
  const indexes = db.query("PRAGMA index_list(messages)").all() as Array<{
    name: string; unique: number; partial: number;
  }>;
  expect(indexes.find(index => index.name === CHAT_INDEX)).toMatchObject({ unique: 0, partial: 0 });
  for (const [name, columns] of [
    [CHAT_INDEX, ["chat_jid"]],
    ["idx_messages_chat_jid_timestamp", ["chat_jid", "timestamp"]],
    ["idx_messages_chat_jid_bot_timestamp", ["chat_jid", "is_bot_message", "timestamp"]],
    ["idx_messages_thread_id", ["chat_jid", "thread_id"]],
  ] as const) {
    const info = db.query(`PRAGMA index_info(${name})`).all() as Array<{ name: string }>;
    expect(info.map(column => column.name)).toEqual([...columns]);
  }
  // rowid is SQLite's implicit suffix, not an explicitly indexed key.
  const extended = db.query(`PRAGMA index_xinfo(${CHAT_INDEX})`).all() as Array<{ cid: number; key: number }>;
  expect(extended.map(column => ({ cid: column.cid, key: column.key }))).toEqual([
    { cid: 1, key: 1 }, { cid: -1, key: 0 },
  ]);
}

function explainApi(run: () => unknown, bindings: Array<string | number>): string[] {
  const db = getDb();
  const prepare = spyOn(db, "prepare");
  let sql: string;
  try {
    run();
    // Capture production SQL (including its real projection), excluding media hydration.
    const calls = prepare.mock.calls.filter(([query]) => /\bFROM messages WHERE\b/.test(query));
    expect(calls).toHaveLength(1);
    sql = calls[0]![0];
  } finally {
    prepare.mockRestore();
  }
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql!}`).all(...bindings) as Array<{ detail: string }>;
  return plan.map(row => row.detail);
}

function timelinePlans() {
  const chat = chats[0]!;
  return [
    explainApi(() => getTimeline(chat, 3), [chat, 3]),
    explainApi(() => getTimeline(chat, 3, 20), [chat, 20, 3]),
    explainApi(() => hasOlderMessages(chat, 20), [chat, 20]),
  ];
}

function assertPlans() {
  for (const plan of timelinePlans()) {
    expect(plan.some(detail => /SEARCH messages USING (?:COVERING )?INDEX idx_messages_chat_jid \(/.test(detail))).toBe(true);
    expect(plan.some(detail => /TEMP B-TREE/i.test(detail))).toBe(false);
  }
}

function assertPages(ids: Map<string, number[]>) {
  return [...ids, ["web:missing", []] as [string, number[]]].map(([chat, expected]) => {
    const pages: ReturnType<typeof getTimeline>[] = [];
    let before: number | undefined;
    let remaining = [...expected];
    do {
      const page = getTimeline(chat, 3, before);
      expect(page.map(row => row.id)).toEqual(remaining.slice(-3));
      expect(page.every(row => row.chat_jid === chat)).toBe(true);
      pages.push(page);
      if (page.length === 0) break;
      remaining = remaining.slice(0, -page.length);
      before = page[0]!.id;
      expect(hasOlderMessages(chat, before)).toBe(remaining.length > 0);
    } while (true);
    expect(pages.flat().map(row => row.id).sort((a, b) => a - b)).toEqual(expected);
    return pages;
  });
}

function assertReinitialization(ids: Map<string, number[]>) {
  const rows = messageRows();
  const definitions = indexDefinitions();
  const pages = assertPages(ids);
  initializeDatabaseSchema(getDb());
  for (let i = 0; i < 2; i++) {
    initDatabase();
    assertIndexes();
    assertPlans();
    expect(messageRows()).toEqual(rows);
    expect(indexDefinitions()).toEqual(definitions);
    expect(assertPages(ids)).toEqual(pages);
  }
}

test("fresh core uses the chat-only index for actual timeline and older-message queries", () => {
  expect(messageRows()).toEqual([]);
  assertIndexes();
  const ids = seedMessages();
  assertPlans();
  assertReinitialization(ids);
});

for (const historicalIndex of [false, true]) {
  test(`owned core upgrade ${historicalIndex ? "preserves a historical chat index" : "adds the missing chat index without changing pages"}`, () => {
    // Model the prior owned core: its full schema/ledger and timestamp/thread
    // indexes, with interleaved data, either missing or already carrying the old index.
    getDb().exec(`DROP INDEX ${CHAT_INDEX}`);
    if (historicalIndex) {
      getDb().exec('CREATE INDEX idx_messages_chat_jid ON "messages" ("chat_jid" ASC)');
    }
    const ids = seedMessages();
    const rows = messageRows();
    const definitions = indexDefinitions();
    const pages = assertPages(ids);
    if (!historicalIndex) {
      // Demonstrate the original regression using both real getTimeline branches.
      for (const plan of timelinePlans().slice(0, 2)) {
        expect(plan.some(detail => /TEMP B-TREE/i.test(detail))).toBe(true);
      }
    }

    initializeDatabaseSchema(getDb());
    assertIndexes();
    assertPlans();
    expect(messageRows()).toEqual(rows);
    expect(assertPages(ids)).toEqual(pages);
    expect(indexDefinitions().filter(index => historicalIndex || index.name !== CHAT_INDEX)).toEqual(definitions);
    assertReinitialization(ids);
  });
}
