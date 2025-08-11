// src/engine/GridRenderer.ts
import { hash2D, mulberry32 } from './prng';
import { colorForId } from './color';

type Options = {
    tileSize: number;                // CSS px por tile (lógico)
    gridLineAlpha?: number;
    onHoverTile?: (col: number, row: number) => void; // callback local (não replicado)
};

type Vec2 = { x: number; y: number };
type ReplicatedCursor = { id: string; name?: string; col: number; row: number };

/**
 * Renderer estável:
 * - Todo desenho (terreno, linhas, hover) em **CSS px**.
 * - Ambos contexts (visível e offscreen) escalados por DPR.
 * - Canvas dimensionado **exatamente** para cols*tileSize (sem depender do parent).
 * - Sem render até grid existir (evita 0x0).
 */
export class GridRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private base: HTMLCanvasElement;
    private baseCtx: CanvasRenderingContext2D;

    private parent: HTMLElement;
    private dpr = Math.max(1, window.devicePixelRatio || 1);

    private opts: {
        tileSize: number;
        gridLineAlpha: number;
        onHoverTile?: (col: number, row: number) => void;
    };

    private cols = 0;
    private rows = 0;
    private tileCss = 32; // logical size in CSS px

    private hover: Vec2 | null = null;
    private raf: number | null = null;

    private cursors: ReplicatedCursor[] = [];

    constructor(canvas: HTMLCanvasElement, options: Options) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error('2D context not available');
        this.ctx = ctx;

        this.base = document.createElement('canvas');
        const bctx = this.base.getContext('2d', { alpha: true });
        if (!bctx) throw new Error('Offscreen 2D context not available');
        this.baseCtx = bctx;

        this.opts = {
            tileSize: options.tileSize,
            gridLineAlpha: options.gridLineAlpha ?? 0.08,
            onHoverTile: options.onHoverTile,
        };
        this.tileCss = this.opts.tileSize;

        this.parent = canvas.parentElement || document.body;

        this.bindEvents();
        // NÃO chama resizeToParent aqui; só após setGrid()
    }

    // ---------- Public API ----------

    destroy() {
        this.unbindEvents();
        if (this.raf) cancelAnimationFrame(this.raf);
    }

    setGrid(cols: number, rows: number, tileSizeCss?: number) {
        if (tileSizeCss) {
            this.tileCss = tileSizeCss;
            this.opts.tileSize = tileSizeCss;
        }
        this.cols = cols;
        this.rows = rows;
        this.resizeToParent(); // primeiro draw só acontece após grid existir
    }

    setReplicatedCursors(list: ReplicatedCursor[]) {
        this.cursors = list;
        this.scheduleRender();
    }
    upsertReplicatedCursor(c: ReplicatedCursor) {
        const i = this.cursors.findIndex(x => x.id === c.id);
        if (i >= 0) this.cursors[i] = c;
        else this.cursors.push(c);
        this.scheduleRender();
    }
    removeReplicatedCursor(id: string) {
        this.cursors = this.cursors.filter(c => c.id !== id);
        this.scheduleRender();
    }

    resizeToParent() {
        if (this.cols <= 0 || this.rows <= 0) return;

        // tamanho lógico fixo (CSS px)
        const targetCssW = this.cols * this.tileCss;
        const targetCssH = this.rows * this.tileCss;

        // CSS size (mantém aspecto, centra via CSS fora daqui)
        this.canvas.style.width = `${targetCssW}px`;
        this.canvas.style.height = `${targetCssH}px`;

        // backing store em device px
        this.canvas.width = Math.round(targetCssW * this.dpr);
        this.canvas.height = Math.round(targetCssH * this.dpr);

        this.base.width = this.canvas.width;
        this.base.height = this.canvas.height;

        // contexts desenham em **CSS px** (escala por DPR)
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(this.dpr, this.dpr);

        this.baseCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.baseCtx.scale(this.dpr, this.dpr);

        this.drawBaseTerrain();
        this.render();
    }

    // ---------- Events ----------

    private bindEvents() {
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseLeave = this.onMouseLeave.bind(this);
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('mouseleave', this.onMouseLeave);
    }
    private unbindEvents() {
        this.canvas.removeEventListener('mousemove', this.onMouseMove);
        this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    }

    private onMouseMove(e: MouseEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const xCss = e.clientX - rect.left;
        const yCss = e.clientY - rect.top;

        const col = Math.floor(xCss / this.tileCss);
        const row = Math.floor(yCss / this.tileCss);

        if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) {
            if (this.hover) {
                this.hover = null;
                this.scheduleRender();
            }
            return;
        }

        if (!this.hover || this.hover.x !== col || this.hover.y !== row) {
            this.hover = { x: col, y: row };
            this.opts.onHoverTile?.(col, row); // local-only
            this.scheduleRender();
        }
    }
    private onMouseLeave() {
        if (this.hover) {
            this.hover = null;
            this.scheduleRender();
        }
    }

    private scheduleRender() {
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
            this.raf = null;
            this.render();
        });
    }

    // ---------- Drawing ----------

    private drawBaseTerrain() {
        // Desenha N×M tiles, cada um tileCss × tileCss, em CSS px
        const ctx = this.baseCtx;
        const W = this.cols * this.tileCss;
        const H = this.rows * this.tileCss;

        ctx.clearRect(0, 0, W, H);

        const speckleSize = 1 / this.dpr; // ~1 device px

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const x = c * this.tileCss;
                const y = r * this.tileCss;

                const seed = hash2D(c, r, 9001);
                const rnd = mulberry32(seed);

                const hDeg = 112 + Math.floor(rnd() * 10) - 5; // 107..117
                const s = 45 + Math.floor(rnd() * 10) - 5;     // 40..50
                const l = 44 + Math.floor(rnd() * 10) - 5;     // 39..49

                ctx.fillStyle = `hsl(${hDeg} ${s}% ${l}%)`;
                ctx.fillRect(x, y, this.tileCss, this.tileCss);

                const g = ctx.createLinearGradient(x, y, x + this.tileCss, y + this.tileCss);
                g.addColorStop(0, 'rgba(255,255,255,0.05)');
                g.addColorStop(1, 'rgba(0,0,0,0.06)');
                ctx.fillStyle = g;
                ctx.fillRect(x, y, this.tileCss, this.tileCss);

                // speckles
                ctx.globalAlpha = 0.08;
                ctx.fillStyle = 'black';
                for (let i = 0; i < 6; i++) {
                    const sx = x + rnd() * this.tileCss;
                    const sy = y + rnd() * this.tileCss;
                    ctx.fillRect(sx, sy, speckleSize, speckleSize);
                }
                ctx.globalAlpha = 1.0;
            }
        }
    }

    private drawGridLines() {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = this.opts.gridLineAlpha;
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000';

        const step = this.tileCss;
        const W = this.cols * step;
        const H = this.rows * step;

        // linhas internas
        for (let c = 1; c < this.cols; c++) {
            const x = c * step + 0.5;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let r = 1; r < this.rows; r++) {
            const y = r * step + 0.5;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }

        // borda externa única (evita clip da última coluna/linha)
        ctx.globalAlpha = 0.25;
        ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
        ctx.restore();
    }

    private drawHoverHighlight() {
        if (!this.hover) return;
        const { x: c, y: r } = this.hover;
        const xCss = c * this.tileCss;
        const yCss = r * this.tileCss;
        const ctx = this.ctx;

        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(xCss, yCss, this.tileCss, this.tileCss);

        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(
            Math.floor(xCss) + 1,
            Math.floor(yCss) + 1,
            this.tileCss - 2,
            this.tileCss - 2
        );

        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(
            Math.floor(xCss) + 0.5,
            Math.floor(yCss) + 0.5,
            this.tileCss - 1,
            this.tileCss - 1
        );
        ctx.restore();
    }

    private drawReplicatedCursors() {
        const ctx = this.ctx;
        for (const c of this.cursors) {
            const xCss = c.col * this.tileCss + this.tileCss / 2;
            const yCss = c.row * this.tileCss + this.tileCss / 2;
            const col = colorForId(c.id);

            ctx.save();
            // sombra
            ctx.beginPath();
            ctx.arc(xCss, yCss, this.tileCss * 0.42, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fill();

            // anel
            ctx.beginPath();
            ctx.arc(xCss, yCss, this.tileCss * 0.35, 0, Math.PI * 2);
            ctx.strokeStyle = col;
            ctx.lineWidth = 3;
            ctx.stroke();

            // iniciais
            const label = (c.name?.trim() || c.id).slice(0, 2).toUpperCase();
            ctx.fillStyle = 'white';
            ctx.font = `bold ${Math.floor(this.tileCss * 0.35)}px system-ui, Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, xCss, yCss + 1);
            ctx.restore();
        }
    }

    private render() {
        if (this.base.width === 0 || this.base.height === 0) return;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // desenha base (offscreen) -> visível, ambos em CSS px via escala DPR
        this.ctx.drawImage(
            this.base,
            0, 0, this.base.width, this.base.height,
            0, 0, this.base.width / this.dpr, this.base.height / this.dpr
        );

        this.drawGridLines();
        this.drawHoverHighlight();
        this.drawReplicatedCursors();
    }
}
