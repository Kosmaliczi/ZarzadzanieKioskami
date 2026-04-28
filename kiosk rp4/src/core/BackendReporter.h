#pragma once

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <queue>
#include <string>
#include <thread>

struct BackendReporterConfig {
    std::string backendBaseUrl;
    std::string serialNumber;
    std::string source = "video_player";
    int heartbeatIntervalSeconds = 60;
};

class BackendReporter {
public:
    BackendReporter();
    ~BackendReporter();

    bool configure(const BackendReporterConfig& config);
    bool isEnabled() const;

    void start();
    void stop();

    void reportIpNow();
    void enqueueError(
        const std::string& message,
        const std::string& level = "error",
        const std::string& detailsJson = "{}"
    );

    bool fetchDeviceOrientation(std::string* orientationOut) const;
    bool fetchDevicePlaylist(std::string* playlistContentOut, std::string* revisionOut = nullptr) const;

private:
    struct ErrorEvent {
        std::string level;
        std::string message;
        std::string detailsJson;
    };

    void workerLoop();
    bool reportIp() const;
    bool reportError(const ErrorEvent& event) const;
    bool postJson(const std::string& endpointPath, const std::string& payload) const;
    bool getJson(const std::string& endpointPath, std::string* responseBodyOut) const;

    static std::string escapeJson(const std::string& value);
    static std::string trimTrailingSlash(const std::string& value);

    BackendReporterConfig config;
    std::atomic<bool> enabled;
    std::atomic<bool> running;

    std::thread workerThread;
    mutable std::mutex queueMutex;
    std::condition_variable queueCondition;
    std::queue<ErrorEvent> errorQueue;
};