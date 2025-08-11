// src/engine/color.ts
export function colorForId(id: string): string {
    // hash to hue
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    const s = 70;
    const l = 55;
    return `hsl(${h} ${s}% ${l}%)`;
}
