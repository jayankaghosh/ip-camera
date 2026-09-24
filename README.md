# IP Camera

Turn one device into a live camera; watch it from another with a 6-character code.

- **Host** optionally sets a password, grants camera + mic, goes live, and gets a unique code
  (e.g. `J74TXD`). The host sees everyone watching, can remove any viewer, and can turn their own
  mic/camera off and on.
- **Viewer** enters their name, the code, and the password (if the host set one) and gets the live
  video + audio. Viewers can also turn the host's mic/camera off and on, and press **Talk** to switch on
  their own mic so the host hears them; the host sees a mic icon beside their name, which turns into
  animated bars while they speak.
- **Admin** (`/admin`, login from `.env`) sees every live stream with its code, password, mic/camera
  state and viewers, and can watch any stream without its password. The host sees admins as
  "Admin" in their viewer list.

Several hosts can be live at the same time; each has its own code.

**Mic/camera off really means off**: the host's device is released (camera light goes out, no
encoding, nothing sent), which saves battery. The connections stay open, so switching back on
resumes within a second without reconnecting.

## How it works

Media is sent with **WebRTC**, browser to browser (peer-to-peer):

- Video codec preference: **AV1 → VP9 → H.264 → VP8** (first one both browsers support wins).
- Audio: **Opus**, with echo cancellation and noise suppression.
- Encrypted end-to-end with DTLS-SRTP; bitrate adapts to the network automatically.

`server.mjs` is a custom Next.js server that also runs a WebSocket at `/ws`. It generates each host's
code (from `A–Z`/`2–9`, skipping look-alikes `0 O 1 I L`), admits viewers with a valid code and
password (5 wrong tries → 1-minute lockout per IP), tells the host who joined or left, relays the
WebRTC handshake and the mic/camera/remove commands, and serves the admin login at `/api/admin/*`.
Everything is kept in memory: a code stops working as soon as its host stops, and a server restart
ends all streams and admin sessions. Video never passes through the server.

Stream passwords are kept in plain text in memory (so the admin can see them) and never written to
disk.

## Run

```bash
npm install
cp .env.example .env # then set ADMIN_USERNAME / ADMIN_PASSWORD
npm run dev          # http://localhost:8908
```

Leave `ADMIN_USERNAME` / `ADMIN_PASSWORD` empty to disable `/admin`.

Production: `npm run build && npm start`.

### Using a phone or another device as the camera

Browsers only allow camera access on `https://` or `localhost`. For other devices on your LAN:

```bash
npm run cert         # creates certs/ with a self-signed certificate
npm run dev          # now serves https://<your-lan-ip>:8908
```

Accept the certificate warning once on each device.

### Across different networks

STUN (Google's public servers) is used by default, which covers most home networks. If viewers
can't connect (strict NAT / corporate networks), add a TURN server:

```bash
NEXT_PUBLIC_ICE_SERVERS='[{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]' npm run build
```

## Deploy behind nginx

`nginx-server-block.conf` is the site config (HTTP→HTTPS redirect + the HTTPS server) and it includes
`nginx.conf` from the project root, which holds the actual proxy rules: `/ws` upgraded to a
long-lived WebSocket, `/_next/static/` served from disk with immutable caching, everything else
proxied to Next.js.

```bash
# on the server, in /var/www/html/ipcamera
npm ci && npm run build
cp .env.example .env && nano .env            # set the admin login
TRUST_PROXY=1 PORT=8908 pm2 start npm --name ip-camera -- start

sudo ln -s /var/www/html/ipcamera/nginx-server-block.conf /etc/nginx/sites-enabled/ipcamera
sudo certbot --nginx -d ipcam.jayanka.in   # adds the ssl_certificate lines
sudo nginx -t && sudo systemctl reload nginx
```

`TRUST_PROXY=1` makes the app listen on `127.0.0.1` only and take the client IP from nginx's
`X-Real-IP` header, so the wrong-code lockout applies per visitor instead of to everyone at once.
