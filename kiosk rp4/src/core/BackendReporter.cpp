#include "BackendReporter.h"

#include <curl/curl.h>
#include <json/json.h>

#include <chrono>
#include <iostream>
#include <memory>
#include <utility>

namespace {
size_t discardResponse(char* ptr, size_t size, size_t nmemb, void* userdata) {
    (void)ptr;
    (void)userdata;
    return size * nmemb;
}

size_t appendResponse(char* ptr, size_t size, size_t nmemb, void* userdata) {
    if (!userdata) {
        return 0;
    }

    const size_t bytes = size * nmemb;
    auto* response = static_cast<std::string*>(userdata);
    response->append(ptr, bytes);
    return bytes;
}
}

BackendReporter::BackendReporter()
    : enabled(false)
    , running(false) {
    curl_global_init(CURL_GLOBAL_DEFAULT);
}

BackendReporter::~BackendReporter() {
    stop();
    curl_global_cleanup();
}

bool BackendReporter::configure(const BackendReporterConfig& inputConfig) {
    const std::string baseUrl = trimTrailingSlash(inputConfig.backendBaseUrl);
    if (baseUrl.empty() || inputConfig.serialNumber.empty()) {
        enabled = false;
        return false;
    }

    config = inputConfig;
    config.backendBaseUrl = baseUrl;
    if (config.heartbeatIntervalSeconds < 10) {
        config.heartbeatIntervalSeconds = 10;
    }

    enabled = true;
    return true;
}

bool BackendReporter::isEnabled() const {
    return enabled.load();
}

void BackendReporter::start() {
    if (!enabled.load() || running.load()) {
        return;
    }

    running = true;
    workerThread = std::thread(&BackendReporter::workerLoop, this);
}

void BackendReporter::stop() {
    running = false;
    queueCondition.notify_all();

    if (workerThread.joinable()) {
        workerThread.join();
    }

    std::lock_guard<std::mutex> lock(queueMutex);
    while (!errorQueue.empty()) {
        errorQueue.pop();
    }
}

void BackendReporter::reportIpNow() {
    if (!enabled.load()) {
        return;
    }
    reportIp();
}

void BackendReporter::enqueueError(
    const std::string& message,
    const std::string& level,
    const std::string& detailsJson
) {
    if (!enabled.load()) {
        return;
    }

    std::lock_guard<std::mutex> lock(queueMutex);
    errorQueue.push({level, message, detailsJson.empty() ? "{}" : detailsJson});
    queueCondition.notify_one();
}

bool BackendReporter::fetchDeviceOrientation(std::string* orientationOut) const {
    if (!enabled.load() || !orientationOut) {
        return false;
    }

    std::string responseBody;
    if (!getJson("/api/device/" + config.serialNumber + "/orientation", &responseBody)) {
        return false;
    }

    Json::Value root;
    Json::CharReaderBuilder builder;
    std::string errors;
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
    const char* begin = responseBody.data();
    const char* end = begin + responseBody.size();

    if (!reader->parse(begin, end, &root, &errors) || !root.isObject()) {
        std::cerr << "[ERROR] BackendReporter orientation parse failed: " << errors << std::endl;
        return false;
    }

    if (!root["orientation"].isString()) {
        return false;
    }

    *orientationOut = root["orientation"].asString();
    return !orientationOut->empty();
}

bool BackendReporter::fetchDevicePlaylist(
    std::string* playlistContentOut,
    std::string* revisionOut
) const {
    if (!enabled.load() || !playlistContentOut) {
        return false;
    }

    std::string responseBody;
    if (!getJson("/api/device/" + config.serialNumber + "/playlist", &responseBody)) {
        return false;
    }

    Json::Value root;
    Json::CharReaderBuilder builder;
    std::string errors;
    std::unique_ptr<Json::CharReader> reader(builder.newCharReader());
    const char* begin = responseBody.data();
    const char* end = begin + responseBody.size();

    if (!reader->parse(begin, end, &root, &errors) || !root.isObject()) {
        std::cerr << "[ERROR] BackendReporter playlist parse failed: " << errors << std::endl;
        return false;
    }

    const Json::Value playlist = root["playlist"];
    if (!playlist.isObject() || !playlist["content"].isString()) {
        return false;
    }

    *playlistContentOut = playlist["content"].asString();
    if (revisionOut) {
        if (playlist["hash"].isString()) {
            *revisionOut = playlist["hash"].asString();
        } else if (playlist["updated_at"].isString()) {
            *revisionOut = playlist["updated_at"].asString();
        } else {
            revisionOut->clear();
        }
    }

    return !playlistContentOut->empty();
}

