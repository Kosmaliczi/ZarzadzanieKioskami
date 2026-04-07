# -*- coding: utf-8 -*-
import xbmc
import xbmcgui
import os
import time

# Config
TICKER_FILE = "/storage/napis.txt"
ORIENTATION_FILE = "/storage/kiosk_orientation.txt"  # optional file with orientation from API-compatible values
REFRESH_TEXT_SECONDS = 3.0   # how often to re-read text file
ANIM_TICK_SECONDS = 0.03     # animation frame tick (~33 FPS)
SCROLL_SPEED_PX_S = 80       # pixels per second
BOTTOM_MARGIN = 24           # px from bottom
FONT_NAME = "font30"
TEXT_COLOR = "0xFFFFFFFF"
BAR_HEIGHT = 48  # height of the bottom bar and label
BG_TEXTURE = "/storage/pasek.png"  # custom bar image
REFRESH_ORIENTATION_SECONDS = 1.0  # how often to re-read current screen orientation


def normalize_orientation(value):
    """Normalize orientation values to xrandr-compatible tokens used by app.py API."""
    orientation = (value or "").strip().lower()
    if orientation in ("0", "normal"):
        return "normal"
    if orientation in ("90", "right"):
        return "right"
    if orientation in ("270", "left"):
        return "left"
    if orientation in ("180", "inverted"):
        return "inverted"
    return "normal"


def get_orientation_from_file():
    """Read orientation from a local file in app.py-compatible format."""
    try:
        import xbmcvfs
        if not xbmcvfs.exists(ORIENTATION_FILE):
            return None

        f = xbmcvfs.File(ORIENTATION_FILE, 'r')
        raw_value = f.read()
        f.close()

        if isinstance(raw_value, bytes):
            raw_value = raw_value.decode('utf-8', errors='ignore')

        raw_value = (raw_value or "").strip().lower()
        if not raw_value:
            return None

        allowed = {"normal", "right", "left", "inverted", "0", "90", "180", "270"}
        if raw_value not in allowed:
            xbmc.log("Ticker: Invalid orientation value in file: " + raw_value, xbmc.LOGWARNING)
            return None

        return normalize_orientation(raw_value)
    except Exception as e:
        xbmc.log("Ticker: Error reading orientation file: " + str(e), xbmc.LOGWARNING)
    return None


