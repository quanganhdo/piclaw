# Numeric project references

Bare numeric references such as `#1390` link to the GitHub or Gitea repository configured for that chat. Timestamp-generated message links remain the way to reference timeline messages. Named hashtags such as `#bug` retain timeline filtering.

The agent uses `chat_project` for the current chat:

- `set` accepts an HTTP or HTTPS repository web URL;
- `get` reports the effective repository and its source chat;
- `clear` explicitly disables inherited links;
- `inherit` removes the current override.

Branch chats inherit along their stored parent chain. They do not infer parents from JID text. Settings persist by branch identity, survive chat renames and are removed when the branch is deleted.

Numeric references remain plain text when no repository is effective. Existing links, inline/fenced code, URL fragments, qualified references such as `owner/#42`, leading-zero values and tokens embedded in words are not rewritten. Generated project links open in a new tab with `noopener noreferrer`.

Repository URLs cannot contain credentials, queries, fragments, whitespace or traversal segments. The renderer receives the effective repository through the existing five-second shared UI snapshot; this adds no endpoint or polling loop. Already-rendered messages update when the snapshot changes.
