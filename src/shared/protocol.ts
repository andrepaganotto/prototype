// src/shared/protocol.ts
import { z } from 'zod';

export const HelloMsg = z.object({
    kind: z.literal('hello'),
    version: z.literal(1),
    name: z.string().min(1).max(24).optional(),
});
export type HelloMsg = z.infer<typeof HelloMsg>;

export const CursorMsg = z.object({
    kind: z.literal('cursor'),
    col: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
});
export type CursorMsg = z.infer<typeof CursorMsg>;

export const PingMsg = z.object({
    kind: z.literal('ping'),
    t: z.number().int(),
});
export type PingMsg = z.infer<typeof PingMsg>;

export const ClientToServer = z.discriminatedUnion('kind', [HelloMsg, CursorMsg, PingMsg]);
export type ClientToServer = z.infer<typeof ClientToServer>;

export const WelcomeMsg = z.object({
    kind: z.literal('welcome'),
    yourId: z.string(),
    grid: z.object({
        tileSize: z.number().int().positive(),
        cols: z.number().int().positive(),
        rows: z.number().int().positive(),
    }),
});
export type WelcomeMsg = z.infer<typeof WelcomeMsg>;

export const PlayersSnapshotMsg = z.object({
    kind: z.literal('players'),
    players: z.array(z.object({
        id: z.string(),
        name: z.string().optional(),
        cursor: z.object({ col: z.number().int().nonnegative(), row: z.number().int().nonnegative() }).optional(),
        lastSeen: z.number().int(),
    })),
});
export type PlayersSnapshotMsg = z.infer<typeof PlayersSnapshotMsg>;

export const PlayerUpdateMsg = z.object({
    kind: z.literal('playerUpdate'),
    player: z.object({
        id: z.string(),
        name: z.string().optional(),
        cursor: z.object({ col: z.number().int().nonnegative(), row: z.number().int().nonnegative() }).optional(),
        lastSeen: z.number().int(),
    }),
});
export type PlayerUpdateMsg = z.infer<typeof PlayerUpdateMsg>;

export const PlayerLeaveMsg = z.object({
    kind: z.literal('playerLeave'),
    id: z.string(),
});
export type PlayerLeaveMsg = z.infer<typeof PlayerLeaveMsg>;

export const ServerToClient = z.discriminatedUnion('kind', [
    WelcomeMsg,
    PlayersSnapshotMsg,
    PlayerUpdateMsg,
    PlayerLeaveMsg,
]);
export type ServerToClient = z.infer<typeof ServerToClient>;
