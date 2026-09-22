# Syntax colour audit

Audits all shared theme IDs and their light/dark variants, including the separate Visual Default. This corrects PR #1358 before merge; no live theme changes.

## Defects corrected

1. The original VS Code mapping ignored semantic token colours, took the first exact TextMate match, and left many roles to generic accent/status fallbacks. Lumon therefore lost its authored variable/function/property/type distinctions.
2. Generated syntax colours were passed through UI readability adjustments, altering source text/comment colours. UI foregrounds still have contrast guards, but code foreground, background and syntax now preserve authored values.
3. Both skin stylesheets collapsed numbers, booleans, atoms and labels, and mapped property definitions to variable definitions. Shared scoped CSS now preserves each role. Lezer's default function-to-variable collapse is supplemented by a common highlighter used by chat and the actual editor.
4. Preview code formerly rendered outside the real post-content cascade. The fixture now uses real chat scope and a mounted CodeMirror editor plus a role sheet; assertions compare computed colours against pinned explicit expectations.

## Mapping policy

- One data-only resolver, `runtime/src/core/theme-syntax.ts`, serves bundled VS Code palettes and user imports.
- Explicit generic semantic selectors have precedence; semantic colours are ignored when semanticHighlighting is false. A font-only semantic style does not erase a TextMate colour.
- Exact/generic parent TextMate scopes are selected by specificity, then source order for equal matches. Comma-separated and array scopes are supported. Alpha colours remain alpha.
- Language-specific selectors, ancestor-stack selectors and wildcard/modifier analysis that Piclaw cannot represent globally are not guessed. This is a generic role projection, not a full VS Code semantic-token engine. Missing roles have named deterministic fallback origins, ultimately editor.foreground.
- Variable definition, function, property definition, local variable, number, bool, atom and label remain distinct. No synthetic default red/green/accent is substituted into code roles.
- Existing imported maps are completed using the same fallback contract. Full SynthWave intentionally overrides its neon token foregrounds; reduced-motion/forced-colours/switching tests remain. AS/400 is the explicit user-requested green-only transformation.
- Non-VS Code palettes (Catppuccin/Rosé Pine source palettes and authored Piclaw concepts) have explicit role maps with provenance. Existing Visual syntax colours are retained where they supplied the original family palette.

## Evidence and limits

`theme-syntax-expectations.json` records 59 base palette expectation sets × 27 roles, including Visual Default's two variants. SynthWave Full shares its base with normal but has a separately tested intentional neon override; PiClaw Classic copies the default dark base. The browser test exercises over 3,500 colour comparisons per engine/skin through real chat/editor selectors and parsed JavaScript tokens, plus explicit imported semantic-token values. It also checks code surface/foreground and ordinary text separately.

`vscode-syntax-sources.json` retains 11 pinned VS Code source projections and source hashes. A unit test resolves those inputs and compares them with the stored bundled roles; these sources remain independent of the generated CSS. Additional hand-authored fixtures test semantic priority, source-order ties, scope specificity, short hex/alpha, invalid CSS and disabled semantics. Source licence notices remain in docs/licenses/theme-palettes.txt.

This does not claim language-server semantic analysis, identical fontStyle rendering, every possible TextMate selector or full WCAG compliance. Source code colours can be low contrast by upstream design; preserving them is distinct from adjusting ordinary UI labels. No source colour is silently claimed to be accessibility-certified.

## Actual chat/editor captures

- [Lumon](theme-syntax/lumon-chat-editor.png)
- [Noctis](theme-syntax/noctis-chat-editor.png)
- [Monokai Original](theme-syntax/monokai-chat-editor.png)
- [AS/400 green-only exception](theme-syntax/as400-chat-editor.png)

Validation: 38 Chromium/WebKit cases / 3,248 assertions, including 16,736 individual colour comparisons across the exhaustive palette and pinned-source-import loops. The 48 focused tests passed (3,947 assertions); all repository typechecks, scoped lint and full `make ci-fast` passed (5,458 runtime tests, 4 skipped, 25 feature tests, 9 build tests). These fixtures use actual highlighted chat markup and a mounted CodeMirror editor, not a recreated colour swatch UI.

## Palette-by-palette record

