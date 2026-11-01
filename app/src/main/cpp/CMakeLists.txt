cmake_minimum_required(VERSION 3.22.1)
project(fuckds_node_bridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(NODE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/node")
if(NOT EXISTS "${NODE_ROOT}/include/node/node.h")
    message(FATAL_ERROR "Node headers missing. Run the Android runtime preparation workflow.")
endif()

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES
    IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so"
)

add_library(node-bridge SHARED node-bridge.cpp)
target_include_directories(node-bridge PRIVATE "${NODE_ROOT}/include/node")
target_link_options(node-bridge PRIVATE "-Wl,-z,max-page-size=16384")
find_library(android-log log)
target_link_libraries(node-bridge node ${android-log})
