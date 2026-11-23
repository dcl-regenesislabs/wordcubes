export function playerLabelParts(name: string, address: string, maxChars = 16, fallback = 'Player') {
  // Keep profile text literal in world text renderers and on a single line.
  const clean = name.replace(/[<>\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, '')
    .trim().replace(/#[0-9a-f]{4}$/i, '').trim() || fallback
  const chars = Array.from(clean)
  const short = chars.length > maxChars ? chars.slice(0, maxChars - 3).join('') + '...' : clean
  return { name: short, suffix: `#${address.slice(-4)}` }
}

// Keep the wallet suffix visible even when the display name is long.
export function playerLabel(name: string, address: string): string {
  const parts = playerLabelParts(name, address)
  return parts.name + parts.suffix
}
