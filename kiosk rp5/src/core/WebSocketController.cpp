#include "WebSocketController.h"

#include "../VideoPlayer.h"
#include "../utils/Logger.h"

#include <algorithm>
#include <cstdlib>
#include <random>
#include <sstream>

WebSocketController::WebSocketController(VideoPlayer* p)
    : player(p)
    , isRunning(false) {
    const char* configuredToken = std::getenv("KIOSK_WS_TOKEN");
    if (configuredToken && configuredToken[0] != '\0') {
        authToken = configuredToken;
        Logger::logInfo("WebSocket auth token loaded from KIOSK_WS_TOKEN");
    } else {
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_int_distribution<int> dis(0, 15);

        std::ostringstream tokenStream;
        for (int i = 0; i < 32; ++i) {
            tokenStream << std::hex << dis(gen);
        }
        authToken = tokenStream.str();
        Logger::logInfo("WebSocket auth token generated");
    }

    Logger::logInfo("WebSocket token: " + authToken);
}

bool WebSocketController::initialize(const std::string& address, uint16_t port) {
    (void)address;

    try {
        server.clear_access_channels(websocketpp::log::alevel::all);
        server.set_access_channels(websocketpp::log::alevel::none);
        server.init_asio();

        server.set_open_handler(std::bind(&WebSocketController::onOpen, this, std::placeholders::_1));
        server.set_close_handler(std::bind(&WebSocketController::onClose, this, std::placeholders::_1));
        server.set_message_handler(
            std::bind(
                &WebSocketController::onMessage,
                this,
                std::placeholders::_1,
                std::placeholders::_2
            )
        );

        server.listen(port);
        Logger::logInfo("WebSocket server listening on port " + std::to_string(port));
        return true;
    } catch (const std::exception& exception) {
        Logger::logError("WebSocket initialization failed: " + std::string(exception.what()));
        return false;
    }
}

void WebSocketController::start() {
    if (isRunning.exchange(true)) {
        return;
    }

    try {
        server.start_accept();
        server.run();
    } catch (const std::exception& exception) {
        Logger::logError("WebSocket runtime error: " + std::string(exception.what()));
    }

    isRunning = false;
}

void WebSocketController::stop() {
    if (!isRunning.exchange(false)) {
        return;
    }

    websocketpp::lib::error_code error;
    server.stop_listening(error);
    server.stop();

    std::lock_guard<std::mutex> lock(connectionMutex);
    connections.clear();
}

void WebSocketController::onOpen(ConnectionHdl hdl) {
    auto connection = hdl.lock();
    if (!connection) {
        return;
    }

    std::lock_guard<std::mutex> lock(connectionMutex);
    connections[connection.get()] = true;
    Logger::logInfo("WebSocket connection opened");
}

void WebSocketController::onClose(ConnectionHdl hdl) {
    auto connection = hdl.lock();
    if (!connection) {
        return;
    }

    std::lock_guard<std::mutex> lock(connectionMutex);
    connections.erase(connection.get());
    Logger::logInfo("WebSocket connection closed");
}

void WebSocketController::onMessage(ConnectionHdl hdl, MessagePtr msg) {
    try {
        Json::CharReaderBuilder builder;
        Json::Value root;
        std::string parseErrors;

        std::istringstream payloadStream(msg->get_payload());
        if (!Json::parseFromStream(builder, payloadStream, &root, &parseErrors)) {
            Logger::logError("Failed to parse WebSocket message: " + parseErrors);
            return;
        }

        if (!root.isMember("token") || !validateAuth(root["token"].asString())) {
            Logger::logError("Invalid WebSocket authentication");
            server.close(
                hdl,
                websocketpp::close::status::policy_violation,
                "Invalid authentication"
            );
            return;
        }

        if (!root.isMember("command")) {
            Logger::logError("WebSocket message missing command field");
            return;
        }

        const std::string command = root["command"].asString();
        Logger::logInfo("Received command: " + command);

        if (command == "play") {
            handlePlayCommand();
        } else if (command == "pause") {
            handlePauseCommand();
        } else if (command == "stop") {
            handleStopCommand();
        } else if (command == "reset") {
            handleResetCommand();
        } else if (command == "volume" && root.isMember("value")) {
            const int volume = std::clamp(root["value"].asInt(), 0, 100);
            handleVolumeCommand(volume);
        } else if (command == "status") {
            Json::Value response;
            response["paused"] = player->isPaused();
            response["running"] = true;

            Json::StreamWriterBuilder writer;
            server.send(hdl, Json::writeString(writer, response), websocketpp::frame::opcode::text);
        } else {
            Logger::logError("Unsupported command: " + command);
        }
    } catch (const std::exception& exception) {
        Logger::logError("WebSocket message handling error: " + std::string(exception.what()));
    }
}

void WebSocketController::handlePlayCommand() {
    player->play();
}

void WebSocketController::handlePauseCommand() {
    player->pause();
}

void WebSocketController::handleStopCommand() {
    player->stop();
}

void WebSocketController::handleResetCommand() {
    player->reset();
}

void WebSocketController::handleVolumeCommand(int volume) {
    player->setVolume(volume);
}

bool WebSocketController::validateAuth(const std::string& token) {
    return token == authToken;
}
