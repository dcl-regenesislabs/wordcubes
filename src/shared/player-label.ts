// Keep the wallet suffix visible even when the display name is long.
export function playerLabel(name: string, address: string): string {
  const clean = name.trim().replace(/#[0-9a-f]{4}$/i, '') || 'Player'
  const chars = Array.from(clean)
  const short = chars.length > 16 ? chars.slice(0, 13).join('') + '...' : clean
  return `${short}#${address.slice(-4)}`
}
