import React, { useEffect, useRef, useState } from 'react';
import { GridRenderer } from './engine/GridRenderer';
import { NetClient } from './engine/net/Client';
import { PlayersSnapshotMsg, PlayerUpdateMsg } from './shared/protocol';

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<GridRenderer | null>(null);
    const netRef = useRef<NetClient | null>(null);
    const youRef = useRef<string | null>(null);
    const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');

    // NEW: fixed CSS size of the grid area; defaults match server (40x24, 32px)
    const [gridCss, setGridCss] = useState<{ w: number; h: number }>({ w: 40 * 32, h: 24 * 32 });

    useEffect(() => {
        const canvas = canvasRef.current!;
        const renderer = new GridRenderer(canvas, {
            tileSize: 32,
            gridLineAlpha: 0.08,
            onHoverTile: (c, r) => netRef.current?.sendCursor(c, r),
        });
        renderer.setGrid(40, 24, 32);
        rendererRef.current = renderer;

        const params = new URLSearchParams(location.search);
        const name = params.get('name') || undefined;
        const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
        const { hostname } = location;
        const wsUrl = `${proto}${hostname}:3000/ws`;

        const net = new NetClient(wsUrl, {
            onWelcome: (w) => {
                youRef.current = w.yourId;
                // FIX: lock grid to server-declared cols/rows/tileSize
                renderer.setGrid(w.grid.cols, w.grid.rows, w.grid.tileSize);
                // center box gets a FIXED CSS size
                setGridCss({ w: w.grid.cols * w.grid.tileSize, h: w.grid.rows * w.grid.tileSize });
                setStatus('online');
                // trigger one layout pass for the fixed size
                renderer.resizeToParent();
            },
            onPlayersSnapshot: (snap: PlayersSnapshotMsg) => {
                const you = youRef.current;
                const list = snap.players
                    .filter(p => p.cursor && p.id !== you)
                    .map(p => ({ id: p.id, name: p.name, col: p.cursor!.col, row: p.cursor!.row }));
                renderer.setReplicatedCursors(list);
            },
            onPlayerUpdate: (u: PlayerUpdateMsg) => {
                if (u.player.id === youRef.current) return;
                if (u.player.cursor) {
                    renderer.upsertReplicatedCursor({
                        id: u.player.id, name: u.player.name,
                        col: u.player.cursor.col, row: u.player.cursor.row,
                    });
                }
            },
            onPlayerLeave: (l) => renderer.removeReplicatedCursor(l.id),
            onDisconnect: () => setStatus('offline'),
        });
        netRef.current = net;
        net.connect(name);

        const onResize = () => {
            // grid stays fixed; we only re-render to keep crispness on DPR changes
            renderer.resizeToParent();
        };
        window.addEventListener('resize', onResize);

        return () => {
            window.removeEventListener('resize', onResize);
            net.close();
            renderer.destroy();
            rendererRef.current = null;
            netRef.current = null;
            youRef.current = null;
        };
    }, []);

    return (
        <div className="app">
            <div className="topbar">
                <strong>Grid Prototype</strong>
                <span>•</span>
                <span>WS: {status}</span>
                <span style={{ marginLeft: 8, opacity: 0.7 }}>
                    Admin: <code>http://localhost:3000/admin</code>
                </span>
            </div>

            <div className="canvas-wrap">
                {/* FIXED, CENTERED BOX */}
                <div className="grid-area" style={{ width: `${gridCss.w}px`, height: `${gridCss.h}px` }}>
                    <canvas ref={canvasRef} />
                    <div className="hint">
                        <div><b>Controls:</b> move mouse — local highlight</div>
                        <div>Server replicates your cursor to other clients</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
