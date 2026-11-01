#include <jni.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <unistd.h>
#include <pthread.h>
#include <cstdio>
#include <android/log.h>
#include "node.h"

namespace {
constexpr const char *kTag = "fuckds-node";
int stdoutPipe[2];
int stderrPipe[2];

void *redirectToLogcat(void *opaque) {
    auto *descriptor = static_cast<int *>(opaque);
    const int fd = *descriptor;
    const int priority = descriptor == &stdoutPipe[0] ? ANDROID_LOG_INFO : ANDROID_LOG_ERROR;
    char buffer[4096];
    ssize_t count;
    while ((count = read(fd, buffer, sizeof(buffer) - 1)) > 0) {
        if (buffer[count - 1] == '\n') --count;
        buffer[count] = '\0';
        __android_log_write(priority, kTag, buffer);
    }
    return nullptr;
}

void startLogcatRedirect() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(stdoutPipe) == 0 && pipe(stderrPipe) == 0) {
        dup2(stdoutPipe[1], STDOUT_FILENO);
        dup2(stderrPipe[1], STDERR_FILENO);
        pthread_t outThread;
        pthread_t errThread;
        pthread_create(&outThread, nullptr, redirectToLogcat, &stdoutPipe[0]);
        pthread_create(&errThread, nullptr, redirectToLogcat, &stderrPipe[0]);
        pthread_detach(outThread);
        pthread_detach(errThread);
    } else {
        __android_log_write(ANDROID_LOG_WARN, kTag, "Unable to redirect Node stdout/stderr to logcat");
    }
}
}

extern "C" JNIEXPORT jint JNICALL
Java_com_fuckds_android_NodeBridge_startNodeWithArguments(
        JNIEnv *env, jobject /* this */, jobjectArray arguments, jobjectArray environment) {
    const jsize envCount = env->GetArrayLength(environment);
    for (jsize i = 0; i < envCount; ++i) {
        auto item = static_cast<jstring>(env->GetObjectArrayElement(environment, i));
        const char *entry = env->GetStringUTFChars(item, nullptr);
        if (entry) {
            const char *eq = std::strchr(entry, '=');
            if (eq) {
                const std::string key(entry, static_cast<size_t>(eq - entry));
                const std::string value(eq + 1);
                setenv(key.c_str(), value.c_str(), 1);
            }
            env->ReleaseStringUTFChars(item, entry);
        }
        env->DeleteLocalRef(item);
    }

    const char *engineDir = std::getenv("FUCKDS_ENGINE_DIR");
    if (engineDir && *engineDir) {
        chdir(engineDir);
        setenv("NODE_PATH", engineDir, 1);
    }

    startLogcatRedirect();

    const jsize argc = env->GetArrayLength(arguments);
    size_t bufferSize = 0;
    std::vector<std::string> values;
    values.reserve(static_cast<size_t>(argc));
    for (jsize i = 0; i < argc; ++i) {
        auto item = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char *arg = env->GetStringUTFChars(item, nullptr);
        values.emplace_back(arg ? arg : "");
        if (arg) env->ReleaseStringUTFChars(item, arg);
        env->DeleteLocalRef(item);
        bufferSize += values.back().size() + 1;
    }

    char *buffer = static_cast<char *>(std::calloc(bufferSize ? bufferSize : 1, 1));
    char **argv = static_cast<char **>(std::calloc(static_cast<size_t>(argc) + 1, sizeof(char *)));
    if (!buffer || !argv) {
        std::free(buffer);
        std::free(argv);
        return -1;
    }

    char *cursor = buffer;
    for (jsize i = 0; i < argc; ++i) {
        const auto &value = values[static_cast<size_t>(i)];
        argv[i] = cursor;
        std::memcpy(cursor, value.c_str(), value.size() + 1);
        cursor += value.size() + 1;
    }

    __android_log_write(ANDROID_LOG_INFO, kTag, "Starting embedded Node.js runtime");
    const int result = node::Start(argc, argv);
    __android_log_write(ANDROID_LOG_INFO, kTag, "Embedded Node.js runtime exited");
    std::free(argv);
    std::free(buffer);
    return result;
}
