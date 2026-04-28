#include "VideoPlayer.h"

#include "utils/Logger.h"

#include <SDL2/SDL.h>

#include <algorithm>
#include <chrono>
#include <cctype>
#include <csignal>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <thread>

namespace {
VideoPlayer* g_player = nullptr;

void signal_handler(int signum) {
    if (g_player) {
        Logger::logInfo("Received signal " + std::to_string(signum) + ", stopping playback...");
        g_player->stop();
    }
    std::exit(0);
}

std::string trim(const std::string& value) {
    size_t start = 0;
    while (start < value.size() && std::isspace(static_cast<unsigned char>(value[start]))) {
        ++start;
    }

    size_t end = value.size();
    while (end > start && std::isspace(static_cast<unsigned char>(value[end - 1]))) {
        --end;
    }

    return value.substr(start, end - start);
}

std::string toLower(std::string value) {
    std::transform(
        value.begin(),
        value.end(),
        value.begin(),
        [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); }
    );
    return value;
}

bool hasM3uExtension(const std::string& path) {
    const std::filesystem::path inputPath(path);
    std::string extension = toLower(inputPath.extension().string());
    return extension == ".m3u" || extension == ".m3u8";
}

bool hasImageExtension(const std::string& path) {
    const std::filesystem::path inputPath(path);
    const std::string extension = toLower(inputPath.extension().string());
    return extension == ".jpg" || extension == ".jpeg" || extension == ".png" ||
           extension == ".bmp" || extension == ".gif" || extension == ".webp";
}

std::vector<std::string> parseM3uContent(
    const std::string& playlistContent,
    const std::filesystem::path& baseDir
) {
    std::vector<std::string> result;

    std::istringstream stream(playlistContent);
    std::string line;
    while (std::getline(stream, line)) {
        const std::string entry = trim(line);
        if (entry.empty() || entry[0] == '#') {
            continue;
        }

        std::filesystem::path mediaPath(entry);
        if (mediaPath.is_relative()) {
            mediaPath = baseDir / mediaPath;
        }

        result.push_back(mediaPath.lexically_normal().string());
    }

    return result;
}

std::vector<std::string> parseM3u(const std::string& playlistPath) {
    std::vector<std::string> result;

    std::ifstream stream(playlistPath);
    if (!stream.is_open()) {
        return result;
    }

    const std::filesystem::path baseDir = std::filesystem::path(playlistPath).parent_path();

    std::string line;
    while (std::getline(stream, line)) {
        const std::string entry = trim(line);
        if (entry.empty() || entry[0] == '#') {
            continue;
        }

        std::filesystem::path mediaPath(entry);
        if (mediaPath.is_relative()) {
            mediaPath = baseDir / mediaPath;
        }

        result.push_back(mediaPath.lexically_normal().string());
    }

    return result;
}

int parseIntEnv(const char* key, int fallback, int minValue, int maxValue) {
    const char* raw = std::getenv(key);
    if (!raw || raw[0] == '\0') {
        return fallback;
    }

    try {
        const int value = std::stoi(raw);
        return std::clamp(value, minValue, maxValue);
    } catch (const std::exception&) {
        return fallback;
    }
}

std::string detectSerialNumber() {
    const char* serialFromEnv = std::getenv("KIOSK_SERIAL_NUMBER");
    if (serialFromEnv && serialFromEnv[0] != '\0') {
        return serialFromEnv;
    }

    std::ifstream cpuInfo("/proc/cpuinfo");
    std::string line;
    while (std::getline(cpuInfo, line)) {
        if (line.rfind("Serial", 0) == 0) {
            const size_t delimiter = line.find(':');
            if (delimiter != std::string::npos) {
                const std::string serial = trim(line.substr(delimiter + 1));
                if (!serial.empty()) {
                    return serial;
                }
            }
        }
    }

    std::ifstream machineId("/etc/machine-id");
    if (std::getline(machineId, line)) {
        const std::string id = trim(line);
        if (!id.empty()) {
            return id;
        }
    }

    return {};
}

