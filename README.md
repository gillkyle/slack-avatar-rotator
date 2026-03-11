# slack-avatar

Rotates your Slack profile photo daily at 9:30am from a folder of images.

## Setup

### 1. Get a Slack token

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it anything (e.g. "Avatar Rotator") and pick your workspace
3. In the left sidebar → **OAuth & Permissions**
4. Under **User Token Scopes**, add `users.profile:write`
5. Scroll up → **Install to Workspace** → Allow
6. Copy the **User OAuth Token** (starts with `xoxp-`)

> Make sure you add the scope under **User Token Scopes**, not Bot Token Scopes.

### 2. Configure

```bash
cp .env.example .env
```

Paste your token into `.env`.

### 3. Add images

Drop `.png`, `.jpg`, `.gif`, or `.webp` files into the `images/` folder. They rotate in alphabetical order — prefix with numbers (`01-foo.png`, `02-bar.png`) to control the sequence.

### 4. Test

```bash
bun run rotate.ts
```

### 5. Schedule daily at 9:30am (macOS)

Update the bun path in the plist if needed (`which bun`), then:

```bash
cp com.kyle.slack-avatar.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.kyle.slack-avatar.plist
```

Logs go to `/tmp/slack-avatar.log`.

To uninstall:

```bash
launchctl unload ~/Library/LaunchAgents/com.kyle.slack-avatar.plist
rm ~/Library/LaunchAgents/com.kyle.slack-avatar.plist
```
