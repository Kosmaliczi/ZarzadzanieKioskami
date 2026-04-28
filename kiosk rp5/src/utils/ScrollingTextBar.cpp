#include "ScrollingTextBar.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <fstream>
#include <sstream>
#include <unordered_map>
#include <vector>

namespace {
constexpr int kGlyphWidth = 5;
constexpr int kGlyphHeight = 7;
constexpr int kPadding = 8;
constexpr int kDefaultScale = 4;
const std::string kHideDirective = "__KIOSK_SCROLLING_TEXT_HIDDEN__";

using Glyph = std::array<uint8_t, kGlyphHeight>;

Glyph fallbackGlyph() {
    return {
        0b11111,
        0b10001,
        0b00010,
        0b00100,
        0b00100,
        0b00000,
        0b00100,
    };
}

Glyph getGlyphPattern(char ch) {
    switch (ch) {
        case 'A': return {0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001};
        case 'B': return {0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110};
        case 'C': return {0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110};
        case 'D': return {0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110};
        case 'E': return {0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111};
        case 'F': return {0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000};
        case 'G': return {0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110};
        case 'H': return {0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001};
        case 'I': return {0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110};
        case 'J': return {0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100};
        case 'K': return {0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001};
        case 'L': return {0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111};
        case 'M': return {0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001};
        case 'N': return {0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001};
        case 'O': return {0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110};
        case 'P': return {0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000};
        case 'Q': return {0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101};
        case 'R': return {0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001};
        case 'S': return {0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110};
        case 'T': return {0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100};
        case 'U': return {0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110};
        case 'V': return {0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100};
        case 'W': return {0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001};
        case 'X': return {0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b01010, 0b10001};
        case 'Y': return {0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100};
        case 'Z': return {0b11111, 0b00010, 0b00100, 0b00100, 0b01000, 0b10000, 0b11111};
        case '0': return {0b01110, 0b10011, 0b10101, 0b10101, 0b11001, 0b10001, 0b01110};
        case '1': return {0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110};
        case '2': return {0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111};
        case '3': return {0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110};
        case '4': return {0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010};
        case '5': return {0b11111, 0b10000, 0b10000, 0b11110, 0b00001, 0b00001, 0b11110};
        case '6': return {0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110};
        case '7': return {0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000};
        case '8': return {0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110};
        case '9': return {0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110};
        case '.': return {0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100};
        case ',': return {0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b01000};
        case '!': return {0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100};
        case '?': return {0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100};
        case '-': return {0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000};
        case ':': return {0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000};
        case ';': return {0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b01000, 0b00000};
        case '/': return {0b00001, 0b00010, 0b00100, 0b00100, 0b01000, 0b10000, 0b00000};
        case '(': return {0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010};
        case ')': return {0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000};
        case '\'': return {0b00100, 0b00100, 0b00010, 0b00000, 0b00000, 0b00000, 0b00000};
        case '"': return {0b01010, 0b01010, 0b00100, 0b00000, 0b00000, 0b00000, 0b00000};
        case '&': return {0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101};
        case '+': return {0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000};
        case '=': return {0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000};
        case '_': return {0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111};
        case '%': return {0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b10110, 0b10011};
        case '#': return {0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0b01010};
        case '@': return {0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110};
        default: return fallbackGlyph();
    }
}

std::string readWholeFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input.is_open()) {
        return {};
    }

    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

std::string trimAndLower(std::string value) {
    const auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };

    while (!value.empty() && isSpace(static_cast<unsigned char>(value.front()))) {
        value.erase(value.begin());
    }

    while (!value.empty() && isSpace(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }

    std::transform(
        value.begin(),
        value.end(),
        value.begin(),
        [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); }
    );

    return value;
}
} // namespace

