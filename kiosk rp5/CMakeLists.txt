cmake_minimum_required(VERSION 3.10)
project(video_player)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm")
    add_compile_definitions(__arm__)
    add_compile_options(-mcpu=cortex-a76 -mtune=cortex-a76)
endif()

find_package(PkgConfig REQUIRED)
pkg_check_modules(FFMPEG REQUIRED IMPORTED_TARGET
    libavcodec
    libavformat
    libavutil
    libswscale
    libswresample
)

find_package(SDL2 REQUIRED)
find_package(Boost REQUIRED COMPONENTS system)
find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)
find_package(Threads REQUIRED)
pkg_check_modules(JSONCPP REQUIRED IMPORTED_TARGET jsoncpp)

find_path(WEBSOCKETPP_INCLUDE_DIR websocketpp/server.hpp
    PATHS /usr/include /usr/local/include
)

if(NOT WEBSOCKETPP_INCLUDE_DIR)
    message(FATAL_ERROR "websocketpp headers not found")
endif()

set(SOURCES
    src/main.cpp
    src/VideoPlayer.cpp
    src/core/AudioManager.cpp
    src/core/BackendReporter.cpp
    src/core/Renderer.cpp
    src/core/VideoDecoder.cpp
    src/core/WebSocketController.cpp
    src/utils/ScrollingTextBar.cpp
    src/utils/Logger.cpp
)

set(HEADERS
    src/VideoPlayer.h
    src/core/AudioManager.h
    src/core/BackendReporter.h
    src/core/Renderer.h
    src/core/VideoDecoder.h
    src/core/WebSocketController.h
    src/utils/ScrollingTextBar.h
    src/utils/Logger.h
)

add_executable(video_player ${SOURCES} ${HEADERS})

target_include_directories(video_player PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/src/core
    ${CMAKE_CURRENT_SOURCE_DIR}/src/utils
    ${SDL2_INCLUDE_DIRS}
    ${JSONCPP_INCLUDE_DIRS}
    ${WEBSOCKETPP_INCLUDE_DIR}
)

target_link_libraries(video_player PRIVATE
    ${SDL2_LIBRARIES}
    ${Boost_LIBRARIES}
    CURL::libcurl
    OpenSSL::SSL
    OpenSSL::Crypto
    PkgConfig::FFMPEG
    PkgConfig::JSONCPP
    Threads::Threads
)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm")
    target_compile_definitions(video_player PRIVATE RASPBERRY_PI)
endif()
