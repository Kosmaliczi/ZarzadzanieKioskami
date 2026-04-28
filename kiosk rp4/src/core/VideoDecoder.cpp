#include "VideoDecoder.h"

#include "AudioManager.h"
#include "../utils/Logger.h"

#include <chrono>
#include <thread>

VideoDecoder::VideoDecoder()
    : formatContext(nullptr)
    , codecContext(nullptr)
    , audioCodecContext(nullptr)
    , videoStreamIndex(-1)
    , audioStreamIndex(-1)
    , audioManager(nullptr)
    , isRunning(false)
    , endOfStream(false) {
}

VideoDecoder::~VideoDecoder() {
    stopDecoding();
}

bool VideoDecoder::initialize(const std::string& path) {
    stopDecoding();

    videoStreamIndex = -1;
    audioStreamIndex = -1;
    endOfStream = false;

    formatContext = avformat_alloc_context();
    if (!formatContext) {
        Logger::logError("Could not allocate format context");
        return false;
    }

    if (avformat_open_input(&formatContext, path.c_str(), nullptr, nullptr) < 0) {
        Logger::logError("Could not open input file: " + path);
        avformat_free_context(formatContext);
        formatContext = nullptr;
        return false;
    }

    if (avformat_find_stream_info(formatContext, nullptr) < 0) {
        Logger::logError("Could not find stream info");
        return false;
    }

    for (unsigned int i = 0; i < formatContext->nb_streams; i++) {
        const auto* codecpar = formatContext->streams[i]->codecpar;
        if (codecpar->codec_type == AVMEDIA_TYPE_VIDEO && videoStreamIndex < 0) {
            videoStreamIndex = static_cast<int>(i);
        } else if (codecpar->codec_type == AVMEDIA_TYPE_AUDIO && audioStreamIndex < 0) {
            audioStreamIndex = static_cast<int>(i);
        }
    }

    if (videoStreamIndex < 0) {
        Logger::logError("Could not find video stream");
        return false;
    }

    const AVCodec* videoCodec = nullptr;
    const auto* videoCodecPar = formatContext->streams[videoStreamIndex]->codecpar;
    if (videoCodecPar->codec_id == AV_CODEC_ID_HEVC) {
        videoCodec = avcodec_find_decoder_by_name("hevc_v4l2m2m");
        if (!videoCodec) {
            Logger::logInfo("Hardware HEVC decoder unavailable, falling back to software decoder");
        }
    }

    if (!videoCodec) {
        videoCodec = avcodec_find_decoder(videoCodecPar->codec_id);
    }

    if (!videoCodec) {
        Logger::logError("Unsupported video codec");
        return false;
    }

    codecContext = avcodec_alloc_context3(videoCodec);
    if (!codecContext) {
        Logger::logError("Could not allocate video codec context");
        return false;
    }

    if (avcodec_parameters_to_context(codecContext, videoCodecPar) < 0) {
        Logger::logError("Could not copy video codec parameters");
        return false;
    }

    codecContext->thread_count = 1;
    codecContext->flags |= AV_CODEC_FLAG_LOW_DELAY;
    codecContext->flags |= AV_CODEC_FLAG_OUTPUT_CORRUPT;
    codecContext->err_recognition = 0;

    if (avcodec_open2(codecContext, videoCodec, nullptr) < 0) {
        Logger::logError("Could not open video codec");
        return false;
    }

    if (audioStreamIndex >= 0) {
        const auto* audioCodecPar = formatContext->streams[audioStreamIndex]->codecpar;
        const AVCodec* audioCodec = avcodec_find_decoder(audioCodecPar->codec_id);
        if (!audioCodec) {
            Logger::logError("Unsupported audio codec");
            return false;
        }

        audioCodecContext = avcodec_alloc_context3(audioCodec);
        if (!audioCodecContext) {
            Logger::logError("Could not allocate audio codec context");
            return false;
        }

        if (avcodec_parameters_to_context(audioCodecContext, audioCodecPar) < 0) {
            Logger::logError("Could not copy audio codec parameters");
            return false;
        }

        if (avcodec_open2(audioCodecContext, audioCodec, nullptr) < 0) {
            Logger::logError("Could not open audio codec");
            return false;
        }
    }

    Logger::logInfo(
        "Decoder initialized: " + std::to_string(codecContext->width) + "x" +
        std::to_string(codecContext->height)
    );

    return true;
}