ScrollingTextBar::ScrollingTextBar()
    : textFilePath("/home/kiosk/napis.txt")
    , cachedText("NAPIS.TXT")
    , fallbackText("NAPIS.TXT")
    , cachedWriteTime()
    , hasCachedWriteTime(false)
    , enabled(true)
    , hiddenByDirective(false)
    , scrollSpeed(90.0f)
    , barHeight(56)
    , scale(kDefaultScale)
    , glyphSpacing(1)
    , textGap(14)
    , rotationDegrees(0)
    , scrollOffset(0.0f)
    , lastUpdate(std::chrono::steady_clock::now()) {
}

void ScrollingTextBar::setTextFilePath(std::string path) {
    if (path.empty()) {
        path = "/home/kiosk/napis.txt";
    }

    if (path != textFilePath) {
        textFilePath = std::move(path);
        hasCachedWriteTime = false;
        scrollOffset = 0.0f;
        lastUpdate = std::chrono::steady_clock::now();
    }
}

void ScrollingTextBar::setEnabled(bool value) {
    enabled = value;
}

void ScrollingTextBar::setScrollSpeed(float pixelsPerSecond) {
    if (pixelsPerSecond > 0.0f) {
        scrollSpeed = pixelsPerSecond;
    }
}

void ScrollingTextBar::setBarHeight(int height) {
    barHeight = std::max(24, height);
}

void ScrollingTextBar::setRotationDegrees(int degrees) {
    int normalized = degrees % 360;
    if (normalized < 0) {
        normalized += 360;
    }

    if (normalized % 90 != 0) {
        return;
    }

    rotationDegrees = normalized;
}

char ScrollingTextBar::normalizeChar(char ch) const {
    unsigned char value = static_cast<unsigned char>(ch);
    if (value < 128) {
        return static_cast<char>(std::toupper(value));
    }
    return ' ';
}

std::string ScrollingTextBar::normalizeText(const std::string& text) const {
    std::string result;
    result.reserve(text.size());

    for (char ch : text) {
        if (ch == '\r' || ch == '\n' || ch == '\t') {
            result.push_back(' ');
            continue;
        }
        result.push_back(normalizeChar(ch));
    }

    const auto first = result.find_first_not_of(' ');
    if (first == std::string::npos) {
        return fallbackText;
    }

    const auto last = result.find_last_not_of(' ');
    return result.substr(first, last - first + 1);
}

std::filesystem::file_time_type ScrollingTextBar::safeLastWriteTime(const std::filesystem::path& path) const {
    std::error_code ec;
    const auto fileTime = std::filesystem::last_write_time(path, ec);
    if (ec) {
        return std::filesystem::file_time_type::min();
    }
    return fileTime;
}

void ScrollingTextBar::reloadTextIfNeeded() {
    if (textFilePath.empty()) {
        hiddenByDirective = false;
        cachedText = fallbackText;
        hasCachedWriteTime = false;
        return;
    }

    const std::filesystem::path path(textFilePath);
    if (!std::filesystem::exists(path)) {
        hiddenByDirective = false;
        cachedText = fallbackText;
        hasCachedWriteTime = false;
        return;
    }

    const auto currentWriteTime = safeLastWriteTime(path);
    if (hasCachedWriteTime && currentWriteTime == cachedWriteTime) {
        return;
    }

    const std::string rawText = readWholeFile(path);
    const std::string directive = trimAndLower(rawText);
    if (directive == trimAndLower(kHideDirective) || directive == "#hide_scrolling_text") {
        hiddenByDirective = true;
        cachedText.clear();
        cachedWriteTime = currentWriteTime;
        hasCachedWriteTime = true;
        return;
    }

    hiddenByDirective = false;
    const std::string normalized = normalizeText(rawText);
    if (!normalized.empty()) {
        cachedText = normalized;
    } else {
        cachedText = fallbackText;
    }

    cachedWriteTime = currentWriteTime;
    hasCachedWriteTime = true;
}

int ScrollingTextBar::measureTextWidth(const std::string& text) const {
    int width = 0;
    for (char ch : text) {
        if (ch == ' ') {
            width += (kGlyphWidth + glyphSpacing) * scale;
        } else {
            width += (kGlyphWidth + glyphSpacing) * scale;
        }
    }
    return width;
}

