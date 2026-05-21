# Operator mode example

The canonical human-to-agent handoff flow.

## What it does

1. Creates a profile that will persist across sessions.
2. Starts an operator-mode session attached to that profile. The session begins in `human` control mode.
3. Prints the URL where a human can drive the browser (the SSE live viewer).
4. Waits for the operator to type `done` in the terminal.
5. Switches the session to `agent` control mode.
6. Runs one automated screenshot action to prove the agent half works.
7. Releases the session.

The next time you start a session against the same profile, the human's login state persists. No second human step required until the profile's cookies expire.

## Prerequisites

- Node 20+.
- A BrowseFleet server running at `http://localhost:3000`.
- For real-time viewing: a small HTML page that subscribes to the live SSE stream and updates an `<img>` per event (see snippet below).

## Run

```bash
npm install
npm start
```

The script prints the live-viewer URL (`http://localhost:3000/v1/sessions/<id>/live`). Opening that URL in a browser directly will show the raw `text/event-stream`. To render the screenshots, save the following as `viewer.html`, replace `<URL>` with the printed URL, and open it locally:

```html
<img id="frame" />
<script>
  const es = new EventSource('<URL>');
  es.onmessage = (e) => {
    const snap = JSON.parse(e.data);
    if (snap.screenshot) {
      document.getElementById('frame').src = 'data:image/jpeg;base64,' + snap.screenshot;
    }
  };
</script>
```

Drive the session via mouse and keyboard by `POST`ing to `/v1/sessions/<id>/actions` from your own UI, or by attaching Puppeteer to the CDP proxy.

When you are done with the human portion, type `done` in the terminal where this script is running. The script switches control to `agent`, takes a screenshot, and releases.

## Limitations

This example does not include a full operator UI. It demonstrates the BrowseFleet half of the equation. A production operator UI would render the live viewer in an `<img>` element, route mouse events to `/v1/sessions/:id/actions`, and provide a button to invoke the control switch.

See [`docs/operator-mode.md`](../../docs/operator-mode.md) for the complete flow and design discussion.