int orientationToDegrees(const std::string& orientationRaw) {
    const std::string orientation = toLower(trim(orientationRaw));

    if (orientation.empty() || orientation == "normal" || orientation == "0") {
        return 0;
    }
    if (orientation == "right" || orientation == "90") {
        return 90;
    }
    if (orientation == "inverted" || orientation == "180") {
        return 180;
    }
    if (orientation == "left" || orientation == "270") {
        return 270;
    }

    return -1;
}

bool writeTextFile(const std::string& filePath, const std::string& content) {
    std::error_code ec;
    const std::filesystem::path targetPath(filePath);
    if (targetPath.has_parent_path()) {
        std::filesystem::create_directories(targetPath.parent_path(), ec);
    }

    std::ofstream output(filePath, std::ios::binary | std::ios::trunc);
    if (!output.is_open()) {
        return false;
    }

    output << content;
    return output.good();
}

std::string resolveScrollingTextFilePath() {
    const char* envPath = std::getenv("KIOSK_SCROLL_TEXT_FILE");
    if (envPath && envPath[0] != '\0') {
        return envPath;
    }

    const char* altEnvPath = std::getenv("KIOSK_TICKER_TEXT_FILE");
    if (altEnvPath && altEnvPath[0] != '\0') {
        return altEnvPath;
    }

    const std::vector<std::string> candidates = {
        "/home/kiosk/napis.txt",
        "/storage/napis.txt",
        "napis.txt",
    };

    for (const std::string& candidate : candidates) {
        if (std::filesystem::exists(candidate)) {
            return candidate;
        }
    }

    return candidates.front();
}
} // namespace

VideoPlayer::VideoPlayer()
    : wsController(this)
    , isRunning(false)
    , paused(false)
    , volume(100)
    , shouldReset(false)
    , orientationWatcherRunning(false)
    , backendSyncRunning(false)
    , preloadRunning(false)
    , pendingBackendReload(false)
    , requestedRotationDegrees(0)
    , appliedRotationDegrees(0)
    , currentSourceIndex(0)
    , preloadedSourceIndex(0)
    , preloadedSourcePath()
    , preloadedFrameQueue()
    , lastValidFrame(nullptr)
    , imagePlaybackActive(false)
    , cachedImageFrame(nullptr)
    , imageDisplayDeadline(std::chrono::steady_clock::time_point::min())
    , imageDisplayDurationSeconds(parseIntEnv("KIOSK_IMAGE_DURATION_SECONDS", 10, 1, 3600))
    , orientationFilePath("/storage/kiosk_orientation.txt")
    , backendRuntimePlaylistPath("/tmp/kiosk_playlist_runtime.m3u")
    , backendSyncIntervalSeconds(10)
    , preloadFrameWaitMs(parseIntEnv("KIOSK_PRELOAD_FRAME_WAIT_MS", 2500, 100, 10000)) {
    g_player = this;
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);
}

VideoPlayer::~VideoPlayer() {
    stop();
}

