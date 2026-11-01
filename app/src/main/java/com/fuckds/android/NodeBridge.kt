package com.fuckds.android

/** Thin JNI bridge to the Android/Bionic libnode build. */
internal object NodeBridge {
    init {
        System.loadLibrary("node")
        System.loadLibrary("node-bridge")
    }

    /** Blocks until the Node event loop exits. Call only on a worker thread. */
    external fun startNodeWithArguments(arguments: Array<String>, environment: Array<String>): Int
}
