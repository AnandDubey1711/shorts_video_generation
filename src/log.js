// one line per event, e.g. "18:41:02 [reel 0b3a33c1] tts: requesting narration", so a reel can be followed in the terminal
const time = () => new Date().toTimeString().slice(0, 8);

export const log = (scope, message) => console.log(`${time()} [${scope}] ${message}`);
export const reelTag = (id) => `reel ${String(id).slice(0, 8)}`;
export const secondsSince = (start) => `${((Date.now() - start) / 1000).toFixed(1)}s`;
