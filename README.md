# IP Camera

Turn one device into a live camera; watch it from another with a 6-character code.

- **Host** grants camera + mic, goes live, and gets a unique code (e.g. `J74TXD`). The host sees the
  name of everyone currently watching.
- **Viewer** enters their name and the code and gets the live video + audio.

Several hosts can be live at the same time; each has its own code.

## How it works

Media is sent with **WebRTC**, browser to browser (peer-to-peer):

- Video codec preference: **AV1 → VP9 → H.264 → VP8** (first one both browsers support wins).
- Audio: **Opus**, with echo cancellation and noise suppression.
- Encrypted end-to-end with DTLS-SRTP; bitrate adapts to the network automatically.

`server.mjs` is a custom Next.js server that also runs a WebSocket at `/ws`. It generates each host's
code (from `A–Z`/`2–9`, skipping look-alikes `0 O 1 I L`), admits viewers with a valid code
(5 wrong codes → 1-minute lockout per IP), tells the host who joined or left, and relays the WebRTC
handshake. A code stops working as soon as its host stops. Video never passes through the server.

## Run

```bash
npm install
npm run dev          # http://localhost:8908
```

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
TRUST_PROXY=1 PORT=8908 pm2 start npm --name ip-camera -- start

sudo ln -s /var/www/html/ipcamera/nginx-server-block.conf /etc/nginx/sites-enabled/ipcamera
sudo certbot --nginx -d ipcam.jayanka.in   # adds the ssl_certificate lines
sudo nginx -t && sudo systemctl reload nginx
```

`TRUST_PROXY=1` makes the app listen on `127.0.0.1` only and take the client IP from nginx's
`X-Real-IP` header, so the wrong-code lockout applies per visitor instead of to everyone at once.
