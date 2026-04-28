#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_error() {
    if [ $? -ne 0 ]; then
        echo -e "${RED}Error: $1${NC}"
        exit 1
    fi
}

echo -e "${YELLOW}Updating package list...${NC}"
sudo apt-get update
check_error "Failed to update package list"

echo -e "${YELLOW}Installing development tools...${NC}"
sudo apt-get install -y \
    build-essential \
    cmake \
    git \
    pkg-config \
    libboost-all-dev
check_error "Failed to install development tools"

echo -e "${YELLOW}Installing FFmpeg dependencies...${NC}"
sudo apt-get install -y \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libswscale-dev \
    libswresample-dev
check_error "Failed to install FFmpeg dependencies"

echo -e "${YELLOW}Installing SDL2...${NC}"
sudo apt-get install -y \
    libsdl2-2.0-0 \
    libsdl2-dev
check_error "Failed to install SDL2"

echo -e "${YELLOW}Installing networking and WebSocket dependencies...${NC}"
sudo apt-get install -y \
    libwebsocketpp-dev \
    libjsoncpp-dev \
    libssl-dev \
    zlib1g-dev \
    libcurl4-openssl-dev
check_error "Failed to install networking dependencies"

echo -e "${YELLOW}Installing V4L2 for hardware acceleration...${NC}"
sudo apt-get install -y \
    libv4l-dev
check_error "Failed to install V4L2 dependencies"

echo -e "${YELLOW}Configuring Raspberry Pi performance profile...${NC}"
if ! grep -q "gpu_mem=256" /boot/config.txt; then
    echo "gpu_mem=256" | sudo tee -a /boot/config.txt >/dev/null
fi

if ! grep -q "force_turbo=1" /boot/config.txt; then
    echo "force_turbo=1" | sudo tee -a /boot/config.txt >/dev/null
fi

echo -e "${GREEN}Dependency installation complete.${NC}"
echo -e "${YELLOW}Build steps:${NC}"
echo "1. mkdir build"
echo "2. cd build"
echo "3. cmake .."
echo "4. make -j4"
