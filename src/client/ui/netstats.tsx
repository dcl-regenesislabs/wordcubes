// Live monitor (config NET_STATS; shown only to the wallets the server allows, see server/netstats.ts). A small button on the left edge, halfway down, opens a panel with what
// this client receives and what the server is doing (client/netstats.ts gathers it).
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { netMon, netLines, health, logSummary } from '../netstats'
import { S, view } from './platform'
import { PAL, Frame, PillButton, c } from './theme'

export function NetMonitor() {
  if (!netMon.allowed) return null
  const lines = netMon.open ? netLines() : []
  const font = S(15)
  const lineH = Math.round(font * 1.35)
  const w = Math.min(S(620), view().w - S(90))
  const h = health()
  const color = h.level === 'ok' ? c(0.2, 0.8, 0.35, 1) : h.level === 'warn' ? PAL.yellow : c(0.95, 0.25, 0.25, 1)
  const title = h.level === 'ok' ? 'ALL GOOD' : h.level === 'warn' ? 'WARNING' : 'FAILING'
  const reasons = h.reasons.slice(0, 3)
  const headH = S(44) + reasons.length * lineH
  const footH = S(52)
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0, bottom: 0 },
        width: '100%',
        height: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: { left: S(8) },
        pointerFilter: 'none'
      }}
    >
      <PillButton id="net-monitor" label={netMon.open ? 'X' : 'NET'} width={S(64)} height={S(40)} font={S(16)} tint={color} onClick={() => (netMon.open = !netMon.open)} />
      {netMon.open && (
        <Frame width={w} height={headH + lines.length * lineH + footH + S(24)} edge={PAL.violetLight} fill={c(0.05, 0.03, 0.12, 0.88)} radius={S(12)} pad={S(10)} align="flex-start" justify="flex-start" margin={{ left: S(8) }} block>
          <UiEntity uiTransform={{ width: '100%', height: S(40), flexDirection: 'row', alignItems: 'center', margin: { bottom: S(4) }, pointerFilter: 'none' }}>
            <UiEntity uiTransform={{ width: S(28), height: S(28), borderRadius: S(14), margin: { right: S(10) } }} uiBackground={{ color }} />
            <Label value={title} fontSize={S(24)} font="sans-serif" color={color} textAlign="middle-left" uiTransform={{ width: '80%', height: S(40) }} />
          </UiEntity>
          {reasons.map((r, i) => (
            <Label key={`why-${i}`} value={`- ${r}`} fontSize={font} font="monospace" color={color} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: lineH }} />
          ))}
          {lines.map((line, i) => (
            <Label
              key={`net-${i}`}
              value={line}
              fontSize={font}
              font="monospace"
              color={line.startsWith('==') ? PAL.yellow : line.includes('NO ') || line.includes('WAITING') ? PAL.pink : PAL.text}
              textAlign="middle-left"
              textWrap="nowrap"
              uiTransform={{ width: '100%', height: lineH }}
            />
          ))}
          <PillButton id="net-log" label="LOG" width={S(120)} height={S(40)} font={S(16)} margin={{ top: S(8) }} onClick={() => logSummary()} />
        </Frame>
      )}
    </UiEntity>
  )
}