| ID | Mode | Code text / background | Keyword | String | Number | Function | Comment | Provenance |
|---|---|---|---|---|---|---|---|---|
| default | light | `#0f1419` / `#ffffff` | `#1d9bf0` | `#00ba7c` | `#f0b429` | `#1d9bf0` | `#536471` | existing Piclaw palette; unspecified code roles use authored foreground |
| default | dark | `#e7e9ea` / `#000000` | `#1d9bf0` | `#1d9bf0` | `#1d9bf0` | `#1d9bf0` | `#71767b` | existing Piclaw palette; unspecified code roles use authored foreground |
| tango | light | `#2e3436` / `#f6f5f4` | `#3465a4` | `#4e9a06` | `#3465a4` | `#3465a4` | `#5c6466` | existing Piclaw palette; unspecified code roles use authored foreground |
| xterm | dark | `#d0d0d0` / `#000000` | `#00a2ff` | `#5fff87` | `#00a2ff` | `#00a2ff` | `#8a8a8a` | existing Piclaw palette; unspecified code roles use authored foreground |
| monokai | dark | `#f8f8f2` / `#272822` | `#f92672` | `#e6db74` | `#ae81ff` | `#f92672` | `#cfcfc2` | existing Piclaw palette; unspecified code roles use authored foreground |
| monokai-pro | dark | `#fcfcfa` / `#2d2a2e` | `#ff6188` | `#ffd866` | `#ab9df2` | `#a9dc76` | `#727072` | Pre-shared Visual Monokai Pro explicit syntax tokens; retain code colours |
| ristretto | dark | `#f4f1ef` / `#2c2525` | `#ff9f43` | `#a9dc76` | `#ff9f43` | `#ff9f43` | `#cbbdb8` | existing Piclaw palette; unspecified code roles use authored foreground |
| dracula | dark | `#f8f8f2` / `#282a36` | `#ff79c6` | `#f1fa8c` | `#bd93f9` | `#50fa7b` | `#6272a4` | Pre-shared Visual Dracula explicit syntax tokens; retain code colours |
| catppuccin | dark | `#cdd6f4` / `#1e1e2e` | `#cba6f7` | `#a6e3a1` | `#fab387` | `#89b4fa` | `#9399b2` | Catppuccin official palette1.8.0; explicit Piclaw role map |
| nord | dark | `#d8dee9` / `#2e3440` | `#81a1c1` | `#a3be8c` | `#b48ead` | `#88c0d0` | `#616e88` | nord.jsonc — shared VS Code resolver |
| gruvbox | dark | `#ebdbb2` / `#282828` | `#fb4934` | `#b8bb26` | `#d3869b` | `#fabd2f` | `#928374` | Pre-shared Visual Gruvbox Dark explicit syntax tokens; retain code colours |
| solarized | light | `#657b83` / `#fdf6e3` | `#859900` | `#2aa198` | `#d33682` | `#268bd2` | `#93a1a1` | Pre-shared Visual Solarized Light explicit syntax tokens; retain code colours |
| solarized | dark | `#839496` / `#002b36` | `#859900` | `#2aa198` | `#d33682` | `#268bd2` | `#586e75` | Pre-shared Visual Solarized Dark explicit syntax tokens; retain code colours |
| tokyo | dark | `#a9b1d6` / `#1a1b26` | `#bb9af7` | `#9ece6a` | `#ff9e64` | `#7aa2f7` | `#51597d` | tokyo-night.jsonc — shared VS Code resolver |
| miasma | dark | `#e5e5e5` / `#1f1f23` | `#c9739c` | `#98c379` | `#c9739c` | `#c9739c` | `#b4b4b4` | existing Piclaw palette; unspecified code roles use authored foreground |
| github | light | `#24292f` / `#ffffff` | `#cf222e` | `#0a3069` | `#0550ae` | `#8250df` | `#6e7781` | Pre-shared Visual GitHub Light explicit syntax tokens; retain code colours |
| github | dark | `#e6edf3` / `#0d1117` | `#ff7b72` | `#a5d6ff` | `#79c0ff` | `#d2a8ff` | `#8b949e` | Pre-shared Visual GitHub Dark explicit syntax tokens; retain code colours |
| gotham | dark | `#cbd6e2` / `#0b0f14` | `#5ccfe6` | `#2aa889` | `#5ccfe6` | `#5ccfe6` | `#9bb0c3` | existing Piclaw palette; unspecified code roles use authored foreground |
| one-dark-pro | dark | `#abb2bf` / `#282c34` | `#c678dd` | `#98c379` | `#d19a66` | `#61afef` | `#5c6370` | Pre-shared Visual One Dark Pro explicit syntax tokens; retain code colours |
| solarized-dark | dark | `#839496` / `#002b36` | `#859900` | `#2aa198` | `#d33682` | `#268bd2` | `#586e75` | Pre-shared Visual Solarized Dark explicit syntax tokens; retain code colours |
| solarized-light | light | `#657b83` / `#fdf6e3` | `#859900` | `#2aa198` | `#d33682` | `#268bd2` | `#93a1a1` | Pre-shared Visual Solarized Light explicit syntax tokens; retain code colours |
| github-dark | dark | `#e6edf3` / `#0d1117` | `#ff7b72` | `#a5d6ff` | `#79c0ff` | `#d2a8ff` | `#8b949e` | Pre-shared Visual GitHub Dark explicit syntax tokens; retain code colours |
| vscode-dark | dark | `#d4d4d4` / `#1f1f1f` | `#569cd6` | `#ce9178` | `#b5cea8` | `#dcdcaa` | `#6a9955` | Pre-shared Visual VS Code Dark Modern explicit syntax tokens; retain code colours |
| vscode-light | light | `#3b3b3b` / `#ffffff` | `#0000ff` | `#a31515` | `#098658` | `#795e26` | `#008000` | Pre-shared Visual VS Code Light Modern explicit syntax tokens; retain code colours |
| github-light | light | `#24292f` / `#ffffff` | `#cf222e` | `#0a3069` | `#0550ae` | `#8250df` | `#6e7781` | Pre-shared Visual GitHub Light explicit syntax tokens; retain code colours |
| ayu-light | light | `#575f66` / `#fafafa` | `#fa8d3e` | `#86b300` | `#a37acc` | `#399ee6` | `#abb0b6` | Pre-shared Visual Ayu Light explicit syntax tokens; retain code colours |
| ayu-dark | dark | `#bfbdb6` / `#0d1017` | `#ff8f40` | `#aad94c` | `#d2a6ff` | `#39bae6` | `#626a73` | Pre-shared Visual Ayu Dark explicit syntax tokens; retain code colours |
| gruvbox-light | light | `#3c3836` / `#fbf1c7` | `#9d0006` | `#79740e` | `#8f3f71` | `#b57614` | `#928374` | Pre-shared Visual Gruvbox Light explicit syntax tokens; retain code colours |
| rose-pine | dark | `#e0def4` / `#191724` | `#31748f` | `#9ccfd8` | `#f6c177` | `#ebbcba` | `#6e6a86` | Rosé Pine official palette; explicit Piclaw role map |
| catppuccin-latte | light | `#4c4f69` / `#eff1f5` | `#8839ef` | `#40a02b` | `#fe640b` | `#1e66f5` | `#7c7f93` | Catppuccin official palette1.8.0; explicit Piclaw role map |
| everforest-dark | dark | `#d3c6aa` / `#2d353b` | `#e69875` | `#a7c080` | `#d699b6` | `#a7c080` | `#b3b5a4` | existing Piclaw palette; unspecified code roles use authored foreground |
| everforest-light | light | `#5c6a72` / `#fdf6e3` | `#f57d26` | `#8da101` | `#df69ba` | `#8da101` | `#5e6c73` | existing Piclaw palette; unspecified code roles use authored foreground |
| rose-pine-dawn | light | `#464261` / `#faf4ed` | `#286983` | `#56949f` | `#ea9d34` | `#d7827e` | `#9893a5` | Rosé Pine official palette; explicit Piclaw role map |
| graphite | dark | `#e6e8ea` / `#202326` | `#93b9cc` | `#a7c6b0` | `#ddca92` | `#93b9cc` | `#a6adb4` | existing Piclaw palette; unspecified code roles use authored foreground |
| paper | light | `#292e31` / `#f8f7f3` | `#376a7d` | `#326947` | `#896016` | `#376a7d` | `#5f676c` | existing Piclaw palette; unspecified code roles use authored foreground |
| accessible-dark | dark | `#ffffff` / `#080b0d` | `#8addff` | `#97e6ac` | `#ffe48a` | `#8addff` | `#dce4e9` | existing Piclaw palette; unspecified code roles use authored foreground |
| accessible-light | light | `#11191f` / `#ffffff` | `#004b76` | `#155b2e` | `#735100` | `#004b76` | `#35434c` | existing Piclaw palette; unspecified code roles use authored foreground |
| oled | dark | `#f1f5f7` / `#000000` | `#6bd8df` | `#8bd7a3` | `#e8cf88` | `#6bd8df` | `#a8b6be` | existing Piclaw palette; unspecified code roles use authored foreground |
| petrol | dark | `#f0e8da` / `#102b30` | `#d99a6c` | `#a8c89a` | `#e7ca87` | `#d99a6c` | `#b7c3bb` | existing Piclaw palette; unspecified code roles use authored foreground |
| petrol-light | light | `#18363b` / `#f0e8da` | `#246372` | `#3b6c4b` | `#89532f` | `#89532f` | `#4a605b` | existing Piclaw palette; unspecified code roles use authored foreground |
| aubergine | dark | `#f4ebdd` / `#291f30` | `#cfafd9` | `#e2bc68` | `#99cbd2` | `#e2bc68` | `#c1b2c0` | existing Piclaw palette; unspecified code roles use authored foreground |
| cobalt2 | dark | `#ffffff` / `#193549` | `#ff9d00` | `#a5ff90` | `#ff628c` | `#ffc600` | `#0088ff` | cobalt2.jsonc — shared VS Code resolver |
| burgundy | dark | `#f4e7dc` / `#321f29` | `#e3a6b1` | `#a5ccb1` | `#ecd68c` | `#e3a6b1` | `#cdb2bc` | existing Piclaw palette; unspecified code roles use authored foreground |
| porcelain | light | `#304567` / `#f6f1e7` | `#304567` | `#476e5f` | `#b94e28` | `#b94e28` | `#546071` | existing Piclaw palette; unspecified code roles use authored foreground |
| synthwave-84 | dark | `#ffffff` / `#262335` | `#fede5d` | `#ff8b39` | `#f97e72` | `#36f9f6` | `#848bbd` | synthwave.jsonc — shared VS Code resolver |
| colour-friendly-dark | dark | `#e6e8ea` / `#202326` | `#93b9cc` | `#a7c6b0` | `#ddca92` | `#93b9cc` | `#a6adb4` | existing Piclaw palette; unspecified code roles use authored foreground |
| colour-friendly-light | light | `#292e31` / `#f8f7f3` | `#376a7d` | `#326947` | `#896016` | `#376a7d` | `#5f676c` | existing Piclaw palette; unspecified code roles use authored foreground |
| turbo-pascal | dark | `#aaaaaa` / `#000088` | `#ffffff` | `#00ffff` | `#ff00ff` | `#ffff00` | `#00ff00` | turbo-pascal.jsonc — shared VS Code resolver |
| as400 | dark | `#00ff00` / `#000000` | `#00ff00` | `#00dd00` | `#00ee00` | `#00cc00` | `#007700` | AS400 source mapping deliberately transformed to green-only by user request |
| lumon | dark | `#d6e2ee` / `#1b2d40` | `#6fb8e3` | `#6fb8e3` | `#f2fcff` | `#4d9ed3` | `#4a6b80` | lumon.jsonc — shared VS Code resolver |
| noctis | dark | `#b2cacd` / `#052529` | `#df769b` | `#49e9a6` | `#7060eb` | `#16a3b6` | `#5b858b` | noctis.jsonc — shared VS Code resolver |
| noctis-lux | light | `#005661` / `#fef8ec` | `#ff5792` | `#00b368` | `#5842ff` | `#0095a8` | `#8ca6a6` | noctis-lux.jsonc — shared VS Code resolver |
| bearded-arc | dark | `#d3d8e1` / `#1c2433` | `#eacd61` | `#3cec85` | `#ff955c` | `#69c3ff` | `#54617b` | bearded-arc.jsonc — shared VS Code resolver |
| tokyo-night-storm | dark | `#a9b1d6` / `#24283b` | `#bb9af7` | `#9ece6a` | `#ff9e64` | `#7aa2f7` | `#5f6996` | tokyo-night-storm.jsonc — shared VS Code resolver |
| tokyo-night-light | light | `#343b59` / `#e6e7ed` | `#65359d` | `#385f0d` | `#965027` | `#2959aa` | `#888b94` | tokyo-night-light.jsonc — shared VS Code resolver |
| catppuccin-frappe | dark | `#c6d0f5` / `#303446` | `#ca9ee6` | `#a6d189` | `#ef9f76` | `#8caaee` | `#949cbb` | Catppuccin official palette1.8.0; explicit Piclaw role map |
| catppuccin-macchiato | dark | `#cad3f5` / `#24273a` | `#c6a0f6` | `#a6da95` | `#f5a97f` | `#8aadf4` | `#939ab7` | Catppuccin official palette1.8.0; explicit Piclaw role map |
| default (visual) | dark | `#cdd6f4` / `#11111b` | `#cba6f7` | `#a6e3a1` | `#fab387` | `#89b4fa` | `#9399b2` | Visual default Catppuccin Mocha/Latte code roles |
| default (visual) | light | `#4c4f69` / `#f5f5f5` | `#8839ef` | `#40a02b` | `#fe640b` | `#1e66f5` | `#7c7f93` | Visual default Catppuccin Mocha/Latte code roles |

Role-source classification totals: {"authored":688,"documented-role-fallback":554,"textmate":196,"fallback":32,"semantic":69,"authored-default":54}. Full per-role origins and colours are in the expectation fixture, not inferred from rendered CSS.