bool VideoPlayer::initialize(const std::string& sourcePath, uint16_t wsPort) {
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO) < 0) {
        Logger::logError("SDL initialization failed: " + std::string(SDL_GetError()));
        return false;
    }

    const char* orientationFromEnv = std::getenv("KIOSK_ORIENTATION_FILE");
    if (orientationFromEnv && orientationFromEnv[0] != '\0') {
        orientationFilePath = orientationFromEnv;
    }

    scrollingTextBar.setTextFilePath(resolveScrollingTextFilePath());
    scrollingTextBar.setEnabled(true);

    configureBackendReporter();

    bool loaded = loadPlaybackSources(sourcePath);
    if (!loaded && backendReporter.isEnabled()) {
        std::string playlistContent;
        std::string playlistRevision;
        if (backendReporter.fetchDevicePlaylist(&playlistContent, &playlistRevision)) {
            loaded = loadPlaybackSourcesFromPlaylistContent(
                playlistContent,
                std::filesystem::path(backendRuntimePlaylistPath).parent_path()
            );
            if (loaded) {
                std::lock_guard<std::mutex> lock(backendSyncMutex);
                backendPlaylistRevision = playlistRevision;
                pendingBackendPlaylistContent.clear();
            }
        }
    }

    if (!loaded) {
        Logger::logError("No valid playback sources found");
        Logger::setErrorCallback(nullptr);
        stopBackendSync();
        backendReporter.stop();
        SDL_Quit();
        return false;
    }

    currentSourceIndex = 0;
    if (!initializePlaybackSource(playbackSources[currentSourceIndex])) {
        Logger::logError("Failed to initialize first playback source");
        Logger::setErrorCallback(nullptr);
        stopBackendSync();
        backendReporter.stop();
        SDL_Quit();
        return false;
    }

    if (!wsController.initialize("0.0.0.0", wsPort)) {
        Logger::logError("Failed to initialize WebSocket controller");
        decoder.stopDecoding();
        audioManager.stop();
        renderer.cleanup();
        Logger::setErrorCallback(nullptr);
        stopBackendSync();
        backendReporter.stop();
        SDL_Quit();
        return false;
    }

    wsThread = std::thread([this]() {
        wsController.start();
    });

    startOrientationWatcher();

    isRunning = true;
    return true;
}

void VideoPlayer::run() {
    while (isRunning) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_QUIT) {
                stop();
                return;
            }

            if (event.type == SDL_KEYDOWN && event.key.keysym.sym == SDLK_ESCAPE) {
                Logger::logInfo("ESC pressed, stopping playback...");
                stop();
                return;
            }
        }

        std::string backendSourceToApply;
        {
            std::lock_guard<std::mutex> lock(backendSyncMutex);
            if (pendingBackendReload) {
                pendingBackendReload = false;
                backendSourceToApply = pendingBackendPlaylistContent;
            }
        }

        if (!backendSourceToApply.empty()) {
            const std::vector<std::string> previousSources = playbackSources;
            const size_t previousSourceIndex = currentSourceIndex;

            if (!loadPlaybackSourcesFromPlaylistContent(
                    backendSourceToApply,
                    std::filesystem::path(backendRuntimePlaylistPath).parent_path()) ||
                playbackSources.empty()) {
                Logger::logError("Failed to parse backend playlist update from memory cache");
                playbackSources = previousSources;
                currentSourceIndex = previousSourceIndex;
            } else {
                currentSourceIndex = 0;
                if (!initializePlaybackSource(playbackSources[currentSourceIndex])) {
                    Logger::logError("Failed to apply backend playlist update, restoring previous source");
                    playbackSources = previousSources;

                    if (playbackSources.empty()) {
                        stop();
                        return;
                    }

                    currentSourceIndex = std::min(previousSourceIndex, playbackSources.size() - 1);
                    if (!initializePlaybackSource(playbackSources[currentSourceIndex])) {
                        Logger::logError("Failed to restore previous playback source after backend update");
                        stop();
                        return;
                    }
                } else {
                    Logger::logInfo("Applied backend playlist update");
                }
            }
        }

        if (shouldReset.exchange(false)) {
            if (!initializePlaybackSource(playbackSources[currentSourceIndex])) {
                Logger::logError("Reset failed, stopping player");
                stop();
                return;
            }
        }

        const int requested = requestedRotationDegrees.load();
        if (requested != appliedRotationDegrees) {
            renderer.setRotation(requested);
            scrollingTextBar.setRotationDegrees(requested);
            appliedRotationDegrees = requested;
            Logger::logInfo("Applied video rotation: " + std::to_string(requested));
        }

        if (!paused) {
            processFrame();
        } else {
            SDL_Delay(10);
        }
    }
}

