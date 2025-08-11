// src/engine/net/Client.ts
import { z } from 'zod';
import {
    ClientToServer, ServerToClient,
    PlayersSnapshotMsg, PlayerUpdateMsg, PlayerLeaveMsg, WelcomeMsg
} from '../../shared/protocol';

type Handlers = {
    onWelcome: (w: WelcomeMsg) => void;
    onPlayersSnapshot: (s: PlayersSnapshotMsg) => void;
    onPlayerUpdate: (u: PlayerUpdateMsg) => void;
    onPlayerLeave: (l: PlayerLeaveMsg) => void;
    onDisconnect: () => void;
};

export class NetClient {
    private ws: WebSocket | null = null;
    private handlers: Handlers;
    private url: string;
    private lastSend = 0;
    private connecting = false;

    constructor(url: string, handlers: Handlers) {
        this.url = url;
        this.handlers = handlers;
    }

    connect(name?: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        if (this.connecting) return;
        this.connecting = true;

        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => {
            this.connecting = false;
            const hello = { kind: 'hello', version: 1, name } as const;
            this.send(hello);
        };
        this.ws.onclose = () => {
            this.connecting = false;
            this.handlers.onDisconnect();
            this.ws = null;
        };
        this.ws.onerror = () => { /* ignore */ };
        this.ws.onmessage = (ev) => {
            let msg: unknown;
            try {
                msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
            } catch {
                return;
            }

            const parsed = ServerToClient.safeParse(msg);
            if (!parsed.success) return;

            const data = parsed.data;
            switch (data.kind) {
                case 'welcome':
                    this.handlers.onWelcome(data);
                    break;
                case 'players':
                    this.handlers.onPlayersSnapshot(data);
                    break;
                case 'playerUpdate':
                    this.handlers.onPlayerUpdate(data);
                    break;
                case 'playerLeave':
                    this.handlers.onPlayerLeave(data);
                    break;
            }
        };
    }

    close() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            try { this.ws.close(); } catch { }
        }
        this.ws = null;
        this.connecting = false;
    }

    private send(msg: ClientToServer) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify(msg));
    }

    sendCursor(col: number, row: number) {
        const now = performance.now();
        if (now - this.lastSend < 33) return; // ~30 Hz throttle
        this.lastSend = now;
        this.send({ kind: 'cursor', col, row });
    }
}
