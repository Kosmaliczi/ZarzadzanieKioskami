#pragma once

#include "core/AudioManager.h"
#include "core/BackendReporter.h"
#include "core/Renderer.h"
#include "core/VideoDecoder.h"
#include "core/WebSocketController.h"
#include "utils/ScrollingTextBar.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

class VideoPlayer {
public:
    VideoPlayer();
    ~VideoPlayer();

    bool initialize(const std::string& sourcePath, uint16_t wsPort = 9002);
    void run();
    void stop();
    void play();
    void pause();
    void reset();
    void setVolume(int volume);
    bool isPaused() const { return paused; }

private:
    bool loadPlaybackSources(const std::string& sourcePath);
    bool loadPlaybackSourcesFromPlaylistContent(
        const std::string& playlistContent,
        const std::filesystem::path& baseDir
    );
    bool initializePlaybackSource(const std::string& sourcePath);
    bool advancePlaybackSource();
    void clearImagePlaybackState();
    void clearPreloadedSourceState();
    void requestPreloadNextSource();
    AVFrame* takePreloadedFrame(const std::string& sourcePath);
    bool hasPreloadedFrames(const std::string& sourcePath) const;

    void processFrame();

    void configureBackendReporter();
    void startBackendSync();
    void stopBackendSync();
    void backendSyncLoop();

    void startOrientationWatcher();
    void stopOrientationWatcher();
    void orientationWatcherLoop();

    AudioManager audioManager;
    VideoDecoder decoder;
    Renderer renderer;
    ScrollingTextBar scrollingTextBar;
    WebSocketController wsController;
    BackendReporter backendReporter;

    bool isRunning;
    bool paused;
    int volume;

    std::atomic<bool> shouldReset;

    std::thread wsThread;
    std::thread orientationThread;
    std::thread backendSyncThread;
    std::thread preloadThread;
    std::atomic<bool> orientationWatcherRunning;
    std::atomic<bool> backendSyncRunning;
    std::atomic<bool> preloadRunning;

    std::mutex backendSyncMutex;
    bool pendingBackendReload;
    std::string pendingBackendPlaylistContent;
    std::string backendPlaylistRevision;

    std::atomic<int> requestedRotationDegrees;
    int appliedRotationDegrees;

    std::vector<std::string> playbackSources;
    size_t currentSourceIndex;

    mutable std::mutex preloadMutex;
    size_t preloadedSourceIndex;
    std::string preloadedSourcePath;
    std::vector<AVFrame*> preloadedFrameQueue;
    AVFrame* lastValidFrame;

    bool imagePlaybackActive;
    AVFrame* cachedImageFrame;
    std::chrono::steady_clock::time_point imageDisplayDeadline;
    int imageDisplayDurationSeconds;

    struct CachedPlaybackSources {
        std::filesystem::file_time_type lastWriteTime;
        std::vector<std::string> sources;
    };

    std::unordered_map<std::string, CachedPlaybackSources> playbackSourceCache;

    std::string orientationFilePath;
    std::string backendRuntimePlaylistPath;
    int backendSyncIntervalSeconds;
    int preloadFrameWaitMs;
};