void VideoDecoder::startDecoding() {
    if (isRunning) {
        return;
    }

    endOfStream = false;
    isRunning = true;
    decodeThread = std::thread(&VideoDecoder::decodeThreadFunction, this);
}

void VideoDecoder::stopDecoding() {
    isRunning = false;
    condition.notify_all();

    if (decodeThread.joinable()) {
        decodeThread.join();
    }

    clearFrameQueue();

    if (audioCodecContext) {
        avcodec_free_context(&audioCodecContext);
    }

    if (codecContext) {
        avcodec_free_context(&codecContext);
    }

    if (formatContext) {
        avformat_close_input(&formatContext);
    }

    videoStreamIndex = -1;
    audioStreamIndex = -1;
    endOfStream = false;
}

AVFrame* VideoDecoder::getNextFrame() {
    std::unique_lock<std::mutex> lock(mutex);
    if (frameQueue.empty()) {
        return nullptr;
    }

    AVFrame* frame = frameQueue.front();
    frameQueue.pop();
    lock.unlock();

    condition.notify_one();
    return frame;
}

AVStream* VideoDecoder::getVideoStream() const {
    if (!formatContext || videoStreamIndex < 0) {
        return nullptr;
    }

    return formatContext->streams[videoStreamIndex];
}

AVStream* VideoDecoder::getAudioStream() const {
    if (!formatContext || audioStreamIndex < 0) {
        return nullptr;
    }

    return formatContext->streams[audioStreamIndex];
}

void VideoDecoder::decodeThreadFunction() {
    AVPacket* packet = av_packet_alloc();
    AVFrame* frame = av_frame_alloc();

    if (!packet || !frame) {
        Logger::logError("Failed to allocate decode resources");
        if (frame) {
            av_frame_free(&frame);
        }
        if (packet) {
            av_packet_free(&packet);
        }
        return;
    }

    while (isRunning) {
        {
            std::unique_lock<std::mutex> lock(mutex);
            condition.wait(lock, [this]() {
                return !isRunning || frameQueue.size() < MAX_QUEUE_SIZE;
            });

            if (!isRunning) {
                break;
            }
        }

        const int readResult = av_read_frame(formatContext, packet);
        if (readResult < 0) {
            if (readResult == AVERROR_EOF) {
                endOfStream = true;
            } else {
                Logger::logError("Decoder read error: " + std::to_string(readResult));
            }
            break;
        }

        if (packet->stream_index == videoStreamIndex) {
            int result = avcodec_send_packet(codecContext, packet);
            if (result >= 0) {
                for (;;) {
                    result = avcodec_receive_frame(codecContext, frame);
                    if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) {
                        break;
                    }
                    if (result < 0) {
                        Logger::logError("Error receiving video frame: " + std::to_string(result));
                        break;
                    }

                    AVFrame* frameCopy = av_frame_clone(frame);
                    if (frameCopy) {
                        std::unique_lock<std::mutex> lock(mutex);
                        condition.wait(lock, [this]() {
                            return !isRunning || frameQueue.size() < MAX_QUEUE_SIZE;
                        });

                        if (!isRunning) {
                            av_frame_free(&frameCopy);
                            av_frame_unref(frame);
                            break;
                        }

                        frameQueue.push(frameCopy);
                        condition.notify_one();
                    }

                    av_frame_unref(frame);
                }
            }
        } else if (packet->stream_index == audioStreamIndex && audioCodecContext && audioManager) {
            int result = avcodec_send_packet(audioCodecContext, packet);
            if (result >= 0) {
                for (;;) {
                    result = avcodec_receive_frame(audioCodecContext, frame);
                    if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) {
                        break;
                    }
                    if (result < 0) {
                        Logger::logError("Error receiving audio frame: " + std::to_string(result));
                        break;
                    }

                    AVFrame* frameCopy = av_frame_clone(frame);
                    if (frameCopy) {
                        if (frameCopy->pts < 0 || frameCopy->pts == AV_NOPTS_VALUE) {
                            frameCopy->pts = frameCopy->best_effort_timestamp;
                        }
                        audioManager->pushFrame(frameCopy);
                    }

                    av_frame_unref(frame);
                }
            }
        }

        av_packet_unref(packet);
    }

    av_frame_free(&frame);
    av_packet_free(&packet);
    condition.notify_all();
}

void VideoDecoder::clearFrameQueue() {
    std::lock_guard<std::mutex> lock(mutex);
    while (!frameQueue.empty()) {
        AVFrame* frame = frameQueue.front();
        frameQueue.pop();
        av_frame_free(&frame);
    }
}
