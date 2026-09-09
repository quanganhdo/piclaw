import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Keep README checks in the default CI suite, which excludes test/scripts.
const root = resolve(import.meta.dir, "../../..");
const documents = [
  "README.md",
  "README.zh-CN.md",
  "README.ja.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/desktop.md",
  "docs/install-from-repo.md",
];
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const stripCode = (text: string) => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
const headings = (text: string) => [...stripCode(text).matchAll(/^#{1,6} (.+)$/gm)].map(
  (match) => match[1]!.toLowerCase().replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-"),
);

test("README and installation guide relative links and anchors resolve", () => {
  for (const path of documents) {
    const text = stripCode(read(path));
    const anchors = headings(text);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const href = match[1]!;
      if (/^[a-z]+:|^\/\//i.test(href)) continue;
      const [file, fragment] = href.split("#");
      const target = file ? resolve(root, dirname(path), decodeURIComponent(file)) : resolve(root, path);
      expect(existsSync(target), `${path}: ${href}`).toBe(true);
      if (fragment && target.endsWith(".md")) {
        expect(headings(readFileSync(target, "utf8")), `${path}: ${href}`).toContain(decodeURIComponent(fragment));
      }
    }
  }
});

test.skipIf(process.platform === "win32")("installation shell examples parse without executing them", () => {
  for (const path of documents) {
    for (const match of read(path).matchAll(/^```bash\n([\s\S]*?)^```/gm)) {
      const result = spawnSync("bash", ["-n"], { input: match[1], encoding: "utf8" });
      expect(result.status, `${path}: ${result.error ?? result.stderr}`).toBe(0);
    }
  }
});

test("newcomer setup retains loopback, persistence and deployment boundaries", () => {
  const readme = read("README.md");
  const guide = read("docs/getting-started.md");
  const docker = readme.match(/```bash\n([\s\S]*?)```/)?.[1] ?? "";
  for (const argument of ["--init", "-p 127.0.0.1:8080:8080", "$(pwd)/home:/config", "$(pwd)/workspace:/workspace"]) {
    expect(docker).toContain(argument);
  }
  expect(readme).toContain("Single-user is the default");
  expect(readme).toContain("[Experimental family mode](docs/multi-user/README.md)");
  expect(readme).toContain("trusted multi-user mode for small groups");
  expect(readme).toContain("Promoted `family-shared` deployments");
  expect(readme).toContain("Isolated-container mode is unavailable");
  expect(readme).toContain("messages.db");
  expect(readme).toContain("Cloud models and external tools");
  expect(guide).toContain("permits unauthenticated access");
  expect(guide).toContain("atomic database snapshot");
  expect(guide).toContain("does not restart a running process");
  expect(read("docs/install-from-repo.md")).not.toMatch(/github:rcarmo\/piclaw#v\d/);
});

test("README translations preserve commands, documentation links and credits", () => {
  const english = read("README.md");
  const codeBlocks = (text: string) => [...text.matchAll(/^```[^\n]*\n[\s\S]*?^```/gm)].map((match) => match[0]);
  const targets = (text: string) => [...new Set([...stripCode(text).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)]
    .map((match) => match[1]!)
    .filter((href) => !href.startsWith("#") && !/^README(?:\.[\w-]+)?\.md$/.test(href)))].sort();
  for (const path of ["README.zh-CN.md", "README.ja.md"]) {
    const text = read(path);
    expect(codeBlocks(text), path).toEqual(codeBlocks(english));
    expect(targets(text), path).toEqual(targets(english));
    expect(text).toContain("[rcarmo/vibes](https://github.com/rcarmo/vibes)");
    expect(text).toContain("[earendil-works/pi](https://github.com/earendil-works/pi)");
    expect(text).not.toContain("rcarmo/agentbox");
    expect(text).not.toContain("github.com/badlogic/pi-mono");
    expect(text).toContain("workspace/.piclaw/store/messages.db");
    expect(text.indexOf("> [!WARNING]")).toBeLessThan(text.indexOf("```bash"));
  }
  const chinese = read("README.zh-CN.md");
  const japanese = read("README.ja.md");
  for (const text of [chinese, japanese]) {
    expect(text).toContain("`family-shared`");
    expect(text).toContain("docs/multi-user/README.md");
    expect(text).toContain("docs/multi-user/user-guide.md");
  }
  expect(chinese).toContain("默认采用单用户模式");
  expect(chinese).toContain("实验性家庭模式");
  expect(chinese).toContain("可信多用户模式");
  expect(chinese).toContain("隔离容器模式不可用");
  expect(chinese).toContain("PiClaw 的原始 UX 设计");
  expect(japanese).toContain("デフォルトはシングルユーザーです");
  expect(japanese).toContain("実験的な家族モード");
  expect(japanese).toContain("少人数のグループ向け");
  expect(japanese).toContain("隔離コンテナーモードは利用できません");
  expect(japanese).toContain("PiClaw のオリジナル UX デザイン");
});
