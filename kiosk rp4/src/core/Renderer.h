#pragma once
#include <SDL2/SDL.h>
#include <string>

extern "C" {
    #include <libavcodec/avcodec.h>
    #include <libswscale/swscale.h>
    #include <libavutil/pixfmt.h>
}

class Renderer {
public:
    Renderer();
    ~Renderer();

    bool initialize(int width, int height);
    void cleanup();
    void renderFrame(AVFrame* frame);
    void present() {
        if (renderer) {
            SDL_RenderPresent(renderer);
        }
    }
    void setRotation(int degrees);
    SDL_Renderer* getSDLRenderer() const { return renderer; }
    int getFrameWidth() const { return frameWidth; }
    int getFrameHeight() const { return frameHeight; }
    
private:
    SDL_Window* window;
    SDL_Renderer* renderer;
    SDL_Texture* texture;
    SwsContext* swsContext;
    int frameWidth;
    int frameHeight;
    int rotationDegrees;
    
    uint8_t* yPlane;
    uint8_t* uPlane;
    uint8_t* vPlane;
}; 