void VideoPlayer::stop() {
    isRunning = false;
    shouldReset = false;

    stopOrientationWatcher();
    stopBackendSync();

    wsController.stop();
    if (wsThread.joinable()) {
        if (std::this_thread::get_id() == wsThread.get_id()) {
            wsThread.detach();
        } else {
            wsThread.join();
        }
    }

    if (preloadThread.joinable()) {
        preloadThread.join();
    }

    decoder.stopDecoding();
    clearImagePlaybackState();
    clearPreloadedSourceState();
    audioManager.stop();
    renderer.cleanup();

    Logger::setErrorCallback(nullptr);
    backendReporter.stop();

    if (SDL_WasInit(SDL_INIT_VIDEO | SDL_INIT_AUDIO) != 0) {
        SDL_Quit();
    }
}

void VideoPlayer::play() {
    paused = false;
}

void VideoPlayer::pause() {
    paused = true;
}

void VideoPlayer::reset() {
    shouldReset = true;
}

void VideoPlayer::setVolume(int vol) {
    volume = std::clamp(vol, 0, 100);
    if (audioManager.isInitialized()) {
        audioManager.setVolume(static_cast<float>(volume) / 100.0f);
    }
}

bool VideoPlayer::loadPlaybackSources(const std::string& sourcePath) {
    const std::string normalizedSourcePath = trim(sourcePath);
    if (normalizedSourcePath.empty()) {
        return false;
    }

    playbackSources.clear();

    if (hasM3uExtension(normalizedSourcePath)) {
        try {
            const auto currentWriteTime = std::filesystem::last_write_time(normalizedSourcePath);
            const auto cacheIt = playbackSourceCache.find(normalizedSourcePath);

            if (cacheIt != playbackSourceCache.end() && cacheIt->second.lastWriteTime == currentWriteTime) {
                playbackSources = cacheIt->second.sources;
            } else {
                playbackSources = parseM3u(normalizedSourcePath);
                if (!playbackSources.empty()) {
                    playbackSourceCache[normalizedSourcePath] = CachedPlaybackSources{currentWriteTime, playbackSources};
                }
            }
        } catch (const std::exception& error) {
            Logger::logError("Playlist cache lookup failed: " + std::string(error.what()));
            playbackSources = parseM3u(normalizedSourcePath);
        }

        if (playbackSources.empty()) {
            Logger::logError("Playlist is empty or unreadable: " + normalizedSourcePath);
            return false;
        }
        Logger::logInfo(
            "Loaded " + std::to_string(playbackSources.size()) + " media entries from playlist"
        );
        return true;
    }

    playbackSources.push_back(normalizedSourcePath);
    return true;
}

bool VideoPlayer::loadPlaybackSourcesFromPlaylistContent(
    const std::string& playlistContent,
    const std::filesystem::path& baseDir
) {
    playbackSources = parseM3uContent(playlistContent, baseDir);
    if (playbackSources.empty()) {
        Logger::logError("Playlist is empty or unreadable from memory cache");
        return false;
    }

    Logger::logInfo(
        "Loaded " + std::to_string(playbackSources.size()) + " media entries from cached playlist"
    );
    return true;
}