void ScrollingTextBar::drawGlyph(SDL_Renderer* renderer, int x, int y, char ch) const {
    if (!renderer || ch == ' ') {
        return;
    }

    const Glyph glyph = getGlyphPattern(ch);
    SDL_Rect pixel{};
    pixel.w = scale;
    pixel.h = scale;

    for (int row = 0; row < kGlyphHeight; ++row) {
        const uint8_t bits = glyph[static_cast<size_t>(row)];
        for (int col = 0; col < kGlyphWidth; ++col) {
            const int mask = 1 << (kGlyphWidth - 1 - col);
            if (bits & mask) {
                pixel.x = x + col * scale;
                pixel.y = y + row * scale;
                SDL_RenderFillRect(renderer, &pixel);
            }
        }
    }
}

void ScrollingTextBar::drawText(SDL_Renderer* renderer, int x, int y, const std::string& text) const {
    int cursorX = x;
    for (char ch : text) {
        drawGlyph(renderer, cursorX, y, ch);
        cursorX += (kGlyphWidth + glyphSpacing) * scale;
    }
}

void ScrollingTextBar::render(SDL_Renderer* renderer, int width, int height) {
    if (!enabled || !renderer || width <= 0 || height <= 0) {
        return;
    }

    reloadTextIfNeeded();
    if (hiddenByDirective) {
        return;
    }

    const std::string text = cachedText.empty() ? fallbackText : cachedText;
    const int textWidth = measureTextWidth(text);
    if (textWidth <= 0) {
        return;
    }

    const auto now = std::chrono::steady_clock::now();
    const float dt = std::chrono::duration<float>(now - lastUpdate).count();
    lastUpdate = now;

    scrollOffset += scrollSpeed * dt;
    const float cycleWidth = static_cast<float>(textWidth + textGap);
    if (cycleWidth > 1.0f) {
        while (scrollOffset >= cycleWidth) {
            scrollOffset -= cycleWidth;
        }
    } else {
        scrollOffset = 0.0f;
    }

    SDL_Texture* overlay = SDL_CreateTexture(
        renderer,
        SDL_PIXELFORMAT_RGBA8888,
        SDL_TEXTUREACCESS_TARGET,
        width,
        height
    );
    if (!overlay) {
        return;
    }

    SDL_SetTextureBlendMode(overlay, SDL_BLENDMODE_BLEND);
    SDL_Texture* previousTarget = SDL_GetRenderTarget(renderer);

    if (SDL_SetRenderTarget(renderer, overlay) != 0) {
        SDL_DestroyTexture(overlay);
        return;
    }

    SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_NONE);
    SDL_SetRenderDrawColor(renderer, 0, 0, 0, 0);
    SDL_RenderClear(renderer);

    SDL_SetRenderDrawBlendMode(renderer, SDL_BLENDMODE_BLEND);
    SDL_SetRenderDrawColor(renderer, 0, 0, 0, 170);
    SDL_Rect barRect{0, std::max(0, height - barHeight), width, barHeight};
    SDL_RenderFillRect(renderer, &barRect);

    SDL_SetRenderDrawColor(renderer, 255, 255, 255, 255);
    const int baselineY = barRect.y + (barHeight - kGlyphHeight * scale) / 2;
    const int cycle = textWidth + textGap;
    int startX = width - static_cast<int>(scrollOffset);

    while (startX > 0) {
        startX -= cycle;
    }

    for (int x = startX; x < width; x += cycle) {
        drawText(renderer, x, baselineY, text);
    }

    SDL_SetRenderTarget(renderer, previousTarget);
    SDL_RenderCopyEx(
        renderer,
        overlay,
        nullptr,
        nullptr,
        static_cast<double>(rotationDegrees),
        nullptr,
        SDL_FLIP_NONE
    );
    SDL_DestroyTexture(overlay);
}
