# Planning Poker
[![GitHub Repo](https://img.shields.io/badge/GitHub-bookish--octo--enigma-181717?logo=github)](https://github.com/MilanBehnam/bookish-octo-enigma)

Simple planning poker app for internal team use.

## Features

- Host creates a session in the browser
- Team members join with their name from a shared link
- Everyone picks a Fibonacci estimate immediately after joining
- Host reveals votes and can reset for the next round
- Optional settings: auto-reveal, fun reveal effect, average in results, and reveal countdown
- Revealed results show majority Fibonacci vote and team agreement percentage

## Hosting on Render

The app uses a Node.js relay server and Socket.IO, so it needs a host that supports a long-running web service and WebSockets. A free Render Web Service can deploy this repository using the included `render.yaml` Blueprint.

### Deploy steps

1. Open [Render](https://render.com/) and sign in with GitHub.
2. Select **New -> Blueprint** and choose this repository.
3. Apply the `planning-poker` service from `render.yaml`.
4. Open the generated `onrender.com` URL.

The free service may sleep after inactivity, and in-memory sessions are lost when the service restarts.

The Render deployment includes a verified production dependency bundle, so it does not need npm or Nexus network access during deployment. Local dependency installs use the Rabobank Nexus npm registry configured in `.npmrc`.

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
- Sessions are held in memory and are lost when the server restarts.