bool VideoPlayer::initializePlaybackSource(const std::string& sourcePath) {
    decoder.stopDecoding();
    audioManager.stop();
    clearImagePlaybackState();

    const bool imageSource = hasImageExtension(sourcePath);
    AVFrame* preloadedFrame = takePreloadedFrame(sourcePath);

    if (imageSource && preloadedFrame) {
        if (!renderer.initialize(preloadedFrame->width, preloadedFrame->height)) {
            Logger::logError("Failed to initialize renderer for preloaded image source");
            av_frame_free(&preloadedFrame);
            return false;
        }

        renderer.setRotation(requestedRotationDegrees.load());
        scrollingTextBar.setRotationDegrees(requestedRotationDegrees.load());
        appliedRotationDegrees = requestedRotationDegrees.load();

        cachedImageFrame = preloadedFrame;
        imagePlaybackActive = true;
        imageDisplayDeadline = std::chrono::steady_clock::now() +
            std::chrono::seconds(imageDisplayDurationSeconds);

        Logger::logInfo(
            "Displaying preloaded image: " + sourcePath +
            " (" + std::to_string(imageDisplayDurationSeconds) + "s)"
        );

        requestPreloadNextSource();
        return true;
    }

    if (!decoder.initialize(sourcePath)) {
        Logger::logError("Failed to initialize decoder for source: " + sourcePath);
        if (preloadedFrame) {
            av_frame_free(&preloadedFrame);
        }
        return false;
    }

    AVCodecContext* videoCodecContext = decoder.getCodecContext();
    if (!videoCodecContext) {
        Logger::logError("Decoder returned null codec context for source: " + sourcePath);
        return false;
    }

    if (videoCodecContext->width <= 0 || videoCodecContext->height <= 0) {
        Logger::logError(
            "Invalid video dimensions from decoder for source: " + sourcePath +
            " (" + std::to_string(videoCodecContext->width) + "x" +
            std::to_string(videoCodecContext->height) + ")"
        );
        return false;
    }

    if (!renderer.initialize(videoCodecContext->width, videoCodecContext->height)) {
        Logger::logError("Failed to initialize renderer");
        return false;
    }

    renderer.setRotation(requestedRotationDegrees.load());
    scrollingTextBar.setRotationDegrees(requestedRotationDegrees.load());
    appliedRotationDegrees = requestedRotationDegrees.load();

    if (!imageSource && decoder.getAudioStream()) {
        AVCodecContext* audioCodecContext = decoder.getAudioCodecContext();
        if (!audioCodecContext) {
            Logger::logError("Audio stream present but audio codec context is null");
        }

        decoder.setAudioManager(&audioManager);
        if (audioCodecContext && !audioManager.initialize(audioCodecContext, decoder.getAudioStream())) {
            Logger::logError("Audio initialization failed, continuing without audio");
        }
    }

    decoder.startDecoding();

    if (imageSource) {
        const int maxAttempts = std::max(1, preloadFrameWaitMs / 10);
        int attempts = 0;
        AVFrame* firstFrame = preloadedFrame;

        while (attempts < maxAttempts && !firstFrame) {
            firstFrame = decoder.getNextFrame();
            if (firstFrame) {
                break;
            }

            if (decoder.hasReachedEndOfStream()) {
                break;
            }

            ++attempts;
            SDL_Delay(10);
        }

        decoder.stopDecoding();

        if (!firstFrame) {
            Logger::logError("Failed to decode image frame for source: " + sourcePath);
            return false;
        }

        cachedImageFrame = firstFrame;
        imagePlaybackActive = true;
        imageDisplayDeadline = std::chrono::steady_clock::now() +
            std::chrono::seconds(imageDisplayDurationSeconds);

        Logger::logInfo(
            "Displaying image: " + sourcePath +
            " (" + std::to_string(imageDisplayDurationSeconds) + "s)"
        );
        requestPreloadNextSource();
        return true;
    }

    if (preloadedFrame) {
        renderer.renderFrame(preloadedFrame);
        scrollingTextBar.render(renderer.getSDLRenderer(), renderer.getFrameWidth(), renderer.getFrameHeight());
        renderer.present();
        av_frame_free(&preloadedFrame);
    }

    Logger::logInfo("Now playing: " + sourcePath);
    requestPreloadNextSource();
    return true;
}

bool VideoPlayer::advancePlaybackSource() {
    if (playbackSources.empty()) {
        return false;
    }

    currentSourceIndex = (currentSourceIndex + 1) % playbackSources.size();
    return initializePlaybackSource(playbackSources[currentSourceIndex]);
}

