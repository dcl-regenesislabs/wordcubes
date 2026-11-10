// Opt-in developer overlay. Access remains controlled by the server's wallet allow-list.
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { netMon, netLines, health, logSummary } from '../netstats'
import { S, view, TOP_RESERVE, BOTTOM_RESERVE, EDGE } from './platform'
import { PAL, c, PillButton } from './theme'

let page = 0

export function NetMonitor() {
  if (!netMon.allowed || !netMon.open) {
    page = 0
    return null
  }
  const margin = EDGE()
  const w = Math.min(S(480), view().w - margin * 2 - S(20))
  const available = Math.max(S(180), view().h - TOP_RESERVE() - BOTTOM_RESERVE() - margin * 2)
  const font = S(14)
  const lineH = S(19)
  const chars = Math.max(20, Math.floor((w - S(28)) / (font * 0.65)))
  const lines: { text: string; warning: boolean }[] = []
  const h = health()
  // Paginate reasons with the data so every warning remains reachable.
  for (const line of [...h.reasons.map(reason => `! ${reason}`), ...netLines()]) {
    const warning = /\bNO\b|WAITING|^!/.test(line)
    let rest = line
    while (rest.length > chars) {
      const space = rest.lastIndexOf(' ', chars)
      const cut = space > 0 ? space : chars
      lines.push({ text: rest.slice(0, cut), warning })
      rest = rest.slice(cut).trimStart()
    }
    lines.push({ text: rest, warning })
  }
  const content = lines
  const rows = Math.max(1, Math.floor((available - S(136)) / lineH))
  const pages = Math.max(1, Math.ceil(content.length / rows))
  page = Math.min(page, pages - 1)
  const visible = content.slice(page * rows, (page + 1) * rows)
  const height = S(136) + visible.length * lineH
  const color = h.level === 'ok' ? PAL.green : h.level === 'warn' ? PAL.orange : PAL.red
  const status = h.level === 'ok' ? 'ALL GOOD' : h.level === 'warn' ? 'WARNING' : 'FAILING'
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: TOP_RESERVE() + margin, left: margin + S(20) }, width: w, height, padding: S(12), flexDirection: 'column', borderRadius: S(12), pointerFilter: 'none' }}
      uiBackground={{ color: c(0.07, 0.06, 0.13, 0.76) }}
    >
      <UiEntity uiTransform={{ width: '100%', height: S(42), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
        <Label value="DEV PANEL" fontSize={S(22)} font="sans-serif" color={PAL.text} textAlign="middle-left" uiTransform={{ width: w - S(200), height: S(38) }} />
        <PillButton id="net-log" label="LOG" width={S(70)} height={S(32)} font={S(14)} onClick={logSummary} />
        <PillButton id="net-close" label="CLOSE" width={S(78)} height={S(32)} font={S(14)} onClick={() => { netMon.open = false }} />
      </UiEntity>
      <Label value={status} fontSize={S(16)} font="sans-serif" color={color} textAlign="middle-left" uiTransform={{ width: '100%', height: S(26), flexShrink: 0 }} />
      <UiEntity uiTransform={{ width: '100%', height: visible.length * lineH, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
        {visible.map((line, i) => (
          <Label key={`net-${i}`} value={line.text} fontSize={font} font="monospace" color={line.warning ? PAL.pink : line.text.startsWith('==') ? PAL.cyan : PAL.text} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: lineH, flexShrink: 0, pointerFilter: 'none' }} />
        ))}
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: S(44), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
        <PillButton id="net-prev" label="<" width={S(64)} height={S(36)} font={S(18)} onClick={() => { page = (page + pages - 1) % pages }} />
        <Label value={`${page + 1} / ${pages}`} fontSize={S(16)} color={PAL.text} uiTransform={{ width: S(100), height: S(36), pointerFilter: 'none' }} />
        <PillButton id="net-next" label=">" width={S(64)} height={S(36)} font={S(18)} onClick={() => { page = (page + 1) % pages }} />
      </UiEntity>
    </UiEntity>
  )
}
