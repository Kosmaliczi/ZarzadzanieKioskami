#include "VideoPlayer.h"

#include <cstdlib>
#include <exception>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

namespace {
std::string resolveSourcePath(int argc, char* argv[]) {
    if (argc >= 2 && argv[1] && argv[1][0] != '\0') {
        return argv[1];
    }

    const char* envSource = std::getenv("KIOSK_PLAYBACK_SOURCE");
    if (envSource && envSource[0] != '\0') {
        return envSource;
    }

    const std::vector<std::string> defaultSources = {
        "/storage/videos/kiosk_playlist.m3u",
        "/storage/videos/playlist.m3u",
        "/home/kiosk/MediaPionowe/kiosk_playlist.m3u"
    };

    for (const std::string& path : defaultSources) {
        if (std::filesystem::exists(path)) {
            return path;
        }
    }

    return {};
}

uint16_t resolveWebSocketPort() {
    const char* rawPort = std::getenv("KIOSK_WS_PORT");
    if (!rawPort || rawPort[0] == '\0') {
        return 9002;
    }

    try {
        const int port = std::stoi(rawPort);
        if (port > 0 && port <= 65535) {
            return static_cast<uint16_t>(port);
        }
    } catch (const std::exception&) {
    }

    return 9002;
}
} // namespace

int main(int argc, char* argv[]) {
    const std::string sourcePath = resolveSourcePath(argc, argv);

    const char* backendBase = std::getenv("KIOSK_BACKEND_URL");
    if (!backendBase || backendBase[0] == '\0') {
        backendBase = std::getenv("BACKEND_BASE_URL");
    }

    if (sourcePath.empty() && (!backendBase || backendBase[0] == '\0')) {
        std::cerr
            << "Usage: " << argv[0] << " <video_or_playlist_path>\n"
            << "Or set KIOSK_PLAYBACK_SOURCE environment variable.\n"
            << "If you want backend-only bootstrap, set KIOSK_BACKEND_URL or BACKEND_BASE_URL."
            << std::endl;
        return 1;
    }

    if (sourcePath.empty()) {
        std::cout << "No local playback source found, waiting for backend playlist bootstrap..." << std::endl;
    }

    VideoPlayer player;
    if (!player.initialize(sourcePath, resolveWebSocketPort())) {
        return 1;
    }

    player.run();
    return 0;
}
