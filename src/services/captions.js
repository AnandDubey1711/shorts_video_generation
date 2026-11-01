const pad = (n) => String(n).padStart(2, '0');

function time(seconds) {
  const cs = Math.round(seconds * 100);
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

export function buildAss(timestamps) {
  const size = Number(process.env.WORDS_PER_CAPTION);
  const words = timestamps.filter((w) => /[\p{L}\p{N}]/u.test(w.word));
  const lines = [];
  for (let i = 0; i < words.length; i += size) {
    const group = words.slice(i, i + size);
    const end = words[i + size] ? words[i + size].start_time : group.at(-1).end_time;
    const text = group.map((w) => w.word).join(' ').replace(/[{}\\]/g, '').toUpperCase();
    lines.push(`Dialogue: 0,${time(group[0].start_time)},${time(end)},Default,,0,0,0,,${text}`);
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${process.env.CAPTION_FONT},${process.env.CAPTION_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
}
