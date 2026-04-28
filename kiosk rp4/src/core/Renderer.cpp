#include "Renderer.h"

#include "../utils/Logger.h"

#include <algorithm>
#include <cmath>

Renderer::Renderer()
    : window(nullptr)
    , renderer(nullptr)
    , texture(nullptr)
    , swsContext(nullptr)
    , frameWidth(0)
    , frameHeight(0)
    , rotationDegrees(0)
    , yPlane(nullptr)
    , uPlane(nullptr)
    , vPlane(nullptr) {
}

Renderer::~Renderer() {
    cleanup();
}

bool Renderer::initialize(int width, int height) {
    if (window && renderer && texture && frameWidth == width && frameHeight == height) {
        SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
        return true;
    }

    if (width <= 0 || height <= 0) {
        Logger::logError(
            "Renderer initialization failed: invalid dimensions " +
            std::to_string(width) + "x" + std::to_string(height)
        );
        return false;
    }

    const bool rendererReady = (window != nullptr && renderer != nullptr);

    if (!SDL_SetHint(SDL_HINT_RENDER_DRIVER, "KMSDRM")) {
        Logger::logInfo("KMSDRM renderer hint not applied, SDL will use default renderer");
    }
    SDL_SetHint(SDL_HINT_RENDER_VSYNC, "1");
    SDL_SetHint(SDL_HINT_VIDEO_DOUBLE_BUFFER, "1");

    if (!rendererReady) {
        cleanup();

        SDL_DisplayMode displayMode{};
        int windowWidth = 1920;
        int windowHeight = 1080;
        if (SDL_GetCurrentDisplayMode(0, &displayMode) == 0) {
            if (displayMode.w > 0) {
                windowWidth = displayMode.w;
            }
            if (displayMode.h > 0) {
                windowHeight = displayMode.h;
            }
        }

        window = SDL_CreateWindow(
            "Video Player",
            SDL_WINDOWPOS_UNDEFINED,
            SDL_WINDOWPOS_UNDEFINED,
            windowWidth,
            windowHeight,
            SDL_WINDOW_SHOWN | SDL_WINDOW_BORDERLESS | SDL_WINDOW_FULLSCREEN
        );

        if (!window) {
            Logger::logError("Window creation failed: " + std::string(SDL_GetError()));
            return false;
        }

        if (SDL_SetWindowFullscreen(window, SDL_WINDOW_FULLSCREEN) != 0) {
            Logger::logInfo("Could not enforce exclusive fullscreen mode, trying desktop fullscreen: " + std::string(SDL_GetError()));
            if (SDL_SetWindowFullscreen(window, SDL_WINDOW_FULLSCREEN_DESKTOP) != 0) {
                Logger::logInfo("Could not enforce fullscreen desktop mode: " + std::string(SDL_GetError()));
            }
        }

        SDL_SetWindowAlwaysOnTop(window, SDL_TRUE);
        SDL_RaiseWindow(window);
        SDL_ShowCursor(SDL_DISABLE);

        renderer = SDL_CreateRenderer(
            window,
            -1,
            SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC | SDL_RENDERER_TARGETTEXTURE
        );

        if (!renderer) {
            Logger::logError("Renderer creation failed: " + std::string(SDL_GetError()));
            return false;
        }
    }

    frameWidth = width;
    frameHeight = height;

    if (texture) {
        SDL_DestroyTexture(texture);
        texture = nullptr;
    }

    delete[] yPlane;
    delete[] uPlane;
    delete[] vPlane;
    yPlane = nullptr;
    uPlane = nullptr;
    vPlane = nullptr;

    texture = SDL_CreateTexture(
        renderer,
        SDL_PIXELFORMAT_IYUV,
        SDL_TEXTUREACCESS_STREAMING,
        frameWidth,
        frameHeight
    );

    if (!texture) {
        Logger::logError("Texture creation failed: " + std::string(SDL_GetError()));
        return false;
    }

    yPlane = new uint8_t[frameWidth * frameHeight];
    uPlane = new uint8_t[frameWidth * frameHeight / 4];
    vPlane = new uint8_t[frameWidth * frameHeight / 4];

    SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
    return true;
}

void Renderer::renderFrame(AVFrame* frame) {
    if (!frame || !renderer || !texture) {
        return;
    }

    const AVPixelFormat sourceFormat = static_cast<AVPixelFormat>(frame->format);
    swsContext = sws_getCachedContext(
        swsContext,
        frame->width,
        frame->height,
        sourceFormat,
        frameWidth,
        frameHeight,
        AV_PIX_FMT_YUV420P,
        SWS_BILINEAR,
        nullptr,
        nullptr,
        nullptr
    );

    if (!swsContext) {
        Logger::logError("Failed to initialize frame conversion context");
        return;
    }

    uint8_t* outputPlanes[3] = {yPlane, uPlane, vPlane};
    int outputStrides[3] = {frameWidth, frameWidth / 2, frameWidth / 2};

    sws_scale(
        swsContext,
        frame->data,
        frame->linesize,
        0,
        frame->height,
        outputPlanes,
        outputStrides
    );

    SDL_UpdateYUVTexture(
        texture,
        nullptr,
        yPlane,
        outputStrides[0],
        uPlane,
        outputStrides[1],
        vPlane,
        outputStrides[2]
    );

    int outputWidth = frameWidth;
    int outputHeight = frameHeight;
    SDL_GetRendererOutputSize(renderer, &outputWidth, &outputHeight);

    const double scaleX = static_cast<double>(outputWidth) / static_cast<double>(frameWidth);
    const double scaleY = static_cast<double>(outputHeight) / static_cast<double>(frameHeight);
    const double scale = std::max(scaleX, scaleY);

    const int destinationWidth = static_cast<int>(std::lround(frameWidth * scale));
    const int destinationHeight = static_cast<int>(std::lround(frameHeight * scale));
    const SDL_Rect destinationRect {
        (outputWidth - destinationWidth) / 2,
        (outputHeight - destinationHeight) / 2,
        destinationWidth,
        destinationHeight,
    };

    SDL_RenderClear(renderer);

    // Keep player window above occasional desktop overlays (e.g. startup tools).
    SDL_RaiseWindow(window);

    SDL_RenderCopyEx(
        renderer,
        texture,
        nullptr,
        &destinationRect,
        static_cast<double>(rotationDegrees),
        nullptr,
        SDL_FLIP_NONE
    );
}
void Renderer::setRotation(int degrees) {
    int normalized = degrees % 360;
    if (normalized < 0) {
        normalized += 360;
    }

    if (normalized % 90 != 0) {
        Logger::logError("Invalid rotation value. Allowed values are multiples of 90");
        return;
    }

    rotationDegrees = normalized;
}

void Renderer::cleanup() {
    delete[] yPlane;
    delete[] uPlane;
    delete[] vPlane;
    yPlane = nullptr;
    uPlane = nullptr;
    vPlane = nullptr;

    if (texture) {
        SDL_DestroyTexture(texture);
        texture = nullptr;
    }

    if (renderer) {
        SDL_DestroyRenderer(renderer);
        renderer = nullptr;
    }

    if (window) {
        SDL_DestroyWindow(window);
        window = nullptr;
    }

    SDL_ShowCursor(SDL_ENABLE);

    if (swsContext) {
        sws_freeContext(swsContext);
        swsContext = nullptr;
    }

    frameWidth = 0;
    frameHeight = 0;
    rotationDegrees = 0;
}
