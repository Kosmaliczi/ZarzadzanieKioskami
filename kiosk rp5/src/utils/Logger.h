#pragma once
#include <functional>
#include <string>

class Logger {
public:
    using ErrorCallback = std::function<void(const std::string&)>;

    static void logInfo(const std::string& message);
    static void logError(const std::string& message);
    static void logPerformance(const std::string& message);
    static void setErrorCallback(ErrorCallback callback);

private:
    static std::string currentTime();
}; 