void BackendReporter::workerLoop() {
    auto nextHeartbeat = std::chrono::steady_clock::now();

    while (running.load()) {
        const auto now = std::chrono::steady_clock::now();
        if (now >= nextHeartbeat) {
            reportIp();
            nextHeartbeat = now + std::chrono::seconds(config.heartbeatIntervalSeconds);
        }

        ErrorEvent event;
        bool hasEvent = false;

        {
            std::unique_lock<std::mutex> lock(queueMutex);
            if (errorQueue.empty()) {
                queueCondition.wait_for(lock, std::chrono::seconds(1), [this]() {
                    return !running.load() || !errorQueue.empty();
                });
            }

            if (!errorQueue.empty()) {
                event = std::move(errorQueue.front());
                errorQueue.pop();
                hasEvent = true;
            }
        }

        if (hasEvent) {
            reportError(event);
        }
    }

    for (;;) {
        ErrorEvent event;
        {
            std::lock_guard<std::mutex> lock(queueMutex);
            if (errorQueue.empty()) {
                break;
            }
            event = std::move(errorQueue.front());
            errorQueue.pop();
        }

        reportError(event);
    }
}

bool BackendReporter::reportIp() const {
    const std::string endpoint = "/api/device/" + config.serialNumber + "/ip";
    const std::string payload = "{\"source\":\"" + escapeJson(config.source) + "\"}";
    return postJson(endpoint, payload);
}

bool BackendReporter::reportError(const ErrorEvent& event) const {
    const std::string endpoint = "/api/device/" + config.serialNumber + "/error-log";
    const std::string payload =
        "{"
        "\"level\":\"" + escapeJson(event.level) + "\"," 
        "\"source\":\"" + escapeJson(config.source) + "\"," 
        "\"message\":\"" + escapeJson(event.message) + "\"," 
        "\"details\":" + (event.detailsJson.empty() ? "{}" : event.detailsJson) +
        "}";

    return postJson(endpoint, payload);
}

bool BackendReporter::postJson(const std::string& endpointPath, const std::string& payload) const {
    CURL* curl = curl_easy_init();
    if (!curl) {
        std::cerr << "[ERROR] Failed to initialize CURL" << std::endl;
        return false;
    }

    const std::string url = config.backendBaseUrl + endpointPath;

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(payload.size()));
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 3L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, discardResponse);

    const CURLcode result = curl_easy_perform(curl);
    long statusCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &statusCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (result != CURLE_OK) {
        std::cerr << "[ERROR] BackendReporter request failed: " << curl_easy_strerror(result)
                  << " (" << url << ")" << std::endl;
        return false;
    }

    if (statusCode < 200 || statusCode >= 300) {
        std::cerr << "[ERROR] BackendReporter request returned HTTP " << statusCode
                  << " (" << url << ")" << std::endl;
        return false;
    }

    return true;
}

bool BackendReporter::getJson(const std::string& endpointPath, std::string* responseBodyOut) const {
    if (!responseBodyOut) {
        return false;
    }

    responseBodyOut->clear();

    CURL* curl = curl_easy_init();
    if (!curl) {
        std::cerr << "[ERROR] Failed to initialize CURL" << std::endl;
        return false;
    }

    const std::string url = config.backendBaseUrl + endpointPath;

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Accept: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 3L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, appendResponse);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, responseBodyOut);

    const CURLcode result = curl_easy_perform(curl);
    long statusCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &statusCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (result != CURLE_OK) {
        std::cerr << "[ERROR] BackendReporter request failed: " << curl_easy_strerror(result)
                  << " (" << url << ")" << std::endl;
        return false;
    }

    if (statusCode < 200 || statusCode >= 300) {
        std::cerr << "[ERROR] BackendReporter request returned HTTP " << statusCode
                  << " (" << url << ")" << std::endl;
        return false;
    }

    return true;
}

std::string BackendReporter::escapeJson(const std::string& value) {
    std::string escaped;
    escaped.reserve(value.size());

    for (const char ch : value) {
        switch (ch) {
        case '\\':
            escaped += "\\\\";
            break;
        case '"':
            escaped += "\\\"";
            break;
        case '\n':
            escaped += "\\n";
            break;
        case '\r':
            escaped += "\\r";
            break;
        case '\t':
            escaped += "\\t";
            break;
        default:
            escaped += ch;
            break;
        }
    }

    return escaped;
}

std::string BackendReporter::trimTrailingSlash(const std::string& value) {
    if (value.empty()) {
        return value;
    }

    size_t endPos = value.size();
    while (endPos > 0 && value[endPos - 1] == '/') {
        --endPos;
    }

    return value.substr(0, endPos);
}