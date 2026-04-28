#pragma once

#include <SDL2/SDL.h>

#include <chrono>
#include <filesystem>
#include <string>

class ScrollingTextBar {
public:
    ScrollingTextBar();

    void setTextFilePath(std::string path);
    void setEnabled(bool enabled);
    void setScrollSpeed(float pixelsPerSecond);
    void setBarHeight(int height);
    void setRotationDegrees(int degrees);
    void render(SDL_Renderer* renderer, int width, int height);

private:
    void reloadTextIfNeeded();
    void drawText(SDL_Renderer* renderer, int x, int y, const std::string& text) const;
    void drawGlyph(SDL_Renderer* renderer, int x, int y, char ch) const;
    int measureTextWidth(const std::string& text) const;
    std::string normalizeText(const std::string& text) const;
    char normalizeChar(char ch) const;
    std::filesystem::file_time_type safeLastWriteTime(const std::filesystem::path& path) const;

    std::string textFilePath;
    std::string cachedText;
    std::string fallbackText;
    std::filesystem::file_time_type cachedWriteTime;
    bool hasCachedWriteTime;
    bool enabled;
    bool hiddenByDirective;
    float scrollSpeed;
    int barHeight;
    int scale;
    int glyphSpacing;
    int textGap;
    int rotationDegrees;
    float scrollOffset;
    std::chrono::steady_clock::time_point lastUpdate;
};