void VideoPlayer::processFrame() {
    if (imagePlaybackActive && cachedImageFrame) {
        renderer.renderFrame(cachedImageFrame);
        scrollingTextBar.render(renderer.getSDLRenderer(), renderer.getFrameWidth(), renderer.getFrameHeight());
        renderer.present();

        if (std::chrono::steady_clock::now() >= imageDisplayDeadline) {
            if (!advancePlaybackSource()) {
                Logger::logError("Playback source switch failed, stopping player");
                stop();
            }
            return;
        }

        SDL_Delay(16);
        return;
    }

    AVFrame* frame = decoder.getNextFrame();
    if (frame) {
        renderer.renderFrame(frame);
        scrollingTextBar.render(renderer.getSDLRenderer(), renderer.getFrameWidth(), renderer.getFrameHeight());
        renderer.present();
        if (lastValidFrame) {
            av_frame_free(&lastValidFrame);
        }
        lastValidFrame = av_frame_clone(frame);
        av_frame_free(&frame);
        return;
    }

    if (decoder.hasReachedEndOfStream()) {
        if (!advancePlaybackSource()) {
            Logger::logError("Playback source switch failed, stopping player");
            stop();
        }
        return;
    }

    // Jestli decoder nie ma klatki, ale mamy preloaded klatki, render je
    AVFrame* preloadedFrame = takePreloadedFrame(playbackSources[currentSourceIndex]);
    if (preloadedFrame) {
        renderer.renderFrame(preloadedFrame);
        scrollingTextBar.render(renderer.getSDLRenderer(), renderer.getFrameWidth(), renderer.getFrameHeight());
        renderer.present();
        if (lastValidFrame) {
            av_frame_free(&lastValidFrame);
        }
        lastValidFrame = av_frame_clone(preloadedFrame);
        av_frame_free(&preloadedFrame);
        return;
    }

    // Ostateczność: render ostatnią ważną klatkę
    if (lastValidFrame) {
        renderer.renderFrame(lastValidFrame);
        scrollingTextBar.render(renderer.getSDLRenderer(), renderer.getFrameWidth(), renderer.getFrameHeight());
        renderer.present();
        return;
    }

    SDL_Delay(1);
}

void VideoPlayer::clearImagePlaybackState() {
    imagePlaybackActive = false;
    imageDisplayDeadline = std::chrono::steady_clock::time_point::min();

    if (cachedImageFrame) {
        av_frame_free(&cachedImageFrame);
        cachedImageFrame = nullptr;
    }
}

void VideoPlayer::clearPreloadedSourceState() {
    std::lock_guard<std::mutex> lock(preloadMutex);
    preloadedSourcePath.clear();
    preloadedSourceIndex = 0;

    for (AVFrame* frame : preloadedFrameQueue) {
        av_frame_free(&frame);
    }
    preloadedFrameQueue.clear();
}

AVFrame* VideoPlayer::takePreloadedFrame(const std::string& sourcePath) {
    std::lock_guard<std::mutex> lock(preloadMutex);

    if (preloadedSourcePath != sourcePath || preloadedFrameQueue.empty()) {
        return nullptr;
    }

    AVFrame* frame = preloadedFrameQueue.front();
    preloadedFrameQueue.erase(preloadedFrameQueue.begin());
    return frame;
}

bool VideoPlayer::hasPreloadedFrames(const std::string& sourcePath) const {
    std::lock_guard<std::mutex> lock(preloadMutex);
    return preloadedSourcePath == sourcePath && !preloadedFrameQueue.empty();
}

