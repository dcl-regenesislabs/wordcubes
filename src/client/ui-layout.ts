// Numeric layout lives outside src/ui so Creator Hub can edit the HUD.
type Insets = { top: number; right: number; bottom: number; left: number }
export type HudCanvas = {
  width: number
  height: number
  screenInsetArea?: Insets
  interactableArea?: Insets
}

export function hudLayout(canvas: HudCanvas | null, mobile: boolean) {
  const width = canvas?.width || (mobile ? 1600 : 1920)
  const height = canvas?.height || (mobile ? 720 : 1080)
  const uiScale = Math.min(width / (mobile ? 1600 : 1920), height / (mobile ? 720 : 1080))
  const device = canvas?.screenInsetArea
  const availableWidth = (width - (device?.left || 0) - (device?.right || 0)) / uiScale
  const availableHeight = (height - (device?.top || 0) - (device?.bottom || 0)) / uiScale
  const native = canvas?.interactableArea
  // The renderer already applies device margins. Reserve only the additional
  // native HUD area, which differs between Unity and Bevy and can change with chat.
  const nativeLeft = mobile ? 0 : Math.max(0, (native?.left || 0) - (device?.left || 0)) / uiScale
  const nativeRight = mobile ? 0 : Math.max(0, (native?.right || 0) - (device?.right || 0)) / uiScale
  const nativeTop = mobile ? 0 : Math.max(0, (native?.top || 0) - (device?.top || 0)) / uiScale
  const nativeBottom = mobile ? 0 : Math.max(0, (native?.bottom || 0) - (device?.bottom || 0)) / uiScale
  // Two compact lines for the clue and word, independent of the native controls.
  const scale = mobile ? Math.max(1, 0.5 / uiScale) : Math.max(1, 0.75 / uiScale)
  const edge = (mobile ? 12 : 24) * scale
  const padding = (mobile ? 8 : 10) * scale
  const frameInset = (mobile ? 56 : 64) * scale
  const statusWidth = 260 * scale
  const gap = 16 * scale
  const usableWidth = availableWidth - nativeLeft - nativeRight
  const showStatus = !mobile && usableWidth * uiScale >= 900
  const desktopPanelLimit = Math.min(
    availableWidth - 2 * (nativeLeft + edge),
    availableWidth - 2 * (nativeRight + edge + (showStatus ? statusWidth + gap : 0))
  )
  const panelWidth = Math.min((mobile ? 560 : 680) * scale, mobile ? availableWidth - edge * 2 : desktopPanelLimit)
  const questionHeight = (mobile ? 34 : 36) * scale
  const wordHeight = (mobile ? 48 : 56) * scale
  const panelHeight = padding * 2 + questionHeight + wordHeight
  // Preserve each painted end cap at its original pixel aspect ratio. Only the
  // undecorated centre stretches, so the cubes stay square at every viewport size.
  const capWidth = panelHeight * (215 / 313)
  const centreWidth = panelWidth - capWidth * 2
  const toastHeight = 72 * scale
  const shortcutsWidth = Math.min(520 * scale, usableWidth - edge * 2)
  const shortcutCell = (shortcutsWidth - 24 * scale - 4) / 3
  return {
    panelWidth, panelHeight, edge, padding, frameInset, capWidth, centreWidth,
    headerTop: edge + nativeTop,
    headerRegionLeft: 0,
    headerRegionWidth: availableWidth,
    contentWidth: panelWidth - frameInset * 2,
    questionHeight, wordHeight,
    questionFont: 28 * scale,
    wordFont: (mobile ? 40 : 48) * scale,
    bodyFont: 24 * scale,
    toastHeight,
    toastTop: edge + nativeTop + panelHeight + 8 * scale,
    desktopDisplay: mobile ? 'none' as const : 'flex' as const,
    statusDisplay: showStatus ? 'flex' as const : 'none' as const,
    statusWidth,
    statusHeight: 116 * scale,
    desktopRight: edge + nativeRight,
    desktopTop: edge + nativeTop,
    desktopBottom: edge + nativeBottom,
    desktopPadding: 12 * scale,
    desktopFont: 22 * scale,
    desktopSmallFont: 20 * scale,
    desktopRow: 28 * scale,
    desktopIcon: 28 * scale,
    desktopIconGap: 8 * scale,
    statusTextWidth: statusWidth - 24 * scale - 4,
    coinTextWidth: statusWidth - 60 * scale - 4,
    shortcutsWidth,
    shortcutsHeight: 92 * scale,
    shortcutCell,
    shortcutTextWidth: shortcutCell - 36 * scale,
    availableHeight, uiScale
  }
}

/** Keep arbitrary word lengths inside the frame with legible, square cells. */
export function wordCellsLayout(count: number, width: number, height: number) {
  if (count <= 0) return { size: 0, rowWidth: 0, fontSize: 0 }
  const gap = Math.min(height / 8, width / (count * 4))
  const size = Math.min(height * 6 / 7, (width - gap * (count - 1)) / count)
  return { size, rowWidth: size * count + gap * (count - 1), fontSize: size * 0.68 }
}
