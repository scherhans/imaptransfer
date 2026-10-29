/** Width and height from the header of a PNG file. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.toString('latin1', 1, 4) !== 'PNG') throw new Error('Not a PNG file');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
