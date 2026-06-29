# Lens

Create prompt **symbols**, then drag a symbol onto your text to transform it with the Claude API.

- **Make a symbol** — give it a name, icon, color, and a prompt (e.g. "Summarize", "Fix grammar", "Translate to French").
- **Drop it on text** — type/paste text, optionally select part of it, then drag a symbol onto the text box. Claude runs the prompt on that text.
- **Apply the result** — replace the text (or just the selection) with Claude's output, or copy it.

Symbols are saved in your browser (localStorage). Your API key stays on the server.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your Claude API key:

   ```bash
   cp .env.example .env
   # then edit .env and set ANTHROPIC_API_KEY=sk-ant-...
   ```

3. Run it (starts the API server + the web app):

   ```bash
   npm run dev
   ```

   Open the app at http://localhost:5173

## Production

```bash
npm run build   # builds the web app into ./dist
npm start       # serves the app + API on http://localhost:8787
```

## Configuration

Set these in `.env`:

| Variable            | Default                          | Description                  |
| ------------------- | -------------------------------- | ---------------------------- |
| `ANTHROPIC_API_KEY` | _(required)_                     | Your Claude API key          |
| `CLAUDE_MODEL`      | `claude-sonnet-4-5-20250929`     | Which Claude model to use    |
| `PORT`              | `8787`                           | API server port              |