def get_screen_orientation():
    """Resolve orientation without xrandr: file hint first, then Kodi screen dimensions."""
    file_orientation = get_orientation_from_file()
    if file_orientation:
        return file_orientation

    try:
        window = xbmcgui.Window(10000)
        w = int(window.getWidth())
        h = int(window.getHeight())
        if w > 0 and h > 0 and h > w:
            return "right"
    except Exception as e:
        xbmc.log("Ticker: Error reading orientation from screen size: " + str(e), xbmc.LOGWARNING)
    return "normal"

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

        self.y = max(0, self.screen_h - BAR_HEIGHT - BOTTOM_MARGIN)
        self.x_bar = 0
        self.y_bar = self.y
        self.text = ""
        self.x = self.screen_w
        self.orientation = "normal"
        self.avg_char_px = 14  # rough average for font30 at 1080p

        # Add solid bar image behind the text (from /storage/pasek.png)
        bg_path = BG_TEXTURE
        tint = None
        try:
            import xbmcvfs
            # translatePath ensures a usable OS/VFS path for ControlImage
            translated = xbmcvfs.translatePath(bg_path)
            if not xbmcvfs.exists(translated):
                xbmc.log(f"Ticker: BG not found at {bg_path}, using fallback.", xbmc.LOGWARNING)
                translated = xbmcvfs.translatePath("special://xbmc/media/white.png")
                tint = "0xFF000000"  # fallback to black bar
            bg_path = translated
        except Exception as e:
            xbmc.log(f"Ticker: BG resolve error: {e}", xbmc.LOGERROR)
            bg_path = "special://xbmc/media/white.png"
            tint = "0xFF000000"

        # Force stretch (aspectRatio=0) and ensure it's visible
        self.bg = xbmcgui.ControlImage(0, self.y, self.screen_w, BAR_HEIGHT, bg_path, aspectRatio=0)
        if tint:
            try:
                self.bg.setColorDiffuse(tint)
            except Exception:
                pass
        self.bg.setVisible(True)
        self.addControl(self.bg)
        xbmc.log(f"Ticker: BG loaded '{bg_path}' at y={self.y}, h={BAR_HEIGHT}", xbmc.LOGINFO)

        # Use a label so we can rotate the rendered text with the control angle.
        self.text_control = None
        self.text_control_angle = None
        self._ensure_text_control(0)
        self.apply_orientation("normal")

    def _format_text_for_orientation(self):
        """Keep ticker text continuous and readable for the textbox control."""
        return (self.text or "").replace("\r\n", " ").replace("\r", " ").replace("\n", " ")

    def _ensure_text_control(self, angle):
        if self.text_control is not None and self.text_control_angle == angle:
            return

        if self.text_control is not None:
            try:
                self.removeControl(self.text_control)
            except Exception:
                pass

        try:
            self.text_control = xbmcgui.ControlLabel(
                0,
                self.y,
                self.screen_w * 2,
                BAR_HEIGHT,
                "",
                font=FONT_NAME,
                textColor=TEXT_COLOR,
                angle=angle,
            )
        except TypeError:
            self.text_control = xbmcgui.ControlLabel(0, self.y, self.screen_w * 2, BAR_HEIGHT, "", font=FONT_NAME, textColor=TEXT_COLOR)
        self.text_control_angle = angle
        self.addControl(self.text_control)

    def _set_text_content(self, content):
        self.text_control.setLabel(content)

    def _get_estimated_text_width(self):
        return max(self.screen_w, int(len(self.text) * self.avg_char_px) + 100)

    def refresh_screen_size(self):
        """Refresh runtime screen size so overlay follows rotation/resolution changes."""
        try:
            w = self.getWidth()
            h = self.getHeight()
            if w and h and (w != self.screen_w or h != self.screen_h):
                self.screen_w = w
                self.screen_h = h
                self.y = max(0, self.screen_h - BAR_HEIGHT - BOTTOM_MARGIN)
                xbmc.log(f"Ticker: Screen size changed to {self.screen_w}x{self.screen_h}", xbmc.LOGINFO)
                return True
        except Exception:
            pass
        return False

    def apply_orientation(self, orientation):
        # Priorytet ma orientacja z pliku kiosk_orientation.txt, jeśli jest poprawna.
        file_orientation = get_orientation_from_file()
        effective_orientation = file_orientation if file_orientation else orientation
        self.orientation = normalize_orientation(effective_orientation)
        text_angle = 90 if self.orientation in ("right", "left") else 0
        self._ensure_text_control(text_angle)

        if self.orientation == "right":
            text_width = max(self._get_estimated_text_width(), self.screen_h)
            self.x_bar = max(0, self.screen_w - BAR_HEIGHT - BOTTOM_MARGIN)
            self.y_bar = 0
            self.bg.setPosition(self.x_bar, self.y_bar)
            self.bg.setWidth(BAR_HEIGHT)
            self.bg.setHeight(self.screen_h)
            self.text_control.setPosition(self.x_bar, self.y_bar)
            self.text_control.setWidth(text_width)
            self.text_control.setHeight(BAR_HEIGHT)
            self.x = -self._get_estimated_text_width()
        elif self.orientation == "left":
            text_width = max(self._get_estimated_text_width(), self.screen_h)
            self.x_bar = BOTTOM_MARGIN
            self.y_bar = 0
            self.bg.setPosition(self.x_bar, self.y_bar)
            self.bg.setWidth(BAR_HEIGHT)
            self.bg.setHeight(self.screen_h)
            self.text_control.setPosition(self.x_bar, self.y_bar)
            self.text_control.setWidth(text_width)
            self.text_control.setHeight(BAR_HEIGHT)
            self.x = -self._get_estimated_text_width()
        else:
            self.x_bar = 0
            self.y_bar = BOTTOM_MARGIN if self.orientation == "inverted" else max(0, self.screen_h - BAR_HEIGHT - BOTTOM_MARGIN)
            self.bg.setPosition(self.x_bar, self.y_bar)
            self.bg.setWidth(self.screen_w)
            self.bg.setHeight(BAR_HEIGHT)
            if self.orientation == "inverted":
                self.x = -self._get_estimated_text_width()
            else:
                self.x = self.screen_w
            self.text_control.setPosition(self.x_bar, self.y_bar)
            self.text_control.setWidth(self.screen_w)
            self.text_control.setHeight(BAR_HEIGHT)

        self._set_text_content(self._format_text_for_orientation())
        xbmc.log(f"Ticker: Orientation set to {self.orientation}", xbmc.LOGINFO)

    def set_text(self, text):
        self.text = text or ""
        self.apply_orientation(self.orientation)

    def step(self, dt):
        if not self.text:
            return

        est_w = self._get_estimated_text_width()
        delta = int(SCROLL_SPEED_PX_S * dt)

        if self.orientation == "normal":
            self.x -= delta
            if self.x <= -est_w:
                self.x = self.screen_w
            self.text_control.setPosition(self.x, self.y_bar)
        elif self.orientation == "inverted":
            self.x += delta
            if self.x >= self.screen_w:
                self.x = -est_w
            self.text_control.setPosition(self.x, self.y_bar)
        elif self.orientation == "right":
            self.x += delta
            if self.x >= self.screen_h:
                self.x = -est_w
            self.text_control.setPosition(self.x_bar, self.x)
        else:  # left
            self.x += delta
            if self.x >= self.screen_h:
                self.x = -est_w
            self.text_control.setPosition(self.x_bar, self.x)

# Main loop
xbmc.log("Ticker: Service starting...", xbmc.LOGINFO)
monitor = xbmc.Monitor()
overlay = None
last_text = ""
last_text_check = 0.0
last_orientation = "normal"
last_orientation_check = 0.0
last_tick = time.time()

try:
    while not monitor.abortRequested():
        now = time.time()

        # Determine whether to show overlay (during fullscreen video)
        show = xbmc.getCondVisibility("VideoPlayer.IsFullscreen") or xbmc.getCondVisibility("Player.HasMedia")

        if show and overlay is None:
            overlay = TickerOverlay()
            last_orientation = get_screen_orientation()
            overlay.apply_orientation(last_orientation)
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

        # Periodically refresh current screen orientation
        if (now - last_orientation_check) >= REFRESH_ORIENTATION_SECONDS:
            if overlay is not None and overlay.refresh_screen_size():
                overlay.apply_orientation(last_orientation)
                if last_text:
                    overlay.set_text(last_text)
            orientation = get_screen_orientation()
            if orientation != last_orientation:
                last_orientation = orientation
                if overlay is not None:
                    overlay.apply_orientation(last_orientation)
                    if last_text:
                        overlay.set_text(last_text)
                xbmc.log(f"Ticker: Orientation updated to {last_orientation}", xbmc.LOGINFO)
            last_orientation_check = now

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
