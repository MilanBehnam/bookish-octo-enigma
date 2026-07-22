# Planning Poker

Simple planning poker app for internal team use.

## Features

- Host creates a session in the browser
- Team members join with their name from a shared link
- Everyone picks a Fibonacci estimate immediately after joining
- Host reveals votes and can reset for the next round
- Optional settings: auto-reveal, fun reveal effect, average in results, and reveal countdown
- Revealed results show majority Fibonacci vote and team agreement percentage

## Hosting on GitHub Pages

This project is frontend-only and can be hosted on GitHub Pages because it does not run a custom backend.

The app uses PeerJS/WebRTC for browser-to-browser communication, so the host browser coordinates the session state.

### Deploy steps

1. Create a GitHub repository and push this project to branch `main`.
2. In GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main` (or run the workflow manually from **Actions**).
5. Your app will be available at:
   `https://<your-username>.github.io/<your-repo>/`

The workflow file is already included at:
`.github/workflows/deploy-pages.yml`

## How to use

1. Open the app.
2. Enter your name.
3. Click **Create session as host**.
4. Share the generated link with your team.
5. Team members open the link, enter their name, and join.
6. Everyone picks a Fibonacci card.
7. The host clicks **Reveal votes**.
8. The host clicks **Reset round** for the next round.

## Notes

- The session works while the host browser tab stays open.
- This version depends on PeerJS public infrastructure for connection setup.
- Because this is a static app, there is no persistent server-side storage.
