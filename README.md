# FindMyFrame local demo

A browser-only event photo finder for testing a gallery of up to 50 photos. The organizer experience is designed for a computer; the guest experience is designed for a phone camera.

## Work in GitHub Codespaces

From the repository page, choose **Code → Codespaces → Create codespace on main**. The workspace installs dependencies automatically and forwards the FindMyFrame preview on port 5173.

Start the app inside the Codespace:

```bash
pnpm dev
```

## Run locally

```powershell
pnpm install
pnpm dev
```

Open the local address printed by the development server.

## Demo flow

1. Use **Organizer** on a computer and select up to 50 JPG, PNG, or WebP photos.
2. Wait while the browser detects and indexes faces.
3. Choose **Preview guest view**.
4. Take or choose a selfie. Group selfies are supported.
5. Review strong and possible matches, then download the original image.

## Privacy and current limitations

- Event photos and face descriptors remain in the current browser tab.
- The face model is downloaded from the Human model host on first use; no API key is required.
- Refreshing clears the current local session.
- The local demo simulates organizer and guest views in one browser session. A real phone on another device cannot see the computer's gallery yet. The production version will use private object storage and an event-scoped database so QR-code guests can access the same event securely.
- Similarity results are suggestions and should be visually reviewed, especially possible matches.

## Production follow-up

Replace the local in-memory gallery with private object storage, authenticated organizer uploads, event-scoped face vectors, expiring download links, and automatic seven-day deletion.
