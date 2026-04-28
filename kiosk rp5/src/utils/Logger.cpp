#include "Logger.h"
#include <chrono>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <utility>

namespace {
std::mutex g_loggerMutex;
Logger::ErrorCallback g_errorCallback;
}

std::string Logger::currentTime() {
    const auto now = std::chrono::system_clock::now();
    const std::time_t rawTime = std::chrono::system_clock::to_time_t(now);

    std::tm timeInfo{};
#ifdef _WIN32
    localtime_s(&timeInfo, &rawTime);
#else
    localtime_r(&rawTime, &timeInfo);
#endif

    std::ostringstream stream;
    stream << std::put_time(&timeInfo, "%H:%M:%S");
    return stream.str();
}

void Logger::logInfo(const std::string& message) {
    std::lock_guard<std::mutex> lock(g_loggerMutex);
    std::cout << "[INFO " << currentTime() << "] " << message << std::endl;
}

void Logger::logError(const std::string& message) {
    ErrorCallback callbackCopy;

    {
        std::lock_guard<std::mutex> lock(g_loggerMutex);
        std::cerr << "[ERROR " << currentTime() << "] " << message << std::endl;
        callbackCopy = g_errorCallback;
    }

    if (callbackCopy) {
        callbackCopy(message);
    }
}

void Logger::logPerformance(const std::string& message) {
    std::lock_guard<std::mutex> lock(g_loggerMutex);
    std::cout << "[PERF " << currentTime() << "] " << message << std::endl;
}

void Logger::setErrorCallback(ErrorCallback callback) {
    std::lock_guard<std::mutex> lock(g_loggerMutex);
    g_errorCallback = std::move(callback);
} 