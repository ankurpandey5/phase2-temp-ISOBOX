#include "../include/cgroups.h"
#include <fstream>
#include <iostream>
#include <cstdlib>
#include <string>

void setupCgroup(int pid, const std::string& containerName) {
    std::string cgroupPath = "/sys/fs/cgroup/" + containerName;
    system(("mkdir -p " + cgroupPath).c_str());

    std::ofstream cpuFile(cgroupPath + "/cpu.max");
    if (cpuFile.is_open()) {
        cpuFile << "50000 100000";
        cpuFile.close();
    }
//ram allocated to the container
    std::ofstream memFile(cgroupPath + "/memory.max");
    if (memFile.is_open()) {
        memFile << "500M";
        memFile.close();
    }

    std::ofstream procFile(cgroupPath + "/cgroup.procs");
    if (procFile.is_open()) {
        procFile << pid;
        procFile.close();
    }
}

void cleanupCgroup(const std::string& containerName) {
    std::string cgroupPath = "/sys/fs/cgroup/" + containerName;
    // Tries to remove the directory (rmdir only works if the directory is empty)
    system(("rmdir " + cgroupPath).c_str());
}