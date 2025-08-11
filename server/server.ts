// server/server.ts
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { ClientToServer, ServerToClient } from '../src/shared/protocol';
import { parse as parseUrl } from 'url';

type Cursor = { col: number; row: number };
type ClientState = {
    id: string;
    name?: string;
    cursor?: Cursor;
    lastSeen: number;
    ws: WebSocket;
};

const HTTP_PORT = 3000;
const GRID = { tileSize: 32, cols: 40, rows: 24 };

const app = express();

// Admin page (HTTP)
app.get('/admin', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Server Admin</title>
<style>
body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#0b0f12;color:#cdd6e0;margin:0}
h1{margin:16px}
table{width:calc(100% - 32px);margin:0 16px 16px;border-collapse:collapse}
td,th{padding:8px;border-bottom:1px solid #1b232c;text-align:left}
.badge{display:inline-block;padding:2px 6px;border-radius:8px;background:#24313d}
small{color:#92a2b3}
</style>
</head>
<body>
  <h1>Server Admin <small id="meta"></small></h1>
  <table>
    <thead><tr><th>ID</th><th>Name</th><th>Cursor</th><th>Last Seen</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
<script>
const rowsEl = document.getElementById('rows');
const metaEl = document.getElementById('meta');
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/admin-ws');
ws.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  if(data.kind === 'snapshot'){
    metaEl.textContent = '• clients: ' + data.count + ' • grid: ' + data.grid.cols + 'x' + data.grid.rows;
    rowsEl.innerHTML = data.players.map(p=>{
      const c = p.cursor ? (p.cursor.col + ',' + p.cursor.row) : '-';
      const t = new Date(p.lastSeen).toLocaleTimeString();
      return '<tr><td><span class="badge">' + p.id + '</span></td><td>' + (p.name||'-')
        + '</td><td>' + c + '</td><td>' + t + '</td></tr>';
    }).join('');
  }
};
</script>
</body></html>`);
});

const server = http.createServer(app);

// WS servers created with noServer, we’ll attach on upgrade
const gameWss = new WebSocketServer({ noServer: true });
const adminWss = new WebSocketServer({ noServer: true });

const clients = new Map<string, ClientState>();
function now() { return Date.now(); }

function broadcast(msg: ServerToClient, exceptId?: string) {
    const json = JSON.stringify(msg);
    for (const [id, c] of clients) {
        if (id === exceptId) continue;
        if (c.ws.readyState === WebSocket.OPEN) c.ws.send(json);
    }
}

function adminBroadcast() {
    const snapshot = {
        kind: 'snapshot',
        count: clients.size,
        grid: GRID,
        players: Array.from(clients.values()).map(c => ({
            id: c.id,
            name: c.name,
            cursor: c.cursor,
            lastSeen: c.lastSeen,
        })),
    };
    const json = JSON.stringify(snapshot);
    adminWss.clients.forEach(s => {
        if (s.readyState === WebSocket.OPEN) s.send(json);
    });
}

// Route upgrades by pathname (/ws, /admin-ws)
server.on('upgrade', (req, socket, head) => {
    const { pathname } = parseUrl(req.url || '');
    if (pathname === '/ws') {
        gameWss.handleUpgrade(req, socket, head, (ws) => {
            gameWss.emit('connection', ws, req);
        });
    } else if (pathname === '/admin-ws') {
        adminWss.handleUpgrade(req, socket, head, (ws) => {
            adminWss.emit('connection', ws, req);
        });
    } else {
        // not a ws endpoint we serve
        socket.destroy();
    }
});

// Game client connections
gameWss.on('connection', (ws) => {
    const id = nanoid(8);
    const state: ClientState = { id, lastSeen: now(), ws };
    clients.set(id, state);

    // Welcome + full snapshot
    ws.send(JSON.stringify({ kind: 'welcome', yourId: id, grid: GRID } as const));
    ws.send(JSON.stringify({
        kind: 'players',
        players: Array.from(clients.values()).map(c => ({
            id: c.id, name: c.name, cursor: c.cursor, lastSeen: c.lastSeen
        })),
    } as const));

    adminBroadcast();

    ws.on('message', (buf) => {
        state.lastSeen = now();
        let msg: unknown;
        try { msg = JSON.parse(String(buf)); } catch { return; }

        const parsed = ClientToServer.safeParse(msg);
        if (!parsed.success) return;

        const data = parsed.data;
        switch (data.kind) {
            case 'hello': {
                state.name = data.name?.slice(0, 24);
                broadcast({
                    kind: 'playerUpdate',
                    player: { id: state.id, name: state.name, cursor: state.cursor, lastSeen: state.lastSeen },
                });
                adminBroadcast();
                break;
            }
            case 'cursor': {
                const col = Math.max(0, Math.min(GRID.cols - 1, data.col));
                const row = Math.max(0, Math.min(GRID.rows - 1, data.row));
                state.cursor = { col, row };
                broadcast({
                    kind: 'playerUpdate',
                    player: { id: state.id, name: state.name, cursor: state.cursor, lastSeen: state.lastSeen },
                }, state.id);
                adminBroadcast();
                break;
            }
            case 'ping':
                break;
        }
    });

    ws.on('close', () => {
        clients.delete(id);
        broadcast({ kind: 'playerLeave', id });
        adminBroadcast();
    });
});

// Admin connections
adminWss.on('connection', () => {
    adminBroadcast();
});

server.listen(HTTP_PORT, () => {
    console.log(`[server] http://localhost:${HTTP_PORT}`);
});
