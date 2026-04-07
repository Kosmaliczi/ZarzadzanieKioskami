# -*- coding: utf-8 -*-
import xbmc
import xbmcgui
import os
import time

# Config
TICKER_FILE = "/storage/napis.txt"
REFRESH_TEXT_SECONDS = 3.0   # how often to re-read text file
ANIM_TICK_SECONDS = 0.03     # animation frame tick (~33 FPS)
SCROLL_SPEED_PX_S = 80       # pixels per second
BOTTOM_MARGIN = 24           # px from bottom
FONT_NAME = "font30"
TEXT_COLOR = "0xFFFFFFFF"

def get_ticker_text():
    """Read ticker text from file."""
    try:
        import xbmcvfs
        if xbmcvfs.exists(TICKER_FILE):
            f = xbmcvfs.File(TICKER_FILE, 'r')
            content = f.read()
            f.close()
            if isinstance(content, bytes):
                content = content.decode('utf-8')
            return content.strip()
    except Exception as e:
        xbmc.log("Ticker: Error reading file: " + str(e), xbmc.LOGERROR)
    return ""

class TickerOverlay(xbmcgui.WindowDialog):
    """Non-blocking overlay window that scrolls text at the bottom of the screen."""
    def __init__(self):
        super().__init__()
        try:
            self.screen_w = self.getWidth()
            self.screen_h = self.getHeight()
        except Exception:
            self.screen_w = 1920
            self.screen_h = 1080

    self.y = max(0, self.screen_h - 48 - BOTTOM_MARGIN)
    self.text = ""
    self.x = self.screen_w
    self.avg_char_px = 14  # rough average for font30 at 1080p
    # Add black background image (solid color)
    self.bg = xbmcgui.ControlImage(0, self.y, self.screen_w * 2, 48, '', colorDiffuse="0xFF000000")
    self.addControl(self.bg)
    # Start with a wide label, will resize in set_text
    self.label = xbmcgui.ControlLabel(0, self.y, self.screen_w * 2, 48, "", font=FONT_NAME, textColor=TEXT_COLOR)
    self.addControl(self.label)

    def set_text(self, text):
        self.text = text or ""
        # Dynamically set label width based on text length
        est_w = max(self.screen_w, int(len(self.text) * self.avg_char_px) + 100)
        self.label.setWidth(est_w)
        self.bg.setWidth(est_w)
        self.label.setLabel(self.text)
        self.x = self.screen_w

    def step(self, dt):
        if not self.text:
            return
        # Estimate text width in pixels
        est_w = max(self.screen_w, int(len(self.text) * self.avg_char_px))
        self.x -= int(SCROLL_SPEED_PX_S * dt)
        if self.x <= -est_w:
            self.x = self.screen_w
        self.label.setPosition(self.x, self.y)
        self.bg.setPosition(self.x, self.y)

# Main loop
xbmc.log("Ticker: Service starting...", xbmc.LOGINFO)
monitor = xbmc.Monitor()
overlay = None
last_text = ""
last_text_check = 0.0
last_tick = time.time()

try:
    while not monitor.abortRequested():
        now = time.time()

        # Determine whether to show overlay (during fullscreen video)
        show = xbmc.getCondVisibility("VideoPlayer.IsFullscreen") or xbmc.getCondVisibility("Player.HasMedia")

        if show and overlay is None:
            overlay = TickerOverlay()
            overlay.show()
            if last_text:
                overlay.set_text(last_text)
            xbmc.log("Ticker: Overlay shown", xbmc.LOGINFO)

        if not show and overlay is not None:
            overlay.close()
            overlay = None
            xbmc.log("Ticker: Overlay hidden", xbmc.LOGINFO)

        # Periodically refresh ticker text from file
        if (now - last_text_check) >= REFRESH_TEXT_SECONDS:
            text = get_ticker_text()
            if text and text != last_text:
                last_text = text
                if overlay is not None:
                    overlay.set_text(last_text)
                xbmc.log("Ticker: Text updated", xbmc.LOGINFO)
            last_text_check = now

        # Animate scrolling
        dt = now - last_tick
        if overlay is not None and last_text:
            overlay.step(dt)
        last_tick = now

        # Wait a short tick or until abort
        if monitor.waitForAbort(ANIM_TICK_SECONDS):
            break
finally:
    if overlay is not None:
        try:
            overlay.close()
        except Exception:
            pass
    xbmc.log("Ticker: Service stopped", xbmc.LOGINFO)