void VideoPlayer::requestPreloadNextSource() {
    if (playbackSources.size() < 2) {
        return;
    }

    if (preloadRunning.load()) {
        return;
    }

    if (preloadThread.joinable()) {
        preloadThread.join();
    }

    const size_t nextIndex = (currentSourceIndex + 1) % playbackSources.size();
    const std::string nextSource = playbackSources[nextIndex];

    {
        std::lock_guard<std::mutex> lock(preloadMutex);
        if (preloadedSourcePath == nextSource && !preloadedFrameQueue.empty()) {
            return;
        }
    }

    preloadRunning = true;
    preloadThread = std::thread([this, nextIndex, nextSource]() {
        std::vector<AVFrame*> framesToStore;

        VideoDecoder preloadDecoder;
        if (!preloadDecoder.initialize(nextSource)) {
            preloadRunning = false;
            return;
        }

        preloadDecoder.startDecoding();
        const int maxAttempts = std::max(1, preloadFrameWaitMs / 10);
        constexpr int targetFrameCount = 10;  // Preload 10 frames

        for (int attempt = 0; attempt < maxAttempts && framesToStore.size() < targetFrameCount; ++attempt) {
            AVFrame* frame = preloadDecoder.getNextFrame();
            if (frame) {
                AVFrame* frameCopy = av_frame_clone(frame);
                if (frameCopy) {
                    framesToStore.push_back(frameCopy);
                }
                av_frame_free(&frame);
            }

            if (preloadDecoder.hasReachedEndOfStream()) {
                break;
            }

            SDL_Delay(10);
        }

        preloadDecoder.stopDecoding();

        if (framesToStore.empty()) {
            preloadRunning = false;
            return;
        }

        {
            std::lock_guard<std::mutex> lock(preloadMutex);
            for (AVFrame* frame : preloadedFrameQueue) {
                av_frame_free(&frame);
            }
            preloadedFrameQueue = framesToStore;
            preloadedSourceIndex = nextIndex;
            preloadedSourcePath = nextSource;
        }

        Logger::logInfo("Preloaded " + std::to_string(framesToStore.size()) + " frames from next source: " + nextSource);
        preloadRunning = false;
    });
}

void VideoPlayer::configureBackendReporter() {
    const char* backendBase = std::getenv("KIOSK_BACKEND_URL");
    if (!backendBase || backendBase[0] == '\0') {
        backendBase = std::getenv("BACKEND_BASE_URL");
    }

    if (!backendBase || backendBase[0] == '\0') {
        Logger::logInfo("Backend reporting disabled (BACKEND_BASE_URL / KIOSK_BACKEND_URL missing)");
        return;
    }

    const char* runtimePlaylistPath = std::getenv("KIOSK_RUNTIME_PLAYLIST_FILE");
    if (runtimePlaylistPath && runtimePlaylistPath[0] != '\0') {
        backendRuntimePlaylistPath = runtimePlaylistPath;
    }

    backendSyncIntervalSeconds = parseIntEnv("KIOSK_BACKEND_SYNC_SECONDS", 10, 5, 300);

    BackendReporterConfig config;
    config.backendBaseUrl = backendBase;
    config.serialNumber = detectSerialNumber();
    config.heartbeatIntervalSeconds = parseIntEnv("KIOSK_HEARTBEAT_SECONDS", 60, 10, 3600);

    const char* source = std::getenv("KIOSK_ERROR_SOURCE");
    if (source && source[0] != '\0') {
        config.source = source;
    }

    if (config.serialNumber.empty()) {
        Logger::logError("Backend reporting disabled: serial number not available");
        return;
    }

    if (!backendReporter.configure(config)) {
        Logger::logError("Backend reporting disabled: invalid reporter configuration");
        return;
    }

    backendReporter.start();
    backendReporter.reportIpNow();

    Logger::setErrorCallback([this](const std::string& message) {
        backendReporter.enqueueError(message);
    });

    std::string orientation;
    if (backendReporter.fetchDeviceOrientation(&orientation)) {
        const int degrees = orientationToDegrees(orientation);
        if (degrees >= 0) {
            requestedRotationDegrees = degrees;
            writeTextFile(orientationFilePath, toLower(trim(orientation)));
        }
    }

    startBackendSync();

    Logger::logInfo("Backend reporting enabled for device serial: " + config.serialNumber);
}

void VideoPlayer::startBackendSync() {
    if (!backendReporter.isEnabled() || backendSyncRunning.exchange(true)) {
        return;
    }

    backendSyncThread = std::thread(&VideoPlayer::backendSyncLoop, this);
}

void VideoPlayer::stopBackendSync() {
    backendSyncRunning = false;

    if (backendSyncThread.joinable()) {
        if (std::this_thread::get_id() == backendSyncThread.get_id()) {
            backendSyncThread.detach();
        } else {
            backendSyncThread.join();
        }
    }

    std::lock_guard<std::mutex> lock(backendSyncMutex);
    pendingBackendReload = false;
    pendingBackendPlaylistContent.clear();
}

void VideoPlayer::backendSyncLoop() {
    int lastBackendOrientation = -1;

    while (backendSyncRunning.load()) {
        std::string orientation;
        if (backendReporter.fetchDeviceOrientation(&orientation)) {
            const int degrees = orientationToDegrees(orientation);
            if (degrees >= 0 && degrees != lastBackendOrientation) {
                requestedRotationDegrees = degrees;
                lastBackendOrientation = degrees;
                writeTextFile(orientationFilePath, toLower(trim(orientation)));
                Logger::logInfo("Orientation update from backend: " + orientation);
            }
        }

        std::string playlistContent;
        std::string playlistRevision;
        if (backendReporter.fetchDevicePlaylist(&playlistContent, &playlistRevision) &&
            !playlistContent.empty()) {
            const std::string nextRevision =
                playlistRevision.empty() ? playlistContent : playlistRevision;

            bool shouldApply = false;
            {
                std::lock_guard<std::mutex> lock(backendSyncMutex);
                shouldApply = nextRevision != backendPlaylistRevision;
            }

            if (shouldApply) {
                if (!parseM3uContent(
                        playlistContent,
                        std::filesystem::path(backendRuntimePlaylistPath).parent_path()).empty()) {
                    std::lock_guard<std::mutex> lock(backendSyncMutex);
                    backendPlaylistRevision = nextRevision;
                    pendingBackendPlaylistContent = playlistContent;
                    pendingBackendReload = true;
                } else {
                    Logger::logError("Backend playlist update was empty or unreadable");
                }
            }
        }

        for (int i = 0; i < backendSyncIntervalSeconds; ++i) {
            if (!backendSyncRunning.load()) {
                break;
            }
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
    }
}

void VideoPlayer::startOrientationWatcher() {
    if (orientationWatcherRunning.exchange(true)) {
        return;
    }

    orientationThread = std::thread(&VideoPlayer::orientationWatcherLoop, this);
}

void VideoPlayer::stopOrientationWatcher() {
    orientationWatcherRunning = false;

    if (orientationThread.joinable()) {
        orientationThread.join();
    }
}

void VideoPlayer::orientationWatcherLoop() {
    std::string lastSeenValue;

    while (orientationWatcherRunning.load()) {
        std::ifstream orientationFile(orientationFilePath);
        if (orientationFile.is_open()) {
            std::string value;
            std::getline(orientationFile, value);

            const std::string normalized = toLower(trim(value));
            if (!normalized.empty() && normalized != lastSeenValue) {
                const int degrees = orientationToDegrees(normalized);
                if (degrees >= 0) {
                    requestedRotationDegrees = degrees;
                    Logger::logInfo(
                        "Orientation update from " + orientationFilePath + ": " + normalized
                    );
                } else {
                    Logger::logError(
                        "Unsupported orientation value in " + orientationFilePath + ": " + normalized
                    );
                }

                lastSeenValue = normalized;
            }
        }

        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
}
